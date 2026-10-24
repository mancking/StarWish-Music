import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'
import { mediaCacheDir } from './paths'

/**
 * 规格书 v2.8 · 1.12 播放缓存 / 视频缓存 / 缓存清理（主进程实现）。
 *  - 音频：在线歌曲播放后自动落盘，最多 50 首、总 500MB，超出按最旧访问时间清理。
 *  - 视频：边播边缓存的流文件（media.ts 写入 stream/），总量上限 1GB，超出清理最旧。
 *  - 清除缓存：只清播放缓存，不动「已下载」文件（下载目录在 downloads/ 下，与这里无关）。
 */
export const AUDIO_CACHE_MAX_FILES = 50
export const AUDIO_CACHE_MAX_BYTES = 500 * 1024 * 1024
export const VIDEO_CACHE_MAX_BYTES = 1024 * 1024 * 1024

export interface CacheInfo {
  audio: { files: number; bytes: number }
  video: { files: number; bytes: number }
  total: number
}

export function audioCacheDir(): string {
  return path.join(mediaCacheDir(), 'audio')
}

export function videoCacheDir(): string {
  return path.join(mediaCacheDir(), 'stream')
}

function ensureDir(dir: string): void {
  try {
    fs.mkdirSync(dir, { recursive: true })
  } catch {
    /* ignore */
  }
}

export function cacheKeyOf(url: string): string {
  return crypto.createHash('sha1').update(url).digest('hex')
}

function listFiles(dir: string): { file: string; size: number; mtime: number }[] {
  try {
    return fs
      .readdirSync(dir)
      .map(name => {
        const file = path.join(dir, name)
        try {
          const st = fs.statSync(file)
          return st.isFile() ? { file, size: st.size, mtime: st.mtimeMs } : null
        } catch {
          return null
        }
      })
      .filter((x): x is { file: string; size: number; mtime: number } => !!x)
  } catch {
    return []
  }
}

function sizeOfDir(dir: string): { files: number; bytes: number } {
  const list = listFiles(dir)
  return { files: list.length, bytes: list.reduce((s, f) => s + f.size, 0) }
}

/** 命中音频缓存则返回文件路径，并刷新访问时间（LRU 依据） */
export function audioCacheFile(url: string): string | null {
  const dir = audioCacheDir()
  const key = cacheKeyOf(url)
  const list = listFiles(dir).filter(f => path.basename(f.file).startsWith(key))
  const hit = list.find(f => !f.file.endsWith('.part'))
  if (!hit) return null
  try {
    const now = new Date()
    fs.utimesSync(hit.file, now, now)
  } catch {
    /* ignore */
  }
  return hit.file
}

/** 写入音频缓存（播放完成后调用），随后按 50 首 / 500MB 规则清理 */
export async function putAudioCache(url: string, data: Buffer, ext = '.m4a'): Promise<string | null> {
  try {
    ensureDir(audioCacheDir())
    const file = path.join(audioCacheDir(), `${cacheKeyOf(url)}${ext}`)
    await fs.promises.writeFile(file, data)
    pruneAudioCache()
    return file
  } catch {
    return null
  }
}

export function pruneAudioCache(): void {
  const dir = audioCacheDir()
  const list = listFiles(dir).sort((a, b) => a.mtime - b.mtime)
  let bytes = list.reduce((s, f) => s + f.size, 0)
  let count = list.length
  for (const f of list) {
    if (count <= AUDIO_CACHE_MAX_FILES && bytes <= AUDIO_CACHE_MAX_BYTES) break
    try {
      fs.rmSync(f.file, { force: true })
      bytes -= f.size
      count--
    } catch {
      /* ignore */
    }
  }
}

export function pruneVideoCache(): void {
  const dir = videoCacheDir()
  const list = listFiles(dir).sort((a, b) => a.mtime - b.mtime)
  let bytes = list.reduce((s, f) => s + f.size, 0)
  for (const f of list) {
    if (bytes <= VIDEO_CACHE_MAX_BYTES) break
    try {
      fs.rmSync(f.file, { force: true })
      bytes -= f.size
    } catch {
      /* ignore */
    }
  }
}

export function cacheInfo(): CacheInfo {
  const audio = sizeOfDir(audioCacheDir())
  const video = sizeOfDir(videoCacheDir())
  return { audio, video, total: audio.bytes + video.bytes }
}

/** 清除播放缓存（保留已下载文件） */
export function clearPlaybackCache(): CacheInfo {
  for (const dir of [audioCacheDir(), videoCacheDir()]) {
    try {
      for (const name of fs.readdirSync(dir)) {
        const file = path.join(dir, name)
        try {
          fs.rmSync(file, { recursive: true, force: true })
        } catch {
          /* 正在播放的文件可能被占用，跳过 */
        }
      }
    } catch {
      /* 目录不存在 */
    }
  }
  return cacheInfo()
}
