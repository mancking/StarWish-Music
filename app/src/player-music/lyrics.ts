import { computed, type ComputedRef, type Ref } from 'vue'
import type { LyricResult } from '@shared/types'

/**
 * 歌词同步
 *
 * 四端共用同一套歌词计算：手机/平板/桌面都只是渲染形态不同，
 * 因此把「行列表 + 当前行 + 下一行」的推导收敛到这里，页面只负责排版。
 */
export interface LyricViewLine {
  /** 秒 */
  time: number
  text: string
  trans?: string
 /** 逐字时间（毫秒）：卡拉OK 逐字高亮 */
  words?: { t: number; d: number; w: string }[]
}

export interface LyricSync {
  lines: ComputedRef<LyricViewLine[]>
  /** 当前行下标，无歌词或尚未到第一行时为 -1 */
  activeIndex: ComputedRef<number>
  activeLine: ComputedRef<LyricViewLine | null>
 /** 桌面歌词悬浮窗用 */
  nextLine: ComputedRef<LyricViewLine | null>
  hasLyric: ComputedRef<boolean>
}

/** 二分查找当前行，避免每帧线性扫描整段歌词 */
export function useLyricSync(
  lyric: { readonly value: LyricResult | null },
  position: { readonly value: number }
): LyricSync {
  const lines = computed<LyricViewLine[]>(() =>
    (lyric.value?.lines || []).map(l => ({ time: l.time, text: l.text, trans: l.trans, words: l.words }))
  )

  const activeIndex = computed(() => {
    const arr = lines.value
    if (!arr.length) return -1
    const t = position.value + 0.12
    let lo = 0
    let hi = arr.length - 1
    let ans = -1
    while (lo <= hi) {
      const mid = (lo + hi) >> 1
      const cur = arr[mid]!
      if (cur.time <= t) {
        ans = mid
        lo = mid + 1
      } else {
        hi = mid - 1
      }
    }
    return ans
  })

  const activeLine = computed(() => lines.value[activeIndex.value] || null)
  const nextLine = computed(() => lines.value[activeIndex.value + 1] || null)
  const hasLyric = computed(() => lines.value.length > 0)

  return { lines, activeIndex, activeLine, nextLine, hasLyric }
}

/**
 * 卡拉OK 逐字高亮 ：按「行起始时间 + 已播放进度」推导每个字的着色比例。
 * 返回当前行内每个字的已唱比例 0~1（无逐字数据时整行二值：0 或 1）。
 * 仅当前行做逐字计算，其余行整行着色（性能约定）。
 */
export function wordProgress(
  line: LyricViewLine | null | undefined,
  positionSec: number
): number[] | null {
  if (!line?.words?.length) return null
  const nowMs = positionSec * 1000
  const offset = line.time * 1000
  return line.words.map(w => {
    const t = offset + w.t
    const d = Math.max(80, w.d)
    if (nowMs <= t) return 0
    if (nowMs >= t + d) return 1
    return Math.min(1, (nowMs - t) / d)
  })
}
