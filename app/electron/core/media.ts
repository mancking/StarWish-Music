import fs from 'node:fs'
import path from 'node:path'
import { Readable } from 'node:stream'
import { protocol, net } from 'electron'
import { createLogger } from './log'

const logger = createLogger('media')

const MIME: Record<string, string> = {
  '.mp3': 'audio/mpeg',
  '.flac': 'audio/flac',
  '.m4a': 'audio/mp4',
  '.aac': 'audio/aac',
  '.ogg': 'audio/ogg',
  '.opus': 'audio/ogg',
  '.wav': 'audio/wav',
  '.wma': 'audio/x-ms-wma',
  '.ape': 'audio/x-ape',
  '.mp4': 'video/mp4',
  '.webm': 'video/webm',
  '.m4v': 'video/mp4',
}

function mimeOf(p: string, fallback = 'audio/mpeg'): string {
  return MIME[path.extname(p).toLowerCase()] || fallback
}

function refererFor(url: string): string {
  try {
    const h = new URL(url).hostname
    if (h.includes('126.net') || h.includes('163.com')) return 'https://music.163.com/'
    if (h.includes('gtimg.cn') || h.includes('qq.com')) return 'https://y.qq.com/'
    if (h.includes('kugou.com')) return 'https://www.kugou.com/'
    if (h.includes('kuwo.cn')) return 'http://www.kuwo.cn/'
    if (h.includes('bilibili.com') || h.includes('hdslb.com') || h.includes('bilivideo')) return 'https://www.bilibili.com/'
    if (h.includes('migu.cn')) return 'https://music.migu.cn/'
  } catch {
    /* ignore */
  }
  return ''
}

export function mediaUrl(target: string): string {
  return `swmedia://stream/?u=${encodeURIComponent(target)}`
}

/**
 * 媒体代理协议：统一处理远程防盗链、Range 断点续传与本地文件流。
 * 播放器只认 swmedia://，从而彻底规避 CORS / Referer / file:// 兼容问题。
 */
export function registerMediaProtocol(getBiliCookie: () => string): void {
  protocol.handle('swmedia', async req => {
    let target = ''
    try {
      const u = new URL(req.url)
      target = u.searchParams.get('u') || ''
    } catch {
      return new Response('bad request', { status: 400 })
    }
    if (!target) return new Response('missing u', { status: 400 })

    // 本地文件
    if (!/^https?:\/\//i.test(target)) {
      try {
        const stat = fs.statSync(target)
        if (!stat.isFile()) return new Response('not found', { status: 404 })
        const size = stat.size
        const range = req.headers.get('Range') || req.headers.get('range')
        const type = mimeOf(target)
        if (range) {
          const m = /bytes=(\d*)-(\d*)/.exec(range)
          let start = m && m[1] ? parseInt(m[1], 10) : 0
          let end = m && m[2] ? parseInt(m[2], 10) : size - 1
          if (Number.isNaN(start) || start < 0) start = 0
          if (Number.isNaN(end) || end >= size) end = size - 1
          if (start > end) return new Response('range not satisfiable', { status: 416 })
          const stream = fs.createReadStream(target, { start, end })
          return new Response(Readable.toWeb(stream) as any, {
            status: 206,
            headers: {
              'Content-Type': type,
              'Content-Length': String(end - start + 1),
              'Content-Range': `bytes ${start}-${end}/${size}`,
              'Accept-Ranges': 'bytes',
              'Access-Control-Allow-Origin': '*',
            },
          })
        }
        return new Response(Readable.toWeb(fs.createReadStream(target)) as any, {
          status: 200,
          headers: {
            'Content-Type': type,
            'Content-Length': String(size),
            'Accept-Ranges': 'bytes',
            'Access-Control-Allow-Origin': '*',
          },
        })
      } catch (e: any) {
        logger.warn('本地媒体读取失败', target, e?.message)
        return new Response('not found', { status: 404 })
      }
    }

    // 远程流：透传 Range，注入 Referer / Cookie
    const headers: Record<string, string> = {
      'User-Agent':
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
      Accept: '*/*',
    }
    const referer = refererFor(target)
    if (referer) headers.Referer = referer
    const range = req.headers.get('Range') || req.headers.get('range')
    if (range) headers.Range = range
    if (/bilibili|bilivideo|hdslb/i.test(target)) headers.Cookie = getBiliCookie()

    try {
      // 优先使用 Node 原生 fetch：网易云等 CDN 会 302 到 http 地址，
      // Chromium 网络栈会以 ERR_BLOCKED_BY_CLIENT 拦截明文 http 跳转。
      let res: Response
      try {
        res = await fetch(target, { headers, redirect: 'follow' })
      } catch {
        res = await net.fetch(target, { headers, redirect: 'follow' })
      }
      const outHeaders: Record<string, string> = {
        'Content-Type': res.headers.get('content-type') || mimeOf(target.split('?')[0]),
        'Accept-Ranges': 'bytes',
        'Access-Control-Allow-Origin': '*',
        'Cache-Control': 'no-store',
      }
      for (const k of ['content-length', 'content-range', 'etag', 'last-modified']) {
        const v = res.headers.get(k)
        if (v) outHeaders[k.replace(/(^|-)([a-z])/g, (_, a, b) => a + b.toUpperCase())] = v
      }
      if (!res.ok && res.status !== 206) {
        logger.warn('媒体请求失败', res.status, target.slice(0, 100))
      }
      return new Response(res.body as any, { status: res.status, headers: outHeaders })
    } catch (e: any) {
      logger.warn('媒体代理异常', e?.message, target.slice(0, 100))
      return new Response('upstream error', { status: 502 })
    }
  })
}
