/**
 * 移动端「跟随跳转」实现（Capacitor）。
 *
 * 开启 CapacitorHttp 后 GET 走原生 fetch 代理：
 *   - 代理端（WebViewLocalServer）自动跟随跳转，JS 侧拿不到 302 的 Location；
 *   - 浏览器把 User-Agent 当 forbidden header 丢掉，上游看到的是 WebView 的
 *     移动 UA，QQ 分享链接的落地页在移动 UA 下是空壳（正文里没有歌单 id）。
 *
 * 所以这里改用原生 CapacitorHttp 插件自己发一次（disableRedirects），
 * 直接拿 302 的 Location；插件不可用（如冒烟环境）时退回共享的 fetch 实现。
 */
import { UA } from '../../../electron/core/http'
import { followRedirect as sharedFollowRedirect } from '../../../electron/core/redirect'

export async function followRedirect(url: string): Promise<string> {
  try {
    const cap: any = (globalThis as any).Capacitor
    if (cap && typeof cap.nativePromise === 'function') {
      const r: any = await cap.nativePromise('CapacitorHttp', 'request', {
        url,
        method: 'GET',
        disableRedirects: true,
        connectTimeout: 10000,
        readTimeout: 10000,
        headers: { 'User-Agent': UA },
      })
      const h: Record<string, string> = (r && r.headers) || {}
      const loc = h.Location || h.location || h.LOCATION || ''
      if (loc) return /^https?:\/\//i.test(loc) ? loc : new URL(loc, url).toString()
      // 没有 Location（例如上游直接 200）时用最终地址：插件自动跟跳转，
      // 返回的 url 就是落地页地址，歌单 id 仍能从里面取到。
      const finalUrl = String((r && r.url) || '')
      if (finalUrl && finalUrl !== url) return finalUrl
    }
  } catch {
    /* 落到共享实现 */
  }
  return sharedFollowRedirect(url)
}

export default { followRedirect }
