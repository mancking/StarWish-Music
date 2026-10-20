import { request } from './http'

/**
 * 跟随一次 HTTP 跳转，取跳转后的地址（落雪 handleParseId 的做法）。
 *
 * 桌面走主进程 fetch：redirect:'manual' 能拿到 302 的 Location。
 * 移动端（Capacitor）另有一份实现，见 src/mobile/shims/redirect-mobile.ts。
 */
export async function followRedirect(url: string): Promise<string> {
  try {
    const res = await request(url, { redirect: 'manual', timeout: 10000, retry: 0 })
    const loc = res.headers['location']
    if (!loc) return url
    return /^https?:\/\//i.test(loc) ? loc : new URL(loc, url).toString()
  } catch {
    return url
  }
}
