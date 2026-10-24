import fs from 'node:fs'
import path from 'node:path'
import vm from 'node:vm'
import crypto from 'node:crypto'
import zlib from 'node:zlib'
import { promisify } from 'node:util'
import type { Song, SourceInfo, SourcePlatform } from '../../shared/types'
import { createLogger } from './log'
import { request, UA } from './http'
import { sourcesDir, userSourcesDir } from './paths'

const logger = createLogger('lx-host')

/* ================= 0.8 内置音源治理 =================
 * 0.8.1 随包白名单：sources/ 仅自研 3 源（package.json extraResources filter）；
 * 0.8.2 沙箱 request 域名白名单（C-23）+ 加载期禁远程自更新（C-19，野草/野花/长青类启动 GET 一律拦截）
 *      + setTimeout/Interval 受限代理（下限 100ms 防忙等）；
 * 0.8.3 debug 日志开关（F-17）：logs/sources/<源名>.log 按源记录请求明细；
 * 默认禁用（Bug 113/114）：oiapi 依赖源与未实现 wbi 签名的 B 站音源默认 disabled、可手动启用。
 */

/** 沙箱出站域名白名单（官方域 + 用户导入时确认追加） */
const SANDBOX_HOST_ALLOW = new Set<string>([
  'music.163.com', 'interface.music.163.com', 'music.126.net',
  'u.y.qq.com', 'c.y.qq.com', 'dl.stream.qqmusic.qq.com', 'isure.stream.qqmusic.qq.com', 'aqqmusic.tc.qq.com',
  'm3ws.kugou.com', 'mobilecdn.kugou.com', 'www.kugou.com', 'service.kugou.com',
  'www.kuwo.cn', 'nmobi.kuwo.cn', 'kuwo.cn', 'oiapi.net',
  'api.bilibili.com', 'api.bilibili.tv', 'upos-sz-mirror08c.bilivideo.com',
  'itunes.apple.com', 'miguvideo.com', 'music.migu.cn',
])
const sandboxAllowExtra = new Set<string>()
export function addSandboxHosts(hosts: string[]): void {
  for (const h of hosts || []) {
    const clean = String(h || '').trim().toLowerCase()
    if (clean) sandboxAllowExtra.add(clean)
  }
}
function sandboxHostAllowed(url: string): boolean {
  try {
    const host = new URL(String(url)).hostname.toLowerCase()
    if (SANDBOX_HOST_ALLOW.has(host) || sandboxAllowExtra.has(host)) return true
    // 官方域的子域（如 v1.itunes.apple.com）
    for (const d of [...SANDBOX_HOST_ALLOW, ...sandboxAllowExtra]) {
      if (host.endsWith(`.${d}`)) return true
    }
    return false
  } catch {
    return false
  }
}

/** F-17：debug 开关下的按源日志（由 ipc 接 settings.sourceDebug 接线） */
let sourceDebugSink: ((sourceName: string, line: string) => void) | null = null
export function setSourceDebugSink(fn: ((sourceName: string, line: string) => void) | null): void {
  sourceDebugSink = fn
}
function debugLog(sourceName: string, line: string): void {
  try {
    sourceDebugSink?.(sourceName, `[${new Date().toISOString()}] ${line}`)
  } catch {
    /* ignore */
  }
}

/** 受限定时器：下限 100ms，防沙箱脚本忙等占满事件循环 */
function limitedTimer(fn: (cb: (...a: any[]) => void, ms?: number, ...rest: any[]) => any): (...a: any[]) => any {
  return (cb: any, ms?: number, ...rest: any[]) => fn(cb, Math.max(100, Number(ms) || 0), ...rest)
}

/** Bug 113/114：默认禁用的内置源（oiapi 单点依赖 / B 站无 wbi 签名）；用户手动启用后不再回退 */
const DEFAULT_DISABLED = new Set(['星愿内置音源.js', 'starwish-bilibili.js'])
const inflateP = promisify(zlib.inflate)
const inflateRawP = promisify(zlib.inflateRaw)
const deflateP = promisify(zlib.deflate)

