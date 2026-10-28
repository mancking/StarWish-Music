import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { getSettings } from './settings'
import { getJson } from './http'
import { userPluginsDir } from './paths'
import { buildMirrorList, fetchFirstOk, fetchFirstOkBuffer, markMirrorFail, parseRaw, rawMirrors } from './github-mirrors'
import { request } from './http'
import * as mfHost from './mf-host'
import * as sourceImportRouter from './source-import-router'
import { lxHost } from './lx-host'
import { listThemes, removeTheme, importThemeContent } from './theme-host'
import { createLogger } from './log'
import * as themeV2 from './theme-v2'

/**
 * 统一源市场门面
 *
 * 五通道分发：URL / 本地 JS / 订阅源 / 市场目录（多镜像竞速）/ git 分支 raw。
 * 四类源 kind 路由：lx-source / signed-source → lxHost（签名源为 lx 协议形态，平台签名封装在插件内）、
 * musicfree-plugin → mfHost、video-source → mfHost（mf 协议形态）。
 * manifest 条目兼容旧格式（无 kind 时按协议字段推断，C-27）。
 * 安装 sha256 校验（0.10.6）；已安装判断按 sourceUrl。
 */

const logger = createLogger('market')

export type SourceKind = 'lx-source' | 'signed-source' | 'musicfree-plugin' | 'video-source' | 'theme'

/** 主题资产清单条目（manifest v2，规格 S1.8） */
export interface ThemeAssetEntry {
  url: string
  sha256: string
  size: number
}

export interface ThemeAssetSet {
  bgImage?: ThemeAssetEntry
  bgGif?: ThemeAssetEntry
  iframe?: ThemeAssetEntry
}

export interface MarketItem {
  kind: SourceKind
  id: string
  name: string
  version?: string
  author?: string
  description?: string
  url: string
  hash?: string
  size?: number
  compat?: string
  changelog?: string
  commitSha?: string
  origin: 'market' | 'subscribe' | 'local' | 'url'
 /** 可更新（已装版本 < 市场版本， */
  canUpdate?: boolean
  installed?: boolean
  installedFile?: string
  /** 主题标签（manifest v2，≤5） */
  tags?: string[]
  /** 主题形态：color | image | gif | iframe（manifest v2） */
  themeType?: string
  /** 卡片预览图绝对 URL（manifest v2，缺省回退渐变预览） */
  preview?: string
  /** 卡片缩略图绝对 URL（manifest v2） */
  thumb?: string
  /** 主题资产清单（manifest v2，安装时逐个 sha256 校验） */
  assets?: ThemeAssetSet
  /** manifest schemaVersion（2 = 主题清单 v2） */
  schemaVersion?: number
}

/** 市场目录内存缓存（24h TTL） */
const marketCache = new Map<string, { at: number; items: MarketItem[] }>()
const MARKET_TTL = 24 * 60 * 60_000

/**
 * 市场清单落盘缓存（跨会话）。
 *
 * 旧实现只有进程内 Map 缓存：每次冷启动（移动端 App 被系统杀掉后重开）都要
 * 重新拉一次远端 manifest —— 移动端弱网下就是「打开插件市场要等十几秒」。
 * 现在把清单 JSON 落到 userPluginsDir()/.cache 下，重启后先读盘秒开，
 * 后台再悄悄刷新（stale-while-revalidate）。
 */
const MARKET_DISK_TTL = 6 * 60 * 60_000

function marketCacheFile(): string {
  return path.join(userPluginsDir(), '.cache', 'market-manifest.json')
}

function readMarketDiskCache(url: string): { at: number; items: MarketItem[] } | null {
  try {
    const f = marketCacheFile()
    if (!fs.existsSync(f)) return null
    const obj = JSON.parse(fs.readFileSync(f, 'utf8'))
    if (!obj || obj.url !== url || !Array.isArray(obj.items)) return null
    return { at: Number(obj.at) || 0, items: obj.items as MarketItem[] }
  } catch {
    return null
  }
}

