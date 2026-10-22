<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import type { DanmakuItem } from '@shared/types'

/**
 * 弹幕渲染层（Canvas 2D）。
 *
 * 为什么不换 ArtPlayer：现有 MvPlayer 的控制条、画质切换、离线缓存共 1500+ 行，
 * 换框架等于推倒重来。这里只做一层覆盖在 <video> 之上的 canvas，数据来自主进程。
 *
 * 时间基准直接读 video.currentTime，避免与 store 的 250ms 轮询不同步导致弹幕漂移。
 */

const props = withDefaults(
  defineProps<{
    video: HTMLVideoElement | null
    items: DanmakuItem[]
    enabled: boolean
    opacity: number
    fontSize: 'small' | 'medium' | 'large'
    speed: 'slow' | 'normal' | 'fast'
    area: 'quarter' | 'half' | 'full'
    antiSubtitle: boolean
    blockWords: string
  }>(),
  {
    enabled: true,
    opacity: 0.85,
    fontSize: 'medium',
    speed: 'normal',
    area: 'half',
    antiSubtitle: true,
    blockWords: '',
  }
)

const canvas = ref<HTMLCanvasElement | null>(null)
let ctx: CanvasRenderingContext2D | null = null
let raf = 0
let dpr = 1
let W = 0
let H = 0

interface Active {
  text: string
  color: string
  size: number
  x: number
  y: number
  v: number
  w: number
  mode: 1 | 4 | 5
  born: number
}

interface TrackEnd {
  x: number
  w: number
  v: number
}

let active: Active[] = []
let trackEnd: TrackEnd[] = []
let cursor = 0
const widthCache = new Map<string, number>()

const fontScale = computed(() => (props.fontSize === 'small' ? 0.82 : props.fontSize === 'large' ? 1.24 : 1))
const speedScale = computed(() => (props.speed === 'slow' ? 0.72 : props.speed === 'fast' ? 1.35 : 1))
const areaRatio = computed(() => (props.area === 'quarter' ? 0.25 : props.area === 'full' ? 1 : 0.5))
const blocked = computed(() => {
  const raw = (props.blockWords || '')
    .split(/[\n,，|]/)
    .map(s => s.trim())
    .filter(Boolean)
  return raw
})

function isBlocked(text: string): boolean {
  if (!blocked.value.length) return false
  return blocked.value.some(w => text.includes(w))
}

function resize(): void {
  const el = canvas.value
  const parent = el?.parentElement
  if (!el || !parent) return
  dpr = Math.min(2, window.devicePixelRatio || 1)
  W = parent.clientWidth
  H = parent.clientHeight
  el.width = Math.max(1, Math.floor(W * dpr))
  el.height = Math.max(1, Math.floor(H * dpr))
  el.style.width = `${W}px`
  el.style.height = `${H}px`
  ctx = el.getContext('2d')
  if (ctx) ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
  trackEnd = []
}

function measure(text: string, size: number): number {
  const key = `${size}|${text}`
  const hit = widthCache.get(key)
  if (hit !== undefined) return hit
  if (!ctx) return text.length * size
  ctx.font = `${size}px "Microsoft YaHei", "PingFang SC", system-ui, sans-serif`
  const w = ctx.measureText(text).width
  if (widthCache.size > 3000) widthCache.clear()
  widthCache.set(key, w)
  return w
}

function colorOf(n: number): string {
  const v = n & 0xffffff
  return `#${v.toString(16).padStart(6, '0')}`
}

/** 滚动弹幕按速度选轨：轨道最后一条已完全进场、且不会追尾，才允许复用 */
function pickTrack(size: number, v: number, lineH: number, maxY: number): number {
  const rows = Math.max(1, Math.floor(maxY / lineH))
  for (let i = 0; i < rows; i++) {
    const t = trackEnd[i]
    if (!t) return i
    if (t.x + t.w < W - 12 && t.v >= v) return i
  }
  return -1
}