function toBuf(b: any): Buffer {
  if (Buffer.isBuffer(b)) return b
  if (b instanceof Uint8Array) return Buffer.from(b.buffer, b.byteOffset, b.byteLength)
  if (Array.isArray(b)) return Buffer.from(b)
  if (typeof b === 'string') return Buffer.from(b, 'utf8')
  if (b && typeof b === 'object' && b.type === 'Buffer' && Array.isArray(b.data)) return Buffer.from(b.data)
  return Buffer.from(b || [])
}

interface LoadedSource {
  file: string
  fullPath: string
  name: string
  version: string
  author: string
  description: string
  platforms: Record<string, { name: string; actions: string[]; qualitys: string[] }>
  handler: ((payload: any) => any) | null
  loadError: string | null
  builtin: boolean
}

interface LxState {
  inited: any[]
  updateAlerts: any[]
  requestHandler: ((payload: any) => any) | null
}

function makeLxApi(state: LxState) {
  const utils = {
    crypto: {
      md5: (s: any) => crypto.createHash('md5').update(String(s)).digest('hex'),
      randomBytes: (size: number) => crypto.randomBytes(size),
      aesEncrypt(b: any, mode: any, key: any, iv: any) {
        const algo = String(mode || 'aes-128-cbc').toLowerCase()
        try {
          const c = crypto.createCipheriv(algo, toBuf(key), iv === null || iv === undefined ? null : toBuf(iv))
          return Promise.resolve(Buffer.concat([c.update(toBuf(b)), c.final()]))
        } catch (e) {
          return Promise.reject(e)
        }
      },
      aesDecrypt(b: any, mode: any, key: any, iv: any) {
        const algo = String(mode || 'aes-128-cbc').toLowerCase()
        try {
          const d = crypto.createDecipheriv(algo, toBuf(key), iv === null || iv === undefined ? null : toBuf(iv))
          return Promise.resolve(Buffer.concat([d.update(toBuf(b)), d.final()]))
        } catch (e) {
          return Promise.reject(e)
        }
      },
      rsaEncrypt(b: any, key: any) {
        try {
          return Promise.resolve(
            crypto.publicEncrypt({ key: String(key), padding: crypto.constants.RSA_PKCS1_PADDING }, toBuf(b))
          )
        } catch (e) {
          return Promise.reject(e)
        }
      },
    },
    buffer: {
      from: (d: any, enc?: string) => {
        if (Buffer.isBuffer(d)) return d
        if (d instanceof ArrayBuffer) return Buffer.from(d)
        if (d && d.buffer !== undefined && d.byteLength !== undefined) return Buffer.from(d.buffer, d.byteOffset, d.byteLength)
        if (Array.isArray(d)) return Buffer.from(d)
        if (typeof d === 'string') {
          const e = String(enc || 'utf8').toLowerCase()
          if (['hex', 'base64', 'latin1', 'binary', 'utf16le'].includes(e)) return Buffer.from(d, e as BufferEncoding)
          return Buffer.from(d, 'utf8')
        }
        return Buffer.from(d || [])
      },
      bufToString: (b: any, fmt?: string) => {
        const f = String(fmt || 'utf8').toLowerCase()
        if (f === 'hex' || f === 'base64') return toBuf(b).toString(f as BufferEncoding)
        return toBuf(b).toString(f === 'utf16le' ? 'utf16le' : 'utf8')
      },
    },
    zlib: {
      inflate: (b: any) => inflateP(toBuf(b)).catch(() => inflateRawP(toBuf(b))),
      deflate: (b: any) => deflateP(toBuf(b)),
    },
  }

  const lx = {
    EVENT_NAMES: { inited: 'inited', request: 'request', updateAlert: 'updateAlert' },
    request(url: string, opts: any, cb?: (err: any, res: any, body: any) => void) {
      opts = opts || {}
      request(url, {
        method: opts.method || 'GET',
        body: opts.body ?? opts.form,
        headers: opts.headers || {},
        timeout: opts.timeout || 15000,
        retry: 0,
      })
        .then(res => {
          try {
            if (typeof cb === 'function') cb(null, res, res.body)
          } catch {
            /* 插件回调异常不污染宿主 */
          }
          return res
        })
        .catch((err: any) => {
          try {
            if (typeof cb === 'function') cb(err, null, null)
          } catch {
            /* ignore */
          }
          return {
            statusCode: 0,
            statusMessage: '',
            headers: {},
            raw: '',
            body: { error: String(err?.message || err) },
            bytes: 0,
            __fetchError: String(err?.message || err),
          }
        })
      return () => {
        /* 中止占位 */
      }
    },
    send(n: any, d: any) {
      const en = (n && n.id) || n
      if (en === 'inited') state.inited.push(d || {})
      else if (en === 'updateAlert') state.updateAlerts.push(d || {})
      return Promise.resolve()
    },
    on(n: any, h: any) {
      const en = (n && n.id) || n
      if (en === 'request') state.requestHandler = h
      return Promise.resolve()
    },
    env: 'desktop',
    version: '2.0.0',
    currentScriptInfo: { name: '', version: '', author: '', description: '', homepage: '', rawScript: '', updateUrl: '' },
    utils,
  }
  return lx
}