function writeMarketDiskCache(url: string, items: MarketItem[]): void {
  try {
    const dir = path.join(userPluginsDir(), '.cache')
    fs.mkdirSync(dir, { recursive: true })
    fs.writeFileSync(marketCacheFile(), JSON.stringify({ url, at: Date.now(), items }), 'utf8')
  } catch {
    /* 缓存写失败不影响主流程 */
  }
}

/** kind 推断（兼容旧 manifest）：manifest 无 kind 时走嗅探判定表 */
function inferKind(entry: Record<string, any>): SourceKind {
  const declared = String(entry.kind || '').trim()
  if (declared === 'lx-source' || declared === 'video-source' || declared === 'musicfree-plugin' || declared === 'theme') {
    return declared as SourceKind
  }
  // 主题分支（Star-Wish-Theme-Library）manifest 条目：themes/<id>/ 形态或 colors 字段
  if (String(entry.url || '').includes('/themes/') || entry.colors) return 'theme'
  const code = String(entry.code || '')
  if (entry.musicSearch || /musicSearch/.test(code)) return 'lx-source'
  if (entry.videoSearch || /videoSearch/.test(code)) return 'video-source'
  /**
   * lx v2 清单形态：带 platform / types 字段（官方插件库的条目都长这样）。
   * 旧实现落到 musicfree-plugin，导致 40 多个音源全被塞进「插件」Tab，
   * 看起来像「市场只有十几个插件」。
   */
  if (entry.platform || Array.isArray(entry.types)) return 'lx-source'
  return 'musicfree-plugin'
}

/**
 * GitHub 分支目录枚举（清单补全）。
 *
 * 背景：维护者往分支里直接上传脚本后，若没有重跑 manifest 生成器，
 * 清单里的条目会远少于分支实际文件数（用户实测「分支 43 个，市场只显示 16 个」）。
 * 这里枚举分支目录，把清单里没有的 .js 补成条目。
 *
 * 双通道枚举：
 *   1. jsDelivr data API（data.jsdelivr.com）：CDN 节点多，国内可达性好，优先用
 *   2. api.github.com contents API：官方接口，需要网络直连 GitHub，失败回退
 *
 * - 只在 GitHub 仓库 + 清单不是纯主题清单时启用；
 * - kind 先按音源猜（绝大多数是 lx v2），安装时 importAny 仍会按内容嗅探纠偏；
 * - 结果缓存 30min：避免每次市场刷新都打一次 API，弱网下不叠加延迟。
 */
const branchListCache = new Map<string, { at: number; items: Array<{ name: string; url: string }> }>()
const BRANCH_LIST_TTL = 30 * 60_000

async function listBranchScripts(marketUrl: string): Promise<Array<{ name: string; url: string }>> {
  const cached = branchListCache.get(marketUrl)
  if (cached && Date.now() - cached.at < BRANCH_LIST_TTL) return cached.items

  const p = parseRaw(marketUrl)
  if (!p) return []

  // 通道 1：jsDelivr data API（CDN 可达性优先）
  try {
    const apiUrl = `https://data.jsdelivr.com/v1/packages/gh/${p.owner}/${p.repo}@${encodeURIComponent(p.branch)}`
    const res = await request(apiUrl, {
      headers: { Accept: 'application/json' },
      timeout: 8000,
      retry: 0,
    })
    if (res.status < 400 && res.body && Array.isArray(res.body.files)) {
      const items = (res.body.files as any[])
        .filter(f => f && f.type === 'file' && /\.js$/i.test(String(f.name || '')))
        .map(f => ({
          name: String(f.name).replace(/\.js$/i, ''),
          url: `https://raw.githubusercontent.com/${p.owner}/${p.repo}/${p.branch}/${encodeURIComponent(String(f.name))}`,
        }))
      if (items.length) {
        branchListCache.set(marketUrl, { at: Date.now(), items })
        logger.info(`分支目录枚举（jsDelivr）：${items.length} 个脚本`)
        return items
      }
    }
  } catch (e: any) {
    logger.debug('jsDelivr data API 枚举失败，回退 api.github.com', e?.message)
  }

  // 通道 2（回退）：api.github.com contents API
  const dir = p.filePath.includes('/') ? p.filePath.slice(0, p.filePath.lastIndexOf('/')) : ''
  const api = `https://api.github.com/repos/${p.owner}/${p.repo}/contents/${dir}?ref=${encodeURIComponent(p.branch)}`
  try {
    const res = await request(api, {
      headers: { Accept: 'application/vnd.github+json', ...authHeaders() },
      timeout: 8000,
      retry: 0,
    })
    if (res.status >= 400) return []
    const arr: any[] = Array.isArray(res.body) ? res.body : []
    const items = arr
      .filter(x => x && x.type === 'file' && /\.js$/i.test(String(x.name || '')))
      .map(x => ({
        name: String(x.name).replace(/\.js$/i, ''),
        url: `https://raw.githubusercontent.com/${p.owner}/${p.repo}/${p.branch}/${encodeURI(String(x.path))}`,
      }))
    branchListCache.set(marketUrl, { at: Date.now(), items })
    return items
  } catch (e: any) {
    logger.debug('api.github.com 枚举也失败', e?.message)
    return []
  }
}

