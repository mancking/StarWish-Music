import fs from 'node:fs'
import fsp from 'node:fs/promises'
import path from 'node:path'
import { app, net } from 'electron'
import type { Song } from '../../shared/types'
import { ensureDir, userDataDir } from './paths'
import { createLogger } from './log'
import { UA } from './http'
import { getSettings } from './settings'
import { resolveUrl, getLyric } from './music-service'
import { writeId3 } from './id3'
import { scanLibrary } from './library'

/**
 * 音乐下载。
 *
 * 与「缓存」的区别：缓存是播放时的临时副产物、可随时清理；下载是用户主动保存的
 * 文件，落在用户选的目录里，不参与缓存清理。
 *
 * 队列并发 2 —— 音源多为第三方，并发太高容易被限流；同时留出带宽给正在播放的歌。
 */

const logger = createLogger('download')

export type DownloadStatus = 'queued' | 'running' | 'done' | 'error' | 'canceled' | 'paused'

export interface DownloadTask {
  id: string
  song: Song
  status: DownloadStatus
  quality: string
  progress: number
  received: number
  total: number
  file?: string
  /** 断点续传：半成品文件（规格书 1.12 .part + Range/206） */
  partPath?: string
  error?: string
  createdAt: number
  finishedAt?: number
}

const tasks = new Map<string, DownloadTask>()
const queue: string[] = []
const aborters = new Map<string, AbortController>()
/** 被用户暂停的任务：abort 后落到 paused 而不是 canceled（规格书 3.5「暂停」） */
const pausedIds = new Set<string>()
let running = 0
let lastEmit = 0

/** 并发数跟随设置（1-4），改设置后下一次 pump 生效 */
function maxConcurrent(): number {
  const n = Number(getSettings().downloadConcurrency) || 2
  return Math.max(1, Math.min(4, n))
}

type Emit = (task: DownloadTask) => void
let emit: Emit = () => {}

export function setDownloadEmitter(fn: Emit): void {
  emit = fn
}

function indexPath(): string {
  return path.join(ensureDir(path.join(userDataDir(), 'downloads')), 'index.json')
}

function persist(): void {
  try {
    // 只持久化有终态的，排队/进行中的重启后重来
    const items = [...tasks.values()].filter(t => t.status === 'done' || t.status === 'error')
    fs.writeFileSync(indexPath(), JSON.stringify(items.slice(0, 500), null, 2), 'utf8')
  } catch (e: any) {
    logger.warn('下载索引写入失败', e?.message)
  }
}

export function restoreDownloads(): void {
  try {
    const raw = JSON.parse(fs.readFileSync(indexPath(), 'utf8'))
    if (Array.isArray(raw)) {
      for (const t of raw) {
        if (t && t.id && t.song) tasks.set(t.id, { ...t, status: t.status === 'done' ? 'done' : 'error' })
      }
    }
  } catch {
    /* 首次运行 */
  }
}

export function listDownloads(): DownloadTask[] {
  return [...tasks.values()].sort((a, b) => b.createdAt - a.createdAt)
}

export function downloadDir(): string {
  const s = getSettings()
  const dir = (s.downloadDir || '').trim()
  if (dir) return ensureDir(dir)
  // 默认放到「下载」目录下的 StarWish
  try {
    return ensureDir(path.join(app.getPath('downloads'), 'StarWish'))
  } catch {
    return ensureDir(path.join(userDataDir(), 'downloads'))
  }
}