function parseHeaderMeta(code: string): Record<string, string> {
  const out: Record<string, string> = {}
  const head = code.slice(0, 4000)
  const pairs: [string, RegExp][] = [
    ['name', /@name\s+([^\r\n*]+)/i],
    ['version', /@version\s+([^\r\n*]+)/i],
    ['author', /@author\s+([^\r\n*]+)/i],
    ['description', /@description\s+([^\r\n*]+)/i],
  ]
  for (const [k, re] of pairs) {
    const m = head.match(re)
    if (m) out[k] = m[1].trim()
  }
  return out
}

class LxHost {
  private sources: LoadedSource[] = []
  private disabled = new Set<string>()
  private deleted = new Set<string>()
  /** 用户显式启用过的源（持久化）：默认禁用列表不覆盖用户选择 */
  private userEnabled = new Set<string>()
  private loading = false
  private loaded = false

  load(): void {
    if (this.loading) return
    this.loading = true
    this.sources = []
    const dirs = [sourcesDir(), userSourcesDir()].filter((d, i, arr) => arr.indexOf(d) === i)
    const seen = new Set<string>()
    for (const dir of dirs) {
      let files: string[] = []
      try {
        files = fs.readdirSync(dir).filter(f => f.endsWith('.js'))
      } catch {
        continue
      }
      for (const file of files.sort()) {
        if (seen.has(file)) continue
        if (this.deleted.has(file)) continue
        seen.add(file)
        const fullPath = path.join(dir, file)
        try {
          const code = fs.readFileSync(fullPath, 'utf8')
          this.loadOne(file, fullPath, code, dir === sourcesDir())
        } catch (e: any) {
          logger.error('读取音源失败', file, e?.message)
        }
      }
    }
    this.loaded = true
    this.loading = false
    this.applyDefaultDisabled()
    const ok = this.sources.filter(s => !s.loadError).length
    logger.info(`音源加载完成 ${ok}/${this.sources.length}`)
  }

