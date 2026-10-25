import fs from 'node:fs'
import fsp from 'node:fs/promises'
import path from 'node:path'
import crypto from 'node:crypto'
import { Readable } from 'node:stream'
import { protocol, net } from 'electron'
import { createLogger } from './log'
import { ensureDir, mediaCacheDir } from './paths'
import { audioCacheFile, putAudioCache, pruneVideoCache } from './cache'

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
const AUDIO_EXT = new Set(['.mp3', '.m4a', '.aac', '.flac', '.ogg', '.opus', '.wav'])

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

/** 音频类资源 */
function isAudioUrl(target: string): boolean {
  try {
    const ext = path.extname(new URL(target).pathname).toLowerCase()
    return AUDIO_EXT.has(ext)
  } catch {
    return false
  }
}

function extOf(target: string): string {
  try {
    const ext = path.extname(new URL(target).pathname).toLowerCase()
    return AUDIO_EXT.has(ext) ? ext : '.m4a'
  } catch {
    return '.m4a'
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

/* ============================ 在线 MV 离线缓存（持久，跨会话） ============================
 * 与上面的 stream 临时缓存不同：离线缓存存到 mediaCacheDir()/offline，启动/关页不清空，
 * 下次播放同一 bvid+cid 直接本地服务，零流量、秒开。按 bvid+cid 取键（源流 URL 会过期，不可当键）。
 * manifest.json 记录标题/大小/时间，供缓存管理面板展示与清理。 */
interface OfflineEntry {
  key: string
  bvid: string
  cid: string
  title: string
  file: string
  size: number
  savedAt: number
}

function offlineDir(): string {
  return path.join(mediaCacheDir(), 'offline')
}

function offlineManifestPath(): string {
  return path.join(offlineDir(), 'manifest.json')
}

function offlineKey(bvid: string, cid: string): string {
  return offlineKeyOf(bvid, cid)
}

/** 离线缓存 manifest 键（三端统一契约：渲染层可自行计算或传 bvid+cid） */
export function offlineKeyOf(bvid: string, cid: string): string {
  return crypto.createHash('sha1').update(`${bvid}:${cid}`).digest('hex')
}

function readOfflineManifest(): Record<string, OfflineEntry> {
  try {
    return JSON.parse(fs.readFileSync(offlineManifestPath(), 'utf8')) || {}
  } catch {
    return {}
  }
}

function writeOfflineManifest(map: Record<string, OfflineEntry>): void {
  try {
    fs.writeFileSync(offlineManifestPath(), JSON.stringify(map))
  } catch {
    /* ignore */
  }
}

/** 该 bvid+cid 是否已离线缓存，返回本地文件路径（不存在返回 null） */
export function offlineVideoFile(bvid: string, cid: string): string | null {
  const key = offlineKey(bvid, cid)
  const entry = readOfflineManifest()[key]
  if (entry && fs.existsSync(entry.file)) return entry.file
  return null
}

/** 整片下载到离线目录（走 referer/cookie 策略），返回离线文件路径 */
export async function saveOfflineVideo(
  bvid: string,
  cid: string,
  url: string,
  title?: string
): Promise<{ file: string; size: number }> {
  const key = offlineKey(bvid, cid)
  await ensureDir(offlineDir())
  const file = path.join(offlineDir(), `${key}.mp4`)
  await downloadMediaTo(url, file)
  const size = fs.statSync(file).size
  const map = readOfflineManifest()
  map[key] = { key, bvid, cid, title: title || '', file, size, savedAt: Date.now() }
  writeOfflineManifest(map)
  return { file, size }
}

/** 缓存管理面板：列出所有离线视频 + 总占用 */
export function listOfflineVideos(): { items: OfflineEntry[]; total: number } {
  const map = readOfflineManifest()
  const items = Object.values(map)
    .filter(e => fs.existsSync(e.file))
    .sort((a, b) => b.savedAt - a.savedAt)
  const total = items.reduce((s, e) => s + e.size, 0)
  return { items, total }
}

/** 删除单个离线视频；不传 key 则清空全部离线视频 */
export function removeOfflineVideos(key?: string): boolean {
  const map = readOfflineManifest()
  const keys = key ? [key] : Object.keys(map)
  for (const k of keys) {
    const e = map[k]
    if (e) {
      try {
        fs.rmSync(e.file, { force: true })
      } catch {
        /* ignore */
      }
      delete map[k]
    }
  }
  writeOfflineManifest(map)
  return true
}

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

 //在线歌曲播放缓存（命中直接本地服务，不再请求远端）
    if (!isVideoUrl(target)) {
      const cached = audioCacheFile(target)
      if (cached) {
        try {
          const size = fs.statSync(cached).size
          const type = mimeOf(cached)
          const range = req.headers.get('Range') || req.headers.get('range')
          const m = /bytes=(\d*)-(\d*)/.exec(range || '')
          if (m && size > 0) {
            const start = m[1] ? parseInt(m[1], 10) : 0
            const end = m[2] ? Math.min(parseInt(m[2], 10), size - 1) : size - 1
            const stream = fs.createReadStream(cached, { start, end })
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
          return new Response(Readable.toWeb(fs.createReadStream(cached)) as any, {
            status: 200,
            headers: {
              'Content-Type': type,
              'Content-Length': String(size),
              'Accept-Ranges': 'bytes',
              'Access-Control-Allow-Origin': '*',
            },
          })
        } catch {
          /* 缓存读取失败则回落到远端 */
        }
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
 //无 Content-Length（total=0）按已收字节升格缓存，不再丢弃
                  if ((!state.total && state.written > 0) || (state.total && state.written >= state.total)) {
                    await fsp.rename(state.file, path.join(streamDir(), `${key}${state.ext}`)).catch(() => {})
 //视频缓存总量上限 1GB，超出清理最旧
                    pruneVideoCache()
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

 //在线歌曲播放缓存——边播边收集，播完落盘（上限 50 首 / 500MB）
      if (body && isAudioUrl(target) && res.status === 200 && !range) {
        const chunks: Buffer[] = []
        const src = body
        const reader = src.getReader()
        body = new ReadableStream<Uint8Array>({
          async pull(controller) {
            const { done, value } = await reader.read().catch(() => ({ done: true, value: undefined }))
            if (done) {
              void putAudioCache(target, Buffer.concat(chunks), extOf(target))
              controller.close()
              return
            }
            if (value) chunks.push(Buffer.from(value))
            controller.enqueue(value!)
          },
          cancel(reason) {
            reader.cancel(reason).catch(() => {})
          },
        })
      }
      return new Response(body as any, { status: res.status, headers: outHeaders })
    } catch (e: any) {
      logger.warn('媒体代理异常', e?.message, target.slice(0, 100))
      return new Response('upstream error', { status: 502 })
    }
  })
}
