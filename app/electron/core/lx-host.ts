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
import { kvGet, kvSet } from './db'

const logger = createLogger('lx-host')

/* ================= 0.8 内置音源治理 =================
 * 0.8.1 随包白名单：sources/ 仅自研 3 源（package.json extraResources filter）；
 * 0.8.2 沙箱 request 域名白名单+ 加载期禁远程自更新（野草/野花/长青类启动 GET 一律拦截）
 *      + setTimeout/Interval 受限代理（下限 100ms 防忙等）；
 * 0.8.3 debug 日志开关：logs/sources/<源名>.log 按源记录请求明细；
 * 默认禁用：oiapi 依赖源与未实现 wbi 签名的 B 站音源默认 disabled、可手动启用。
 */

/** 沙箱出站域名白名单（官方域 + 用户导入时确认追加） */
const SANDBOX_HOST_ALLOW = new Set<string>([
  'music.163.com', 'interface.music.163.com', 'music.126.net',
  'u.y.qq.com', 'c.y.qq.com', 'dl.stream.qqmusic.qq.com', 'isure.stream.qqmusic.qq.com', 'aqqmusic.tc.qq.com',
  'm3ws.kugou.com', 'mobilecdn.kugou.com', 'mobiles.kugou.com', 'm.kugou.com', 'www.kugou.com', 'service.kugou.com',
  'imge.kugou.com', 'singerimg.kugou.com', 'fs.android.kugou.com',
  'www.kuwo.cn', 'search.kuwo.cn', 'antiserver.kuwo.cn', 'mobi.kuwo.cn', 'nmobi.kuwo.cn', 'kuwo.cn',
  'oiapi.net',
  'api.bilibili.com', 'api.bilibili.tv', 'search.bilibili.com',
  'upos-sz-mirror08c.bilivideo.com', 'upos-sz-mirrorcoso1.bilivideo.com', 'cn-hljheb-ct-01-02.bilivideo.com', 'cn-hljheb-ct-01-03.bilivideo.com',
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
    const u = new URL(String(url))
    const host = u.hostname.toLowerCase()
 // 裸 IP / 明文 HTTP 出站一律拒绝（口径：源不得打裸 IP HTTP 端点）
    if (/^\d{1,3}(\.\d{1,3}){3}$/.test(host) || (u.protocol === 'http:' && /\d+\.\d+\.\d+\.\d+/.test(host))) {
      return false
    }
    if (SANDBOX_HOST_ALLOW.has(host) || sandboxAllowExtra.has(host)) return true
    for (const d of [...SANDBOX_HOST_ALLOW, ...sandboxAllowExtra]) {
      if (host.endsWith(`.${d}`)) return true
    }
    // 默认放行其余域名并记日志（源后端常轮换，硬白名单会误杀可播源）；
    // settings.sandboxStrict=true 时才强制白名单。
    return !sandboxStrict
  } catch {
    return false
  }
}

/** 严格白名单开关（settings.sandboxStrict），默认关闭保证内置源可播 */
let sandboxStrict = false
export function setSandboxStrict(on: boolean): void {
  sandboxStrict = !!on
}

/**debug 开关下的按源日志（由 ipc 接 settings.sourceDebug 接线） */
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

/**
 * 默认禁用的内置源列表（.12.2 口径）
 * starwish-bilibili.js 未实现 wbi 签名，未签名直调在风控网络下 -403/-412，
 * 故默认关闭（设置页可见、开关 OFF、一键启用立即生效；用户 Toggle 后 userEnabled 优先）。
 * release 包零音源（0.11.1），本列表仅影响 dev/导入场景。
 */