  private loadOne(file: string, fullPath: string, code: string, builtin: boolean): void {
    const meta = parseHeaderMeta(code)
    const state: LxState = { inited: [], updateAlerts: [], requestHandler: null }
    const sandbox: any = {
      // F-17：debug 开启时转发沙箱 console 到按源日志
      console: {
        log: (...a: any[]) => debugLog(meta.name || file, a.map(String).join(' ')),
        warn: (...a: any[]) => debugLog(meta.name || file, `[warn] ${a.map(String).join(' ')}`),
        error: (...a: any[]) => debugLog(meta.name || file, `[error] ${a.map(String).join(' ')}`),
        info: (...a: any[]) => debugLog(meta.name || file, a.map(String).join(' ')),
        debug: (...a: any[]) => debugLog(meta.name || file, a.map(String).join(' ')),
      },
      setTimeout: limitedTimer(setTimeout),
      clearTimeout,
      setInterval: limitedTimer(setInterval),
      clearInterval,
      Buffer,
      TextEncoder,
      TextDecoder,
      URL,
      URLSearchParams,
      Math,
      JSON,
      Date,
      RegExp,
      Error,
      Promise,
      Array,
      Object,
      String,
      Number,
      Boolean,
      Symbol,
      Map,
      Set,
      WeakMap,
      WeakSet,
      Reflect,
      Proxy,
      parseInt,
      parseFloat,
      isNaN,
      isFinite,
      encodeURIComponent,
      decodeURIComponent,
      encodeURI,
      decodeURI,
      atob,
      btoa,
      structuredClone,
      AbortController,
    }
    sandbox.globalThis = sandbox
    sandbox.lx = makeLxApi(state)
    // C-23/C-19：request 白名单 + debug 日志包装（白名单外出站拒绝并记日志）
    const rawRequest = sandbox.lx.request.bind(sandbox.lx)
    sandbox.lx.request = (u: string, o: any, c: any) => {
      const ustr = String(u || '')
      if (!sandboxHostAllowed(ustr)) {
        debugLog(meta.name || file, `[blocked] 白名单外出站请求：${ustr.slice(0, 120)}`)
        try {
          c?.(new Error('请求被沙箱白名单拦截'), null, null)
        } catch {
          /* ignore */
        }
        return () => {}
      }
      const t0 = Date.now()
      debugLog(meta.name || file, `[req] ${ustr.slice(0, 160)}`)
      return rawRequest(u, o, (err: any, res: any, body: any) => {
        debugLog(meta.name || file, `[res] ${res?.statusCode ?? 0} ${Date.now() - t0}ms ${ustr.slice(0, 100)}`)
        try {
          c?.(err, res, body)
        } catch {
          /* ignore */
        }
      })
    }
    sandbox.request = (u: string, o: any, c: any) => sandbox.lx.request(u, o, c)
    sandbox.send = (n: any, d: any) => sandbox.lx.send(n, d)
    sandbox.on = (n: any, h: any) => sandbox.lx.on(n, h)
    sandbox.EVENT_NAMES = sandbox.lx.EVENT_NAMES
    sandbox.utils = sandbox.lx.utils

    let loadError: string | null = null
    try {
      const ctx = vm.createContext(sandbox)
      vm.runInContext(code, ctx, { filename: file, timeout: 20000 })
    } catch (e: any) {
      loadError = String(e?.message || e)
    }

    const inited = state.inited[state.inited.length - 1] || {}
    const platforms: LoadedSource['platforms'] = {}
    const raw = (inited && inited.sources) || {}
    for (const p of Object.keys(raw || {})) {
      const s = raw[p] || {}
      platforms[p] = {
        name: s.name || p,
        actions: Array.isArray(s.actions) ? s.actions : [],
        qualitys: Array.isArray(s.qualitys) ? s.qualitys : [],
      }
    }
    const name =
      (inited && inited.name) ||
      meta.name ||
      (sandbox.script && sandbox.script.name) ||
      file.replace(/\.js$/, '')
    this.sources.push({
      file,
      fullPath,
      name,
      version: (inited && inited.version) || meta.version || '',
      author: (inited && inited.author) || meta.author || '',
      description: (inited && inited.description) || meta.description || '',
      platforms,
      handler: state.requestHandler,
      loadError,
      builtin,
    })
    if (loadError) logger.warn('音源加载失败', file, loadError)
  }

  ensureLoaded(): void {
    if (!this.loaded) this.load()
  }

  setEnabled(file: string, enabled: boolean): void {
    if (enabled) {
      this.disabled.delete(file)
      this.userEnabled.add(file)
    } else {
      this.disabled.add(file)
      this.userEnabled.delete(file)
    }
  }

