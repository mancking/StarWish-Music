import { onBeforeUnmount, ref, type Ref } from 'vue'

/**
 * 视频播放手势（规格书 2.8，仅手机 / 平板）
 *
 * - 左半屏上下滑：亮度
 * - 右半屏上下滑：音量
 * - 左右滑：时间偏移预览，松手跳转
 * - 双击：左半屏 −10s / 右半屏 +10s / 中间播放暂停
 * - 单击：显示或隐藏控件
 *
 * 车机不做手势（规格书 2.8 / 3.0）。
 */
export type VideoGestureMode = '' | 'bright' | 'vol' | 'seek'

export interface VideoGestureHooks {
  getVolume: () => number
  onVolume: (v: number) => void
  seekTo: (sec: number) => void
  getPosition: () => number
  getDuration: () => number
  onToggle: () => void
  onTap: () => void
}

export interface VideoGestures {
  brightness: Ref<number>
  mode: Ref<VideoGestureMode>
  hint: Ref<string>
  onTouchStart: (e: TouchEvent) => void
  onTouchMove: (e: TouchEvent) => void
  onTouchEnd: (e: TouchEvent) => void
}

export function useVideoGestures(hooks: VideoGestureHooks): VideoGestures {
  const brightness = ref(1)
  const mode = ref<VideoGestureMode>('')
  const hint = ref('')

  let hintTimer = 0
  let tapTimer = 0
  let lastTapAt = 0

  const g = {
    active: false,
    x: 0,
    y: 0,
    t: 0,
    startVol: 1,
    startBright: 1,
    startPos: 0,
    w: 1,
    h: 1,
    target: 0,
  }

  function showHint(text: string, ms = 900): void {
    hint.value = text
    window.clearTimeout(hintTimer)
    hintTimer = window.setTimeout(() => {
      hint.value = ''
      mode.value = ''
    }, ms)
  }

  function onTouchStart(e: TouchEvent): void {
    const t = e.touches[0]
    if (!t) return
    const box = (e.currentTarget as HTMLElement).getBoundingClientRect()
    g.active = true
    g.x = t.clientX
    g.y = t.clientY
    g.t = Date.now()
    g.startVol = hooks.getVolume()
    g.startBright = brightness.value
    g.startPos = hooks.getPosition()
    g.target = g.startPos
    g.w = box.width || 1
    g.h = box.height || 1
    mode.value = ''
  }

  function onTouchMove(e: TouchEvent): void {
    if (!g.active) return
    const t = e.touches[0]
    if (!t) return
    const dx = t.clientX - g.x
    const dy = t.clientY - g.y

    if (!mode.value) {
      if (Math.abs(dx) < 14 && Math.abs(dy) < 14) return
      if (Math.abs(dx) > Math.abs(dy)) {
        mode.value = 'seek'
      } else {
        const box = (e.currentTarget as HTMLElement).getBoundingClientRect()
        mode.value = t.clientX - box.left < g.w / 2 ? 'bright' : 'vol'
      }
    }
    if (e.cancelable) e.preventDefault()

    if (mode.value === 'seek') {
      const dur = hooks.getDuration() || 0
      const delta = (dx / g.w) * Math.min(dur, 180) * 0.9
      g.target = Math.min(dur, Math.max(0, g.startPos + delta))
      const diff = Math.round(g.target - g.startPos)
      showHint(`${diff >= 0 ? '快进' : '快退'} ${Math.abs(diff)}s`, 6000)
    } else if (mode.value === 'bright') {
      const next = Math.min(1, Math.max(0.15, g.startBright - dy / g.h))
      brightness.value = next
      showHint(`亮度 ${Math.round(next * 100)}%`)
    } else {
      const next = Math.min(1, Math.max(0, g.startVol - dy / g.h))
      hooks.onVolume(next)
      showHint(`音量 ${Math.round(next * 100)}%`)
    }
  }

  function onTouchEnd(e: TouchEvent): void {
    if (!g.active) return
    g.active = false
    const dx = (e.changedTouches[0]?.clientX || 0) - g.x
    const dy = (e.changedTouches[0]?.clientY || 0) - g.y
    const elapsed = Date.now() - g.t

    if (mode.value === 'seek') {
      hooks.seekTo(g.target)
      showHint('', 0)
      return
    }
    if (mode.value) return
    if (Math.abs(dx) > 16 || Math.abs(dy) > 16 || elapsed > 320) return

    const box = (e.currentTarget as HTMLElement).getBoundingClientRect()
    const x = (e.changedTouches[0]?.clientX || 0) - box.left
    const ratio = x / (box.width || 1)
    const now = Date.now()

    if (now - lastTapAt < 300) {
      window.clearTimeout(tapTimer)
      lastTapAt = 0
      if (ratio < 0.35) {
        hooks.seekTo(Math.max(0, hooks.getPosition() - 10))
        showHint('快退 10s')
      } else if (ratio > 0.65) {
        hooks.seekTo(Math.min(hooks.getDuration(), hooks.getPosition() + 10))
        showHint('快进 10s')
      } else {
        hooks.onToggle()
      }
      return
    }
    lastTapAt = now
    window.clearTimeout(tapTimer)
    tapTimer = window.setTimeout(() => {
      hooks.onTap()
    }, 260)
  }

  onBeforeUnmount(() => {
    window.clearTimeout(hintTimer)
    window.clearTimeout(tapTimer)
  })

  return { brightness, mode, hint, onTouchStart, onTouchMove, onTouchEnd }
}
