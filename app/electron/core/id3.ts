import fs from 'node:fs'
import fsp from 'node:fs/promises'
import path from 'node:path'
import { createLogger } from './log'

/**
 * 极简 ID3v2.3 写入器（规格书 1.12「下载时写入 ID3 封面」）。
 *
 * 只做三件事：写标题/歌手/专辑文本帧 + 一张 APIC 封面帧，然后拼到文件头部。
 * 已有 ID3 头的文件直接跳过——不做重写，避免破坏原标签。
 * 仅用于 MP3；FLAC 的 PICTURE 块结构不同，这里不处理（下载仍保留原格式）。
 */

const logger = createLogger('id3')

export interface Id3Meta {
  title?: string
  artist?: string
  album?: string
  cover?: { mime: string; data: Uint8Array }
}

function syncsafe(n: number): Buffer {
  return Buffer.from([(n >>> 21) & 0x7f, (n >>> 14) & 0x7f, (n >>> 7) & 0x7f, n & 0x7f])
}

function textFrame(id: string, value: string): Buffer {
  const text = (value || '').trim()
  if (!text) return Buffer.alloc(0)
  // 0x01 = UTF-16（带 BOM），中文歌名必须走这个编码
  const body = Buffer.concat([Buffer.from([0x01, 0xff, 0xfe]), Buffer.from(text, 'utf16le')])
  const head = Buffer.alloc(10)
  head.write(id, 0, 4, 'latin1')
  head.writeUInt32BE(body.length, 4)
  return Buffer.concat([head, body])
}

function apicFrame(mime: string, data: Uint8Array): Buffer {
  if (!data || data.length < 100) return Buffer.alloc(0)
  const mimeBuf = Buffer.from(`${mime || 'image/jpeg'}\0`, 'latin1')
  // 编码 0x00(ISO-8859-1) + MIME + 图片类型 0x03(封面) + 空描述 + 数据
  const body = Buffer.concat([Buffer.from([0x00]), mimeBuf, Buffer.from([0x03, 0x00]), Buffer.from(data)])
  const head = Buffer.alloc(10)
  head.write('APIC', 0, 4, 'latin1')
  head.writeUInt32BE(body.length, 4)
  return Buffer.concat([head, body])
}

export function buildId3Tag(meta: Id3Meta): Buffer {
  const frames = Buffer.concat([
    textFrame('TIT2', meta.title || ''),
    textFrame('TPE1', meta.artist || ''),
    textFrame('TALB', meta.album || ''),
    meta.cover ? apicFrame(meta.cover.mime, meta.cover.data) : Buffer.alloc(0),
  ])
  if (!frames.length) return Buffer.alloc(0)
  const header = Buffer.concat([Buffer.from('ID3', 'latin1'), Buffer.from([0x03, 0x00, 0x00]), syncsafe(frames.length)])
  return Buffer.concat([header, frames])
}

function hasId3Tag(head: Buffer): boolean {
  return head.length >= 3 && head[0] === 0x49 && head[1] === 0x44 && head[2] === 0x33
}

/** 给 MP3 文件补写 ID3v2.3（标题/歌手/封面）。已带标签则跳过。 */
export async function writeId3(file: string, meta: Id3Meta): Promise<boolean> {
  if (path.extname(file).toLowerCase() !== '.mp3') return false
  try {
    const fh = await fsp.open(file, 'r')
    const head = Buffer.alloc(3)
    try {
      await fh.read(head, 0, 3, 0)
    } finally {
      await fh.close()
    }
    if (hasId3Tag(head)) return false
    const tag = buildId3Tag(meta)
    if (!tag.length) return false
    const body = await fsp.readFile(file)
    const tmp = `${file}.id3tmp`
    await fsp.writeFile(tmp, Buffer.concat([tag, body]))
    await fsp.rename(tmp, file)
    return true
  } catch (e: any) {
    logger.warn('ID3 写入失败', path.basename(file), e?.message)
    return false
  }
}

/** 同步版：仅用于启动时批量补标签（扫描已完成下载的文件） */
export function writeId3Sync(file: string, meta: Id3Meta): boolean {
  if (path.extname(file).toLowerCase() !== '.mp3') return false
  try {
    const fd = fs.openSync(file, 'r')
    const head = Buffer.alloc(3)
    try {
      fs.readSync(fd, head, 0, 3, 0)
    } finally {
      fs.closeSync(fd)
    }
    if (hasId3Tag(head)) return false
    const tag = buildId3Tag(meta)
    if (!tag.length) return false
    const body = fs.readFileSync(file)
    const tmp = `${file}.id3tmp`
    fs.writeFileSync(tmp, Buffer.concat([tag, body]))
    fs.renameSync(tmp, file)
    return true
  } catch {
    return false
  }
}