function sha256(text: string): string {
  return crypto.createHash('sha256').update(text, 'utf8').digest('hex')
}

/**http 请求自动带 gitToken（私有仓库 raw 下载） */
function authHeaders(): Record<string, string> {
  const token = String((getSettings() as any).gitToken || '').trim()
  return token ? { Authorization: `Bearer ${token}` } : {}
}

/** 市场通道镜像候选：统一镜像池（github-mirrors，多端同源） */
export function mirrorCandidates(url: string): string[] {
  const parts = parseRaw(url)
  return parts ? rawMirrors(parts) : [url]
}

/**
 * 多镜像并发竞速拉取（统一镜像池 + 健康记忆）。
 *
 * 旧实现是 **串行** 遍历：第 1 个镜像不通要干等满 timeout（15s）才试第 2 个，
 * 8 个镜像最坏要等 2 分钟 —— 这就是「移动端插件市场拉取内容时间过长」的根因。
 *
 * 现在改为 **全部镜像并发发起 + Promise.any 先到先用**：
 *   - 正常情况：最快镜像（通常 jsDelivr CDN）几百毫秒返回
 *   - 镜像部分挂掉：其余仍在飞，谁先回用谁
 *   - 失败镜像进入冷却（指数退避），弱网下不再反复等超时
 *   - 全部失败：Promise.any 抛 AggregateError，转成中文错误
 */
async function fetchWithMirrors(url: string, timeout = 15000, preferOrigin = false): Promise<string> {
  const t0 = Date.now()
  try {
    const content = await fetchFirstOk(url, Math.min(timeout, 8000), {
      preferOrigin,
      headers: authHeaders(),
    })
    logger.info(`镜像竞速成功 ${Math.round(Date.now() - t0)}ms`)
    return content
  } catch (e: any) {
    logger.warn(`镜像竞速全部失败 ${Math.round(Date.now() - t0)}ms`, e?.message || String(e))
    throw new Error(`全部镜像拉取失败：${e?.message || String(e)}`)
  }
}

/**
 * 市场目录 → MarketItem（搜索/Tab 过滤在渲染层做，
 *
 * 缓存策略（stale-while-revalidate）：
 *   1. 进程内 Map 命中（24h）→ 直接返回
 *   2. 落盘缓存命中（6h）→ 立即返回旧清单，后台静默刷新（不阻塞首屏）
 *   3. 都没有 → 走镜像竞速拉取，写内存 + 落盘
 *   4. force=true（用户点「刷新」）→ 跳过全部缓存直接拉远端
 *     （Bug：维护者往市场分支上传新音源后，客户端点刷新仍命中 24h 旧缓存，
 *      表现为「上传的音源拉取不到」）
 */
export async function fetchMarketList(marketUrl: string, force = false): Promise<MarketItem[]> {
  if (!force) {
    const cached = marketCache.get(marketUrl)
    if (cached && Date.now() - cached.at < MARKET_TTL) return cached.items

    // 落盘缓存：先给旧数据，刷新在后台跑（弱网下用户不用干等）
    const disk = readMarketDiskCache(marketUrl)
    if (disk && Date.now() - disk.at < MARKET_DISK_TTL) {
      marketCache.set(marketUrl, disk)
      void refreshMarketList(marketUrl).catch(() => undefined)
      return disk.items
    }
  }
  return refreshMarketList(marketUrl, force)
}

