<script setup lang="ts">
/**
 * 视频舞台
 *
 * 只负责「画面 + 背景层 + AB 标记 + 手势 + 自动隐藏计时」，控件由页面通过
 * overlay 插槽渲染（桌面/手机共用 ControlBar）。
 *
 * 全屏适配（唯一口径 = 3.15.6 矩阵）
 *  - 内嵌行（默认进入态）：任何源 contain + 封面静态模糊背景
 *    （背景单帧 cover + blur(24px) + rgba(0,0,0,0.55)），无纯色底；
 *  - 全屏态按矩阵：M1 竖屏源×竖屏全屏 = cover 铺满（裁切 ≤15%）；
 *    M2 竖屏源×横屏全屏 = contain 高度撑满 + 左右模糊延伸；
 *    M3 横屏源×竖屏全屏 = contain 宽度铺满 + 上下模糊延伸；
 *    M4 横屏源×横屏全屏 = 16:9 直接铺满；方形源铺满短边 + 长方向模糊延伸；
 *  - 模糊延伸背景 = canvas 采样 dynamicbg（对齐 xgplayer dynamicBg）：
 *    采样 10fps、canvas 宽 240px、CSS blur(50px) brightness(0.7)、scale(1.2)、
 *    遮罩 rgba(0,0,0,0.65)；降级链 canvas → poster 静态模糊 → 深灰 #0a0a0a。
 *
 * 源方向识别：首帧 videoWidth/videoHeight 实测（16:9 ±10% 判横/竖/方形），
 * 播放中方向不变（切分 P 由页面重建 stage 后重新判定）。
 * 全屏实现：CSS 全屏（props.fullscreen → 100vw/100vh fixed），不用
 * webkitEnterFullscreen（原生 AVPlayer 下 object-fit 失效）；video 始终 playsinline。
 */
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { useVideoGestures } from '@/player-video/useVideoGestures'

const props = withDefaults(
  defineProps<{
    src: string
    poster?: string
    fit?: 'contain' | 'cover' | 'fill' | 'actual' | 'force16x9'
    abA?: number | null
    abB?: number | null
    duration?: number
    rate?: number
 /** 车机端不自动隐藏 */
    autoHide?: boolean
    /** 禁用长按加速（车机/音频模式，规格 2.7） */
    disableBoost?: boolean
 /** CSS 全屏态（由页面控制，进入全屏后按矩阵适配） */
    fullscreen?: boolean
    /** 续播断点秒数（>15s 显示进度轨断点圆点） */
    resumeAt?: number
  }>(),
  {
    poster: '',
    fit: 'contain',
    abA: null,
    abB: null,
    duration: 0,
    rate: 1,
    autoHide: true,
    fullscreen: false,
    resumeAt: 0,
  }
)

const emit = defineEmits<{
  (e: 'loaded', duration: number): void
  (e: 'time', position: number): void
  (e: 'ended'): void
 /**真实播放态。此前不往外发，页面 playing 恒为 false，
   *  导致「播起来了中央大播放图标还在」+「控制条播放/暂停按钮不翻转」 */
  (e: 'playing', playing: boolean): void
  (e: 'toggle'): void
  (e: 'tap'): void
  (e: 'seek', sec: number): void
  (e: 'volume', v: number): void
  (e: 'error', message: string): void
  (e: 'direction', dir: 'landscape' | 'portrait' | 'square'): void
}>()

const el = ref<HTMLVideoElement | null>(null)
const bgCanvas = ref<HTMLCanvasElement | null>(null)
const position = ref(0)
const duration = ref(0)
const gesture = ref(false)

/* ---------------- 源方向识别 ---------------- */
const sourceDir = ref<'landscape' | 'portrait' | 'square'>('landscape')
function detectDirection(): void {
  const v = el.value
  if (!v || !v.videoWidth || !v.videoHeight) return
  const r = v.videoWidth / v.videoHeight
  if (r >= 16 / 9 * 0.9 && r <= 16 / 9 / 0.9) sourceDir.value = 'landscape'
  else if (r <= 9 / 16 * 1.1 && r >= 9 / 16 * 0.9) sourceDir.value = 'portrait'
  else if (Math.abs(r - 1) <= 0.2) sourceDir.value = 'square'
  else sourceDir.value = r > 1 ? 'landscape' : 'portrait'
  emit('direction', sourceDir.value)
  startBgSampler()
}