  setDisabledList(list: string[]): void {
    this.disabled = new Set(list || [])
    // Bug 113/114：默认禁用不受列表覆盖（用户显式启用过的源除外）
    this.applyDefaultDisabled()
  }

  /** 默认禁用合并：oiapi 依赖源 / 无 wbi 签名 B 站源默认 disabled（用户启用过则不覆盖） */
  private applyDefaultDisabled(): void {
    for (const f of DEFAULT_DISABLED) {
      if (this.sources.some(s => s.file === f) && !this.userEnabled.has(f)) this.disabled.add(f)
    }
  }

  setUserEnabledList(list: string[]): void {
    this.userEnabled = new Set(list || [])
  }

  getUserEnabledList(): string[] {
    return [...this.userEnabled]
  }

  setDeletedList(list: string[]): void {
    this.deleted = new Set(list || [])
  }

  getDeletedList(): string[] {
    return [...this.deleted]
  }

  /** 恢复内置音源（F-25）：只清 deleted，保留用户 disabled 选择 */
  restoreBuiltin(): void {
    this.deleted.clear()
    this.load()
  }

  getDisabledList(): string[] {
    return [...this.disabled]
  }

  list(): SourceInfo[] {
    this.ensureLoaded()
    return this.sources.map(s => ({
      file: s.file,
      name: s.name,
      version: s.version,
      author: s.author,
      description: s.description,
      loadError: s.loadError,
      enabled: !this.disabled.has(s.file),
      builtin: s.builtin,
      platforms: Object.keys(s.platforms).map<SourcePlatform>(p => ({
        platform: p,
        name: s.platforms[p].name,
        actions: s.platforms[p].actions,
        qualitys: s.platforms[p].qualitys,
      })),
    }))
  }

  getSourceCode(file: string): string {
    const s = this.sources.find(x => x.file === file)
    if (!s) throw new Error('音源不存在')
    return fs.readFileSync(s.fullPath, 'utf8')
  }

  private active(): LoadedSource[] {
    this.ensureLoaded()
    return this.sources.filter(s => !s.loadError && s.handler && !this.disabled.has(s.file))
  }

  /** 所有可用平台（去重），用于搜索/榜单的源切换 */
  platformList(): { platform: string; name: string; source: string }[] {
    const map = new Map<string, { platform: string; name: string; source: string }>()
    for (const s of this.active()) {
      for (const p of Object.keys(s.platforms)) {
        if (!map.has(p)) map.set(p, { platform: p, name: s.platforms[p].name, source: s.file })
      }
    }
    return [...map.values()]
  }

  async search(
    term: string,
    page = 1,
    pageSize = 40,
    opts: { platform?: string; perSourceCap?: number; timeout?: number; waitMs?: number } = {}
  ): Promise<Song[]> {
    const kw = String(term || '').trim()
    if (!kw) return []
    const perSourceCap = opts.perSourceCap ?? 10
    const limit = opts.timeout ?? 12000
    const out: Song[] = []
    const seen = new Set<string>()
    const sources = this.active().filter(s =>
      Object.keys(s.platforms).some(p => s.platforms[p].actions.includes('musicSearch'))
    )
    // 聚合源优先（wy/kw 通常覆盖最广）
    sources.sort((a, b) => scoreSource(b) - scoreSource(a))

    const tasks: Promise<void>[] = []
    for (const src of sources) {
      for (const p of Object.keys(src.platforms)) {
        if (opts.platform && p !== opts.platform) continue
        if (!src.platforms[p].actions.includes('musicSearch')) continue
        tasks.push(
          (async () => {
            try {
              const res = await Promise.race([
                src.handler!({
                  source: p,
                  action: 'musicSearch',
                  info: { musicInfo: { searchTerm: kw, keyword: kw }, type: '128k', keyword: kw, page, pagesize: pageSize },
                }),
                new Promise((_, rej) => setTimeout(() => rej(new Error('搜索超时')), limit)),
              ])
              const list: any[] = Array.isArray(res) ? res : (res && (res.list || res.songs)) || []
              let count = 0
              for (const s of list) {
                if (!s || !s.name) continue
                const songId = String(s.songId || s.id || s.songmid || s.hash || '')
                if (!songId) continue
                const key = `${p}:${songId}`
                if (seen.has(key)) continue
                seen.add(key)
                out.push({
                  id: `${p}:${songId}`,
                  source: s.source || p,
                  songId,
                  name: String(s.name),
                  singer: String(s.singer || s.artist || '未知歌手'),
                  album: s.albumName || s.album || '',
                  duration: Number(s.duration || s._interval || s.interval || 0),
                  pic: s.pic || s.img || '',
                  qualitys: Array.isArray(s.qualitys) ? s.qualitys : src.platforms[p].qualitys,
                  extra: {
                    songmid: s.songmid,
                    albummid: s.albummid,
                    hash: s.hash,
                    cid: s.cid,
                    bvid: s.bvid,
                    page: s.page,
                    albumId: s.albumId,
                    copyrightId: s.copyrightId,
                    _url: s._url,
                  },
                })
                if (++count >= perSourceCap) break
              }
            } catch {
              /* 单源失败不影响整体 */
            }
          })()
        )
      }
    }
    if (opts.waitMs && opts.waitMs > 0) {
      // 到点即返回已收集结果，慢音源在后台继续（不阻塞 UI）
      await Promise.race([Promise.all(tasks), new Promise(r => setTimeout(r, opts.waitMs))])
    } else {
      await Promise.all(tasks)
    }
    return out.slice(0, Math.max(pageSize, 20))
  }