const DEFAULT_DISABLED = new Set<string>(['starwish-bilibili.js'])
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
            // lx 协议形状归一化：社区插件读 res.statusCode（lx-music 口径），
 // 内部 HttpResponse 字段为 status —— 不归一化会让所有 req 判定假失败
            const normalized = { ...res, statusCode: (res as any).statusCode ?? res.status }
            if (typeof cb === 'function') cb(null, normalized, normalized.body)
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
  /**
   * 初始化状态机（落雪式「初始化中 / 初始化成功 / 初始化失败」）。
   *
   * 修 Bug：停用后再启用「无法使用」的根因是**只改了 disabled 集合、没有重新
   * 初始化脚本**——旧实现里音源的 requestHandler 是 load() 时一次性绑定到沙箱
   * 实例上的，源被停用后其 handler 所在的沙箱上下文已失效，重新启用时若不
   * 重新 eval 脚本，注册进去的仍然是失效 handler，于是表现为「开关打开但搜不到 /
   * 取链失败」。
   *
   * 现在：
   *   - 启用时走 `enableSource()`：重新读盘 + 重新 eval 脚本 + 重新绑定 handler
   *   - 状态实时写入 `initState`，渲染层据此展示「初始化中…」
   *   - 初始化失败时自动回滚为停用态，并把原因带出去给 UI 提示
   */
  private initState = new Map<string, 'idle' | 'initing' | 'ready' | 'failed'>()

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
 //启动时回填持久化的首选源记忆（0.13：重启后同平台仍首选上次成功源）
    this.loadPreferred()
    const ok = this.sources.filter(s => !s.loadError).length
    logger.info(`音源加载完成 ${ok}/${this.sources.length}`)
  }

  private loadOne(file: string, fullPath: string, code: string, builtin: boolean): void {
    const meta = parseHeaderMeta(code)
    const state: LxState = { inited: [], updateAlerts: [], requestHandler: null }
    const sandbox: any = {
 //debug 开启时转发沙箱 console 到按源日志
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
 // /C-19：request 白名单 + debug 日志包装（白名单外出站拒绝并记日志）
    const rawRequest = sandbox.lx.request.bind(sandbox.lx)
    sandbox.lx.request = (u: string, o: any, c: any) => {
      const ustr = String(u || '')
      if (!sandboxHostAllowed(ustr)) {
        debugLog(meta.name || file, `[blocked] 出站请求被拒绝（裸IP/严格白名单）：${ustr.slice(0, 120)}`)
        try {
          c?.(new Error('请求被沙箱策略拦截'), null, null)
        } catch {
          /* ignore */
        }
        return () => {}
      }
 //外部 B 站音源请求自动附登录态（SESSDATA/buvid/UA/Referer），
      // 沙箱 request 默认不带 biliHeaders()，未签名 + 无 Cookie 双重风控 → -412。
      let opts = o
      if (/^(https?:\/\/)?[a-z0-9.-]*bilibili\.com(\/|$)/i.test(ustr)) {
        try {
          const { biliHeaders } = require('./bili')
          opts = { ...(o || {}), headers: { ...biliHeaders(), ...((o || {}).headers || {}) } }
        } catch {
          /* bili 模块不可用时按原样请求 */
        }
      }
      const t0 = Date.now()
      debugLog(meta.name || file, `[req] ${ustr.slice(0, 160)}`)
      return rawRequest(u, opts, (err: any, res: any, body: any) => {
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

  /**
   * 启用/停用音源。
   *
   * 关键修复（Bug：停用后再启用无法使用）：
   *   启用时**重新读盘并重新 eval 脚本**，让沙箱与 requestHandler 重新绑定。
   *   旧实现只翻转 disabled 集合，源脚本从未重新初始化，导致启用后取链/搜索
   *   仍走失效的 handler —— 表现为「开关打开了但还是不能用」。
   *
   * @returns 初始化结果；失败时 enabled 会被回滚为 false
   */
  setEnabled(file: string, enabled: boolean): { ok: boolean; message?: string } {
    if (!enabled) {
      this.disabled.add(file)
      this.userEnabled.delete(file)
      this.initState.set(file, 'idle')
      return { ok: true }
    }
    // 启用：先标记初始化中，让 UI 能展示「初始化中…」（落雪口径）
    this.initState.set(file, 'initing')
    this.disabled.delete(file)
    this.userEnabled.add(file)
    const src = this.sources.find(s => s.file === file)
    if (!src) {
      this.initState.set(file, 'failed')
      this.disabled.add(file)
      this.userEnabled.delete(file)
      return { ok: false, message: '音源文件不存在，可能已被删除' }
    }
    // 重新读盘 + 重新 eval（脚本可能被用户更新过，也保证 handler 是新的）
    try {
      const code = fs.readFileSync(src.fullPath, 'utf8')
      // 移除旧条目后重新载入，loadOne 会重新创建沙箱并绑定 handler
      this.sources = this.sources.filter(s => s.file !== file)
      this.loadOne(file, src.fullPath, code, src.builtin)
      const fresh = this.sources.find(s => s.file === file)
      if (fresh?.loadError) {
        this.initState.set(file, 'failed')
        // 初始化失败 → 回滚为停用，避免"开关显示已启用但实际不可用"
        this.disabled.add(file)
        this.userEnabled.delete(file)
        return { ok: false, message: `初始化失败：${fresh.loadError}` }
      }
      this.initState.set(file, 'ready')
      return { ok: true }
    } catch (e: any) {
      this.initState.set(file, 'failed')
      this.disabled.add(file)
      this.userEnabled.delete(file)
      return { ok: false, message: `初始化失败：${e?.message || e}` }
    }
  }

  /** 初始化状态（渲染层展示「初始化中 / 初始化成功 / 初始化失败」） */
  getInitState(file: string): 'idle' | 'initing' | 'ready' | 'failed' {
    return this.initState.get(file) || 'idle'
  }

  setDisabledList(list: string[]): void {
    this.disabled = new Set(list || [])
 //默认禁用不受列表覆盖（用户显式启用过的源除外）
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

 /** 恢复内置音源：只清 deleted，保留用户 disabled 选择 */
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
      // 初始化状态（落雪口径）：idle / initing / ready / failed
      initState: this.initState.get(s.file) || (s.loadError ? 'failed' : this.disabled.has(s.file) ? 'idle' : 'ready'),
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
 * MV 协议分发 ：音源 JS 声明 capabilities.mvSearch/mvUrl
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

  /* ================= 0.9.8 videoHost 四函数分发（视频源插件契约） =================
   * 契约：videoSearch(kw,page)→{isEnd,videos[]} / videoInfo(video)→{video}
   * videoParts(video)→{parts[]} / videoUrl(video,part)→{url,headers}
   * 插件在 platforms[p].actions 声明 videoSearch/videoInfo/videoParts/videoUrl 即接入。 */
  hasVideoSupport(platform: string, action: 'videoSearch' | 'videoInfo' | 'videoParts' | 'videoUrl'): boolean {
    return this.active().some(s => s.platforms[platform]?.actions.includes(action))
  }

  private async videoCall<T = any>(platform: string, action: string, info: Record<string, any>, timeout = 15_000): Promise<T> {
    for (const src of this.active()) {
      const actions = src.platforms[platform]?.actions
      if (!actions?.includes(action)) continue
      try {
        const res = await Promise.race([
          src.handler!({ source: platform, action, info }),
          new Promise((_, rej) => setTimeout(() => rej(new Error(action + ' 超时')), timeout)),
        ])
        if (res && typeof res === 'object') return res as T
      } catch (e: any) {
        logger.warn('video 分发失败', platform, action, e?.message)
      }
    }
    throw new Error(`视频源不支持 ${platform}/${action}`)
  }

  async dispatchVideoSearch(platform: string, keyword: string, page = 1): Promise<{ isEnd: boolean; videos: any[] }> {
    const r = await this.videoCall<any>(platform, 'videoSearch', { keyword, page, pagesize: 20 })
    const videos: any[] = Array.isArray(r) ? r : r.videos || r.list || []
    return { isEnd: !!r.isEnd, videos }
  }

  async dispatchVideoInfo(platform: string, videoId: string): Promise<any> {
    const r = await this.videoCall<any>(platform, 'videoInfo', { videoId, video: { id: videoId } })
    return r.video || r
  }

  async dispatchVideoParts(platform: string, videoId: string): Promise<any[]> {
    const r = await this.videoCall<any>(platform, 'videoParts', { videoId, video: { id: videoId } })
    return r.parts || []
  }

  async dispatchVideoUrl(
    platform: string,
    videoId: string,
    part: { cid?: string; page?: number } | null,
    quality?: string
  ): Promise<{ url: string; headers?: Record<string, string>; userAgent?: string }> {
    const r = await this.videoCall<any>(
      platform,
      'videoUrl',
      { videoId, video: { id: videoId }, part: part || {}, quality },
      20_000
    )
    if (typeof r === 'string') return { url: r }
    if (!r?.url) throw new Error('视频源未返回播放地址')
    return { url: String(r.url), headers: r.headers, userAgent: r.userAgent }
  }

 /** Bug A（切歌音源稳定）：同平台/同歌记首选源。
 * preferredByPlatform 持久化到 db（platform→file），重启后同平台取链仍首选上次成功源；
   * preferredBySong 量大，仅进程内。 */
  private preferredByPlatform = new Map<string, string>()
  private preferredBySong = new Map<string, string>()
  private preferredPersistDirty = false
  private static PREFERRED_KEY = 'lx_preferred_platform'

  private loadPreferred(): void {
    try {
      const raw = kvGet(LxHost.PREFERRED_KEY)
      if (!raw) return
      const obj = JSON.parse(raw)
      if (obj && typeof obj === 'object') {
        for (const [k, v] of Object.entries(obj)) {
          if (typeof v === 'string' && v) this.preferredByPlatform.set(k, v)
        }
      }
    } catch {
      /* 忽略损坏记录 */
    }
  }

  private schedulePreferredPersist(): void {
    if (this.preferredPersistDirty) return
    this.preferredPersistDirty = true
    setTimeout(() => {
      this.preferredPersistDirty = false
      try {
        kvSet(LxHost.PREFERRED_KEY, JSON.stringify(Object.fromEntries(this.preferredByPlatform)))
      } catch {
        /* 非致命 */
      }
    }, 2000)
  }

  /**
   * 取播放地址。
   *
   * v1.0.0 换源精准化（Bug：当前音源播放失败后不切换音源）：
   *   - `opts.avoidFiles`：跳过指定源文件（上层记录的历史失败源），重试时
   *     不再拿同一坏源浪费 15s 超时；
   *   - 返回值带 `file`（成功命中的源文件），上层可记录；
   *   - 全部失败抛错时错误对象带 `triedFiles`（本轮尝试过的源文件），
   *     上层据此累积失败记录，下一轮重试精准排除。
   */
  async resolveUrl(
    song: Song,
    quality: string,
    opts?: { avoidFiles?: string[] }
  ): Promise<{ url: string; from: string; file?: string }> {
    const avoid = new Set(opts?.avoidFiles || [])
    const direct = song.extra?._url
    if (typeof direct === 'string' && /^https?:\/\//i.test(direct)) return { url: direct, from: 'direct' }
    if (song.localPath) return { url: song.localPath, from: 'local' }
    const platform = song.source
    const samePlatform = this.active().filter(s => s.platforms[platform]?.actions.includes('musicUrl') && !avoid.has(s.file))
 // 跨平台降级：同平台取不到时扩大到所有支持 musicUrl 的源
    const others = this.active().filter(
      s => !samePlatform.includes(s) && !avoid.has(s.file) && Object.values(s.platforms).some(p => p.actions.includes('musicUrl'))
    )
    const allCandidates = [...samePlatform, ...others]
    if (!allCandidates.length) throw new Error(`平台 ${platform} 没有可用的取链音源`)

    const tryOne = async (src: LoadedSource, crossPlatform: boolean): Promise<string> => {
      // lx 协议标准：info.musicInfo 携带完整歌曲对象（社区插件按 info.musicInfo.songId/hash 取参）；
      // 平铺字段保留兼容旧星河插件（直读 info.songId）。type = 音质档位。
      const flat: any = { ...song, ...(song.extra || {}) }
      const info: any = { musicInfo: flat, type: quality, ...flat }
      if (crossPlatform) {
        info.keyword = `${song.name} ${song.singer || ''}`.trim()
      }
      const url = await Promise.race([
        src.handler!({ source: platform, action: 'musicUrl', info }),
        new Promise((_, rej) => setTimeout(() => rej(new Error('取链超时')), 15_000)),
      ])
      if (typeof url === 'string' && /^https?:\/\//i.test(url.trim())) return url.trim()
      throw new Error('返回无效')
    }

    const songKey = `${platform}:${song.songId || song.id || song.name}_${song.singer || ''}`.slice(0, 200)
    const preferFile = this.preferredBySong.get(songKey) || this.preferredByPlatform.get(platform)

    // 排序候选：已记住的首选源排最前（保证同一首歌/同一平台的取链源稳定不变）
    const orderHead = (list: LoadedSource[]): LoadedSource[] => {
      if (!preferFile) return list
      const idx = list.findIndex(s => s.file === preferFile)
      if (idx <= 0) return list
      return [list[idx], ...list.slice(0, idx), ...list.slice(idx + 1)]
    }
    const candidates = [...orderHead(samePlatform), ...others]

    // 记录成功的音源
    const recordSuccess = (src: LoadedSource): void => {
      this.preferredBySong.set(songKey, src.file)
      if (this.preferredByPlatform.get(platform) !== src.file) {
        this.preferredByPlatform.set(platform, src.file)
        this.schedulePreferredPersist()
      }
    }

 //取链总预算 30s 硬顶
    const deadline = Date.now() + 30_000
    const errors: string[] = []
    /** 本轮实际尝试过的源文件（全部失败时随错误带回，上层据此精准排除） */
    const triedFiles = new Set<string>()
    let stopped429 = false

 // Bug A：首选源单独串行尝试（保证同歌/同平台命中稳定）
    // 失败后再降级到候选批次竞速（保持降级速度）
    const head = candidates[0]
    if (head) {
      const crossPlatform = !samePlatform.includes(head)
      triedFiles.add(head.file)
      try {
        const url = await tryOne(head, crossPlatform)
        recordSuccess(head)
        return { url, from: head.name, file: head.file }
      } catch (e: any) {
        const msg = String((e as Error)?.message || e)
        errors.push(msg)
        if (/429|too many|限频|rate.?limit/i.test(msg)) stopped429 = true
      }
    }

    // 降级：剩余候选按 3 个一批竞速择优（保留降级速度，不降低用户体验）
    for (let start = 0; start < candidates.length; start += 3) {
      if (stopped429) break
      const batch = candidates.slice(start, start + 3).filter(s => !head || s.file !== head.file)
      if (!batch.length) continue
      for (const s of batch) triedFiles.add(s.file)
      const tasks = batch.map(async src => {
        const crossPlatform = !samePlatform.includes(src)
        const url = await tryOne(src, crossPlatform)
        recordSuccess(src)
        return { url, from: src.name, file: src.file }
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
          if (/429|too many|限频|rate.?limit/i.test(msg)) stopped429 = true
        }
        if (Date.now() >= deadline) break
      }
    }
    // 全部失败：带出本轮尝试过的源文件，上层据此在重试时精准排除坏源
    const err = new Error((stopped429 ? '音源限频，已停止尝试；' : '') + errors.slice(0, 3).join('；') || '取链失败')
    ;(err as any).triedFiles = [...triedFiles]
    throw err
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
 /** URL 导入下载：多镜像回退（0.9.2/ 口径，GitHub raw 被墙场景）
   * 镜像清单与 market-host 同源（raw → jsDelivr → ghproxy → gitmirror） */
  private static urlMirrors(url: string): string[] {
    try {
      const u = new URL(url)
      const m = u.hostname === 'raw.githubusercontent.com' ? /^\/([^/]+)\/([^/]+)\/([^/]+)\/(.+)$/.exec(u.pathname) : null
      if (!m) return [url]
      const [, owner, repo, branch, p] = m
      return [
        url,
        `https://gh-proxy.com/https://raw.githubusercontent.com/${owner}/${repo}/${branch}/${p}`,
        `https://testingcf.jsdelivr.net/gh/${owner}/${repo}@${branch}/${p}`,
        `https://cdn.jsdelivr.net/gh/${owner}/${repo}@${branch}/${p}`,
        `https://ghfast.top/https://raw.githubusercontent.com/${owner}/${repo}/${branch}/${p}`,
        `https://ghproxy.com/https://raw.githubusercontent.com/${owner}/${repo}/${branch}/${p}`,
        `https://raw.gitmirror.com/${owner}/${repo}/${branch}/${p}`,
      ]
    } catch {
      return [url]
    }
  }

  private async fetchSourceUrl(url: string): Promise<string> {
    const candidates = LxHost.urlMirrors(url)
    let lastErr: Error | null = null
    for (const u of candidates) {
      try {
        const res = await request(u, { headers: { 'User-Agent': UA }, timeout: 20000 })
        if (res.status === 200) {
          const text = typeof res.body === 'string' ? res.body : res.raw
          if (text && text.trim()) return text
          lastErr = new Error('响应为空')
        } else {
          lastErr = new Error(`HTTP ${res.status}`)
        }
      } catch (e: any) {
        lastErr = e
      }
    }
    throw new Error(`音源下载失败（已尝试 ${candidates.length} 个地址）：${lastErr?.message || '网络错误'}`)
  }

  async importSource(payload: { url?: string; content?: string; file?: string }): Promise<{ file: string }> {
    let content = payload.content || ''
    if (payload.url) {
      if (!/^https?:\/\//i.test(payload.url)) throw new Error('仅支持 http(s) 链接')
 // URL 导入多镜像回退（同口径）：GitHub 直链被墙时依次尝试
      // raw → jsDelivr → ghproxy → gitmirror，任一 200 即用
      content = await this.fetchSourceUrl(payload.url)
    }
    if (!content.trim()) throw new Error('音源内容为空')
 //512KB 上限
    if (Buffer.byteLength(content, 'utf8') > 512 * 1024) throw new Error('音源脚本超过 512KB 上限')
    if (!/lx\.|EVENT_NAMES|module\.exports|exports\./.test(content)) {
      throw new Error('不是有效的 lx-music 音源脚本（缺少 lx API 调用）')
    }
 //混淆/密钥风险预扫描（命中提示，不阻断导入）
    const risks = scanSourceRisks(content)
    if (risks.length) logger.warn(`[F-45] 导入风险提示（不阻断）：${risks.join('；')}`)
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
 //写盘后校验，loadError 立即 unlink 回滚（不留坏脚本）
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
      const le = String(loaded.loadError)
      if (/require is not defined|module is not defined/i.test(le)) {
        throw new Error('该脚本是 MusicFree 插件（非 lx 音源），请改用「导入插件 / 源市场 · 插件」通道安装')
      }
      throw new Error(`脚本加载失败（已回滚）：${le}`)
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

/**第三方源混淆/密钥风险预扫描（提示不阻断） */
export function scanSourceRisks(content: string): string[] {
  const risks: string[] = []
  const evalCount = (content.match(/eval\s*\(|new\s+Function\s*\(/g) || []).length
  if (evalCount >= 3) risks.push(`动态代码执行 ${evalCount} 处（eval/new Function）`)
  const longHex = content.match(/[0-9a-fA-F]{65,}/)
  if (longHex) risks.push('含超长 hex 串（>64 字符，疑似加密载荷/指纹）')
  const keyLike = content.match(/(?:api?key|secret|token|passwd|password)['\"\s:=]{1,4}([A-Za-z0-9_\-]{24,})/)
  if (keyLike) risks.push('疑似内嵌密钥/令牌')
  return risks
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
