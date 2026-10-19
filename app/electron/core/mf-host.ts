import fs from 'node:fs'
import path from 'node:path'
import vm from 'node:vm'
import type { PluginInfo, PluginSubscription } from '../../shared/types'
import { createLogger } from './log'
import { request } from './http'
import { userPluginsDir, pluginsRegistryFile, builtinPluginsDir } from './paths'
// 静态导入而非 createRequire：桌面（esbuild）与移动端（vite）都能解析同一份依赖。
// ponytail: 覆盖下列 7 个常用依赖；若插件 require 其他模块会抛错——需要时再扩展 DEPS。
import axios from 'axios'
import * as cheerio from 'cheerio'
import CryptoJS from 'crypto-js'
import dayjs from 'dayjs'
import * as qs from 'qs'
import * as heNS from 'he'
import BigInteger from 'big-integer'

const logger = createLogger('mf-host')

// he 是纯 ESM（仅具名导出 decode/encode/escape/unescape，无默认导出）；插件 shim 里
// `require('he')` 期望拿到含 .decode/.encode 的对象，这里手工补一个等价的默认导出。
const he = { ...(heNS as any) }

const DEPS: Record<string, any> = {
  axios,
  cheerio,
  'crypto-js': CryptoJS,
  dayjs,
  qs,
  he,
  'big-integer': BigInteger,
}

interface LoadedPlugin {
  file: string
  fullPath: string
  meta: any // module.exports 原始对象
  info: PluginInfo
}

const PLUGIN_EXT = new Set(['.js', '.cjs', '.txt'])
const plugins = new Map<string, LoadedPlugin>()

/* ---------------- 注册表（记录 origin / sourceUrl / 订阅） ---------------- */

interface Registry {
  entries: Record<string, { origin: PluginInfo['origin']; sourceUrl?: string; enabled?: boolean }>
  subscriptions: PluginSubscription[]
}

function readRegistry(): Registry {
  try {
    const raw = fs.readFileSync(pluginsRegistryFile(), 'utf8')
    const obj = JSON.parse(raw)
    return { entries: obj.entries || {}, subscriptions: obj.subscriptions || [] }
  } catch {
    return { entries: {}, subscriptions: [] }
  }
}

function writeRegistry(reg: Registry): void {
  fs.writeFileSync(pluginsRegistryFile(), JSON.stringify(reg, null, 2), 'utf8')
}

/* ---------------- 加载 ---------------- */

function safeFileName(name: string): string {
  return name.replace(/[^\w一-龥-]+/g, '_').replace(/^_+|_+$/g, '') || 'plugin'
}

/** 在 vm 沙箱里运行插件源码，拿到 module.exports */
function evalPlugin(code: string, filename: string): any {
  const module = { exports: {} as any }
  const req = (name: string) => {
    if (name in DEPS) return DEPS[name]
    throw new Error(`插件依赖 ${name} 不在支持列表内`)
  }
  const sandbox: any = {
    module,
    exports: module.exports,
    require: req,
    console,
    setTimeout,
    clearTimeout,
    setInterval,
    clearInterval,
    Buffer,
    URL,
    URLSearchParams,
    Math,
    JSON,
    Date,
    RegExp,
    Promise,
    Object,
    Array,
    String,
    Number,
    Boolean,
    encodeURIComponent,
    decodeURIComponent,
    encodeURI,
    decodeURI,
  }
  vm.createContext(sandbox)
  vm.runInContext(code, sandbox, { filename, timeout: 20000 })
  return module.exports
}

function loadOne(file: string, dir?: string, builtin = false): LoadedPlugin | null {
  const baseDir = dir || userPluginsDir()
  const fullPath = path.join(baseDir, file)
  try {
    const code = fs.readFileSync(fullPath, 'utf8')
    const meta = evalPlugin(code, file)
    if (!meta || typeof meta !== 'object') throw new Error('插件未导出对象')
    const reg = readRegistry()
    const entry = reg.entries[file] || {}
    const searchTypes: string[] = Array.isArray(meta.supportedSearchType)
      ? meta.supportedSearchType
      : meta.search && typeof meta.search === 'function'
        ? ['music']
        : []
    const info: PluginInfo = {
      file,
      name: String(meta.platform || path.basename(file, path.extname(file))),
      version: meta.version ? String(meta.version) : undefined,
      author: meta.author ? String(meta.author) : undefined,
      platform: meta.platform ? String(meta.platform) : undefined,
      description: meta.description ? String(meta.description) : undefined,
      searchTypes,
      origin: entry.origin || 'local',
      sourceUrl: entry.sourceUrl,
      loadError: null,
      // 插件默认关闭：仅当用户显式开启（enabled===true）才启用，避免新装插件自动参与聚合搜索。
      enabled: entry.enabled === true,
      builtin,
    }
    return { file, fullPath, meta, info }
  } catch (e) {
    const reg = readRegistry()
    const entry = reg.entries[file] || {}
    const info: PluginInfo = {
      file,
      name: path.basename(file, path.extname(file)),
      searchTypes: [],
      origin: entry.origin || 'local',
      sourceUrl: entry.sourceUrl,
      loadError: (e as Error).message,
      // 同上：默认关闭。
      enabled: entry.enabled === true,
      builtin,
    }
    return { file, fullPath, meta: null, info }
  }
}

