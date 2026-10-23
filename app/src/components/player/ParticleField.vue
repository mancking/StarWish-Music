<script setup lang="ts">
/**
 * 粒子背景（规格书 v2.7 · 1.5）
 * 桌面 200 / 平板 80 / 手机 50（30fps）/ 车机 0。
 * 硬约束：不做连线、不做鼠标交互、不做碰撞检测、不做 WebGL —— 就是圆点漂移 + 边缘反弹。
 */
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { particleCount, platform } from '@/platform'

const props = withDefaults(
  defineProps<{
    /** 覆盖自动档位（默认按端取） */
    count?: number
    /** 外部总开关（设置里关掉粒子时传 false） */
    enabled?: boolean
  }>(),
  { count: 0, enabled: true }
)

const canvas = ref<HTMLCanvasElement | null>(null)

interface Dot {
  x: number
  y: number
  r: number
  vx: number
  vy: number
  a: number
  pink: boolean
}

const active = computed(() => props.enabled && (props.count || particleCount()) > 0)
const dotCount = computed(() => props.count || particleCount())

let dots: Dot[] = []
let raf = 0
let w = 0
let h = 0
let last = 0
const FPS = platform.value.kind === 'phone' ? 30 : 60

function resize(): void {
  const c = canvas.value
  if (!c) return
  const rect = c.getBoundingClientRect()
  const dpr = Math.min(2, window.devicePixelRatio || 1)
  w = Math.max(1, rect.width)
  h = Math.max(1, rect.height)
  c.width = Math.round(w * dpr)
  c.height = Math.round(h * dpr)
  const ctx = c.getContext('2d')
  if (ctx) ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
}

function seed(): void {
  const n = dotCount.value
  dots = Array.from({ length: n }, () => ({
    x: Math.random() * w,
    y: Math.random() * h,
    r: 1 + Math.random() * 1.5, // 1~2.5px
    vx: (Math.random() - 0.5) * 0.4, // 0.2~0.5px/帧
    vy: (Math.random() - 0.5) * 0.4,
    a: 0.3 + Math.random() * 0.4, // 0.3~0.7
    pink: Math.random() > 0.5,
  }))
}

function frame(now: number): void {
  raf = requestAnimationFrame(frame)
  if (now - last < 1000 / FPS) return
  last = now
  const ctx = canvas.value?.getContext('2d')
  if (!ctx) return
  ctx.clearRect(0, 0, w, h)
  for (const d of dots) {
    d.x += d.vx
    d.y += d.vy
    // 边缘反弹（不是重生成，避免粒子「跳」）
    if (d.x < -2 || d.x > w + 2) d.vx = -d.vx
    if (d.y < -2 || d.y > h + 2) d.vy = -d.vy
    ctx.globalAlpha = d.a
    ctx.fillStyle = d.pink ? '#F472B6' : '#A78BFA'
    ctx.beginPath()
    ctx.arc(d.x, d.y, d.r, 0, Math.PI * 2)
    ctx.fill()
  }
  ctx.globalAlpha = 1
}

function start(): void {
  stop()
  if (!active.value) return
  resize()
  if (!dots.length) seed()
  raf = requestAnimationFrame(frame)
}

function stop(): void {
  if (raf) cancelAnimationFrame(raf)
  raf = 0
  const ctx = canvas.value?.getContext('2d')
  if (ctx) ctx.clearRect(0, 0, w, h)
}

let ro: ResizeObserver | null = null
onMounted(() => {
  if (canvas.value) {
    ro = new ResizeObserver(() => {
      resize()
      seed()
    })
    ro.observe(canvas.value)
  }
  start()
})
onBeforeUnmount(() => {
  stop()
  ro?.disconnect()
})
watch([active, dotCount], () => start())
</script>

<template>
  <canvas v-show="active" ref="canvas" class="particle-field" aria-hidden="true" />
</template>

<style scoped>
.particle-field {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  pointer-events: none;
  z-index: 1;
}
</style>