/* 容器方向（设备/窗口方向）：全屏态按 100vw/100vh 判定 */
const boxDir = computed<'landscape' | 'portrait' | 'square'>(() => {
  const w = stageBox.value?.clientWidth || window.innerWidth
  const h = stageBox.value?.clientHeight || window.innerHeight
  if (!w || !h) return 'landscape'
  const r = w / h
  if (Math.abs(r - 1) <= 0.2) return 'square'
  return r > 1 ? 'landscape' : 'portrait'
})

/* ---------------- 3.15.6 矩阵适配 ---------------- */
const matrix = computed(() => {
  if (!props.fullscreen) return 'inline' as const
  const s = sourceDir.value
  const d = boxDir.value
  if (s === 'portrait' && d === 'portrait') return 'M1' as const // cover 铺满
  if (s === 'portrait' && d !== 'portrait') return 'M2' as const // contain 高撑满 + 左右模糊延伸
  if (s !== 'portrait' && d === 'portrait') return 'M3' as const // contain 宽铺满 + 上下模糊延伸
  if (s === 'square' || d === 'square') return 'MS' as const // 铺满短边 + 长方向模糊延伸
  return 'M4' as const // 直接铺满
})

/** 前景 video object-fit（术语：cover=裁切铺满 / contain=完整画面） */
const objectFit = computed(() => {
  if (props.fit === 'actual') return 'none'
  if (props.fit === 'fill') return 'fill'
  if (props.fit === 'force16x9') return 'fill'
  if (props.fullscreen) {
    // 矩阵：方向一致 cover（M1/M4）；方向冲突 contain（M2/M3/方形）
    if (matrix.value === 'M1' || matrix.value === 'M4') return props.fit === 'cover' ? 'cover' : 'cover'
    return 'contain'
  }
  // 内嵌行：contain（B 站网页版形态）
  return props.fit
})

/** force16x9（2.3 五态之一）：强制 16:9 变形 */
const videoExtraStyle = computed(() => {
  if (props.fit === 'force16x9') return { aspectRatio: '16 / 9', width: '100%', height: '100%', objectFit: 'fill' as const }
  return undefined
})

const abRatio = (t: number | null): number =>
  t === null || !duration.value ? 0 : Math.min(100, Math.max(0, (t / duration.value) * 100))

/* ---------------- canvas 采样 dynamicbg ---------------- */
const stageBox = ref<HTMLElement | null>(null)
const bgAvailable = ref(false)
let bgTimer = 0
let bgFailed = false

function sampleBg(): void {
  const v = el.value
  const c = bgCanvas.value
  if (!v || !c || v.videoWidth === 0 || bgFailed) return
  try {
    const w = 240
    const h = Math.max(1, Math.round((w * v.videoHeight) / v.videoWidth))
    if (c.width !== w || c.height !== h) {
      c.width = w
      c.height = h
    }
    const ctx = c.getContext('2d')
    if (!ctx) throw new Error('no ctx')
    ctx.drawImage(v, 0, 0, w, h)
    if (!bgAvailable.value) bgAvailable.value = true
  } catch {
    // 跨域画布污染等 → 降级 poster 静态模糊（3.15 降级链）
    bgFailed = true
    bgAvailable.value = false
    stopBgSampler()
  }
}
function startBgSampler(): void {
  stopBgSampler()
  // 10fps 采样（3.15 技术实现行）
  bgTimer = window.setInterval(sampleBg, 100)
}
function stopBgSampler(): void {
  if (bgTimer) window.clearInterval(bgTimer)
  bgTimer = 0
}
watch(
  () => props.fullscreen,
  f => {
    // 内嵌行走静态模糊层，仅全屏方向冲突组合需要 canvas 采样
    if (f && (matrix.value === 'M2' || matrix.value === 'M3' || matrix.value === 'MS')) startBgSampler()
    else stopBgSampler()
  }
)
watch(matrix, m => {
  if (props.fullscreen && (m === 'M2' || m === 'M3' || m === 'MS')) startBgSampler()
})