/** 真正拉取远端清单并回填两级缓存 */
async function refreshMarketList(marketUrl: string, force = false): Promise<MarketItem[]> {
  const text = await fetchWithMirrors(marketUrl, 15000, force)
  let raw: any
  try {
    raw = JSON.parse(text)
  } catch {
    throw new Error('市场清单不是有效 JSON')
  }
  const arr: any[] = Array.isArray(raw) ? raw
    : Array.isArray(raw?.plugins) ? raw.plugins
    : Array.isArray(raw?.items) ? raw.items
    : Array.isArray(raw?.themes) ? raw.themes
    : []
  // 顶层 schemaVersion（主题清单 v2）；条目级优先
  const topSchema = Number(raw && !Array.isArray(raw) ? raw?.schemaVersion || 0 : 0) || 0
  const items: MarketItem[] = arr
    .map((it: any) => {
      let url = String(it.url || it.srcUrl || '')
      if (!/^https?:\/\//i.test(url)) return null
      const kind = inferKind(it)
      const base = mirrorBaseUrl(url)
      const entry: MarketItem = {
        kind,
        id: String(it.id || it.name || url),
        name: String(it.name || '未命名'),
        version: it.version ? String(it.version) : undefined,
        author: it.author ? String(it.author) : undefined,
        description: it.description ? String(it.description) : undefined,
        url,
        hash: it.hash ? String(it.hash) : undefined,
        compat: it.minAppVersion || it.compat ? String(it.minAppVersion || it.compat) : undefined,
        changelog: it.changelog ? String(it.changelog) : undefined,
        commitSha: it.commitSha ? String(it.commitSha) : undefined,
        origin: 'market' as const,
        schemaVersion: Number(it.schemaVersion || topSchema || 1) || undefined,
      }
      // manifest v2（主题清单）：标签/形态/预览/缩略图/资产清单
      if (entry.schemaVersion === 2) {
        if (Array.isArray(it.tags)) entry.tags = it.tags.slice(0, 5)
        const tt = String(it.type || '').trim()
        if (tt === 'color' || tt === 'image' || tt === 'gif' || tt === 'iframe') entry.themeType = tt
        if (it.preview) entry.preview = resolveRef(base, String(it.preview))
        if (it.thumb) entry.thumb = resolveRef(base, String(it.thumb))
        if (it.assets) entry.assets = it.assets
      }
      return entry
    })
    .filter(Boolean) as MarketItem[]

  // 清单补全：分支里有、清单没列的脚本（避免「分支 43 个、市场 16 个」）
  const onlyThemes = items.length > 0 && items.every(i => i.kind === 'theme')
  if (!onlyThemes) {
    try {
      const extra = await listBranchScripts(marketUrl)
      if (extra.length) {
        const have = new Set(items.map(i => i.url))
        let added = 0
        for (const f of extra) {
          if (have.has(f.url)) continue
          items.push({
            kind: 'lx-source',
            id: f.name,
            name: f.name,
            url: f.url,
            origin: 'market',
          })
          added++
        }
        if (added) logger.info(`市场清单补全 ${added} 项（分支共 ${extra.length} 个脚本）`)
      }
    } catch (e: any) {
      logger.warn('分支目录枚举失败（不影响清单）', e?.message)
    }
  }

  marketCache.set(marketUrl, { at: Date.now(), items })
  writeMarketDiskCache(marketUrl, items)
  return items
}

/** 把 raw_url 直链转成 manifest 基址（raw.githubusercontent 分段），供相对路径解析 */
function mirrorBaseUrl(url: string): string {
  try {
    const u = new URL(url)
    const segs = u.pathname.split('/')
    const file = segs.pop() || ''
    if (!file) return u.origin + u.pathname
    // .json → 主题清单；删掉文件名后剩余的就是 base
    return u.origin + segs.join('/') + '/'
  } catch {
    return url
  }
}

/** 相对引用转绝对 URL（manifest 基址 + 相对路径） */
function resolveRef(base: string, ref: string): string {
  try {
    return new URL(ref, base).href
  } catch {
    return ref
  }
}

/**
 * 已安装登记表（插件市场「更新」按钮失效的根因修复）
 *
 * 旧实现只用 mfHost.list() 的 sourceUrl 反查已安装状态，
 * 而 lx 音源 / lx 形态视频源走 lxHost，根本没有 sourceUrl 字段
 * → installed 恒为 false、canUpdate 恒为 false，按钮永远是「安装」，
 * 更新入口等于不存在。这里改为落一张安装登记表（url → file/kind/version），
 * 安装/更新/卸载三处同步维护，反查时按 kind 回各自宿主校验文件是否还在。
 */
interface InstalledRecord {
  url: string
  file: string
  kind: SourceKind
  version?: string
  hash?: string
  name?: string
  at: number
}

function registryPath(): string {
  return path.join(userPluginsDir(), '.market-installed.json')
}

function readRegistry(): Record<string, InstalledRecord> {
  try {
    const raw = fs.readFileSync(registryPath(), 'utf8')
    const obj = JSON.parse(raw)
    return obj && typeof obj === 'object' ? (obj as Record<string, InstalledRecord>) : {}
  } catch {
    return {}
  }
}

function writeRegistry(reg: Record<string, InstalledRecord>): void {
  try {
    fs.mkdirSync(userPluginsDir(), { recursive: true })
    fs.writeFileSync(registryPath(), JSON.stringify(reg, null, 2), 'utf8')
  } catch (e: any) {
    logger.warn('安装登记表写入失败', e?.message)
  }
}

function recordInstalled(item: MarketItem, file: string): void {
  const reg = readRegistry()
  reg[item.url] = {
    url: item.url,
    file,
    kind: item.kind,
    version: item.version,
    hash: item.hash,
    name: item.name,
    at: Date.now(),
  }
  writeRegistry(reg)
}

function forgetInstalled(url: string): void {
  const reg = readRegistry()
  if (reg[url]) {
    delete reg[url]
    writeRegistry(reg)
  }
}

/** 已安装判断按 sourceUrl 匹配；lx 源走登记表 */
function findInstalledByUrl(url: string): { file: string; version?: string; kind?: SourceKind; hash?: string } | null {
  const rec = readRegistry()[url]
  if (rec && rec.file) {
    // 文件仍在（用户可能已从插件页手动删除）才算已安装
    let alive = false
    if (rec.kind === 'theme') {
      // 主题包：v2 落盘在 themes/<id>/theme.json，v1 落盘在 themes/<id>.json
      const themeId = rec.file.replace(/\/theme\.json$/, '').replace(/\.json$/, '')
      try {
        alive = listThemes().some(t => t.id === themeId)
      } catch {
        alive = false
      }
    } else if (rec.kind === 'lx-source' || rec.kind === 'video-source') {
      alive = lxHost.list().some(s => s.file === rec.file) || mfHost.list().some(p => p.file === rec.file)
    } else {
      alive = mfHost.list().some(p => p.file === rec.file)
    }
    if (alive) return { file: rec.file, version: rec.version, kind: rec.kind, hash: rec.hash }
    forgetInstalled(url)
  }
  try {
    const list = mfHost.list()
    const hit = list.find(p => (p as any).sourceUrl === url)
    if (hit) return { file: hit.file, version: hit.version }
  } catch {
    /* ignore */
  }
  return null
}

function semverGt(a?: string, b?: string): boolean {
  const pa = String(a || '0').split(/[.-]/).map(x => parseInt(x, 10) || 0)
  const pb = String(b || '0').split(/[.-]/).map(x => parseInt(x, 10) || 0)
  for (let i = 0; i < 3; i++) {
    if ((pa[i] || 0) > (pb[i] || 0)) return true
    if ((pa[i] || 0) < (pb[i] || 0)) return false
  }
  return false
}

/** 默认市场地址：官方插件库分支 manifest（0.10.1「市场即 manifest」； 自定义市场 URL 优先） */
/** 主题市场独立分支（与插件市场 Star-Wish-Plugin-Library 相互独立） */
export const DEFAULT_THEME_MARKET_URL =
  'https://raw.githubusercontent.com/mancking/StarWish-Music/Star-Wish-Theme-Library/manifest.json'

/**
 * 在线主题库（独立分支）。分支尚未上架 manifest 时返回空数组而非报错，
 * UI 显示「主题库暂未上架」空态；force=true 绕过缓存（与插件市场同口径）。
 */
export async function listThemeMarket(url: string, force = false): Promise<MarketItem[]> {
  const marketUrl = String(url || '').trim() || DEFAULT_THEME_MARKET_URL
  try {
    const items = await fetchMarketList(marketUrl, force)
    return items.filter(it => it.kind === 'theme')
  } catch (e: any) {
    // 分支未就绪（404）属预期状态：静默空态，不向上抛
    if (/HTTP 404|全部镜像拉取失败/i.test(String(e?.message || e))) return []
    throw e
  }
}

export const DEFAULT_MARKET_URL =
  'https://raw.githubusercontent.com/mancking/StarWish-Music/Star-Wish-Plugin-Library/manifest.json'

/**
 * 市场清单自动拉取（用户需求：向插件分支 / 主题分支直接上传文件后，
 * 最迟 24h 内应用内可见，无需手动刷新）。启动后 30s 预热一次，之后每 24h 一次；
 * 拉取成功即刷新内存/磁盘缓存，失败静默（下次周期再试）。
 */
const MANIFEST_REFRESH_MS = 24 * 60 * 60_000
const MANIFEST_PREHEAT_DELAY_MS = 30_000
let manifestTimer: ReturnType<typeof setInterval> | null = null

export function startManifestAutoRefresh(onUpdated?: () => void): void {
  if (manifestTimer) return
  const refresh = async (): Promise<void> => {
    const urls = [
      String((getSettings() as any).marketUrl || '').trim() || DEFAULT_MARKET_URL,
      DEFAULT_THEME_MARKET_URL,
    ]
    for (const u of [...new Set(urls)]) {
      try {
        await fetchMarketList(u, true)
        onUpdated?.()
      } catch (e: any) {
        logger.warn('市场清单自动刷新失败（24h 后重试）', u, e?.message)
      }
    }
  }
  const first = setTimeout(() => void refresh(), MANIFEST_PREHEAT_DELAY_MS)
  if (typeof first === 'object' && first && 'unref' in (first as any)) {
    ;(first as any).unref?.()
  }
  manifestTimer = setInterval(() => void refresh(), MANIFEST_REFRESH_MS)
  if (typeof manifestTimer === 'object' && manifestTimer && 'unref' in manifestTimer) {
    ;(manifestTimer as any).unref?.()
  }
}

export function stopManifestAutoRefresh(): void {
  if (manifestTimer) {
    clearInterval(manifestTimer)
    manifestTimer = null
  }
}

/** 市场列表附带安装态与可更新标记；url 为空回退默认市场 */
export async function listMarket(url: string, force = false): Promise<MarketItem[]> {
  const marketUrl = String(url || (getSettings() as any).marketUrl || '').trim() || DEFAULT_MARKET_URL
  const items = await fetchMarketList(marketUrl, force)
  for (const it of items) {
    const inst = findInstalledByUrl(it.url)
    it.installed = !!inst
    it.installedFile = inst?.file
 // 版本号更高即可更新；manifest 无版本号时用 hash 变化判定（内容指纹）
    it.canUpdate =
      !!inst &&
      ((!!it.version && semverGt(it.version, inst.version)) ||
        (!it.version && !!it.hash && !!inst.hash && it.hash !== inst.hash))
  }
  return items
}

/**
 * manifest v2 主题包安装（多资产 + 逐资产 sha256 校验 + 落盘 themes/<id>/）
 *
 * 口径：
 *   1. 先拉 theme.json（入参 content），按 schema v2 校验、落盘 theme.json
 *   2. 按 assets 清单项逐资产拉取（镜像竞速），逐个 sha256 比对 + size 确认
 *   3. 任一资产失败 → 删整个 themes/<id>/（决不留半包）并抛错
 *   4. 全部通过后 file 写 <id>/theme.json 目录（theme-host 按 id 找目录即完成安装）
 */
async function installThemeV2(item: MarketItem, content: string): Promise<{ file: string; id: string; name: string }> {
  const id = String(item.id || '').trim()
  if (!id) throw new Error('主题包缺少 id')
  const dir = themeV2.themeV2Dir(id)
  // 1. 校验 theme.json 正文（content 是 manifest 条目 url 指向的 theme.json 原文）
  let raw: any
  try {
    raw = JSON.parse(content)
  } catch {
    throw new Error('主题包不是有效 JSON')
  }
  const meta = themeV2.validateThemeV2(raw)
  if (!meta.theme) throw new Error(`主题包 ${id} 校验失败：${meta.dropped.join('；')}`)
  const theme: themeV2.ThemeV2 = meta.theme
  // manifest 条目提供的信息优先（assets / preview / thumb / type / tags）
  if (item.assets) theme.assets = item.assets
  if (item.preview) theme.preview = item.preview
  if (item.thumb) theme.thumb = item.thumb
  if (item.themeType) theme.type = item.themeType as themeV2.ThemeV2['type']
  if (item.tags && item.tags.length) theme.tags = item.tags.slice(0, 5)
  themeV2.writeThemeV2(theme)
  logger.info(`v2 主题已落盘：${id}`)
  // 2. 逐资产下载 + sha256 校验
  const assets = theme.assets || {}
  for (const key of ['bgImage', 'bgGif', 'iframe'] as const) {
    const a = assets[key]
    if (!a) continue
    const buf = await fetchFirstOkBuffer(a.url, 20000, { preferOrigin: true })
    const hash = themeV2.sha256Buffer(buf)
    if (hash !== a.sha256.toLowerCase()) {
      themeV2.removeThemeV2Dir(id)
      throw new Error(`主题包 ${id} 的 ${key} 资产 sha256 不匹配（已回滚）`)
    }
    if (Number.isFinite(Number(a.size)) && Number(a.size) > 0 && buf.length !== Number(a.size)) {
      logger.warn(`资产 ${key} 大小不符：${buf.length} vs ${a.size}`)
    }
    const fname = key === 'bgImage' ? 'bg.jpg' : key === 'bgGif' ? 'bg.gif' : 'iframe.html'
    fs.writeFileSync(path.join(dir, fname), buf)
  }
  // 3. 预览/缩略图（manifest 补全的绝对 URL）
  if (item.preview) {
    const buf = await fetchFirstOkBuffer(item.preview, 20000, { preferOrigin: true })
    fs.writeFileSync(path.join(dir, 'preview.png'), buf)
  }
  if (item.thumb) {
    const buf = await fetchFirstOkBuffer(item.thumb, 20000, { preferOrigin: true })
    fs.writeFileSync(path.join(dir, 'thumb.jpg'), buf)
  }
  return { file: path.join(id, 'theme.json'), id, name: item.name || id }
}

/** 统一安装入口：按 kind 分发；sha256 校验（0.10.6） */
export async function installItem(item: MarketItem): Promise<{ file: string; kind: SourceKind }> {
  const reg = readRegistry()
  // 更新时沿用登记的文件名，保证原地替换而不是新增副本
  const prior = reg[item.url]?.file
  if (prior && !item.installedFile) item.installedFile = prior
  const content = await fetchWithMirrors(item.url, 20000)
  if (!content || content.length < 10) throw new Error('下载内容为空，可能不是有效脚本')
  const hash = sha256(content)
  if (item.hash && item.hash !== hash) {
    throw new Error('内容校验失败（sha256 不匹配），已拒绝安装')
  }
  if (item.kind === 'lx-source') {
    const r = await sourceImportRouter.importAny(content, {
      kind: 'lx-source',
      file: item.installedFile,
      origin: 'market',
      sourceUrl: item.url,
    })
    recordInstalled(item, r.file)
    return { file: r.file, kind: item.kind }
  }
  if (item.kind === 'signed-source') {
    // 签名源：lx 协议形态（平台签名封装在插件内），安装走同一 lx 通道，
    // kind 保留原值用于市场列表过滤（设置 → 音源与插件 → 签名源 Tab）
    const r = await sourceImportRouter.importAny(content, {
      kind: 'signed-source',
      file: item.installedFile,
      origin: 'market',
      sourceUrl: item.url,
    })
    recordInstalled(item, r.file)
    return { file: r.file, kind: item.kind }
  }
  if (item.kind === 'theme') {
    // v2 主题：多资产下载 + 逐个 sha256 校验 + 落盘 themes/<id>/
    if (item.schemaVersion === 2 || (item.assets && item.assets.bgImage)) {
      const r = await installThemeV2(item, content)
      recordInstalled(item, r.file)
      return { file: r.file, kind: item.kind }
    }
    // v1 主题：皮肤商店社区主题包（JSON ≤256KB 白名单校验）
    const r = importThemeContent(content, 'market')
    const f = r.theme.file || r.theme.id
    recordInstalled(item, f)
    return { file: f, kind: item.kind }
  }
  if (item.kind === 'video-source') {
    // 视频源协议分发统一交由 sourceImportRouter：
    // lx 形态走 lxHost，mf 形态走 mfHost（mf-host 已扩展视频四方法）。
    const r = await sourceImportRouter.importAny(content, {
      kind: 'video-source',
      file: item.installedFile,
      origin: 'market',
      sourceUrl: item.url,
    })
    recordInstalled(item, r.file)
    return { file: r.file, kind: item.kind }
  }
  const r = await sourceImportRouter.importAny(content, {
    kind: 'musicfree-plugin',
    file: item.installedFile,
    origin: 'market',
    sourceUrl: item.url,
  })
  recordInstalled(item, r.file)
  return { file: r.file, kind: item.kind }
}

/** 统一更新：先备份（mfHost 已带 .bak），lx 源更新同理走 importSource 原地替换 */
export async function updateItem(item: MarketItem): Promise<{ file: string }> {
  const r = await installItem(item)
  return { file: r.file }
}

/** 统一卸载：按 sourceUrl 找到文件后删除 */
export async function uninstallItem(item: MarketItem): Promise<boolean> {
  const inst = findInstalledByUrl(item.url)
  if (!inst) return false
 // 按实际宿主删除：主题走 theme-host，lx 源在 lxHost，其余在 mfHost
  if (inst.kind === 'theme') {
    try {
      removeTheme(String(inst.file).replace(/\/theme\.json$/, '').replace(/\.json$/, ''))
    } catch (e: any) {
      logger.warn('主题卸载失败', e?.message)
    }
    forgetInstalled(item.url)
    return true
  }
  const inLx = lxHost.list().some(s => s.file === inst.file)
  if (inLx) lxHost.deleteSource(inst.file)
  else mfHost.deletePlugin(inst.file)
  forgetInstalled(item.url)
  return true
}

/** 市场通道说明（0.10.4 通道矩阵展示） */
export function channels(): { key: string; label: string; desc: string }[] {
  return [
    { key: 'url', label: 'URL 导入', desc: '粘贴 http(s) 直链导入音源/插件' },
    { key: 'local', label: '本地 JS', desc: '从文件选择 .js 脚本导入' },
    { key: 'subscribe', label: '订阅源', desc: '订阅清单自动同步与刷新' },
    { key: 'market', label: '市场目录', desc: '多镜像竞速拉取市场 manifest' },
    { key: 'git', label: 'git 分支分发', desc: 'raw 直链即分支 manifest（HTTP 托管）' },
  ]
}

/**本地内容缓存（同 URL 重复更新 sha1 未变不重新下载） */
const contentCacheDir = (): string => path.join(userPluginsDir(), '.cache')

export async function cachedFetch(url: string): Promise<string> {
  try {
    fs.mkdirSync(contentCacheDir(), { recursive: true })
    const key = crypto.createHash('sha1').update(url).digest('hex')
    const file = path.join(contentCacheDir(), key)
    if (fs.existsSync(file)) return fs.readFileSync(file, 'utf8')
    const content = await fetchWithMirrors(url)
    fs.writeFileSync(file, content, 'utf8')
    return content
  } catch {
    return fetchWithMirrors(url)
  }
}

void getJson