  /**
   * MV 协议分发（规格书 2.17 / C-17）：音源 JS 声明 capabilities.mvSearch/mvUrl
   * （或 platforms[p].actions 含 mvSearch/mvUrl）即接入；未声明返回空/抛错。
   * action 命名统一 mvSearch/mvUrl（复用社区既有名）。
   */
  hasMvSupport(platform: string, action: 'mvSearch' | 'mvUrl'): boolean {
    return this.active().some(
      s => s.platforms[platform]?.actions.includes(action) || (s as any).capabilities?.mvSearch === true
    )
  }

  async dispatchMvSearch(platform: string, keyword: string, page = 1): Promise<any[]> {
    for (const src of this.active()) {
      const actions = src.platforms[platform]?.actions
      if (!actions?.includes('mvSearch')) continue
      try {
        const res = await Promise.race([
          src.handler!({
            source: platform,
            action: 'mvSearch',
            info: { keyword, page, pagesize: 20 },
          }),
          new Promise((_, rej) => setTimeout(() => rej(new Error('MV 搜索超时')), 15_000)),
        ])
        const list: any[] = Array.isArray(res) ? res : (res && (res.list || res.mvs)) || []
        return list
          .map((m: any) => ({
            source: platform,
            sourceId: String(m.mvId || m.id || m.vid || ''),
            title: String(m.name || m.title || ''),
            author: String(m.singer || m.artist || ''),
            pic: String(m.pic || m.cover || ''),
            duration: String(m.intervalLabel || m.duration || ''),
            durationSec: Number(m.interval || m.durationSec || 0),
            play: Number(m.playCount || m.play || 0),
            danmaku: 0,
          }))
          .filter((m: any) => m.sourceId)
      } catch (e: any) {
        console.warn('[lx-host] mvSearch 失败', platform, e?.message)
      }
    }
    return []
  }

  async dispatchMvUrl(platform: string, id: string, quality?: string): Promise<{ url: string; headers?: Record<string, string>; userAgent?: string; qualities?: { qn: number; label: string }[] }> {
    for (const src of this.active()) {
      const actions = src.platforms[platform]?.actions
      if (!actions?.includes('mvUrl')) continue
      try {
        const res = await Promise.race([
          src.handler!({
            source: platform,
            action: 'mvUrl',
            info: { mvId: id, quality },
          }),
          new Promise((_, rej) => setTimeout(() => rej(new Error('MV 取链超时')), 15_000)),
        ])
        if (typeof res === 'string') return { url: res }
        if (res && typeof res === 'object' && res.url) {
          return { url: String(res.url), headers: res.headers, userAgent: res.userAgent, qualities: res.qualities }
        }
      } catch (e: any) {
        console.warn('[lx-host] mvUrl 失败', platform, e?.message)
      }
    }
    throw new Error('音源不支持该 MV 或取链失败')
  }