/** 背景层模式：inline=poster 静态模糊；M2/M3/MS=canvas 采样；M1/M4 无需背景（铺满）；兜底 #0a0a0a */
const bgMode = computed<'none' | 'poster' | 'canvas' | 'solid'>(() => {
  if (!props.fullscreen) return props.poster ? 'poster' : 'solid'
  if (matrix.value === 'M2' || matrix.value === 'M3' || matrix.value === 'MS') {
    if (bgAvailable.value) return 'canvas'
    return props.poster ? 'poster' : 'solid'
  }
  return 'none'
})

/* ---------------- 手势 ---------------- */
const gestures = useVideoGestures({
  getVolume: () => el.value?.volume ?? 1,
  onVolume: v => {
    if (el.value) el.value.volume = v
    emit('volume', v)
  },
  seekTo: sec => {
    if (el.value) el.value.currentTime = sec
    emit('seek', sec)
  },
  getPosition: () => el.value?.currentTime || 0,
  getDuration: () => el.value?.duration || 0,
  onToggle: () => emit('toggle'),
  onTap: () => emit('tap'),
 //长按 2.0x 快进，松手恢复
  onBoost: r => {
    if (el.value) el.value.playbackRate = r
  },
  getRate: () => el.value?.playbackRate || props.rate || 1,
  canBoost: () => !props.disableBoost,
})

/** 已缓冲比例（规格 2.6 / 6.2：进度条「已缓冲」灰层） */
const bufferedRatio = computed(() => {
  const v = el.value
  const d = duration.value
  if (!v || !d || !v.buffered.length) return 0
  return Math.min(1, v.buffered.end(v.buffered.length - 1) / d)
})

/** 续播断点圆点（6.2：>15s 才显示、直径 8px、不拦截拖动） */
const resumeRatio = computed(() => {
  if (!props.resumeAt || !duration.value || props.resumeAt <= 15) return 0
  return Math.min(1, props.resumeAt / duration.value)
})

function onTime(): void {
  const v = el.value
  if (!v) return
  position.value = v.currentTime
 // AB 段循环 ：到达 B 点回到 A 点
  if (props.abA !== null && props.abB !== null && v.currentTime >= props.abB - 0.05) {
    v.currentTime = props.abA
    position.value = props.abA
  }
  emit('time', position.value)
}

function onLoaded(): void {
  duration.value = el.value?.duration || 0
  detectDirection()
  emit('loaded', duration.value)
}

onMounted(() => {
  window.addEventListener('resize', detectDirection)
})
onBeforeUnmount(() => {
  stopBgSampler()
  window.removeEventListener('resize', detectDirection)
})

defineExpose({
  el,
  position,
  duration,
  direction: sourceDir,
  matrix,
  seek: (s: number) => {
    if (el.value) el.value.currentTime = s
  },
})
</script>

<template>
  <div
    ref="stageBox"
    class="stage"
    :class="{ gesturing: gesture, fullscreen: fullscreen, [`m-${matrix}`]: true }"
    @touchstart="gestures.onTouchStart"
    @touchmove="gestures.onTouchMove"
    @touchend="gestures.onTouchEnd"
    @dblclick.stop.prevent="emit('toggle')"
  >
 <!-- 背景层（降级链：canvas 采样 → poster 静态模糊 → #0a0a0a） -->
    <div v-if="bgMode === 'poster'" class="bg poster" :style="poster ? { backgroundImage: `url('${poster}')` } : undefined" />
    <div v-else-if="bgMode === 'solid'" class="bg solid" />
    <div v-else-if="bgMode === 'canvas'" class="bg canvas-wrap">
      <canvas ref="bgCanvas" class="bg-canvas" />
    </div>

    <video
      ref="el"
      class="video"
      :src="src"
      :poster="poster"
      :style="{ objectFit, filter: `brightness(${gestures.brightness.value})`, ...(videoExtraStyle || {}) }"
      :playback-rate="rate"
      playsinline
      @loadedmetadata="onLoaded"
      @timeupdate="onTime"
      @progress="() => undefined"
      @play="emit('playing', true)"
      @pause="emit('playing', false)"
      @ended="emit('ended')"
      @error="emit('error', '视频加载失败')"
    />

    <!-- 规格 2.6：底部进度条「已缓冲」灰层 + 续播断点圆点 -->
    <div class="buffered" :style="{ width: `${bufferedRatio * 100}%` }" />
    <div v-if="resumeRatio > 0" class="resume-dot" :style="{ left: `${resumeRatio * 100}%` }" />

    <div v-if="abA !== null" class="ab a" :style="{ left: `${abRatio(abA)}%` }" />
    <div v-if="abB !== null" class="ab b" :style="{ left: `${abRatio(abB)}%` }" />

 <!--长按 2.0x 右上角 badge -->
    <div v-if="gestures.pressing.value" class="boost-badge">{{ gestures.boostRate.value }}x</div>

    <div v-if="gestures.hint.value" class="hint">{{ gestures.hint.value }}</div>

    <slot name="overlay" />
  </div>
