import { onBeforeUnmount, ref, type Ref } from 'vue'

/**
 * 播放页手势（规格书 1.10 / Bug 11 / 19 / 20 / 41 / 84 · 模块化重构版）
 *
 * 交互裁定（以规格书为唯一依据）：
 *  - 左右滑：切换 封面 ↔ 歌词 视图（左滑→歌词、右滑→封面，两种视图内同样生效），
 *    跟手平移，阈值 max(60px, 屏宽 20%)，未达回弹；不再用于切歌（Bug 20）。
 *  - 左半屏上下滑（仅封面视图）：亮度 0.1~1.0；右半屏：音量 0~100。
 *    歌词视图内完全禁用（Bug 19：歌词页上下滑只滚动歌词）。
 *  - 双击：播放 / 暂停（封面/歌词视图均可）。
 *  - 单击封面：进入歌词视图（单向辅助入口，返回一律右滑）。
 *  - 上滑收起（Bug 11）：起点位于屏幕底部 25% 区域的快速上滑，或任意位置
 *    250ms 内上抛（dy<-60 且竖向位移大于横向）→ 触发 onCollapse（回迷你条/开队列）。
 *  - 边缘保护：起点 clientX ≤ 28px 交给系统边缘返回，不抢手势（4.11 ③）。
 *  - 车机禁用手势（Bug 41）：hooks.enabled() 返回 false 时全部 handler 空转。
 *  - 性能（Bug 84）：rect 只在 touchstart 取一次，move 中不再读 getBoundingClientRect。
 */

export type PlaybackGestureMode = '' | 'bright' | 'vol' | 'view' | 'collapse'
export type PlaybackGestureView = 'cover' | 'lyrics'

export interface PlaybackGestureHooks {
  /** 当前音量（0~1），用于手势起始基准 */
  getVolume: () => number
  onVolume: (v: number) => void
  onToggle: () => void
  /** 左右滑切换视图：dir='lyrics' 左滑进歌词 / 'cover' 右滑回封面 */
  onSwipeView: (dir: 'lyrics' | 'cover') => void
  /** 上滑收起（Bug 11）：回迷你条 / 打开 Up Next 队列 */
  onCollapse: () => void
  /** 当前视图：歌词视图禁用亮度/音量（Bug 19） */
  view: () => PlaybackGestureView
  /** 车机返回 false 禁用全部手势（Bug 41） */
  enabled: () => boolean
  /** 单击封面 → 歌词（单向） */
  onTapCover?: () => void
}

export interface PlaybackGestures {
  brightness: Ref<number>
  hudKind: Ref<'bright' | 'vol' | ''>
  hudPercent: Ref<number>
  /** 视图切换跟手位移（px，左滑为负）；松手后归零回弹 */
  viewShift: Ref<number>
  onTouchStart: (e: TouchEvent) => void
  onTouchMove: (e: TouchEvent) => void
  onTouchEnd: (e: TouchEvent) => void
}

const MIN_BRIGHT = 0.1
/** 边缘返回保护区（4.11） */
const EDGE_GUARD = 28
/** 双击窗口 */
const DOUBLE_TAP_MS = 300