function listDir(dir: string | null): string[] {
  if (!dir) return []
  try {
    return fs.readdirSync(dir).filter(f => PLUGIN_EXT.has(path.extname(f).toLowerCase()))
  } catch {
    return []
  }
}

function loadAll(): void {
  plugins.clear()
  // 内置插件优先（随包只读），再叠加用户目录（同名用户插件覆盖内置）
  const builtinDir = builtinPluginsDir()
  for (const f of listDir(builtinDir)) {
    const p = loadOne(f, builtinDir!, true)
    if (p) plugins.set(f, p)
  }
  const userDir = userPluginsDir()
  for (const f of listDir(userDir)) {
    const p = loadOne(f, userDir, false)
    if (p) plugins.set(f, p)
  }
  logger.info(`已加载 ${plugins.size} 个插件`)
}

/* ---------------- 对外 API ---------------- */

export function list(): PluginInfo[] {
  if (!plugins.size) loadAll()
  return [...plugins.values()].map(p => p.info).sort((a, b) => a.name.localeCompare(b.name))
}

export function getSourceCode(file: string): string {
  if (!plugins.size) loadAll()
  const p = plugins.get(file)
  if (!p) throw new Error(`插件不存在：${file}`)
  return fs.readFileSync(p.fullPath, 'utf8')
}

export function togglePlugin(file: string, enabled: boolean): PluginInfo[] {
  const reg = readRegistry()
  reg.entries[file] = { ...(reg.entries[file] || { origin: 'local' }), enabled }
  writeRegistry(reg)
  loadAll()
  return list()
}

export function deletePlugin(file: string): PluginInfo[] {
  if (!plugins.size) loadAll()
  const p = plugins.get(file)
  if (p?.info.builtin) throw new Error('内置插件随应用分发，无法删除（可停用）')
  try {
    fs.unlinkSync(path.join(userPluginsDir(), file))
  } catch (e) {
    logger.warn(`删除插件失败 ${file}: ${(e as Error).message}`)
  }
  const reg = readRegistry()
  delete reg.entries[file]
  writeRegistry(reg)
  loadAll()
  return list()
}

export interface ImportResult {
  file: string
  plugins: PluginInfo[]
}

/** 从内容导入（本地文件读取后传入） */
export function importFromContent(
  content: string,
  origin: PluginInfo['origin'] = 'local',
  sourceUrl?: string
): ImportResult {
  const dir = userPluginsDir()
  // 尝试解析出平台名做文件名
  let base = 'plugin'
  try {
    const probe = evalPlugin(content, 'probe.js')
    if (probe?.platform) base = safeFileName(String(probe.platform))
  } catch {
    /* 解析失败则用通用名 */
  }
  let file = `${base}.js`
  let i = 1
  while (fs.existsSync(path.join(dir, file))) {
    file = `${base}-${i++}.js`
  }
  fs.writeFileSync(path.join(dir, file), content, 'utf8')
  const reg = readRegistry()
  reg.entries[file] = { origin, sourceUrl }
  writeRegistry(reg)
  loadAll()
  return { file, plugins: list() }
}

