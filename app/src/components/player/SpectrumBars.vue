<script setup lang="ts">
/**
 * 舞台频谱
 * 桌面底部 64 柱（0~200px）/ 平板底部 32 柱（0~120px）/ 手机顶部 24px 窄条 16 柱 / 车机不显示。
 * 数据来自真实 AnalyserNode（见 src/audio/spectrum.ts），无数据时柱高归零而不是假跳动。
 */
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { platform } from '@/platform'
import { setSpectrumActive, spectrumBars } from '@/player-core/spectrum'

const props = withDefaults(
  defineProps<{
    placement?: 'bottom' | 'top'
    /** 覆盖柱数（默认按端） */
    bars?: number
  }>(),
  { placement: 'bottom', bars: 0 }
)

const canvas = ref<HTMLCanvasElement | null>(null)
const count = computed(() => props.bars || platform.value.bars)
const maxHeight = computed(() => {
  if (props.placement === 'top') return 24
  return platform.value.kind === 'pad' ? 120 : 200
})
const visible = computed(() => count.value > 0)

let smooth: number[] = []
let raf = 0
let w = 0
let h = 0
let last = 0
let ro: ResizeObserver | null = null

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

function frame(now: number): void {
  raf = requestAnimationFrame(frame)
  if (now - last < 1000 / 30) return
  last = now
  const ctx = canvas.value?.getContext('2d')
  if (!ctx || !w || !h) return
  const n = count.value
  const data = spectrumBars.value
  ctx.clearRect(0, 0, w, h)
  const gap = n > 32 ? 2 : 3
  const barW = Math.max(1, (w - gap * (n - 1)) / n)
  const radius = Math.min(2, barW / 2)
  for (let i = 0; i < n; i++) {
    // 频段抽样：低频段更密（log 分布），没有数据时为 0
    let value = 0
    if (data.length) {
      const from = Math.floor((i / n) ** 1.7 * data.length)
      const to = Math.max(from + 1, Math.floor(((i + 1) / n) ** 1.7 * data.length))
      let sum = 0
      for (let k = from; k < to && k < data.length; k++) sum += data[k]
      value = sum / Math.max(1, to - from) / 255
    }
    const target = Math.max(0, Math.min(1, value))
    smooth[i] = (smooth[i] || 0) * 0.72 + target * 0.28
    const bh = Math.max(1, smooth[i] * h)
    const x = i * (barW + gap)
    const y = props.placement === 'top' ? 0 : h - bh
    ctx.fillStyle = 'rgba(167, 139, 250, 0.6)'
    if (ctx.roundRect) {
      ctx.beginPath()
      ctx.roundRect(x, y, barW, bh, radius)
      ctx.fill()
    } else {
      ctx.fillRect(x, y, barW, bh)
    }
  }
}

function start(): void {
  stop()
  if (!visible.value) return
  resize()
  smooth = []
  setSpectrumActive(true)
  raf = requestAnimationFrame(frame)
}

function stop(): void {
  if (raf) cancelAnimationFrame(raf)
  raf = 0
  setSpectrumActive(false)
}

onMounted(() => {
  if (canvas.value) {
    ro = new ResizeObserver(() => resize())
    ro.observe(canvas.value)
  }
  start()
})
onBeforeUnmount(() => {
  stop()
  ro?.disconnect()
})
watch(visible, () => start())
</script>

<template>
  <canvas
    v-show="visible"
    ref="canvas"
    class="spectrum"
    :class="placement"
    :style="{ height: maxHeight + 'px' }"
    aria-hidden="true"
  />
</template>

<style scoped>
.spectrum {
  position: absolute;
  left: 0;
  right: 0;
  width: 100%;
  pointer-events: none;
  z-index: 1;
}
.spectrum.bottom {
  bottom: 0;
}
.spectrum.top {
  top: 0;
}
</style>
