<script setup lang="ts">
/**
 * 视频转音频模式（规格书 v2.7 · 2.12）
 *
 * 约定：本组件只负责「界面」，不持有播放状态。
 * 父页面在切到音频模式时继续用同一个 <video> 元素放声音（画面隐藏），
 * 进度、播放/暂停、切集、循环、倍速全部通过事件回传给父页面处理，
 * 因此切回视频时进度天然保持不变（同一个 media 元素，不重新加载）。
 */
import Icon from '@/components/Icon.vue'
import { computed, ref } from 'vue'

const props = defineProps<{
  title: string
  singer: string
  /** 视频首帧截图（dataURL），作为静态封面 */
  cover: string
  curTime: number
  duration: number
  playing: boolean
  loopLabel: string
  rateLabel: string
  /** 车机端：控件持续可见，不做自动隐藏 */
  car?: boolean
}>()

const emit = defineEmits<{
  (e: 'toggle'): void
  (e: 'seek', seconds: number): void
  (e: 'prev'): void
  (e: 'next'): void
  (e: 'cycle-loop'): void
  (e: 'cycle-rate'): void
  (e: 'open-eq'): void
  (e: 'exit'): void
}>()

const barEl = ref<HTMLElement | null>(null)
const dragging = ref(false)
const dragValue = ref(0)

const shownTime = computed(() => (dragging.value ? dragValue.value : props.curTime))
const progress = computed(() => {
  const d = props.duration || 0
  if (!d) return 0
  return Math.max(0, Math.min(1, shownTime.value / d))
})

function fmt(s: number): string {
  if (!Number.isFinite(s) || s < 0) return '00:00'
  const m = Math.floor(s / 60)
  const r = Math.floor(s % 60)
  return `${String(m).padStart(2, '0')}:${String(r).padStart(2, '0')}`
}

function posOf(e: PointerEvent): number {
  const el = barEl.value
  if (!el) return 0
  const r = el.getBoundingClientRect()
  const p = Math.max(0, Math.min(1, (e.clientX - r.left) / r.width))
  return p * (props.duration || 0)
}

function onDown(e: PointerEvent): void {
  dragging.value = true
  dragValue.value = posOf(e)
  ;(e.target as HTMLElement).setPointerCapture?.(e.pointerId)
}
function onMove(e: PointerEvent): void {
  if (!dragging.value) return
  dragValue.value = posOf(e)
}
function onUp(): void {
  if (!dragging.value) return
  dragging.value = false
  emit('seek', dragValue.value)
}
</script>

<template>
  <div class="amv" :class="{ car: !!car }">
    <div class="amv-head">
      <button class="amv-back" @click="emit('exit')">
        <Icon name="video" :size="16" />
        <span>视频模式</span>
      </button>
      <span class="amv-tag">听视频</span>
    </div>

    <div class="amv-body">
      <div class="amv-cover">
        <img v-if="cover" :src="cover" alt="" />
        <Icon v-else name="video" :size="34" :stroke="1.4" />
      </div>
      <div class="amv-meta">
        <b class="ellipsis">{{ title }}</b>
        <span class="ellipsis">{{ singer }}</span>
      </div>
    </div>

    <div class="amv-seek">
      <div
        ref="barEl"
        class="amv-bar"
        @pointerdown="onDown"
        @pointermove="onMove"
        @pointerup="onUp"
        @pointercancel="onUp"
      >
        <div class="amv-bar-played" :style="{ width: progress * 100 + '%' }"></div>
        <div class="amv-bar-thumb" :style="{ left: progress * 100 + '%' }"></div>
      </div>
      <div class="amv-times">
        <span>{{ fmt(shownTime) }}</span>
        <span>{{ fmt(duration) }}</span>
      </div>
    </div>

    <div class="amv-ctrl">
      <button class="amv-round" aria-label="上一集" @click="emit('prev')"><Icon name="prev" :size="22" /></button>
      <button class="amv-play" :aria-label="playing ? '暂停' : '播放'" @click="emit('toggle')">
        <Icon :name="playing ? 'pause' : 'play'" :size="26" />
      </button>
      <button class="amv-round" aria-label="下一集" @click="emit('next')"><Icon name="next" :size="22" /></button>
    </div>

    <div class="amv-func">
      <button class="amv-f" @click="emit('cycle-loop')"><Icon name="repeat" :size="16" /><span>{{ loopLabel }}</span></button>
      <button class="amv-f" @click="emit('cycle-rate')"><Icon name="zap" :size="16" /><span>{{ rateLabel }}</span></button>
      <button class="amv-f" @click="emit('open-eq')"><Icon name="sliders" :size="16" /><span>音效</span></button>
    </div>
  </div>
