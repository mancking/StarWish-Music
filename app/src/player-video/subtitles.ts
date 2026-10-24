/**
 * 外挂字幕（规格书 2.11 · 独立模块）
 *
 * - 解析 .srt / .ass（含 .vtt 宽松兼容），任何畸形输入返回空列表不抛异常
 * - subtitleOffsetSec：字幕延迟 ±0.5s 步进、限 ±10s，跨视频记忆（独立于歌词 offset）
 * - SubtitleOverlay.vue 消费 activeCue 渲染
 */

export interface SubCue {
  start: number
  end: number
  text: string
}

function toSec(ts: string): number {
  const m = /(\d{1,2}):(\d{1,2}):(\d{1,2})[.,](\d{1,3})/.exec(ts)
  if (m) return Number(m[1]) * 3600 + Number(m[2]) * 60 + Number(m[3]) + Number(m[4].padEnd(3, '0')) / 1000
  const m2 = /(\d{1,2}):(\d{1,2})[.,](\d{1,3})/.exec(ts)
  if (m2) return Number(m2[1]) * 60 + Number(m2[2]) + Number(m2[3].padEnd(3, '0')) / 1000
  return 0
}

/** SRT：块间空行分隔，首行序号，第二行时间轴 */
function parseSrt(src: string): SubCue[] {
  const out: SubCue[] = []
  const blocks = src.replace(/\r\n?/g, '\n').split(/\n{2,}/)
  for (const b of blocks) {
    const lines = b.split('\n').filter(l => l.trim())
    if (lines.length < 2) continue
    const tl = lines.find(l => /-->/.test(l))
    if (!tl) continue
    const [a, z] = tl.split('-->')
    const start = toSec(a || '')
    const end = toSec((z || '').trim().split(/\s+/)[0] || '')
    const text = lines
      .filter(l => l !== tl && !/^\d+$/.test(l.trim()))
      .join('\n')
      .trim()
    if (text && end > start) out.push({ start, end, text })
  }
  return out
}

/** ASS：Dialogue 行，Text 为最后若干逗号段 */
function parseAss(src: string): SubCue[] {
  const out: SubCue[] = []
  for (const line of src.split(/\r?\n/)) {
    if (!/^Dialogue:/i.test(line)) continue
    const parts = line.split(',')
    if (parts.length < 10) continue
    const start = toSec(parts[1] || '')
    const end = toSec(parts[2] || '')
    const text = parts
      .slice(9)
      .join(',')
      .replace(/\{[^}]*\}/g, '')
      .replace(/\\N/gi, '\n')
      .trim()
    if (text && end > start) out.push({ start, end, text })
  }
  return out
}

export function parseSubtitles(raw: string): SubCue[] {
  const src = String(raw || '')
  if (!src.trim()) return []
  const cues = /^Dialogue:/im.test(src) ? parseAss(src) : parseSrt(src)
  return cues.sort((a, b) => a.start - b.start)
}

/** 字幕延迟（±0.5s 步进，限 ±10s，规格书 2.11） */
export function nudgeSubtitleOffset(cur: number, delta: number): number {
  return Math.max(-10, Math.min(10, Math.round((cur + delta) * 10) / 10))
}

/** 按当前播放位置（含偏移）取活动字幕行 */
export function activeCueAt(cues: SubCue[], position: number, offsetSec: number): SubCue | null {
  const t = position + offsetSec
  let lo = 0
  let hi = cues.length - 1
  let ans: SubCue | null = null
  while (lo <= hi) {
    const mid = (lo + hi) >> 1
    const c = cues[mid]!
    if (c.start <= t) {
      if (t < c.end) ans = c
      lo = mid + 1
    } else {
      hi = mid - 1
    }
  }
  return ans
}
