import fs from 'node:fs'
import fsp from 'node:fs/promises'
import path from 'node:path'
import crypto from 'node:crypto'
import { Readable } from 'node:stream'
import { protocol, net } from 'electron'
import { createLogger } from './log'
import { ensureDir, mediaCacheDir } from './paths'

const logger = createLogger('media')

const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36'

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

/** —— 视频边播边存（临时流缓存）——
 * 只缓存视频流（.mp4/.webm/.m4v）：swmedia 代理时按 offset tee 写入 mediaCacheDir()/stream，
 * 下完整后改名为 <sha1>.<ext> 即视为完整缓存，后续播放直接本地服务（含 Range）。
 * 临时性：关闭视频页 / 切分P 由渲染层调 releaseMediaCache 清除，应用启动时整体清空。
 * ponytail: 不做 LRU/容量上限（临时目录，关页即删）；写冲突（乱序 Range）时放弃该次缓存，播放不受影响。 */
const VIDEO_EXT = new Set(['.mp4', '.webm', '.m4v'])

function streamDir(): string {
  return path.join(mediaCacheDir(), 'stream')
}

function cacheKey(target: string): string {
  return crypto.createHash('sha1').update(target).digest('hex')
}

function isVideoUrl(target: string): boolean {
  try {
    return VIDEO_EXT.has(path.extname(new URL(target).pathname).toLowerCase())
  } catch {
    return false
  }
}

/** 完整缓存文件路径（存在才返回） */
function completeCacheFile(target: string): string | null {
  const key = cacheKey(target)
  try {
    for (const f of fs.readdirSync(streamDir())) {
      if (f.startsWith(key) && !f.endsWith('.part')) return path.join(streamDir(), f)
    }
  } catch {
    /* 目录不存在 */
  }
  return null
}

interface CacheState {
  fh: fsp.FileHandle
  written: number
  total: number
  file: string
  ext: string
  active: boolean
}
const streamStates = new Map<string, CacheState>()

/** 清除视频临时缓存：给定 url 清该视频（含进行中的 .part），不给则整体清空 */
export async function releaseMediaCache(url?: string): Promise<void> {
  const drop = (key: string): void => {
    const st = streamStates.get(key)
    if (st) {
      streamStates.delete(key)
      void st.fh.close().catch(() => {})
    }
    try {
      for (const f of fs.readdirSync(streamDir())) {
        if (f.startsWith(key)) fs.rmSync(path.join(streamDir(), f), { force: true })
      }
    } catch {
      /* 目录不存在 */
    }
  }
  if (url) {
    drop(cacheKey(url))
  } else {
    for (const key of [...streamStates.keys()]) drop(key)
    try {
      fs.rmSync(streamDir(), { recursive: true, force: true })
    } catch {
      /* ignore */
    }
  }
}

let biliCookieGetter: () => string = () => ''

/**
 * 把远程媒体整片下载到指定路径（走与代理一致的 Referer / Cookie / 重定向策略）。
 */
export async function downloadMediaTo(url: string, dest: string): Promise<void> {
  const headers: Record<string, string> = { 'User-Agent': UA, Accept: '*/*' }
  const referer = refererFor(url)
  if (referer) headers.Referer = referer
  if (/bilibili|bilivideo|hdslb/i.test(url)) headers.Cookie = biliCookieGetter()
  let res: Response
  try {
    res = await fetch(url, { headers, redirect: 'follow' })
  } catch {
    res = await net.fetch(url, { headers, redirect: 'follow' })
  }
  if (!res.ok || !res.body) throw new Error(`下载失败（HTTP ${res.status}）`)
  const fh = await fsp.open(dest, 'w')
  try {
    const reader = (res.body as any).getReader()
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      await fh.write(value)
    }
  } finally {
    await fh.close()
  }
}

/**
 * 媒体代理协议：统一处理远程防盗链、Range 断点续传与本地文件流。
 * 播放器只认 swmedia://，从而彻底规避 CORS / Referer / file:// 兼容问题。
 */