</template>

<style scoped>
.amv {
  position: absolute;
  inset: 0;
  z-index: 30;
  display: flex;
  flex-direction: column;
  padding: 14px 20px 22px;
  background: linear-gradient(180deg, #17131f 0%, #0b0b10 58%, #0b0b10 100%);
  color: var(--sw-text, #ececf1);
}
.amv-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
}
.amv-back {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  height: 34px;
  padding: 0 12px;
  border-radius: 17px;
  border: 1px solid var(--sw-line, #262633);
  background: rgba(255, 255, 255, 0.04);
  color: var(--sw-text-dim, #9b9ba8);
  font-size: 12.5px;
}
.amv-tag {
  font-size: 11px;
  letter-spacing: 0.08em;
  color: var(--sw-text-dim, #9b9ba8);
}
.amv-body {
  flex: 1;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 16px;
  min-height: 0;
}
.amv-cover {
  width: 208px;
  height: 208px;
  border-radius: 14px;
  overflow: hidden;
  display: grid;
  place-items: center;
  background: radial-gradient(circle at 30% 30%, #f472b6, #8b5cf6 78%);
  color: rgba(255, 255, 255, 0.9);
  box-shadow: 0 18px 44px rgba(0, 0, 0, 0.45);
}
.amv-cover img {
  width: 100%;
  height: 100%;
  object-fit: cover;
}
.amv-meta {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 5px;
  max-width: 88%;
  text-align: center;
}
.amv-meta b {
  font-size: 16px;
  font-weight: 600;
}
.amv-meta span {
  font-size: 12px;
  color: var(--sw-text-dim, #9b9ba8);
}
.ellipsis {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  max-width: 100%;
}
.amv-seek {
  padding: 4px 2px 0;
}
.amv-bar {
  position: relative;
  height: 3px;
  border-radius: 2px;
  background: rgba(255, 255, 255, 0.2);
  cursor: pointer;
  touch-action: none;
}
.amv-bar-played {
  position: absolute;
  inset: 0 auto 0 0;
  border-radius: 2px;
  background: var(--sw-video, #f472b6);
}
.amv-bar-thumb {
  position: absolute;
  top: 50%;
  width: 11px;
  height: 11px;
  margin-left: -5.5px;
  border-radius: 50%;
  background: #fff;
  transform: translateY(-50%);
}
.amv-times {
  display: flex;
  justify-content: space-between;
  margin-top: 6px;
  font-size: 11.5px;
  color: rgba(255, 255, 255, 0.75);
  font-variant-numeric: tabular-nums;
}
.amv-ctrl {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 26px;
  padding: 14px 0 10px;
}
.amv-round {
  width: 44px;
  height: 44px;
  display: grid;
  place-items: center;
  border-radius: 22px;
  background: rgba(255, 255, 255, 0.07);
  color: var(--sw-text, #ececf1);
}
.amv-play {
  width: 62px;
  height: 62px;
  display: grid;
  place-items: center;
  border-radius: 31px;
  background: var(--sw-grad, linear-gradient(135deg, #a78bfa, #f472b6));
  color: #fff;
  box-shadow: 0 10px 26px rgba(167, 139, 250, 0.35);
}
.amv-func {
  display: flex;
  justify-content: center;
  gap: 8px;
}
.amv-f {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  height: 32px;
  padding: 0 12px;
  border-radius: 16px;
  background: rgba(255, 255, 255, 0.05);
  color: var(--sw-text-dim, #9b9ba8);
  font-size: 12px;
}
.amv-f:active {
  background: rgba(255, 255, 255, 0.1);
}
/* 车机：控件加大，持续可见 */
.amv.car {
  padding: 18px 26px 26px;
}
.amv.car .amv-cover {
  width: 180px;
  height: 180px;
}
.amv.car .amv-meta b {
  font-size: 24px;
}
.amv.car .amv-meta span {
  font-size: 18px;
}
.amv.car .amv-round {
  width: 60px;
  height: 60px;
  border-radius: 30px;
}
.amv.car .amv-play {
  width: 80px;
  height: 80px;
  border-radius: 40px;
}
.amv.car .amv-f {
  height: 48px;
  padding: 0 18px;
  font-size: 16px;
  border-radius: 24px;
}
</style>