function spawn(item: DanmakuItem, now: number): void {
  if (!ctx) return
  if (isBlocked(item.text)) return
  const base = 25 * fontScale.value
  const size = Math.round((item.size === 36 ? base * 1.3 : item.size === 18 ? base * 0.78 : base) * 10) / 10
  const w = measure(item.text, size)
  const lineH = size + 8
  const topPad = 8
  const limit = H * Math.min(1, areaRatio.value)
  const maxY = props.antiSubtitle ? Math.min(limit, H * 0.78) : limit

  if (item.mode === 1) {
    const duration = 9 / speedScale.value
    const v = (W + w) / duration
    const row = pickTrack(size, v, lineH, Math.max(lineH, maxY - topPad))
    if (row < 0) return
    const y = topPad + row * lineH + size
    trackEnd[row] = { x: W, w, v }
    active.push({ text: item.text, color: colorOf(item.color), size, x: W, y, v, w, mode: 1, born: now })
    return
  }

  // 顶部 / 底部：各占 3 条轨道，固定显示 4 秒
  const rows = 3
  for (let i = 0; i < rows; i++) {
    const y = item.mode === 5 ? topPad + i * lineH + size : H - 24 - (i + 1) * lineH + size
    const occupied = active.some(a => a.mode === item.mode && Math.abs(a.y - y) < 2)
    if (occupied) continue
    active.push({
      text: item.text,
      color: colorOf(item.color),
      size,
      x: (W - w) / 2,
      y,
      v: 0,
      w,
      mode: item.mode,
      born: now,
    })
    return
  }
}

function frame(): void {
  raf = requestAnimationFrame(frame)
  if (!ctx) return
  const v = props.video
  const time = v && Number.isFinite(v.currentTime) ? v.currentTime : 0
  const playing = !!v && !v.paused && !v.ended

  ctx.clearRect(0, 0, W, H)

  if (!props.enabled || !props.items.length) {
    active = []
    return
  }

  const now = performance.now()

  // 投递：只处理 [time-1, time+0.35] 窗口内的弹幕，避免切进度后一次性灌入
  if (cursor < props.items.length) {
    while (cursor < props.items.length && props.items[cursor].t < time - 1) cursor++
    let guard = 0
    while (cursor < props.items.length && props.items[cursor].t <= time + 0.35 && guard++ < 80) {
      spawn(props.items[cursor], now)
      cursor++
    }
  }

  // 拖动进度条后退：重置游标与活动队列
  if (props.items[cursor - 1] && props.items[cursor - 1].t > time + 2) {
    cursor = 0
    active = []
    trackEnd = []
  }

  const dt = 1 / 60
  ctx.globalAlpha = Math.max(0.15, Math.min(1, props.opacity))
  ctx.textBaseline = 'alphabetic'
  ctx.shadowColor = 'rgba(0,0,0,0.55)'
  ctx.shadowBlur = 2

  const next: Active[] = []
  for (const a of active) {
    if (a.mode === 1) {
      if (playing) a.x -= a.v * dt
      if (a.x + a.w < -8) continue
    } else if (now - a.born > 4000) {
      continue
    }
    ctx.font = `600 ${a.size}px "Microsoft YaHei", "PingFang SC", system-ui, sans-serif`
    ctx.fillStyle = a.color
    ctx.fillText(a.text, a.x, a.y)
    next.push(a)
  }
  active = next
  ctx.globalAlpha = 1
  ctx.shadowBlur = 0
}

watch(
  () => props.video,
  () => {
    cursor = 0
    active = []
    trackEnd = []
  }
)

watch(
  () => props.items,
  () => {
    cursor = 0
    active = []
    trackEnd = []
  }
)

let ro: ResizeObserver | null = null
onMounted(() => {
  resize()
  const parent = canvas.value?.parentElement
  if (parent) {
    ro = new ResizeObserver(resize)
    ro.observe(parent)
  }
  raf = requestAnimationFrame(frame)
})

onBeforeUnmount(() => {
  cancelAnimationFrame(raf)
  ro?.disconnect()
  active = []
  trackEnd = []
  widthCache.clear()
})
</script>

<template>
  <canvas ref="canvas" class="danmaku-canvas" aria-hidden="true" />
</template>

<style scoped>
.danmaku-canvas {
  position: absolute;
  inset: 0;
  z-index: 3;
  pointer-events: none;
}
</style>
