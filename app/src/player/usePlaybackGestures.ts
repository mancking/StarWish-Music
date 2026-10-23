import { onBeforeUnmount, ref, type Ref } from 'vue'

/**
 * 播放页手势（规格书 1.10，仅手机 / 平板）
 *
 * - 左半屏上下滑：亮度 0.1 ~ 1.0
 * - 右半屏上下滑：音量 0 ~ 100
 * - 封面区左右滑：左滑下一首 / 右滑上一首
 * - 双击屏幕：播放 / 暂停
 * - 单击：交给页面（封面 ⇄ 歌词），延迟 260ms 判定以避开双击
 *
 * 车机不做手势（规格书 0.4 / 3.0），页面在车机形态下不绑定这三个 handler。
 */
export type PlaybackGestureMode = '' | 'bright' | 'vol' | 'song'

export interface PlaybackGestureHooks {
  /** 当前音量（0~1），用于手势起始基准 */
  getVolume: () => number
  onVolume: (v: number) => void
  onPrev: () => void
  onNext: () => void
  onToggle: () => void
  /** 单击回调（可选） */
  onTap?: () => void
}

export interface PlaybackGestures {
  /** 当前亮度（0.1~1.0），页面绑定到 CSS filter */
  brightness: Ref<number>
  hudKind: Ref<PlaybackGestureMode>
  hudText: Ref<string>
  onTouchStart: (e: TouchEvent) => void
  onTouchMove: (e: TouchEvent) => void
  onTouchEnd: (e: TouchEvent) => void
}

const MIN_BRIGHT = 0.1
const SWIPE_SONG = 60

export function usePlaybackGestures(hooks: PlaybackGestureHooks): PlaybackGestures {
  const brightness = ref(1)
  const hudKind = ref<PlaybackGestureMode>('')
  const hudText = ref('')

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
  }

  function showHud(kind: PlaybackGestureMode, text: string): void {
    hudKind.value = kind
    hudText.value = text
    window.clearTimeout(hudTimer)
    hudTimer = window.setTimeout(() => {
      hudKind.value = ''
    }, 900)
  }

  function onTouchStart(e: TouchEvent): void {
    const t = e.touches[0]
    if (!t) return
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
        g.mode = 'song'
      } else {
        const box = (e.currentTarget as HTMLElement).getBoundingClientRect()
        g.mode = t.clientX - box.left < g.w / 2 ? 'bright' : 'vol'
      }
    }
    if (e.cancelable) e.preventDefault()

    if (g.mode === 'bright') {
      const next = Math.min(1, Math.max(MIN_BRIGHT, g.startBright - dy / g.h))
      brightness.value = next
      showHud('bright', `亮度 ${Math.round(next * 100)}%`)
    } else if (g.mode === 'vol') {
      const next = Math.min(1, Math.max(0, g.startVol - dy / g.h))
      hooks.onVolume(next)
      showHud('vol', `音量 ${Math.round(next * 100)}%`)
    }
  }

  function onTouchEnd(e: TouchEvent): void {
    if (!g.active) return
    g.active = false
    const dx = (e.changedTouches[0]?.clientX || 0) - g.x
    const dy = (e.changedTouches[0]?.clientY || 0) - g.y
    const elapsed = Date.now() - g.t

    if (g.mode === 'song') {
      if (dx <= -SWIPE_SONG) hooks.onNext()
      else if (dx >= SWIPE_SONG) hooks.onPrev()
      return
    }
    if (g.mode) return
    if (Math.abs(dx) > 16 || Math.abs(dy) > 16 || elapsed > 320) return

    const now = Date.now()
    if (now - lastTapAt < 300) {
      window.clearTimeout(tapTimer)
      lastTapAt = 0
      hooks.onToggle()
      return
    }
    lastTapAt = now
    window.clearTimeout(tapTimer)
    tapTimer = window.setTimeout(() => {
      hooks.onTap?.()
    }, 260)
  }

  onBeforeUnmount(() => {
    window.clearTimeout(hudTimer)
    window.clearTimeout(tapTimer)
  })

  return { brightness, hudKind, hudText, onTouchStart, onTouchMove, onTouchEnd }
}
