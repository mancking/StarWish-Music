<script setup lang="ts">
/**
 * 音乐进度条（规格书 1.1 播放页 + 2.6 进度条样式参考）
 *
 * 拖拽时只更新本地预览，松手才 seek，避免每帧打 IPC。
 */
import { computed, ref } from 'vue'
import { formatTime } from '@shared/lrc'

const props = withDefaults(
  defineProps<{
    position: number
    duration: number
    variant?: 'phone' | 'pad' | 'desktop' | 'car'
    showTime?: boolean
    /** 进度条强调色：音乐紫 #A78BFA / 视频粉 #F472B6 */
    accent?: string
  }>(),
  { variant: 'phone', showTime: true, accent: '#a78bfa' }
)

const emit = defineEmits<{ (e: 'seek', sec: number): void }>()

const bar = ref<HTMLElement | null>(null)
const dragging = ref(false)
const preview = ref(0)

const dur = computed(() => Math.max(0, props.duration || 0))
const shown = computed(() => (dragging.value ? preview.value : props.position || 0))
const ratio = computed(() => (dur.value ? Math.min(1, Math.max(0, shown.value / dur.value)) : 0))

function ratioAt(clientX: number): number {
  const el = bar.value
  if (!el) return 0
  const box = el.getBoundingClientRect()
  return Math.min(1, Math.max(0, (clientX - box.left) / (box.width || 1)))
}

function onDown(e: PointerEvent): void {
  dragging.value = true
  preview.value = ratioAt(e.clientX) * dur.value
  ;(e.currentTarget as HTMLElement).setPointerCapture?.(e.pointerId)
}

function onMove(e: PointerEvent): void {
  if (!dragging.value) return
  preview.value = ratioAt(e.clientX) * dur.value
}

function onUp(e: PointerEvent): void {
  if (!dragging.value) return
  const sec = ratioAt(e.clientX) * dur.value
  dragging.value = false
  emit('seek', sec)
}
</script>

<template>
  <div class="progress" :class="`is-${variant}`">
    <div
      ref="bar"
      class="track"
      @pointerdown="onDown"
      @pointermove="onMove"
      @pointerup="onUp"
      @pointercancel="onUp"
    >
      <span class="fill" :style="{ width: `${ratio * 100}%`, background: accent }" />
      <span class="thumb" :class="{ on: dragging }" :style="{ left: `${ratio * 100}%` }" />
    </div>
    <div v-if="showTime" class="times">
      <span>{{ formatTime(shown) }}</span>
      <span>{{ formatTime(dur) }}</span>
    </div>
  </div>
</template>

<style scoped>
.progress {
  width: 100%;
}
.track {
  position: relative;
  height: 14px;
  display: flex;
  align-items: center;
  cursor: pointer;
  touch-action: none;
}
.track::before {
  content: '';
  position: absolute;
  left: 0;
  right: 0;
  height: 3px;
  border-radius: 2px;
  background: rgba(255, 255, 255, 0.18);
}
.fill {
  position: absolute;
  left: 0;
  height: 3px;
  border-radius: 2px;
  background: #a78bfa;
}
.thumb {
  position: absolute;
  width: 10px;
  height: 10px;
  margin-left: -5px;
  border-radius: 50%;
  background: #fff;
  transition: transform 140ms ease;
}
.thumb.on {
  transform: scale(1.3);
}
.times {
  display: flex;
  justify-content: space-between;
  margin-top: 4px;
  font-size: 12px;
  color: #9b9ba8;
  font-variant-numeric: tabular-nums;
}
.is-car .track {
  height: 20px;
}
.is-car .track::before,
.is-car .fill {
  height: 6px;
  border-radius: 3px;
}
.is-car .thumb {
  width: 16px;
  height: 16px;
  margin-left: -8px;
}
.is-car .times {
  font-size: 16px;
}
</style>