function safeName(s: string): string {
  return (s || '').replace(/[\\/:*?"<>|]/g, '_').replace(/\s+/g, ' ').trim().slice(0, 80)
}

function extOf(url: string, quality: string): string {
  if (quality === 'flac' || quality === 'flac24bit') return 'flac'
  const m = /\.(mp3|flac|m4a|aac|ogg|wav)(\?|$)/i.exec(url)
  if (m) return m[1].toLowerCase()
  return 'mp3'
}

function throttleEmit(task: DownloadTask): void {
  const now = Date.now()
  if (now - lastEmit < 180 && task.status === 'running') return
  lastEmit = now
  emit(task)
}

/** 抓取封面二进制（用于写 ID3 APIC 帧）；失败不影响下载结果 */
async function fetchCover(url?: string): Promise<{ mime: string; data: Uint8Array } | null> {
  const u = (url || '').trim()
  if (!/^https?:\/\//i.test(u)) return null
  try {
    const headers: Record<string, string> = { 'User-Agent': UA, Accept: 'image/*,*/*' }
    if (/hdslb|bilivideo|bilibili/i.test(u)) headers.Referer = 'https://www.bilibili.com/'
    let res: Response
    try {
      res = await fetch(u, { headers, redirect: 'follow' })
    } catch {
      res = await net.fetch(u, { headers, redirect: 'follow' })
    }
    if (!res.ok) return null
    const buf = new Uint8Array(await res.arrayBuffer())
    if (buf.length < 100) return null
    const ct = (res.headers.get('content-type') || '').split(';')[0].trim()
    const mime = /^image\//.test(ct) ? ct : /\.png(\?|$)/i.test(u) ? 'image/png' : 'image/jpeg'
    return { mime, data: buf }
  } catch {
    return null
  }
}

/** 单流空闲超时（Bug 81）：30s 无数据即失败，释放并发槽 */
const STREAM_IDLE_TIMEOUT_MS = 30_000

/**
 * 流式下载到 dest。
 * startAt > 0 时携带 Range 头从断点续传（追加写）；服务端不支持 Range（返回 200 非 206）则退回全量重下。
 */
async function streamTo(
  url: string,
  dest: string,
  signal: AbortSignal,
  onProgress: (r: number, got: number, total: number) => void,
  startAt = 0,
): Promise<void> {
  const headers: Record<string, string> = { 'User-Agent': UA, Accept: '*/*' }
  if (/bilibili|bilivideo|hdslb/i.test(url)) headers.Referer = 'https://www.bilibili.com/'
  if (startAt > 0) headers.Range = `bytes=${startAt}-`

  let res: Response
  try {
    res = await fetch(url, { headers, redirect: 'follow', signal })
  } catch {
    res = await net.fetch(url, { headers, redirect: 'follow', signal })
  }
  if (startAt > 0 && res.status === 416) {
    // 断点越界（远端内容已变化）→ 从头重下
    res = await fetch(url, { headers: { ...headers, Range: undefined } as any, redirect: 'follow', signal })
    startAt = 0
  }
  if (!res.ok || !res.body) throw new Error(`下载失败（HTTP ${res.status}）`)
  let append = false
  if (startAt > 0 && res.status === 206) {
    append = true
  } else if (startAt > 0) {
    startAt = 0
  }

  const total = startAt + (Number(res.headers.get('content-length') || 0) || 0)
  const fh = await fsp.open(dest, append ? 'a' : 'w')
  let got = startAt
  let reader: any = null
  let idleTimer: NodeJS.Timeout | null = null
  const armIdle = () => {
    if (idleTimer) clearTimeout(idleTimer)
    idleTimer = setTimeout(() => {
      try {
        reader?.cancel('idle-timeout')
      } catch {
        /* ignore */
      }
    }, STREAM_IDLE_TIMEOUT_MS)
  }
  try {
    reader = (res.body as any).getReader()
    armIdle()
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      if (signal.aborted) throw new Error('已取消')
      await fh.write(value)
      got += value?.byteLength || 0
      armIdle()
      onProgress(total ? got / total : 0, got, total)
    }
  } finally {
    if (idleTimer) clearTimeout(idleTimer)
    await fh.close()
  }
}

/** 启动清理（N15）：下载目录里没有任务认领的 .part 残留直接删除 */
export function sweepOrphanParts(): void {
  try {
    const dir = downloadDir()
    for (const f of fs.readdirSync(dir)) {
      if (!f.endsWith('.part')) continue
      const full = path.join(dir, f)
      const claimed = [...tasks.values()].some(t => t.partPath === full)
      if (claimed) continue
      try {
        fs.rmSync(full, { force: true })
      } catch {
        /* ignore */
      }
    }
  } catch {
    /* 目录不存在 */
  }
}

async function runOne(id: string): Promise<void> {
  const task = tasks.get(id)
  if (!task || task.status !== 'queued') return

  const ac = new AbortController()
  aborters.set(id, ac)
  task.status = 'running'
  throttleEmit(task)

  const s = getSettings()
  const quality = task.quality || s.downloadQuality || s.quality

  try {
    const resolved = await resolveUrl(task.song, quality, s.autoSwitchSource)
    const url = typeof resolved === 'string' ? resolved : (resolved as any)?.url
    if (!url) throw new Error('没有拿到可用的音频地址')

    const ext = extOf(url, quality)
    const base = safeName(`${task.song.singer || '未知'} - ${task.song.name || '未命名'}`)
    const dir = downloadDir()
    let file = path.join(dir, `${base}.${ext}`)
    if (!task.partPath) {
      // 同名不覆盖，加 (1)(2)；断点续传时沿用首次选定的文件名
      let n = 1
      while (fs.existsSync(file) || fs.existsSync(`${file}.part`)) {
        file = path.join(dir, `${base} (${n}).${ext}`)
        n++
        if (n > 99) break
      }
      task.file = file
      task.partPath = `${file}.part`
    } else {
      file = task.file || file
    }

    // 断点续传（Bug 7 / N14）：.part 已有字节数作为 Range 起点，追加写入
    let startAt = 0
    try {
      startAt = fs.existsSync(task.partPath) ? fs.statSync(task.partPath).size : 0
    } catch {
      startAt = 0
    }
    if (task.total > 0 && startAt >= task.total && task.total > 0) startAt = 0

    await streamTo(url, task.partPath!, ac.signal, (r, got, total) => {
      task.progress = total ? got / total : r
      task.received = got
      task.total = total
      throttleEmit(task)
    }, startAt)

    // 完成：.part 改名正式文件（规格书 1.12）
    await fsp.rename(task.partPath!, file)
    task.partPath = undefined

    // 歌词同名 .lrc（失败不影响下载结果）
    if (s.downloadLrc) {
      try {
        const lyric = await getLyric(task.song)
        if (lyric?.raw) {
          await fsp.writeFile(file.replace(/\.[^.]+$/, '.lrc'), lyric.raw, 'utf8')
        }
      } catch {
        /* 无歌词就跳过 */
      }
    }

    task.status = 'done'
    task.progress = 1
    task.file = file
    task.finishedAt = Date.now()

    // 规格书 1.12：原格式不转码 + 写入 ID3 封面（仅 MP3 生效，失败不阻塞）
    const cover = await fetchCover(task.song.pic)
    await writeId3(file, {
      title: task.song.name,
      artist: task.song.singer,
      album: task.song.album || '',
      cover: cover || undefined,
    })

    // 规格书 1.12：已下载识别为本地曲目——下载目录并入本地库
    try {
      await scanLibrary([dir], () => {})
    } catch {
      /* 正在扫描或目录不可读时跳过，不影响下载结果 */
    }

    logger.info('下载完成', task.song.name, path.basename(file))
  } catch (e: any) {
    if (ac.signal.aborted && pausedIds.has(id)) {
      task.status = 'paused'
      task.error = '已暂停'
      // 暂停保留 .part（断点续传依据）
    } else if (ac.signal.aborted) {
      task.status = 'canceled'
      task.error = '已取消'
      if (task.partPath) {
        try {
          fs.rmSync(task.partPath, { force: true })
        } catch {
          /* ignore */
        }
        task.partPath = undefined
      }
    } else {
      task.status = 'error'
      task.error = e?.message || '下载失败'
      logger.warn('下载失败', task.song?.name, task.error)
    }
    task.finishedAt = Date.now()
  } finally {
    aborters.delete(id)
    persist()
    emit(task)
  }
}

function pump(): void {
  while (running < maxConcurrent() && queue.length) {
    const id = queue.shift()!
    const t = tasks.get(id)
    if (!t || t.status !== 'queued') continue
    running++
    void runOne(id).finally(() => {
      running--
      pump()
    })
  }
}

export function addDownloads(songs: Song[], quality?: string): DownloadTask[] {
  const created: DownloadTask[] = []
  for (const song of songs || []) {
    if (!song?.id) continue
    // 同一首歌已在队列/进行中/已完成则不重复添加
    const dup = [...tasks.values()].find(
      t => t.song.id === song.id && (t.status === 'queued' || t.status === 'running' || t.status === 'done')
    )
    if (dup) continue

    const task: DownloadTask = {
      id: `dl_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`,
      song,
      status: 'queued',
      quality: quality || '',
      progress: 0,
      received: 0,
      total: 0,
      createdAt: Date.now(),
    }
    tasks.set(task.id, task)
    queue.push(task.id)
    created.push(task)
    emit(task)
  }
  pump()
  return created
}

export function cancelDownload(id: string): boolean {
  const t = tasks.get(id)
  if (!t) return false
  if (t.status === 'queued') {
    t.status = 'canceled'
    t.error = '已取消'
    const i = queue.indexOf(id)
    if (i >= 0) queue.splice(i, 1)
    emit(t)
    persist()
    return true
  }
  const ac = aborters.get(id)
  if (ac) ac.abort()
  return true
}

/** 暂停（规格书 3.5）：排队中直接挂起；下载中中断流并标记 paused。 */
export function pauseDownload(id: string): boolean {
  const t = tasks.get(id)
  if (!t) return false
  if (t.status === 'queued') {
    const i = queue.indexOf(id)
    if (i >= 0) queue.splice(i, 1)
    t.status = 'paused'
    t.error = '已暂停'
    emit(t)
    return true
  }
  if (t.status !== 'running') return false
  pausedIds.add(id)
  const ac = aborters.get(id)
  if (ac) ac.abort()
  return true
}

/** 继续下载（Bug 7）：不清零进度，按 .part 已收字节断点续传。 */
export function resumeDownload(id: string): boolean {
  const t = tasks.get(id)
  if (!t || t.status !== 'paused') return false
  pausedIds.delete(id)
  t.status = 'queued'
  t.error = undefined
  // progress/received/total 保留：runOne 会读 .part 大小作为 Range 起点
  queue.push(id)
  emit(t)
  pump()
  return true
}

export function removeDownload(id: string, deleteFile = false): boolean {
  const t = tasks.get(id)
  if (!t) return false
  if (t.status === 'running') cancelDownload(id)
  if (deleteFile && t.file) {
    try {
      if (fs.existsSync(t.file)) fs.unlinkSync(t.file)
      const lrc = t.file.replace(/\.[^.]+$/, '.lrc')
      if (fs.existsSync(lrc)) fs.unlinkSync(lrc)
    } catch (e: any) {
      logger.warn('删除文件失败', e?.message)
    }
  }
  if (t.partPath) {
    try {
      fs.rmSync(t.partPath, { force: true })
    } catch {
      /* ignore */
    }
  }
  tasks.delete(id)
  persist()
  return true
}

export function clearDownloads(onlyFinished = true): number {
  let n = 0
  for (const [id, t] of [...tasks.entries()]) {
    if (onlyFinished && (t.status === 'queued' || t.status === 'running')) continue
    tasks.delete(id)
    n++
  }
  persist()
  return n
}
