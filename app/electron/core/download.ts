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

/**
 * 音乐下载。
 *
 * 与「缓存」的区别：缓存是播放时的临时副产物、可随时清理；下载是用户主动保存的
 * 文件，落在用户选的目录里，不参与缓存清理。
 *
 * 队列并发 2 —— 音源多为第三方，并发太高容易被限流；同时留出带宽给正在播放的歌。
 */

const logger = createLogger('download')

export type DownloadStatus = 'queued' | 'running' | 'done' | 'error' | 'canceled'

export interface DownloadTask {
  id: string
  song: Song
  status: DownloadStatus
  quality: string
  progress: number
  received: number
  total: number
  file?: string
  error?: string
  createdAt: number
  finishedAt?: number
}

const tasks = new Map<string, DownloadTask>()
const queue: string[] = []
const aborters = new Map<string, AbortController>()
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

async function streamTo(url: string, dest: string, signal: AbortSignal, onProgress: (r: number, got: number, total: number) => void): Promise<void> {
  const headers: Record<string, string> = { 'User-Agent': UA, Accept: '*/*' }
  if (/bilibili|bilivideo|hdslb/i.test(url)) headers.Referer = 'https://www.bilibili.com/'
  let res: Response
  try {
    res = await fetch(url, { headers, redirect: 'follow', signal })
  } catch {
    res = await net.fetch(url, { headers, redirect: 'follow', signal })
  }
  if (!res.ok || !res.body) throw new Error(`下载失败（HTTP ${res.status}）`)

  const total = Number(res.headers.get('content-length') || 0)
  const fh = await fsp.open(dest, 'w')
  let got = 0
  try {
    const reader = (res.body as any).getReader()
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      if (signal.aborted) throw new Error('已取消')
      await fh.write(value)
      got += value?.byteLength || 0
      onProgress(total ? got / total : 0, got, total)
    }
  } finally {
    await fh.close()
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
    // 同名不覆盖，加 (1)(2)
    let n = 1
    while (fs.existsSync(file)) {
      file = path.join(dir, `${base} (${n}).${ext}`)
      n++
      if (n > 99) break
    }

    await streamTo(url, file, ac.signal, (r, got, total) => {
      task.progress = r
      task.received = got
      task.total = total
      throttleEmit(task)
    })

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
    logger.info('下载完成', task.song.name, path.basename(file))
  } catch (e: any) {
    if (ac.signal.aborted) {
      task.status = 'canceled'
      task.error = '已取消'
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
