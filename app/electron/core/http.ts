import { createLogger } from './log'

const logger = createLogger('http')

export const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36'

export interface HttpResponse {
  status: number
  headers: Record<string, string>
  raw: string
  body: any
}

export interface RequestOptions {
  method?: string
  body?: any
  headers?: Record<string, string>
  timeout?: number
  retry?: number
  /** 期望二进制时传 true，返回 raw 为 latin1 字符串，bytes 为 Buffer */
  binary?: boolean
  /** 'manual' 时不自动跟随跳转，302 的 location 留在 headers.location（解析分享链接用） */
  redirect?: 'follow' | 'manual'
}

export class HttpError extends Error {
  status: number
  url: string
  constructor(message: string, url: string, status = 0) {
    super(message)
    this.name = 'HttpError'
    this.status = status
    this.url = url
  }
}

function withTimeout(ms: number): { signal: AbortSignal; done: () => void } {
  const ctl = new AbortController()
  const timer = setTimeout(() => ctl.abort(), Math.max(1000, ms))
  return { signal: ctl.signal, done: () => clearTimeout(timer) }
}

/** 是否跑在 Capacitor 原生 WebView（Android 真机）。桌面主进程 / 冒烟浏览器为 false。 */
function isNativeCap(): boolean {
  try {
    const c: any = (globalThis as any).Capacitor
    return !!(c && typeof c.isNativePlatform === 'function' && c.isNativePlatform())
  } catch {
    return false
  }
}

/**
 * 真机原生 HTTP 通道。
 *
 * v2.3.1 根因修复：v2.3.0 走 `import('@capacitor-community/http')`，该 npm 包
 * 在生产构建里是独立动态 chunk，真机上一旦加载失败（CSP/分包/版本错配），
 * 所有请求集体报错 →「所有功能网络不可用」。现改为直连 Capacitor 运行时
 * 内置的 `CapacitorHttp` 插件（`Capacitor.nativePromise`，零 npm 依赖），
 * 并保留 npm 包 import 与 WebView fetch 两级回退——任何一级失败都不会
 * 再拖垮全部网络。
 */
type NativeRes = { status: number; headers: Record<string, unknown>; data: unknown; url?: string }

/** 探明一条可用的原生通道并缓存：nativePromise → @capacitor-community/http → null(用 WebView fetch) */
let nativeChannel: ((opts: any) => Promise<NativeRes>) | null | undefined

async function resolveNativeChannel(): Promise<((opts: any) => Promise<NativeRes>) | null> {
  if (nativeChannel !== undefined) return nativeChannel
  const cap: any = (globalThis as any).Capacitor
  // 1) Capacitor 6 内置 CapacitorHttp（与 capacitor.config 的 plugins.CapacitorHttp 同源）
  if (cap && typeof cap.nativePromise === 'function') {
    nativeChannel = (o: any) => cap.nativePromise('CapacitorHttp', 'request', o) as Promise<NativeRes>
    return nativeChannel
  }
  // 2) 社区包（兜底，旧壳/自定义运行时）
  try {
    const mod: any = await import('@capacitor-community/http')
    if (mod?.Http?.request) {
      nativeChannel = (o: any) => mod.Http.request(o) as Promise<NativeRes>
      return nativeChannel
    }
  } catch { /* 继续降级 */ }
  nativeChannel = null
  return null
}

