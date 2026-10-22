/** node:util 的浏览器垫片（只保留 core 可能用到的几个）。 */

/**
 * 最小 Buffer polyfill（浏览器无 Node Buffer）。
 * lx 音源沙箱、http.ts、music-service.ts、cover.ts 都要用：
 * isBuffer / from(str, enc) / from(arrayBuffer) / concat / toString(enc)。
 */
class BufferImpl extends Uint8Array {
  static isBuffer(b: any): boolean {
    return b instanceof BufferImpl || (b && b.__isBufferPoly__ === true) || b instanceof Uint8Array
  }
  static from(v: any, enc?: any): any {
    if (typeof v === 'string') {
      if (enc === 'base64') return new BufferImpl(Uint8Array.from(atob(v), (c) => c.charCodeAt(0)))
      if (enc === 'hex') {
        const out = new BufferImpl(v.length >> 1)
        for (let i = 0; i < out.length; i++) out[i] = parseInt(v.substr(i * 2, 2), 16)
        return out
      }
      return new BufferImpl(new TextEncoder().encode(v))
    }
    if (Array.isArray(v)) return new BufferImpl(v)
    if (v instanceof ArrayBuffer) return new BufferImpl(v.slice(0))
    if (v && (v as any).buffer !== undefined && (v as any).byteLength !== undefined) {
      return new BufferImpl((v as any).buffer.slice((v as any).byteOffset, (v as any).byteOffset + (v as any).byteLength))
    }
    if (v && v.type === 'Buffer' && Array.isArray(v.data)) return new BufferImpl(v.data)
    return new BufferImpl(0)
  }
  static alloc(n: number, fill = 0): any {
    const b = new BufferImpl(n)
    if (fill) b.fill(fill)
    return b
  }
  static concat(list: Array<Uint8Array | ArrayLike<number>>): any {
    const total = list.reduce((s: number, x: any) => s + x.length, 0)
    const out = new BufferImpl(total)
    let off = 0
    for (const x of list) {
      out.set(x as any, off)
      off += x.length
    }
    return out
  }
  toString(enc: string = 'utf8'): string {
    if (enc === 'hex') {
      let s = ''
      for (const byte of this) s += byte.toString(16).padStart(2, '0')
      return s
    }
    if (enc === 'base64') {
      let bin = ''
      for (let i = 0; i < this.length; i++) bin += String.fromCharCode(this[i])
      return btoa(bin)
    }
    if (enc === 'latin1' || enc === 'binary') {
      let s = ''
      for (let i = 0; i < this.length; i++) s += String.fromCharCode(this[i])
      return s
    }
    if (enc === 'utf16le') {
      let s = ''
      for (let i = 0; i + 1 < this.length; i += 2) s += String.fromCharCode(this[i] | (this[i + 1] << 8))
      return s
    }
    return new TextDecoder().decode(this)
  }
}

/**
 * 全局 Buffer 引用（lx 音源沙箱在 core 里直接写 `Buffer` 而不 import）。
 * 这里刻意取 globalThis 可能已存在的实现，避免重复构造。
 */
export const Buffer: any = (globalThis as any).Buffer || BufferImpl

/** 在 boot 最前面调用：把 Buffer 装到全局，供 lx-host 沙箱与 core 取用 */
export function registerBufferGlobal(): void {
  if (!(globalThis as any).Buffer) (globalThis as any).Buffer = BufferImpl
}

/**
 * 当前是否跑在 Capacitor 真机 WebView（native-bridge 已注入）。
 * 真机启用 CapacitorHttp 后 native-bridge 已把 window.fetch 换成原生请求
 * （无 CORS），此时绝不能再改写到 /__cors/——真机静态服务器不提供该代理，
 * 改写会让接口拿到 index.html 而「响应格式异常」。
 */
export function isNativeWebView(): boolean {
  try {
    const c = (globalThis as any).Capacitor
    return !!(c && typeof c.isNativePlatform === 'function' && c.isNativePlatform())
  } catch { return false }
}

/**
 * 把全局 fetch 也顺到同源 /__cors 代理上。
 *
 * `electron/core/http.ts` 用的是裸 fetch（桌面主进程无 CORS 概念），浏览器里
 * 这条路径会被上游 CORS 策略全部拦掉。只在 location 是 http(s)（冒烟环境）时
 * 改写；真机（native-bridge 原生 fetch）与桌面都不受影响。
 */
export function patchFetch(): void {
  const orig = (globalThis as any).fetch
  if (!orig || orig.__starwishPatched) return
  // 真机：native-bridge 的 CapacitorHttp fetch 已无 CORS，直通即可
  if (isNativeWebView()) return
  const patched = (input: any, init?: RequestInit) => {
    let u = ''
    try {
      u = typeof input === 'string' ? input : String((input as any)?.url ?? input ?? '')
    } catch { /* ignore */ }
    // swmedia:// 取链由移动端播放器直接透传，不走代理
    try {
      const t = new URL(u)
      // 同源（本机静态服务、wasm 等）绝不经代理
      if (t.origin === location.origin) return orig(input, init)
    } catch { /* 非同源或相对路径，继续判断 */ }
    if (/^https?:\/\//.test(u) && typeof location !== 'undefined' && /^https?:$/.test(location.protocol)) {
      const t = new URL(u)
      return orig(location.origin + '/__cors/' + t.host + t.pathname + t.search, init)
    }
    return orig(input, init)
  }
  ;(patched as any).__starwishPatched = true
  ;(globalThis as any).fetch = patched
}

