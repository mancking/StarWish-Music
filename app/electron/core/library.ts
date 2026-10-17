import fs from 'node:fs'
import path from 'node:path'
import type { ScanProgress, Song } from '../../shared/types'
import { createLogger } from './log'
import { saveSongs, localCount } from './db'
import { saveEmbeddedCover } from './cover'

const logger = createLogger('library')

const AUDIO_EXT = new Set(['.mp3', '.flac', '.m4a', '.aac', '.ogg', '.opus', '.wav', '.wma', '.ape', '.mp4', '.m4b'])
const COVER_NAMES = ['cover.jpg', 'cover.jpeg', 'cover.png', 'folder.jpg', 'folder.png', 'front.jpg', 'album.jpg']

let scanning = false
let cancelFlag = false
let progress: ScanProgress = { phase: 'idle', found: 0, parsed: 0, current: '' }

export function getScanProgress(): ScanProgress {
  return { ...progress }
}

export function cancelScan(): void {
  if (scanning) cancelFlag = true
}

function emit(onProgress: (p: ScanProgress) => void): void {
  try {
    onProgress({ ...progress })
  } catch {
    /* ignore */
  }
}

function walk(dir: string, out: string[], depth = 0): void {
  if (depth > 8 || out.length > 20000) return
  let entries: fs.Dirent[]
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true })
  } catch {
    return
  }
  for (const e of entries) {
    if (cancelFlag) return
    const full = path.join(dir, e.name)
    if (e.isDirectory()) {
      if (/^(\$RECYCLE|System Volume|node_modules|\.git)/i.test(e.name)) continue
      walk(full, out, depth + 1)
    } else if (e.isFile() && AUDIO_EXT.has(path.extname(e.name).toLowerCase())) {
      out.push(full)
    }
  }
}

interface MetaModule {
  parseFile: (file: string, opts?: any) => Promise<any>
}

let metaMod: MetaModule | null = null
async function getMeta(): Promise<MetaModule | null> {
  if (metaMod) return metaMod
  try {
    const mod: any = await import('music-metadata')
    metaMod = mod as MetaModule
    return metaMod
  } catch (e: any) {
    logger.warn('元数据解析模块加载失败，使用文件名兜底', e?.message)
    return null
  }
}

function parseNameFromFile(file: string): { name: string; singer: string } {
  const base = path.basename(file, path.extname(file))
  const m = base.split(/\s*[-–—]\s*/)
  if (m.length >= 2) return { singer: m[0].trim(), name: m.slice(1).join(' - ').trim() }
  return { name: base.trim(), singer: '未知歌手' }
}

function findFolderCover(dir: string): string {
  for (const n of COVER_NAMES) {
    const p = path.join(dir, n)
    try {
      if (fs.existsSync(p)) return p
    } catch {
      /* ignore */
    }
  }
  return ''
}

export async function scanLibrary(dirs: string[], onProgress: (p: ScanProgress) => void): Promise<{ added: number; total: number }> {
  if (scanning) throw new Error('正在扫描中，请稍候')
  scanning = true
  cancelFlag = false
  progress = { phase: 'scanning', found: 0, parsed: 0, current: '' }
  emit(onProgress)

  const files: string[] = []
  for (const d of dirs) {
    try {
      if (fs.existsSync(d) && fs.statSync(d).isDirectory()) walk(d, files)
    } catch (e: any) {
      logger.warn('目录不可读', d, e?.message)
    }
  }
  progress.found = files.length
  progress.phase = 'parsing'
  emit(onProgress)

  const meta = await getMeta()
  let parsed = 0
  const batch: Song[] = []
  const coverByDir = new Map<string, string>()

  for (const file of files) {
    if (cancelFlag) break
    progress.current = file
    const fallback = parseNameFromFile(file)
    let song: Song = {
      id: `local:${file}`,
      source: 'local',
      songId: file,
      name: fallback.name,
      singer: fallback.singer,
      album: '',
      duration: 0,
      pic: '',
      localPath: file,
      qualitys: ['local'],
    }
    if (meta) {
      try {
        const m = await meta.parseFile(file, { duration: true, skipCovers: false })
        const c = m?.common || {}
        const f = m?.format || {}
        song = {
          ...song,
          name: String(c.title || fallback.name).trim() || fallback.name,
          singer: Array.isArray(c.artists) && c.artists.length ? c.artists.join('/') : String(c.artist || fallback.singer),
          album: String(c.album || ''),
          duration: Math.round(Number(f.duration) || 0),
          extra: {
            bitrate: Math.round(Number(f.bitrate) || 0) / 1000,
            codec: String(f.codec || ''),
            ...(Array.isArray(c.lyrics) && c.lyrics.length
              ? { lyrics: String(c.lyrics.map((l: any) => l?.text || l || '').join('\n')).slice(0, 20000) }
              : {}),
          },
        }
        const pic = Array.isArray(c.picture) && c.picture[0]
        if (pic?.data && pic.data.length > 100) {
          song.pic = saveEmbeddedCover(
            pic.data instanceof Uint8Array ? pic.data : new Uint8Array(pic.data),
            pic.format || 'image/jpeg',
            `${file}:${song.name}`
          )
        }
      } catch {
        /* 解析失败保留文件名信息 */
      }
    }
    if (!song.pic) {
      const dir = path.dirname(file)
      if (!coverByDir.has(dir)) coverByDir.set(dir, findFolderCover(dir))
      const fc = coverByDir.get(dir)
      if (fc) {
        try {
          const data = fs.readFileSync(fc)
          song.pic = saveEmbeddedCover(
            new Uint8Array(data),
            fc.endsWith('.png') ? 'image/png' : 'image/jpeg',
            `${dir}:cover`
          )
        } catch {
          /* ignore */
        }
      }
    }
    batch.push(song)
    parsed++
    progress.parsed = parsed
    if (parsed % 12 === 0) emit(onProgress)
    if (batch.length >= 80) {
      saveSongs(batch.splice(0, batch.length))
      emit(onProgress)
    }
  }
  if (batch.length) saveSongs(batch.splice(0, batch.length))

  progress.phase = cancelFlag ? 'done' : 'done'
  progress.current = ''
  emit(onProgress)
  scanning = false
  cancelFlag = false
  logger.info(`本地音乐扫描完成：${parsed}/${files.length}，曲库共 ${localCount()}`)
  return { added: parsed, total: localCount() }
}

export function listAudioFiles(dir: string): string[] {
  const out: string[] = []
  walk(dir, out)
  return out
}
