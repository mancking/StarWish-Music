import fs from 'node:fs'
import path from 'node:path'
import { nativeImage } from 'electron'
import type { WallpaperItem } from '../../shared/types'
import { ensureDir, userDataDir } from './paths'
import { createLogger } from './log'

/**
 * 图片壁纸库。
 *
 * 只做图片：原图统一由渲染层用 canvas 转成 jpg（限长边 2560）后以 dataURL 传进来，
 * 主进程负责落盘、生成缩略图、维护索引。这样桌面与移动端共用同一条导入链路，
 * 不依赖 sharp 之类的原生模块。
 *
 * 目录结构：
 *   <dataDir>/wallpapers/index.json
 *   <dataDir>/wallpapers/<id>.jpg
 *   <dataDir>/wallpapers/<id>.thumb.jpg
 */

const logger = createLogger('wallpaper')

interface IndexFile {
  version: 1
  items: WallpaperItem[]
}

function wallpaperDir(): string {
  return ensureDir(path.join(userDataDir(), 'wallpapers'))
}

function indexPath(): string {
  return path.join(wallpaperDir(), 'index.json')
}

function readIndex(): IndexFile {
  try {
    const raw = JSON.parse(fs.readFileSync(indexPath(), 'utf8'))
    if (raw && Array.isArray(raw.items)) return { version: 1, items: raw.items }
  } catch {
    /* 首次运行或索引损坏，重建 */
  }
  return { version: 1, items: [] }
}

function writeIndex(idx: IndexFile): void {
  try {
    fs.writeFileSync(indexPath(), JSON.stringify(idx, null, 2), 'utf8')
  } catch (e: any) {
    logger.error('壁纸索引写入失败', e?.message)
  }
}

function newId(): string {
  return `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`
}

/** 列出全部壁纸，自动剔除文件已丢失的条目 */
export function listWallpapers(): WallpaperItem[] {
  const idx = readIndex()
  const alive = idx.items.filter(it => {
    try {
      return fs.existsSync(it.file)
    } catch {
      return false
    }
  })
  if (alive.length !== idx.items.length) {
    writeIndex({ version: 1, items: alive })
  }
  return alive
}

/**
 * 保存一张壁纸。dataUrl 必须是 image/jpeg 的 base64。
 * 缩略图由 nativeImage 生成；若解码失败则退回原图作为缩略图。
 */
export function saveWallpaper(input: {
  name?: string
  dataUrl: string
  width?: number
  height?: number
}): WallpaperItem {
  const m = /^data:image\/([a-zA-Z+]+);base64,(.+)$/.exec(input.dataUrl || '')
  if (!m) throw new Error('壁纸数据格式不正确')

  const id = newId()
  const ext = m[1] === 'png' ? 'png' : 'jpg'
  const buf = Buffer.from(m[2], 'base64')
  if (buf.length < 1024) throw new Error('壁纸文件过小，可能不是有效图片')

  const file = path.join(wallpaperDir(), `${id}.${ext}`)
  fs.writeFileSync(file, buf)

  let thumb = file
  try {
    const img = nativeImage.createFromBuffer(buf)
    if (!img.isEmpty()) {
      const size = img.getSize()
      const w = Math.min(480, size.width || 480)
      const thumbBuf = img.resize({ width: w, quality: 'good' }).toJPEG(78)
      if (thumbBuf.length > 0) {
        thumb = path.join(wallpaperDir(), `${id}.thumb.jpg`)
        fs.writeFileSync(thumb, thumbBuf)
      }
    }
  } catch (e: any) {
    logger.warn('缩略图生成失败，回退原图', e?.message)
  }

  const item: WallpaperItem = {
    id,
    name: (input.name || '未命名壁纸').slice(0, 60),
    file,
    thumb,
    width: input.width || 0,
    height: input.height || 0,
    size: buf.length,
    addedAt: Date.now(),
  }

  const idx = readIndex()
  idx.items.unshift(item)
  writeIndex(idx)
  logger.info('壁纸已保存', item.id, item.name, `${Math.round(buf.length / 1024)}KB`)
  return item
}

export function removeWallpaper(id: string): boolean {
  const idx = readIndex()
  const target = idx.items.find(it => it.id === id)
  if (!target) return false
  for (const p of [target.file, target.thumb]) {
    try {
      if (p && fs.existsSync(p)) fs.unlinkSync(p)
    } catch {
      /* 文件被占用时忽略，索引已移除即可 */
    }
  }
  idx.items = idx.items.filter(it => it.id !== id)
  writeIndex(idx)
  return true
}

export function renameWallpaper(id: string, name: string): boolean {
  const idx = readIndex()
  const target = idx.items.find(it => it.id === id)
  if (!target) return false
  target.name = (name || '').slice(0, 60) || target.name
  writeIndex(idx)
  return true
}

/**
 * 从本地路径导入。桌面端用这条链路（nativeImage 解码 + 转码 + 缩放），
 * 渲染层不需要 canvas，也就没有「跨协议图片污染 canvas」的问题。
 */
export function importWallpaperFromPath(p: string, name?: string): WallpaperItem {
  const src = (p || '').trim()
  if (!src) throw new Error('未选择图片')
  if (!fs.existsSync(src)) throw new Error('文件不存在')

  const img = nativeImage.createFromPath(src)
  if (img.isEmpty()) throw new Error('无法解码该图片格式')

  const size = img.getSize()
  const max = 2560
  const scale = Math.min(1, max / Math.max(size.width || 1, size.height || 1))
  const target = scale < 1 ? img.resize({ width: Math.round(size.width * scale), quality: 'best' }) : img
  const buf = target.toJPEG(90)
  if (!buf.length) throw new Error('图片转码失败')

  return saveWallpaper({
    name: name || path.basename(src),
    dataUrl: `data:image/jpeg;base64,${buf.toString('base64')}`,
    width: Math.round((size.width || 0) * scale),
    height: Math.round((size.height || 0) * scale),
  })
}

/**
 * 旧版本只存了一个图片路径（settings.playerWallpaper）。
 * 启动时若发现该文件存在且库里还没有对应条目，就把它登记进来，避免用户重选。
 */
export function migrateLegacyWallpaper(legacyPath: string): WallpaperItem | null {
  const p = (legacyPath || '').trim()
  if (!p) return null
  try {
    if (!fs.existsSync(p)) return null
  } catch {
    return null
  }
  const idx = readIndex()
  if (idx.items.some(it => path.resolve(it.file) === path.resolve(p))) return null

  let buf: Buffer
  try {
    buf = fs.readFileSync(p)
  } catch {
    return null
  }
  if (buf.length < 1024) return null

  const id = newId()
  const file = path.join(wallpaperDir(), `${id}.jpg`)
  try {
    const img = nativeImage.createFromBuffer(buf)
    if (img.isEmpty()) return null
    fs.writeFileSync(file, img.toJPEG(92))
    const size = img.getSize()
    const thumb = path.join(wallpaperDir(), `${id}.thumb.jpg`)
    fs.writeFileSync(thumb, img.resize({ width: Math.min(480, size.width || 480), quality: 'good' }).toJPEG(78))
    const item: WallpaperItem = {
      id,
      name: path.basename(p).slice(0, 60) || '旧壁纸',
      file,
      thumb,
      width: size.width,
      height: size.height,
      size: buf.length,
      addedAt: Date.now(),
    }
    idx.items.unshift(item)
    writeIndex(idx)
    logger.info('旧壁纸已迁移入库', item.id)
    return item
  } catch (e: any) {
    logger.warn('旧壁纸迁移失败', e?.message)
    return null
  }
}