/**
 * 真机原生 fetch：把全局 fetch 的**跨域 http(s) 请求**改走 Capacitor 原生
 * HTTP 插件（@capacitor-community/http，无 CORS 概念），返回真实 Response
 * 对象（.json()/.text()/.headers 照常用）。
 *
 * `electron/core/http.ts` 的 request() 已在内部走原生通道；这里再兜一层是给
 * 直接用裸 fetch 的消费者（MusicFree 插件沙箱里 axios 的 fetch adapter 等）。
 * 同源（https://localhost 的静态资源）与 blob:/data: 一律透传原生 fetch。
 */
export async function patchNativeFetch(): Promise<void> {
  if (!isNativeWebView()) return
  const orig = (globalThis as any).fetch
  if (!orig || orig.__starwishNative) return
  let httpMod: any = null
  // 优先 Capacitor 运行时内置的 CapacitorHttp（零依赖、永不断链）；
  // 拿不到再退 @capacitor-community/http；都没有则不接管（保持原 fetch）。
  const getHttp = async (): Promise<any> => {
    const cap: any = (globalThis as any).Capacitor
    if (cap && typeof cap.nativePromise === 'function') {
      return {
        request: (o: any) => cap.nativePromise('CapacitorHttp', 'request', o),
      }
    }
    if (!httpMod) httpMod = await import('@capacitor-community/http').catch(() => null)
    return httpMod?.Http ?? null
  }
  const nativeFetch = async (input: any, init?: any) => {
    let url = ''
    try {
      url = typeof input === 'string' ? input : String(input?.url ?? input ?? '')
    } catch {
      url = ''
    }
    let external = false
    try {
      const t = new URL(url, location.origin)
      external = /^https?:$/.test(t.protocol) && t.origin !== location.origin
    } catch {
      external = false
    }
    if (!external) return orig(input, init)
    const Http = await getHttp()
    if (!Http) return orig(input, init)
    const method = String(init?.method || (typeof input === 'object' && input?.method) || 'GET').toUpperCase()
    const headers: Record<string, string> = {}
    const src = init?.headers ?? (typeof input === 'object' ? input?.headers : null)
    if (src) {
      if (typeof src.forEach === 'function') src.forEach((v: any, k: string) => { headers[k] = String(v) })
      else if (Array.isArray(src)) src.forEach(([k, v]: any) => { headers[k] = String(v) })
      else Object.keys(src).forEach(k => { headers[k] = String(src[k]) })
    }
    let data: string | undefined
    if (init?.body && method !== 'GET' && method !== 'HEAD') {
      data = typeof init.body === 'string' ? init.body : String(init.body)
      if (!Object.keys(headers).some(k => k.toLowerCase() === 'content-type')) {
        headers['Content-Type'] = 'application/json'
      }
    }
    let res: any
    try {
      res = await Http.request({
        url,
        method,
        headers,
        data,
        responseType: 'text',
        connectTimeout: 15000,
        readTimeout: 30000,
      })
    } catch (e) {
      // 原生请求失败：退回 WebView fetch 再试一次（CapacitorHttp 的 native-bridge
      // 接管时该 fetch 本身无 CORS；即便失败也比整层断网信息更明确）
      try {
        return await orig(input, init)
      } catch {
        throw e
      }
    }
    const hs = new Headers()
    for (const k of Object.keys(res.headers || {})) {
      const v = (res.headers as any)[k]
      if (Array.isArray(v)) v.forEach((x: any) => hs.append(k, String(x)))
      else hs.append(k, String(v))
    }
    const bodyText = res.data !== null && typeof res.data === 'object' ? JSON.stringify(res.data) : String(res.data ?? '')
    const status = Number(res.status) || 200
    // 101/204/205/304 不允许带 body
    const nullBody = status === 101 || status === 204 || status === 205 || status === 304
    return new Response(nullBody ? null : bodyText, { status, headers: hs })
  }
  ;(nativeFetch as any).__starwishNative = true
  ;(globalThis as any).fetch = nativeFetch
}

export function format(fmt: string, ...args: any[]): string {
  let i = 0
  return String(fmt).replace(/%[sdifjoO%]/g, (s: string) => {
    if (s === '%%') return '%'
    if (i >= args.length) return s
    const v = args[i++]
    if (s === '%j') { try { return JSON.stringify(v) } catch { return String(v) } }
    if (s === '%d' || s === '%i') return String(parseInt(v, 10))
    if (s === '%f') return String(parseFloat(v))
    if (s === '%o' || s === '%O' || s === '%j') { try { return JSON.stringify(v) } catch { return String(v) } }
    return typeof v === 'string' ? v : inspect(v)
  })
}

export function inspect(v: any): string {
  return typeof v === 'string' ? v : JSON.stringify(v)
}

export function promisify<T, R>(fn: (...args: any[]) => any): (...args: any[]) => Promise<R> {
  return (...args: any[]) =>
    new Promise((res, rej) => {
      fn(...args, (e: any, r: R) => (e ? rej(e) : res(r)))
    }) as any
}

export function callbackify(fn: (...args: any[]) => Promise<any>): (...args: any[]) => void {
  return (...args: any[]) => {
    const cb = args.pop() as any
    fn(...args).then(r => cb(null, r), e => cb(e))
  }
}

export const types = {
  isDate: (v: any) => v instanceof Date,
  isRegExp: (v: any) => v instanceof RegExp,
  isError: (v: any) => v instanceof Error,
}
export const TextDecoder = globalThis.TextDecoder
export const TextEncoder = globalThis.TextEncoder
export default { format, inspect, promisify, callbackify, types, TextDecoder, TextEncoder }
