import type { LyricLine } from './types'

/**
 * 容错 LRC / QRC / YRC 解析。
 * 设计原则：任何畸形输入都必须返回可用结果（绝不抛异常），因为歌词源质量极不稳定。
 */

const TIME_TAG = /\[(\d{1,3}):(\d{1,2})(?:[.:](\d{1,3}))?\]/g
const META_TAG = /^\[(ti|ar|al|by|offset|length|re|ve):(.*)\]$/i

function toSeconds(m: string, s: string, ms?: string): number {
  const mm = parseInt(m, 10) || 0
  const ss = parseInt(s, 10) || 0
  let frac = 0
  if (ms) {
    const v = parseInt(ms, 10) || 0
    frac = ms.length === 1 ? v / 10 : ms.length === 2 ? v / 100 : v / 1000
  }
  return mm * 60 + ss + frac
}

/** 逐字标签 <mm:ss.xx> 或 [mm:ss.xxx] */
const WORD_TAG = /[<[](\d{1,3}):(\d{1,2})(?:[.:](\d{1,3}))?[>\]]/g

function parseWordLine(text: string, lineTime: number): LyricLine['words'] | undefined {
  if (!/[<[]\d{1,3}:\d{1,2}/.test(text)) return undefined
  const marks: { t: number; idx: number; len: number }[] = []
  let m: RegExpExecArray | null
  WORD_TAG.lastIndex = 0
  while ((m = WORD_TAG.exec(text))) {
    marks.push({ t: toSeconds(m[1], m[2], m[3]) * 1000, idx: m.index, len: m[0].length })
  }
  if (marks.length < 2) return undefined
  const words: { t: number; d: number; w: string }[] = []
  for (let i = 0; i < marks.length; i++) {
    const start = marks[i].idx + marks[i].len
    const end = i + 1 < marks.length ? marks[i + 1].idx : text.length
    const w = text.slice(start, end)
    const nextT = i + 1 < marks.length ? marks[i + 1].t : marks[i].t + 800
    if (w.trim()) words.push({ t: marks[i].t, d: Math.max(80, nextT - marks[i].t), w })
  }
  return words.length ? words : undefined
}

function stripWordTags(text: string): string {
  return text.replace(WORD_TAG, '').trim()
}

export function parseLyric(raw: string): { lines: LyricLine[]; offset: number; hasWordByWord: boolean } {
  const src = String(raw || '').replace(/\r\n?/g, '\n')
  if (!src.trim()) return { lines: [], offset: 0, hasWordByWord: false }

  let offset = 0
  const entries: { time: number; text: string; trans?: string }[] = []
  const lines = src.split('\n')

  for (const rawLine of lines) {
    const line = rawLine.trim()
    if (!line) continue
    const meta = line.match(META_TAG)
    if (meta) {
      if (meta[1].toLowerCase() === 'offset') offset = (parseInt(meta[2], 10) || 0) / 1000
      continue
    }
    TIME_TAG.lastIndex = 0
    const times: number[] = []
    let tm: RegExpExecArray | null
    let lastEnd = 0
    while ((tm = TIME_TAG.exec(line))) {
      if (tm.index > lastEnd) break
      times.push(toSeconds(tm[1], tm[2], tm[3]))
      lastEnd = tm.index + tm[0].length
    }
    if (!times.length) continue
    const content = line.slice(lastEnd).trim()
    const words = parseWordLine(content, times[0])
    const text = stripWordTags(content)
    for (const t of times) {
      entries.push({ time: t, text, ...(words ? { trans: undefined } : {}) })
      if (words) (entries[entries.length - 1] as any).words = words
    }
  }

  entries.sort((a, b) => a.time - b.time)

  // 翻译行配对：同一时间戳的第二条（无逐字、文本不同）作为翻译
  const result: LyricLine[] = []
  for (const e of entries) {
    const last = result[result.length - 1]
    const isTrans = last && Math.abs(last.time - e.time) < 0.05 && last.text !== e.text && !(e as any).words
    if (isTrans) {
      if (!last.trans) last.trans = e.text
      continue
    }
    result.push({ time: e.time, text: e.text, trans: e.trans, words: (e as any).words })
  }

  const hasWordByWord = result.some(l => l.words && l.words.length > 1)
  return { lines: result, offset, hasWordByWord }
}

/** 二分查找当前行索引；返回 -1 表示尚未开始 */
export function findLyricIndex(lines: LyricLine[], timeSec: number): number {
  if (!lines.length) return -1
  let lo = 0
  let hi = lines.length - 1
  let ans = -1
  while (lo <= hi) {
    const mid = (lo + hi) >> 1
    if (lines[mid].time <= timeSec + 0.001) {
      ans = mid
      lo = mid + 1
    } else {
      hi = mid - 1
    }
  }
  return ans
}

export function formatTime(sec: number): string {
  if (!Number.isFinite(sec) || sec < 0) return '0:00'
  const s = Math.floor(sec)
  const m = Math.floor(s / 60)
  const r = s % 60
  if (m >= 60) {
    const h = Math.floor(m / 60)
    return `${h}:${String(m % 60).padStart(2, '0')}:${String(r).padStart(2, '0')}`
  }
  return `${m}:${String(r).padStart(2, '0')}`
}
