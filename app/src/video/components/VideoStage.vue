<script setup lang="ts">
/**
 * 视频舞台（规格书 2.1 / 2.2 / 2.3 / 2.6 / 2.8）
 *
 * 只负责「画面 + AB 标记 + 手势 + 自动隐藏计时」，控件由页面通过 overlay 插槽渲染，
 * 这样桌面/手机/车机三套控制栏可以复用同一块画面逻辑。
 */
import { computed, ref } from 'vue'
import { useVideoGestures } from '@/video/useVideoGestures'

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
      @ended="emit('ended')"
      @error="emit('error', '视频加载失败')"
    />

    <div v-if="abA !== null" class="ab a" :style="{ left: `${abRatio(abA)}%` }" />
    <div v-if="abB !== null" class="ab b" :style="{ left: `${abRatio(abB)}%` }" />

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