</template>

<style scoped>
.stage {
  position: relative;
  width: 100%;
  height: 100%;
  background: var(--video-stage-bg, var(--bg));
  overflow: hidden;
  touch-action: none;
  user-select: none;
}
/*CSS 全屏（禁 webkitEnterFullscreen，保证 object-fit 生效） */
.stage.fullscreen {
  position: fixed;
  inset: 0;
  z-index: 800;
}
/* ---- 背景层 ---- */
.bg {
  position: absolute;
  inset: 0;
  pointer-events: none;
}
/* 内嵌行 / 降级 poster：单帧 cover + blur(24px) + 遮罩 rgba(0,0,0,0.55) */
.bg.poster {
  background-color: var(--video-bg, var(--bg));
  background-size: cover;
  background-position: center;
  filter: blur(24px) brightness(0.55);
  transform: scale(1.15);
}
.bg.solid {
  background: var(--video-stage-bg, var(--bg));
}
/* canvas 采样 dynamicbg：blur(50px) brightness(0.7)、scale(1.2)、遮罩 rgba(0,0,0,0.65) */
.bg.canvas-wrap {
  background: var(--video-bg, var(--bg));
  overflow: hidden;
}
.bg-canvas {
  position: absolute;
  left: 50%;
  top: 50%;
  width: auto;
  height: auto;
  min-width: 120%;
  min-height: 120%;
  transform: translate(-50%, -50%) scale(1.2);
  filter: blur(50px) brightness(0.7);
}
.bg.canvas-wrap::after {
  content: '';
  position: absolute;
  inset: 0;
  background: var(--video-veil, rgba(0, 0, 0, 0.65));
}
.video {
  position: relative;
  width: 100%;
  height: 100%;
  display: block;
  background: transparent;
}
.buffered {
  position: absolute;
  left: 0;
  bottom: 0;
  height: 3px;
  background: rgba(255, 255, 255, 0.22);
  pointer-events: none;
  transition: width 400ms linear;
}
.resume-dot {
  position: absolute;
  bottom: -2px;
  width: 8px;
  height: 8px;
  margin-left: -4px;
  border-radius: 50%;
  background: rgba(255, 255, 255, 0.85);
  border: 1px solid rgba(0, 0, 0, 0.4);
  pointer-events: none;
}
/*长按 2.0x badge 右上角（当前倍速 ≠1.0 显示） */
.boost-badge {
  position: absolute;
  right: 12px;
  top: 12px;
  padding: 4px 10px;
  border-radius: 999px;
  background: rgba(244, 114, 182, 0.92);
  color: #0b0b10;
  font-size: 13px;
  font-weight: 700;
  pointer-events: none;
}
.ab {
  position: absolute;
  top: 0;
  width: 3px;
  height: 100%;
  pointer-events: none;
}
.ab.a {
  background: #22c55e;
}
.ab.b {
  background: #f472b6;
}
.hint {
  position: absolute;
  left: 50%;
  top: 18%;
  transform: translateX(-50%);
  padding: 8px 14px;
  border-radius: 999px;
  background: rgba(11, 11, 16, 0.78);
  backdrop-filter: blur(10px);
  color: #ececf1;
  font-size: 13px;
  pointer-events: none;
}
</style>
