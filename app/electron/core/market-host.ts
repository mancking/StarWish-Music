import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { getSettings } from './settings'
import { getJson, request } from './http'
import { userPluginsDir } from './paths'
import * as mfHost from './mf-host'
import { lxHost } from './lx-host'
import { createLogger } from './log'

/**
 * 统一源市场门面（规格书 0.10 / C-26 / F-31 · 独立模块）
 *
 * 五通道分发：URL / 本地 JS / 订阅源 / 市场目录（多镜像竞速）/ git 分支 raw。
 * 三类源 kind 路由：lx-source → lxHost、musicfree-plugin → mfHost、video-source → mfHost（mf 协议形态）。
 * manifest 条目兼容旧格式（无 kind 时按协议字段推断，C-27）。
 * 安装 sha256 校验（N8/0.10.6）；已安装判断按 sourceUrl（Bug 125/126）。
 */

const logger = createLogger('market')

export type SourceKind = 'lx-source' | 'musicfree-plugin' | 'video-source'

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
  /** 可更新（已装版本 < 市场版本，N30） */
  canUpdate?: boolean
  installed?: boolean
  installedFile?: string
}

/** 市场目录磁盘缓存（24h TTL，OctoPrint repository_ttl 口径） */
const marketCache = new Map<string, { at: number; items: MarketItem[] }>()
const MARKET_TTL = 24 * 60 * 60_000

/** kind 推断（C-27 兼容旧 manifest） */
function inferKind(entry: Record<string, any>): SourceKind {
  const declared = String(entry.kind || '').trim()
  if (declared === 'lx-source' || declared === 'video-source' || declared === 'musicfree-plugin') {
    return declared as SourceKind
  }
  const code = String(entry.code || '')
  if (entry.musicSearch || /musicSearch/.test(code)) return 'lx-source'
  if (entry.videoSearch || /videoSearch/.test(code)) return 'video-source'
  return 'musicfree-plugin'
}

function sha256(text: string): string {
  return crypto.createHash('sha256').update(text, 'utf8').digest('hex')
}

/** N31：http 请求自动带 gitToken（私有仓库 raw 下载） */
function authHeaders(): Record<string, string> {
  const token = String((getSettings() as any).gitToken || '').trim()
  return token ? { Authorization: `Bearer ${token}` } : {}
}

/** N24/N29：多镜像竞速拉取（raw → jsDelivr → ghproxy），桌面补到与移动端对等 */
function mirrorCandidates(url: string): string[] {
  const out = [url]
  const m = /^(https?):\/\/(raw\.githubusercontent\.com|github\.com)\/([^/]+)\/([^/]+)\/((?:blob\/)?([^/]+)\/(.+)|.+)$/i.exec(url)
  if (m) {
    const proto = m[1]!
    const owner = m[3]!
    const repo = m[4]!
    const rest = m[5]!
    const branch = m[6] || 'main'
    const filePath = m[7] || rest
    out.push(`${proto}://cdn.jsdelivr.net/gh/${owner}/${repo}@${branch}/${filePath}`)
    out.push(`${proto}://ghproxy.com/https://raw.githubusercontent.com/${owner}/${repo}/${branch}/${filePath}`)
    out.push(`${proto}://raw.gitmirror.com/${owner}/${repo}/${branch}/${filePath}`)
    out.push(`${proto}://raw.githubusercdn.com/${owner}/${repo}/${branch}/${filePath}`)
  }
  return out
}

async function fetchWithMirrors(url: string, timeout = 15000): Promise<string> {
  const mirrors = mirrorCandidates(url)
  let lastErr: Error | null = null
  for (const u of mirrors) {
    try {
      const res = await request(u, { headers: { 'User-Agent': 'StarWish-Music', ...authHeaders() }, timeout })
      if (res.status === 200 && (res.raw || res.body)) {
        return typeof res.body === 'string' ? res.body : res.raw
      }
      lastErr = new Error(`HTTP ${res.status}`)
    } catch (e: any) {
      lastErr = e
    }
  }
  throw lastErr || new Error('全部镜像拉取失败')
}

/** 市场目录 → MarketItem[]（搜索/Tab 过滤在渲染层做，N28） */
export async function fetchMarketList(marketUrl: string): Promise<MarketItem[]> {
  const cached = marketCache.get(marketUrl)
  if (cached && Date.now() - cached.at < MARKET_TTL) return cached.items
  const text = await fetchWithMirrors(marketUrl)
  let raw: any
  try {
    raw = JSON.parse(text)
  } catch {
    throw new Error('市场清单不是有效 JSON')
  }
  const arr: any[] = Array.isArray(raw) ? raw : Array.isArray(raw?.plugins) ? raw.plugins : Array.isArray(raw?.items) ? raw.items : []
  const items: MarketItem[] = arr
    .map((it: any) => {
      const url = String(it.url || it.srcUrl || '')
      if (!/^https?:\/\//i.test(url)) return null
      const kind = inferKind(it)
      return {
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
      }
    })
    .filter(Boolean) as MarketItem[]
  marketCache.set(marketUrl, { at: Date.now(), items })
  return items
}

/** 已安装判断按 sourceUrl 匹配（Bug 125/126） */
function findInstalledByUrl(url: string): { file: string; version?: string } | null {
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

/** 市场列表附带安装态与可更新标记（N30） */
export async function listMarket(url: string): Promise<MarketItem[]> {
  const items = await fetchMarketList(url)
  for (const it of items) {
    const inst = findInstalledByUrl(it.url)
    it.installed = !!inst
    it.installedFile = inst?.file
    it.canUpdate = !!inst && !!it.version && semverGt(it.version, inst.version)
  }
  return items
}

/** 统一安装入口（F-31）：按 kind 分发；sha256 校验（0.10.6） */
export async function installItem(item: MarketItem): Promise<{ file: string; kind: SourceKind }> {
  const content = await fetchWithMirrors(item.url, 20000)
  if (!content || content.length < 10) throw new Error('下载内容为空，可能不是有效脚本')
  const hash = sha256(content)
  if (item.hash && item.hash !== hash) {
    throw new Error('内容校验失败（sha256 不匹配），已拒绝安装')
  }
  if (item.kind === 'lx-source') {
    const r = await lxHost.importSource({ content, file: item.installedFile })
    return { file: r.file, kind: item.kind }
  }
  if (item.kind === 'video-source') {
    // 视频源走 mfHost 插件形态（协议限制：视频站类源必须走 mfHost，0.10.5）
    const r = mfHost.importFromContent(content, 'market', item.url, item.installedFile)
    return { file: r.file, kind: item.kind }
  }
  const r = mfHost.importFromContent(content, 'market', item.url, item.installedFile)
  return { file: r.file, kind: item.kind }
}

/** 统一更新：先备份（mfHost 已带 .bak），lx 源更新同理走 importSource 原地替换 */
export async function updateItem(item: MarketItem): Promise<{ file: string }> {
  const r = await installItem(item)
  return { file: r.file }
}

/** 统一卸载：按 sourceUrl 找到文件后删除（Bug 125/126） */
export async function uninstallItem(item: MarketItem): Promise<boolean> {
  const inst = findInstalledByUrl(item.url)
  if (!inst) return false
  mfHost.deletePlugin(inst.file)
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

/** F-32：本地内容缓存（同 URL 重复更新 sha1 未变不重新下载） */
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