  async resolveUrl(song: Song, quality: string): Promise<{ url: string; from: string }> {
    const direct = song.extra?._url
    if (typeof direct === 'string' && /^https?:\/\//i.test(direct)) return { url: direct, from: 'direct' }
    if (song.localPath) return { url: song.localPath, from: 'local' }
    const platform = song.source
    const samePlatform = this.active().filter(s => s.platforms[platform]?.actions.includes('musicUrl'))
    // F-24 跨平台降级：同平台取不到时扩大到所有支持 musicUrl 的源（音源侧按歌名匹配）
    const others = this.active().filter(
      s => !samePlatform.includes(s) && Object.values(s.platforms).some(p => p.actions.includes('musicUrl'))
    )
    const candidates = [...samePlatform, ...others]
    if (!candidates.length) throw new Error(`平台 ${platform} 没有可用的取链音源`)

    const tryOne = async (src: LoadedSource, crossPlatform: boolean): Promise<string> => {
      const info: any = { ...song, ...(song.extra || {}) }
      if (crossPlatform) {
        // 跨源取链：把歌名/歌手交给音源自行匹配（F-24）
        info.keyword = `${song.name} ${song.singer || ''}`.trim()
      }
      const url = await Promise.race([
        src.handler!({ source: platform, action: 'musicUrl', info }),
        new Promise((_, rej) => setTimeout(() => rej(new Error('取链超时')), 15_000)),
      ])
      if (typeof url === 'string' && /^https?:\/\//i.test(url.trim())) return url.trim()
      throw new Error('返回无效')
    }

    // Bug 117：取链总预算 30s 硬顶 + 前 3 候选竞速择优 + 429 类错误立即停手
    const deadline = Date.now() + 30_000
    const errors: string[] = []
    let stopped429 = false
    for (let start = 0; start < candidates.length; start += 3) {
      if (stopped429) break
      const batch = candidates.slice(start, start + 3)
      const tasks = batch.map(async (src, i) => {
        const crossPlatform = start + i >= samePlatform.length
        const url = await tryOne(src, crossPlatform)
        return { url, from: src.name }
      })
      try {
        const winner = await Promise.race([
          Promise.any(tasks),
          new Promise<never>((_, rej) =>
            setTimeout(() => rej(new Error('竞速超时')), Math.max(1000, deadline - Date.now()))
          ),
        ])
        return winner
      } catch (e: any) {
        const agg = e as AggregateError
        for (const err of agg?.errors || [e]) {
          const msg = String((err as Error)?.message || err)
          errors.push(msg)
          // 429 / 限频：立即停手不再轮询（0.8.2 熔断）
          if (/429|too many|限频|rate.?limit/i.test(msg)) stopped429 = true
        }
        if (Date.now() >= deadline) break
      }
    }
    throw new Error((stopped429 ? '音源限频，已停止尝试；' : '') + errors.slice(0, 3).join('；') || '取链失败')
  }

  async getLyric(song: Song): Promise<string> {
    const platform = song.source
    const candidates = this.active().filter(s => s.platforms[platform]?.actions.includes('lyric'))
    for (const src of candidates) {
      try {
        const res = await Promise.race([
          src.handler!({ source: platform, action: 'lyric', info: { musicInfo: { ...song, ...(song.extra || {}) } } }),
          new Promise((_, rej) => setTimeout(() => rej(new Error('歌词超时')), 12000)),
        ])
        const lrc = (res && (res.lyric || res.lxlyric || res.rlyric || res.tlyric)) || ''
        if (typeof lrc === 'string' && lrc.trim()) return lrc
      } catch {
        /* 下一个 */
      }
    }
    return ''
  }

  async getPic(song: Song): Promise<string> {
    const platform = song.source
    const candidates = this.active().filter(s => s.platforms[platform]?.actions.includes('pic'))
    for (const src of candidates) {
      try {
        const r = await Promise.race([
          src.handler!({ source: platform, action: 'pic', info: { musicInfo: { ...song, ...(song.extra || {}) } } }),
          new Promise((_, rej) => setTimeout(() => rej(new Error('封面超时')), 8000)),
        ])
        const u = typeof r === 'string' ? r : r && (r.url || r.pic)
        if (typeof u === 'string' && /^https?:\/\//i.test(u.trim())) return u.trim()
      } catch {
        /* 下一个 */
      }
    }
    return ''
  }

  /** 导入音源；传 file 表示原地替换该文件（更新已有音源），否则新建 */
  async importSource(payload: { url?: string; content?: string; file?: string }): Promise<{ file: string }> {
    let content = payload.content || ''
    if (payload.url) {
      if (!/^https?:\/\//i.test(payload.url)) throw new Error('仅支持 http(s) 链接')
      const res = await request(payload.url, { headers: { 'User-Agent': UA }, timeout: 20000 })
      if (res.status !== 200 || !res.raw) throw new Error(`下载失败（HTTP ${res.status}）`)
      content = res.raw
    }
    if (!content.trim()) throw new Error('音源内容为空')
    // F-18：512KB 上限
    if (Buffer.byteLength(content, 'utf8') > 512 * 1024) throw new Error('音源脚本超过 512KB 上限')
    if (!/lx\.|EVENT_NAMES|module\.exports|exports\./.test(content)) {
      throw new Error('不是有效的 lx-music 音源脚本（缺少 lx API 调用）')
    }
    const meta = parseHeaderMeta(content)
    const base =
      meta.name ||
      (content.match(/script\.name\s*=\s*['"]([^'"]+)['"]/)?.[1] ?? '') ||
      `imported-${Date.now()}`
    const safe = base.replace(/[\\/:*?"<>|]/g, '_').slice(0, 60)
    let file = `${safe}.js`
    const dir = userSourcesDir()
    const target = String(payload.file || '').trim()
    if (target) {
      // 原地替换：保留原文件名，用户不必重新启用/排序
      const old = this.sources.find(s => s.file === target)
      if (!old || old.builtin) throw new Error('只能更新用户导入的音源')
      file = path.basename(target)
    } else {
      let i = 1
      while (fs.existsSync(path.join(dir, file))) {
        file = `${safe}-${i++}.js`
      }
    }
    // N25：写盘后校验，loadError 立即 unlink 回滚（不留坏脚本）
    fs.writeFileSync(path.join(dir, file), content, 'utf8')
    this.load()
    const loaded = this.sources.find(s => s.file === file)
    if (loaded?.loadError) {
      try {
        fs.rmSync(path.join(dir, file), { force: true })
      } catch {
        /* ignore */
      }
      this.load()
      throw new Error(`脚本加载失败（已回滚）：${loaded.loadError}`)
    }
    return { file }
  }

  deleteSource(file: string): void {
    const s = this.sources.find(x => x.file === file)
    if (!s) throw new Error('音源不存在')
    if (s.builtin) {
      // 内置音源不删除安装包文件，只记录移除标记，可随时恢复
      this.deleted.add(file)
      this.sources = this.sources.filter(x => x.file !== file)
      return
    }
    try {
      fs.unlinkSync(s.fullPath)
    } catch (e: any) {
      throw new Error(`删除失败：${e?.message || e}`)
    }
    this.load()
  }
}

function scoreSource(s: LoadedSource): number {
  let score = 0
  const ps = Object.keys(s.platforms)
  if (ps.includes('wy')) score += 5
  if (ps.includes('kw')) score += 4
  if (ps.includes('qq')) score += 3
  if (ps.includes('kg')) score += 2
  if (ps.includes('mg')) score += 1
  if (s.file.includes('unified')) score += 6
  return score
}

export const lxHost = new LxHost()