async function nativeRequest(
  url: string,
  opts: RequestOptions
): Promise<HttpResponse & { bytes?: Buffer }> {
  const send = await resolveNativeChannel()
  if (!send) throw new Error('原生 HTTP 通道不可用')
  const method = (opts.method || 'GET').toUpperCase()
  const retry = opts.retry ?? 1
  const timeout = Math.max(1000, opts.timeout ?? 15000)
  let lastErr: unknown = null

  for (let attempt = 0; attempt <= retry; attempt++) {
    try {
      const headers: Record<string, string> = {
        'User-Agent': UA,
        'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.8',
        ...(opts.headers || {}),
      }
      let data: string | undefined
      if (opts.body !== undefined && opts.body !== null && method !== 'GET' && method !== 'HEAD') {
        data =
          typeof opts.body === 'string'
            ? opts.body
            : Buffer.isBuffer(opts.body)
              ? (opts.body as any).toString('utf8')
              : JSON.stringify(opts.body)
        if (!Object.keys(headers).some(k => k.toLowerCase() === 'content-type')) {
          headers['Content-Type'] = 'application/json'
        }
      }
      const res = await send({
        url,
        method,
        headers,
        data,
        // 注意：原生层对 Content-Type 为 JSON 的响应无论如何都会预解析成对象，
        // 这里的 responseType 只影响非 JSON 响应；binary 用 arraybuffer（返回 base64）
        responseType: opts.binary ? 'arraybuffer' : 'text',
        connectTimeout: timeout,
        readTimeout: timeout,
        disableRedirects: opts.redirect === 'manual',
      })
      // 原生层把多值响应头用 ", " 连接成单值；这里统一收进小写键，
      // set-cookie 多条以 ;; 连接（与桌面 getSetCookie 的处理约定一致）
      const h: Record<string, string> = {}
      const hs: any = res.headers || {}
      for (const k of Object.keys(hs)) {
        const lk = k.toLowerCase()
        const v = String(hs[k] ?? '')
        if (lk === 'set-cookie') h['set-cookie'] = h['set-cookie'] ? `${h['set-cookie']};;${v}` : v
        else h[lk] = v
      }
      if (res.status >= 500 && attempt < retry) {
        lastErr = new HttpError(`服务端错误 ${res.status}`, url, res.status)
        continue
      }
      if (opts.binary) {
        const buf = Buffer.from(String(res.data || ''), 'base64')
        return { status: res.status, headers: h, raw: buf.toString('latin1'), body: null, bytes: buf }
      }
      const isObj = res.data !== null && typeof res.data === 'object'
      const text = isObj ? JSON.stringify(res.data) : String(res.data ?? '')
      let parsed: any = text
      if (isObj) parsed = res.data
      else if (text) {
        const ct = h['content-type'] || ''
        if (ct.includes('json') || /^[\[{]/.test(text.trim())) {
          try {
            parsed = JSON.parse(text)
          } catch {
            parsed = text
          }
        }
      }
      return { status: res.status, headers: h, raw: text, body: parsed }
    } catch (e) {
      lastErr = e
      if (attempt < retry) continue
    }
  }

  const msg = lastErr instanceof Error ? lastErr.message : String(lastErr)
  logger.warn('请求失败(原生)', url, msg)
  throw new HttpError(`网络请求失败：${msg}`, url)
}

/**
 * 统一请求：超时、重试、JSON 自动解析、错误归一化。
 * 绝不向外抛裸异常（调用方可依赖 HttpError 判断状态码）。
 */
export async function request(url: string, opts: RequestOptions = {}): Promise<HttpResponse & { bytes?: Buffer }> {
  // 真机 WebView：跨域 fetch 全部被 CORS 拦截，优先走原生 HTTP 通道；
  // 通道不可用（插件缺失/加载失败）时降级 WebView fetch——CapacitorHttp 开启时
  // native-bridge 已接管 window.fetch，本身无 CORS，请求仍能继续。
  if (isNativeCap()) {
    try {
      return await nativeRequest(url, opts)
    } catch (e) {
      logger.warn('原生通道失败，降级 WebView fetch', url, String((e as Error)?.message || e))
    }
  }
  const method = (opts.method || 'GET').toUpperCase()
  const retry = opts.retry ?? 1
  let lastErr: unknown = null

  for (let attempt = 0; attempt <= retry; attempt++) {
    const { signal, done } = withTimeout(opts.timeout ?? 15000)
    try {
      const headers: Record<string, string> = {
        'User-Agent': UA,
        'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.8',
        ...(opts.headers || {}),
      }
      let body: any
      if (opts.body !== undefined && opts.body !== null && method !== 'GET' && method !== 'HEAD') {
        if (typeof opts.body === 'string' || Buffer.isBuffer(opts.body)) body = opts.body
        else {
          if (!Object.keys(headers).some(k => k.toLowerCase() === 'content-type')) {
            headers['Content-Type'] = 'application/json'
          }
          body = JSON.stringify(opts.body)
        }
      }
      const res = await fetch(url, { method, headers, body, signal, redirect: opts.redirect || 'follow' })
      const h: Record<string, string> = {}
      res.headers.forEach((v, k) => {
        h[k.toLowerCase()] = v
      })
      // fetch 的 Headers.forEach 把多条 Set-Cookie 折叠成一条且会丢掉第一条（实测只剩 DedeUserID，
      // SESSDATA 消失），导致 B 站扫码登录拿不到登录态。用 getSetCookie() 取全量。
      const setCookies = typeof (res.headers as any).getSetCookie === 'function' ? (res.headers as any).getSetCookie() : []
      if (Array.isArray(setCookies) && setCookies.length) h['set-cookie'] = setCookies.join(';;')
      if (opts.binary) {
        const buf = Buffer.from(await res.arrayBuffer())
        return { status: res.status, headers: h, raw: buf.toString('latin1'), body: null, bytes: buf }
      }
      const text = await res.text()
      let parsed: any = text
      if (text) {
        const ct = h['content-type'] || ''
        if (ct.includes('json') || /^[\[{]/.test(text.trim())) {
          try {
            parsed = JSON.parse(text)
          } catch {
            parsed = text
          }
        }
      }
      if (res.status >= 500 && attempt < retry) {
        lastErr = new HttpError(`服务端错误 ${res.status}`, url, res.status)
        continue
      }
      return { status: res.status, headers: h, raw: text, body: parsed }
    } catch (e: any) {
      lastErr = e
      const aborted = e?.name === 'AbortError'
      if (aborted && attempt < retry) continue
      if (attempt < retry) continue
    } finally {
      done()
    }
  }

  const msg = lastErr instanceof Error ? lastErr.message : String(lastErr)
  logger.warn('请求失败', url, msg)
  throw new HttpError(`网络请求失败：${msg}`, url)
}

export async function getJson<T = any>(
  url: string,
  headers?: Record<string, string>,
  timeout = 15000
): Promise<T> {
  const res = await request(url, { headers, timeout })
  return res.body as T
}

export function qs(obj: Record<string, string | number | undefined | null>): string {
  return Object.keys(obj)
    .filter(k => obj[k] !== undefined && obj[k] !== null && obj[k] !== '')
    .map(k => `${encodeURIComponent(k)}=${encodeURIComponent(String(obj[k]))}`)
    .join('&')
}

export const sleep = (ms: number) => new Promise<void>(r => setTimeout(r, ms))

/** 按域名限流：避免首页并发请求触发平台风控 */
const limiters = new Map<string, { active: number; queue: (() => void)[] }>()

export async function limited<T>(key: string, limit: number, fn: () => Promise<T>): Promise<T> {
  let st = limiters.get(key)
  if (!st) {
    st = { active: 0, queue: [] }
    limiters.set(key, st)
  }
  if (st.active >= limit) {
    await new Promise<void>(resolve => st!.queue.push(resolve))
  }
  st.active++
  try {
    return await fn()
  } finally {
    st.active--
    const next = st.queue.shift()
    if (next) next()
  }
}

export function hostOf(url: string): string {
  try {
    return new URL(url).hostname
  } catch {
    return 'unknown'
  }
}

/** 简单并发池，避免同时打爆某个平台接口 */
export async function pool<T, R>(items: T[], limit: number, fn: (item: T, i: number) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length)
  let cursor = 0
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (cursor < items.length) {
      const i = cursor++
      out[i] = await fn(items[i], i)
    }
  })
  await Promise.all(workers)
  return out
}

export function stripHtml(s: string): string {
  return String(s || '')
    .replace(/<[^>]*>/g, '')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, ' ')
}
