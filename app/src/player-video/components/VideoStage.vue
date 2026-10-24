<script setup lang="ts">
/**
 * 视频舞台（规格书 2.1 / 2.2 / 2.3 / 2.6 / 2.8）
 *
 * 只负责「画面 + AB 标记 + 手势 + 自动隐藏计时」，控件由页面通过 overlay 插槽渲染，
 * 这样桌面/手机/车机三套控制栏可以复用同一块画面逻辑。
 */
import { computed, ref } from 'vue'
import { useVideoGestures } from '@/player-video/useVideoGestures'

const props = withDefaults(
  defineProps<{
    src: string
    poster?: string
    fit?: 'contain' | 'cover' | 'fill' | 'actual'
    abA?: number | null
    abB?: number | null
    duration?: number
    rate?: number
    /** 车机端不自动隐藏（规格书 2.1） */
    autoHide?: boolean
    /** 禁用长按加速（车机/音频模式，规格 2.7） */
    disableBoost?: boolean
  }>(),
  {
    poster: '',
    fit: 'contain',
    abA: null,
    abB: null,
    duration: 0,
    rate: 1,
    autoHide: true,
  }
)

const emit = defineEmits<{
  (e: 'loaded', duration: number): void
  (e: 'time', position: number): void
  (e: 'ended'): void
  (e: 'toggle'): void
  (e: 'tap'): void
  (e: 'seek', sec: number): void
  (e: 'volume', v: number): void
  (e: 'error', message: string): void
}>()

const el = ref<HTMLVideoElement | null>(null)
const position = ref(0)
const duration = ref(0)
const gesture = ref(false)

const objectFit = computed(() => (props.fit === 'actual' ? 'none' : props.fit))
const abRatio = (t: number | null): number =>
  t === null || !duration.value ? 0 : Math.min(100, Math.max(0, (t / duration.value) * 100))

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
  // 2.7 长按加速：松手回原倍速
  onBoost: r => {
    if (el.value) el.value.playbackRate = r
    boostRate.value = r
  },
  getRate: () => el.value?.playbackRate || props.rate || 1,
  canBoost: () => !props.disableBoost,
})

/** 长按加速显示倍数（1.5 / 恢复后回 1） */
const boostRate = ref(1)

/** 已缓冲比例（规格 2.6 / 6.2：进度条「已缓冲」灰层） */
const bufferedRatio = computed(() => {
  const v = el.value
  const d = duration.value
  if (!v || !d || !v.buffered.length) return 0
  return Math.min(1, v.buffered.end(v.buffered.length - 1) / d)
})

function onTime(): void {
  const v = el.value
  if (!v) return
  position.value = v.currentTime
  // AB 段循环（规格书 2.2）：到达 B 点回到 A 点
  if (props.abA !== null && props.abB !== null && v.currentTime >= props.abB - 0.05) {
    v.currentTime = props.abA
    position.value = props.abA
  }
  emit('time', position.value)
}

function onLoaded(): void {
  duration.value = el.value?.duration || 0
  emit('loaded', duration.value)
}

defineExpose({ el, position, duration, seek: (s: number) => { if (el.value) el.value.currentTime = s } })
</script>

<template>
  <div
    class="stage"
    :class="{ gesturing: gesture }"
    @touchstart="gestures.onTouchStart"
    @touchmove="gestures.onTouchMove"
    @touchend="gestures.onTouchEnd"
  >
    <video
      ref="el"
      class="video"
      :src="src"
      :poster="poster"
      :style="{ objectFit, filter: `brightness(${gestures.brightness.value})` }"
      :playback-rate="rate"
      playsinline
      @loadedmetadata="onLoaded"
      @timeupdate="onTime"
      @progress="() => undefined"
      @ended="emit('ended')"
      @error="emit('error', '视频加载失败')"
    />

    <!-- 规格 2.6：底部进度条「已缓冲」灰层 -->
    <div class="buffered" :style="{ width: `${bufferedRatio * 100}%` }" />

    <div v-if="abA !== null" class="ab a" :style="{ left: `${abRatio(abA)}%` }" />
    <div v-if="abB !== null" class="ab b" :style="{ left: `${abRatio(abB)}%` }" />

    <!-- 6.4：长按 2x 中央大字浮层 -->
    <div v-if="gestures.pressing.value" class="press-badge">1.5x »</div>

    <div v-if="gestures.hint.value" class="hint">{{ gestures.hint.value }}</div>

    <slot name="overlay" />
  </div>
</template>

<style scoped>
.stage {
  position: relative;
  width: 100%;
  height: 100%;
  background: #000;
  overflow: hidden;
  touch-action: none;
  user-select: none;
}
.video {
  width: 100%;
  height: 100%;
  display: block;
  background: #000;
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
.press-badge {
  position: absolute;
  left: 50%;
  top: 50%;
  transform: translate(-50%, -50%);
  padding: 14px 26px;
  border-radius: 16px;
  background: rgba(11, 11, 16, 0.72);
  backdrop-filter: blur(10px);
  color: #fff;
  font-size: 22px;
  font-weight: 700;
  pointer-events: none;
  animation: press-in 140ms ease-out;
}
@keyframes press-in {
  from {
    opacity: 0;
    transform: translate(-50%, -50%) scale(0.9);
  }
  to {
    opacity: 1;
    transform: translate(-50%, -50%) scale(1);
  }
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
