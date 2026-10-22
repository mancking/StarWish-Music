import type { DanmakuItem } from '../../shared/types'
import { request, pool } from './http'
import { createLogger as mkLogger } from './log'

/**
 * B 站弹幕拉取与解析。
 *
 * 两跳：
 *   1. /x/v2/dm/web/view?type=1&oid=<cid>  取分段总数
 *   2. /x/v2/dm/web/seg.so?type=1&oid=<cid>&segment_index=<n>  取 protobuf（每段约 6 分钟）
 *
 * 只解析 DanmakuElem 的 5 个字段（progress/mode/fontsize/color/content），
 * 所以手写 varint 解析，不引入 protobufjs（40KB+ 体积换 5 个字段不划算）。
 */

const logger = mkLogger('danmaku')

interface CacheEntry {
  at: number
  items: DanmakuItem[]
}

const cache = new Map<string, CacheEntry>()
const TTL = 6 * 60 * 60 * 1000
const MAX_CIDS = 30
/** 单视频弹幕上限，超过按时间均匀采样，避免 IPC 传输与内存失控 */
const MAX_ITEMS = 20000

function readVarint(buf: Uint8Array, pos: number): [number, number] {
  let result = 0
  let shift = 0
  let p = pos
  while (p < buf.length) {
    const b = buf[p++]
    result += (b & 0x7f) * Math.pow(2, shift)
    if ((b & 0x80) === 0) break
    shift += 7
    if (shift > 56) break
  }
  return [result, p]
}

const decoder = new TextDecoder('utf-8')

function parseElem(buf: Uint8Array, start: number, end: number): DanmakuItem | null {
  let progress = 0
  let mode = 1
  let size = 25
  let color = 0xffffff
  let text = ''

  let p = start
  while (p < end) {
    const [tag, p1] = readVarint(buf, p)
    p = p1
    const field = Math.floor(tag / 8)
    const wire = tag % 8
    if (wire === 0) {
      const [v, p2] = readVarint(buf, p)
      p = p2
      if (field === 2) progress = v
      else if (field === 3) mode = v
      else if (field === 4) size = v
      else if (field === 5) color = v
    } else if (wire === 2) {
      const [len, p2] = readVarint(buf, p)
      p = p2
      const e = Math.min(p + len, end)
      if (field === 7) text = decoder.decode(buf.subarray(p, e))
      p = e
    } else if (wire === 5) {
      p += 4
    } else if (wire === 1) {
      p += 8
    } else {
      break
    }
  }

  if (!text) return null
  // mode: 1/2/3 滚动，4 底部，5 顶部；其余（高级弹幕、代码弹幕）一律丢弃
  const m: 1 | 4 | 5 = mode === 4 ? 4 : mode === 5 ? 5 : 1
  if (mode > 5) return null
  return {
    t: Math.max(0, progress / 1000),
    mode: m,
    size: size >= 36 ? 36 : size <= 18 ? 18 : 25,
    color: color & 0xffffff,
    text: text.slice(0, 120),
  }
}

function parseReply(buf: Uint8Array): DanmakuItem[] {
  const out: DanmakuItem[] = []
  let p = 0
  while (p < buf.length) {
    const [tag, p1] = readVarint(buf, p)
    p = p1
    const field = Math.floor(tag / 8)
    const wire = tag % 8
    if (wire === 2) {
      const [len, p2] = readVarint(buf, p)
      p = p2
      const end = Math.min(p + len, buf.length)
      if (field === 1) {
        const it = parseElem(buf, p, end)
        if (it) out.push(it)
      }
      p = end
    } else if (wire === 0) {
      const [, p2] = readVarint(buf, p)
      p = p2
    } else if (wire === 5) {
      p += 4
    } else if (wire === 1) {
      p += 8
    } else {
      break
    }
  }
  return out
}

/** 均匀采样，保留时间分布，避免只保留前半段 */
function sample(items: DanmakuItem[], limit: number): DanmakuItem[] {
  if (items.length <= limit) return items
  const step = items.length / limit
  const out: DanmakuItem[] = []
  for (let i = 0; i < limit; i++) out.push(items[Math.floor(i * step)])
  return out
}

async function fetchSegment(cid: string, index: number): Promise<DanmakuItem[]> {
  const url =
    `https://api.bilibili.com/x/v2/dm/web/seg.so?type=1&oid=${encodeURIComponent(cid)}` +
    `&segment_index=${index}`
  try {
    const res = await request(url, {
      binary: true,
      retry: 1,
      timeout: 12000,
      headers: {
        Referer: 'https://www.bilibili.com/',
        Origin: 'https://www.bilibili.com',
      },
    })
    const bytes = res.bytes
    if (!bytes || bytes.length === 0) return []
    return parseReply(new Uint8Array(bytes.buffer, bytes.byteOffset, bytes.byteLength))
  } catch (e: any) {
    logger.warn('弹幕分段拉取失败', index, e?.message)
    return []
  }
}

export async function getDanmaku(cid: string): Promise<DanmakuItem[]> {
  const key = String(cid || '')
  if (!key) return []

  const hit = cache.get(key)
  if (hit && Date.now() - hit.at < TTL) return hit.items

  let total = 1
  try {
    const meta = await request(
      `https://api.bilibili.com/x/v2/dm/web/view?type=1&oid=${encodeURIComponent(key)}`,
      { timeout: 10000, headers: { Referer: 'https://www.bilibili.com/' } }
    )
    const body: any = meta.body
    total = Number(body?.data?.dm_seg?.total ?? body?.data?.total ?? 1) || 1
    // 超过 20 段（约 2 小时）只取前 20 段，避免超长合集把请求打爆
    total = Math.min(total, 20)
  } catch (e: any) {
    logger.warn('弹幕元信息获取失败，按单段处理', e?.message)
  }

  const indexes = Array.from({ length: total }, (_, i) => i + 1)
  const chunks = await pool(indexes, 4, i => fetchSegment(key, i))
  const all = chunks.flat().sort((a, b) => a.t - b.t)
  const items = sample(all, MAX_ITEMS)

  if (cache.size >= MAX_CIDS) {
    const oldest = [...cache.entries()].sort((a, b) => a[1].at - b[1].at)[0]
    if (oldest) cache.delete(oldest[0])
  }
  cache.set(key, { at: Date.now(), items })

  logger.info('弹幕加载完成', key, `${items.length} 条 / ${total} 段`)
  return items
}
