/**
 * 移动端 `electron/core/cover.ts` 替身。
 *
 * 桌面版用 `protocol.handle` 注册 swcover:// 协议 + 磁盘缓存；WebView 里
 * 没有自定义协议，也没有本地缓存目录，所以这里只实现**取链兜底链**：
 *   song.pic 已是 http(s) → 直接用
 *   → lxHost.getPic(song)
 *   → itunesCover(name + singer)
 * 与桌面 `resolveCoverUrl` 的顺序完全一致（不含 swcover:// 落盘那一层）。
 *
 * 附带把远端图片请求走 /__cors 代理：真机侧 Capacitor 原生 http 不做 CORS，
 * 桌面侧走 swmedia://；只有在 http(s) 冒烟环境里浏览器才会拦跨域图片。
 */
import type { Song } from '../../../shared/types'
import { itunesCover } from '../../../electron/core/providers'
import { lxHost } from '../../../electron/core/lx-host'
import { isNativeWebView } from './util'

/** http(s) URL → 展示用地址。
 * 真机：走同源 /swmedia/ 原生代理（SwMediaClient 按 CDN 注入 Referer/UA）——
 * B 站 hdslb、酷我等图片 CDN 有防盗链，WebView 直连会带 https://localhost
 * 的 Referer 被 403 拒图（v1.0.0「MV 封面获取不到」的根因）。
 * 冒烟 http(s)：走 /__cors 代理；桌面不用本 shim。 */
function proxied(url: string): string {
  try {
    const t = new URL(url)
    if ((t.protocol === 'http:' || t.protocol === 'https:') && isNativeWebView()) {
      return `/swmedia/?u=${encodeURIComponent(url)}`
    }
    if ((t.protocol === 'http:' || t.protocol === 'https:') && typeof location !== 'undefined' && location.origin.startsWith('http')) {
      return location.origin + '/__cors/' + t.host + t.pathname + t.search
    }
  } catch { /* ignore */ }
  return url
}

/**
 * 移动端没有 swcover:// 自定义协议，桌面侧 `coverProtocolUrl` 在这里退化为
 * 「转成同源 /swmedia/ 代理地址」——调用方（如搜索封面增量补丁）不需要分端写两套。
 */
export function coverProtocolUrl(remoteUrl: string): string {
  const u = String(remoteUrl || '')
  if (!u) return ''
  return /^https?:\/\//i.test(u) ? proxied(u) : u
}

export async function resolveCoverUrl(song: Song): Promise<string> {
  const pic = String(song.pic || '')
  if (pic) {
    if (/^https?:\/\//.test(pic)) return proxied(pic)
    // swcover:// / data: 等已解析地址直接回传，让 WebView 自己决定
    if (pic) return pic
  }
  if (String(song.source || '') !== 'local') {
    try {
      const lx = await lxHost.getPic(song)
      if (lx && /^https?:\/\//.test(lx)) return proxied(lx)
    } catch { /* 落到下一级 */ }
  }
  const it = await itunesCover(`${song.name} ${song.singer}`)
  return it ? proxied(it) : ''
}

/** 本地曲目无内嵌封面时调用；移动端不扫描本地，不落盘 */
export async function saveEmbeddedCover(_data: Uint8Array, _mime: string, _seed: string): Promise<string> {
  return ''
}

export function clearCoverCache(): void { /* 无磁盘缓存，无需清理 */ }
export function coverCacheSize(): number { return 0 }

export default { resolveCoverUrl, saveEmbeddedCover, clearCoverCache, coverCacheSize }