/** 从网址导入（下载后按内容导入） */
export async function importFromUrl(url: string): Promise<ImportResult> {
  if (!/^https?:\/\//i.test(url)) throw new Error('仅支持 http(s) 链接')
  const res = await request(url, { timeout: 20000 })
  const body: any = res.body
  const content = typeof body === 'string' ? body : res.raw || ''
  if (!content || content.length < 10) throw new Error('下载内容为空或过短，可能不是插件脚本')
  return importFromContent(content, 'url', url)
}

export function listSubscriptions(): PluginSubscription[] {
  return readRegistry().subscriptions
}

/**
 * 从订阅源导入：订阅地址返回插件清单。
 * 支持两种格式：JSON 数组 [{name,url}]，或纯文本每行一个 url。
 * 导入/更新该订阅下的全部插件（按 url 去重，存在则覆盖更新）。
 */
export async function importSubscription(url: string, name?: string): Promise<{ added: number; updated: number; subscriptions: PluginSubscription[] }> {
  if (!/^https?:\/\//i.test(url)) throw new Error('仅支持 http(s) 订阅链接')
  const res = await request(url, { timeout: 20000 })
  const raw: any = res.body
  const text = typeof raw === 'string' ? raw : res.raw || ''

  let listItems: { name?: string; url: string }[] = []
  try {
    const json = JSON.parse(text)
    const arr = Array.isArray(json) ? json : Array.isArray(json?.plugins) ? json.plugins : null
    if (arr) {
      listItems = arr
        .map((it: any) => (typeof it === 'string' ? { url: it } : { name: it.name, url: it.url || it.srcUrl }))
        .filter(it => it && /^https?:\/\//i.test(it.url))
    }
  } catch {
    // 非 JSON：按行解析 URL
    listItems = text
      .split(/\r?\n/)
      .map(l => l.trim())
      .filter(l => /^https?:\/\//i.test(l))
      .map(u => ({ url: u }))
  }
  if (!listItems.length) throw new Error('订阅源未解析到任何插件地址（支持 JSON 数组或每行一个 URL）')

  const reg = readRegistry()
  let added = 0
  let updated = 0
  for (const item of listItems) {
    try {
      const dl = await request(item.url, { timeout: 20000 })
      const dlBody: any = dl.body
      const content = typeof dlBody === 'string' ? dlBody : dl.raw || ''
      if (!content || content.length < 10) continue
      // 若该 sourceUrl 已导入过，则覆盖其文件
      const existing = Object.entries(reg.entries).find(([, e]) => e.sourceUrl === item.url)
      if (existing) {
        fs.writeFileSync(path.join(userPluginsDir(), existing[0]), content, 'utf8')
        updated++
      } else {
        importFromContent(content, 'subscribe', item.url)
        added++
      }
    } catch (e) {
      logger.warn(`订阅插件导入失败 ${item.url}: ${(e as Error).message}`)
    }
  }

  const idx = reg.subscriptions.findIndex(s => s.url === url)
  const sub: PluginSubscription = {
    name: name || url,
    url,
    updatedAt: Date.now(),
    count: listItems.length,
  }
  if (idx >= 0) reg.subscriptions[idx] = sub
  else reg.subscriptions.push(sub)
  writeRegistry(reg)
  loadAll()
  return { added, updated, subscriptions: reg.subscriptions }
}

export function removeSubscription(url: string): PluginSubscription[] {
  const reg = readRegistry()
  reg.subscriptions = reg.subscriptions.filter(s => s.url !== url)
  writeRegistry(reg)
  return reg.subscriptions
}

export interface MarketEntry {
  name: string
  file?: string
  url: string
  version?: string
  author?: string
  description?: string
  platform?: string
  supportedSearchType?: string[]
}

/** 拉取插件市场目录（走后端 request，规避渲染层直连 raw.githubusercontent 的 fetch failed） */
export async function fetchMarket(url: string): Promise<MarketEntry[]> {
  const res = await request(url, { timeout: 20000, headers: { Accept: 'application/json' } })
  const data: any = res.body
  const arr: any[] = Array.isArray(data) ? data : Array.isArray(data?.plugins) ? data.plugins : []
  return arr.map((it: any) => (typeof it === 'string' ? { name: it, url: it } : it)).filter((it: any) => it && /^https?:\/\//i.test(it.url))
}

/* ---------------- 运行插件能力 ---------------- */

function getEnabled(file: string): LoadedPlugin {
  if (!plugins.size) loadAll()
  const p = plugins.get(file)
  if (!p) throw new Error(`插件不存在：${file}`)
  if (p.info.loadError) throw new Error(`插件加载失败：${p.info.loadError}`)
  if (!p.info.enabled) throw new Error(`插件已停用：${p.info.name}`)
  return p
}

/** 调用插件方法，带 try/catch 与超时兜底 */
async function callMethod(file: string, method: string, ...args: any[]): Promise<any> {
  const p = getEnabled(file)
  const fn = p.meta?.[method]
  if (typeof fn !== 'function') return undefined
  return await fn.apply(p.meta, args)
}

/** 搜索：type 取 music/lyric/album/artist/sheet/comment */
export async function search(file: string, query: string, page = 1, type: string = 'music'): Promise<any> {
  const res = await callMethod(file, 'search', query, page, type)
  return res || { isEnd: true, data: [] }
}

export async function getLyric(file: string, musicItem: any): Promise<{ rawLrc?: string; lrc?: string }> {
  const res = await callMethod(file, 'getLyric', musicItem)
  return res || {}
}

export async function getMediaSource(file: string, musicItem: any, quality = 'standard'): Promise<any> {
  return await callMethod(file, 'getMediaSource', musicItem, quality)
}

export async function getMusicUrl(file: string, musicItem: any, quality = 'standard'): Promise<any> {
  // 部分插件用 getMusicUrl/getMediaSource 之一
  const viaUrl = await callMethod(file, 'getMusicUrl', musicItem, quality)
  if (viaUrl) return viaUrl
  return await getMediaSource(file, musicItem, quality)
}

export async function getMusicInfo(file: string, musicItem: any): Promise<any> {
  return await callMethod(file, 'getMusicInfo', musicItem)
}

/** 启动时预热一次（失败不影响主流程） */
export function init(): void {
  try {
    loadAll()
  } catch (e) {
    logger.warn(`插件库初始化失败：${(e as Error).message}`)
  }
}