export function registerMediaProtocol(getBiliCookie: () => string): void {
  biliCookieGetter = getBiliCookie
  // 启动即清空上一次会话残留的视频临时缓存（临时性质）
  void releaseMediaCache()
  protocol.handle('swmedia', async req => {
    let target = ''
    try {
      const u = new URL(req.url)
      target = u.searchParams.get('u') || ''
    } catch {
      return new Response('bad request', { status: 400 })
    }
    if (!target) return new Response('missing u', { status: 400 })

    // 视频有完整缓存 → 直接当本地文件服务（含 Range，二次播放零流量）
    if (isVideoUrl(target)) {
      const cached = completeCacheFile(target)
      if (cached) target = cached
    }

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
      // 视频边播边存：按 Range 偏移 tee 写入 .part；整个文件下完整后改名成完整缓存
      let body: ReadableStream<Uint8Array> | null = res.body
      if (body && isVideoUrl(target) && (res.status === 200 || res.status === 206)) {
        try {
          const key = cacheKey(target)
          const m = /bytes=(\d*)-/.exec(range || '')
          const start = m ? (m[1] ? parseInt(m[1], 10) : 0) : 0
          const cr = res.headers.get('content-range')
          const total = cr
            ? parseInt(cr.split('/')[1] || '0', 10)
            : res.status === 200
              ? parseInt(res.headers.get('content-length') || '0', 10)
              : 0
          let st = streamStates.get(key)
          if (start === 0) {
            await ensureDir(streamDir())
            const file = path.join(streamDir(), `${key}.part`)
            if (st) await st.fh.close().catch(() => {})
            st = {
              fh: await fsp.open(file, 'w'),
              written: 0,
              total,
              file,
              ext: path.extname(new URL(target).pathname).toLowerCase() || '.mp4',
              active: true,
            }
            streamStates.set(key, st)
          } else if (st && st.written === start) {
            /* 连续续传：复用同一句柄 */
          } else {
            // 无起点状态或偏移对不上：放弃本次缓存（播放透传不受影响）
            if (st) {
              await st.fh.close().catch(() => {})
              streamStates.delete(key)
            }
            st = undefined
          }
          const state = st
          if (state) {
            const src = body
            // reader 只能创建一次：ReadableStream 被第二个 getReader() 会抛 locked，
            // 之前每 pull 新建导致第二块起全被判 done → 视频只剩首块 → Format error
            const reader = src.getReader()
            body = new ReadableStream<Uint8Array>({
              async pull(controller) {
                const { done, value } = await reader.read().catch(() => ({ done: true, value: undefined }))
                if (done) {
                  await state.fh.close().catch(() => {})
                  streamStates.delete(key)
                  if (state.total && state.written >= state.total) {
                    // 下载完整 → 升格为完整缓存
                    await fsp.rename(state.file, path.join(streamDir(), `${key}${state.ext}`)).catch(() => {})
                  }
                  controller.close()
                  return
                }
                if (value) {
                  await state.fh.write(value, 0, value.length, state.written).catch(() => {})
                  state.written += value.length
                }
                controller.enqueue(value!)
              },
              async cancel(reason) {
                await state.fh.close().catch(() => {})
                streamStates.delete(key)
                reader.cancel(reason).catch(() => {})
              },
            })
          }
        } catch (e: any) {
          // 缓存是附加优化：任何缓存侧异常（磁盘满/杀软锁目录/句柄失效）都降级为纯透传，
          // 绝不能让整条媒体请求 502（那会让所有视频 Format error）
          logger.warn('视频缓存写入异常，降级为透传', e?.message)
          body = res.body
        }
      }
      return new Response(body as any, { status: res.status, headers: outHeaders })
    } catch (e: any) {
      logger.warn('媒体代理异常', e?.message, target.slice(0, 100))
      return new Response('upstream error', { status: 502 })
    }
  })
}