export function usePlaybackGestures(hooks: PlaybackGestureHooks): PlaybackGestures {
  const brightness = ref(Number(localStorage.getItem('xinyuan_brightness') || '1') || 1)
  const hudKind = ref<'bright' | 'vol' | ''>('')
  const hudPercent = ref(100)
  const viewShift = ref(0)

  let hudTimer = 0
  let tapTimer = 0
  let lastTapAt = 0

  const g = {
    active: false,
    x: 0,
    y: 0,
    t: 0,
    startBright: 1,
    startVol: 1,
    mode: '' as PlaybackGestureMode,
    w: 1,
    h: 1,
    left: 0,
  }

  function showHud(kind: 'bright' | 'vol', percent: number): void {
    hudKind.value = kind
    hudPercent.value = Math.round(percent)
    window.clearTimeout(hudTimer)
    hudTimer = window.setTimeout(() => {
      hudKind.value = ''
    }, 900)
  }

  function onTouchStart(e: TouchEvent): void {
    if (!hooks.enabled()) return
    const t = e.touches[0]
    if (!t) return
    // Bug 84：rect 只在起点取一次
    const box = (e.currentTarget as HTMLElement).getBoundingClientRect()
    g.active = true
    g.x = t.clientX
    g.y = t.clientY
    g.t = Date.now()
    g.startBright = brightness.value
    g.startVol = hooks.getVolume()
    g.mode = ''
    g.w = box.width || 1
    g.h = box.height || 1
    g.left = box.left
  }

  function onTouchMove(e: TouchEvent): void {
    if (!g.active) return
    const t = e.touches[0]
    if (!t) return
    const dx = t.clientX - g.x
    const dy = t.clientY - g.y

    if (!g.mode) {
      if (Math.abs(dx) < 14 && Math.abs(dy) < 14) return
      if (Math.abs(dx) > Math.abs(dy)) {
        // Bug 20：左右滑切视图（跟手平移），不再切歌
        g.mode = 'view'
      } else if (hooks.view() === 'lyrics') {
        // Bug 19：歌词视图上下滑只滚动歌词，绝不定亮度/音量
        g.mode = 'collapse'
        return
      } else {
        // 左半屏亮度 / 右半屏音量（仅封面视图，规格书 1.10）
        g.mode = g.x - g.left < g.w / 2 ? 'bright' : 'vol'
      }
    }
    if (g.mode === 'bright' || g.mode === 'vol') {
      if (e.cancelable) e.preventDefault()
      if (g.mode === 'bright') {
        const next = Math.min(1, Math.max(MIN_BRIGHT, g.startBright - dy / g.h))
        brightness.value = next
        showHud('bright', next * 100)
      } else {
        const next = Math.min(1, Math.max(0, g.startVol - dy / g.h))
        hooks.onVolume(next)
        showHud('vol', next * 100)
      }
      return
    }
    if (g.mode === 'view') {
      if (e.cancelable) e.preventDefault()
      viewShift.value = dx
    }
    // mode === 'collapse'：不拦默认行为，交给原生滚动
  }

  function onTouchEnd(e: TouchEvent): void {
    if (!g.active) return
    g.active = false
    const t = e.changedTouches[0]
    const dx = (t?.clientX || 0) - g.x
    const dy = (t?.clientY || 0) - g.y
    const elapsed = Math.max(1, Date.now() - g.t)

    if (g.mode === 'view') {
      viewShift.value = 0
      const threshold = Math.max(60, g.w * 0.2)
      if (dx <= -threshold) hooks.onSwipeView('lyrics')
      else if (dx >= threshold) hooks.onSwipeView('cover')
      return
    }
    if (g.mode === 'bright' || g.mode === 'vol') {
      // Bug 11：快速上抛（<250ms、上滑 >60px、竖向大于横向）→ 收起播放页
      if (dy < -60 && Math.abs(dy) > Math.abs(dx) && elapsed < 250) {
        hudKind.value = ''
        hooks.onCollapse()
      }
      return
    }
    if (g.mode === 'collapse') {
      // 歌词视图快速上抛也允许收起（规格书 1.10 上滑退出）
      if (dy < -60 && Math.abs(dy) > Math.abs(dx) && elapsed < 250) hooks.onCollapse()
      return
    }

    // 未成模式：判tap（起点在底部 25% 区域上滑同样收起，Bug 11 ①）
    if (dy < -60 && Math.abs(dy) > Math.abs(dx) && g.y > g.h * 0.75) {
      hooks.onCollapse()
      return
    }
    if (Math.abs(dx) > 16 || Math.abs(dy) > 16 || elapsed > 320) return

    const now = Date.now()
    if (now - lastTapAt < DOUBLE_TAP_MS) {
      window.clearTimeout(tapTimer)
      lastTapAt = 0
      hooks.onToggle()
      return
    }
    lastTapAt = now
    window.clearTimeout(tapTimer)
    tapTimer = window.setTimeout(() => {
      // Bug 20：单击封面 → 歌词（单向），歌词视图单击不切
      if (hooks.view() === 'cover') hooks.onTapCover?.()
    }, 260)
  }

  onBeforeUnmount(() => {
    window.clearTimeout(hudTimer)
    window.clearTimeout(tapTimer)
  })

  return { brightness, hudKind, hudPercent, viewShift, onTouchStart, onTouchMove, onTouchEnd }
}
