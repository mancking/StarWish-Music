<script setup lang="ts">
/**
 * 视频控制条
 *
 * 布局：左 = 播放 / 下一个 / 时间；右 = 清晰度 → 选集 → 倍速 → 字幕 → 设置 → PiP → 全屏。
 * 进度轨：视觉 4px / 热区 14px + 已缓冲层 + 续播断点圆点。
 * 弹幕入口在控制条（弹幕开关 + 输入框），不在页面信息区（口径）。
 * 仅 B 站视频有弹幕；MV 无弹幕源时隐藏弹幕区（2.19）。
 * 3s 无操作自动隐藏（autoHide 由父级控制 visible），桌面 hover 常驻。
 */
import { computed, ref } from 'vue'
import Icon from '@/components/Icon.vue'
import Slider from '@/components/Slider.vue'

const props = withDefaults(
  defineProps<{
    playing: boolean
    position: number
    duration: number
    buffered?: number
    qualityLabel?: string
    /** 分 P 数（≥2 时选集按钮可用） */
    partsCount?: number
    rate?: number
    fullscreen?: boolean
    pipSupported?: boolean
    /** 弹幕（仅 B 站视频显示） */
    danmakuSupported?: boolean
    danmakuEnabled?: boolean
    title?: string
    author?: string
    variant?: 'phone' | 'pad' | 'desktop'
    visible?: boolean
 /** 播放器音量（视频页可调音量，实时反馈） */
    volume?: number
    muted?: boolean
  }>(),
  {
    buffered: 0,
    volume: 0.8,
    muted: false,
    qualityLabel: '自动',
    partsCount: 0,
    rate: 1,
    fullscreen: false,
    pipSupported: true,
    danmakuSupported: false,
    danmakuEnabled: false,
    title: '',
    author: '',
    variant: 'phone',
    visible: true,
  }
)

const emit = defineEmits<{
  (e: 'toggle'): void
  (e: 'prev'): void
  (e: 'next'): void
  (e: 'seek', sec: number): void
  (e: 'quality'): void
  (e: 'parts'): void
  (e: 'rate'): void
  (e: 'subtitle'): void
  (e: 'settings'): void
  (e: 'pip'): void
  (e: 'fullscreen'): void
  (e: 'danmaku', on: boolean): void
  (e: 'danmaku-send', text: string): void
  (e: 'volume', v: number): void
  (e: 'mute'): void
}>()

const dmInput = ref('')
const dmOpen = ref(false)
const volOpen = ref(false)

function fmt(t: number): string {
  const s = Math.max(0, Math.floor(t || 0))
  const h = Math.floor(s / 3600)
  const m = Math.floor((s % 3600) / 60)
  const r = s % 60
  return h > 0
    ? `${h}:${String(m).padStart(2, '0')}:${String(r).padStart(2, '0')}`
    : `${String(m).padStart(2, '0')}:${String(r).padStart(2, '0')}`
}

const pct0 = computed(() => (props.duration ? Math.min(100, Math.max(0, (props.position / props.duration) * 100)) : 0))
const bufPct = computed(() => (props.duration ? Math.min(100, (props.buffered / props.duration) * 100) : 0))

/* 拖动进度：按住预览、拖动更新、松手才 seek——流式源拖一次只发一次 seek，不卡顿 */
const dragRatio = ref<number | null>(null)
const dragTip = ref('')
const pct = computed(() => {
  const base = dragRatio.value !== null ? dragRatio.value * 100 : pct0.value
  return Math.min(100, Math.max(0, base))
})

function ratioAt(e: PointerEvent, track: HTMLElement): number {
  const rect = track.getBoundingClientRect()
  return Math.min(1, Math.max(0, (e.clientX - rect.left) / rect.width))
}

function onTrackPointer(e: PointerEvent): void {
  const track = e.currentTarget as HTMLElement
  if (!props.duration) return
  dragRatio.value = ratioAt(e, track)
  dragTip.value = fmt(dragRatio.value * props.duration)
  try {
    track.setPointerCapture(e.pointerId)
  } catch {
    /* ignore */
  }
  const move = (ev: PointerEvent) => {
    dragRatio.value = ratioAt(ev, track)
    dragTip.value = fmt(dragRatio.value * props.duration)
  }
  const up = () => {
    track.removeEventListener('pointermove', move)
    track.removeEventListener('pointerup', up)
    track.removeEventListener('pointercancel', up)
    const r = dragRatio.value
    dragRatio.value = null
    dragTip.value = ''
    if (r !== null && props.duration) emit('seek', r * props.duration)
  }
  track.addEventListener('pointermove', move)
  track.addEventListener('pointerup', up)
  track.addEventListener('pointercancel', up)
}

function sendDanmaku(): void {
  const text = dmInput.value.trim()
  if (!text) return
  emit('danmaku-send', text)
  dmInput.value = ''
  dmOpen.value = false
}
</script>

<template>
  <div class="cbar" :class="[{ hide: !visible }, `is-${variant}`, { fs: fullscreen }]">
    <!-- 顶部：标题 + UP 主（播放器内叠加） -->
    <div class="top-line">
      <div class="tinfo">
        <b>{{ title }}</b>
        <span v-if="author">{{ author }}</span>
      </div>
      <div class="top-right">
        <!-- 弹幕入口在控制条（开关 + 输入框） -->
        <template v-if="danmakuSupported">
          <button
            class="ib"
            :class="{ on: danmakuEnabled }"
            :aria-label="danmakuEnabled ? '关闭弹幕' : '开启弹幕'"
            @click="emit('danmaku', !danmakuEnabled)"
          >
            <Icon name="message" :size="16" />
          </button>
          <input
            v-if="danmakuEnabled"
            v-model="dmInput"
            class="dm-input"
            :class="{ open: dmOpen }"
            placeholder="发个弹幕见证当下"
            @focus="dmOpen = true"
            @keyup.enter="sendDanmaku"
            @keyup.esc="dmOpen = false"
          />
        </template>
      </div>
    </div>

    <div class="spacer" />

    <!-- 进度轨：视觉 4px / 热区 14px + 已缓冲层 -->
    <div class="track" :class="{ dragging: dragRatio !== null }" @pointerdown="onTrackPointer">
      <div class="rail">
        <div class="buf" :style="{ width: `${bufPct}%` }" />
        <div class="played" :style="{ width: `${pct}%` }" />
        <div class="thumb" :style="{ left: `${pct}%` }" />
      </div>
      <span v-if="dragTip" class="drag-tip" :style="{ left: `${pct}%` }">{{ dragTip }}</span>
    </div>

    <!-- 底部按钮行（B 站序）：左 播放/音量/下一个/时间；右 清晰度→选集→倍速→字幕→设置→PiP→全屏 -->
    <div class="row">
      <div class="left">
        <button class="ib main" :aria-label="playing ? '暂停' : '播放'" @click="emit('toggle')">
          <Icon :name="playing ? 'pause' : 'play'" :size="variant === 'desktop' ? 18 : 20" />
        </button>
        <div class="vol" @mouseenter="volOpen = true" @mouseleave="volOpen = false">
          <button class="ib" :aria-label="muted ? '取消静音' : '静音'" @click="emit('mute')">
            <Icon :name="muted || volume === 0 ? 'volume-mute' : volume < 0.45 ? 'volume-low' : 'volume'" :size="17" />
          </button>
          <div class="vol-slider" :class="{ open: volOpen }">
            <Slider
              :model-value="muted ? 0 : volume"
              :max="1"
              :step="0.01"
              thin
              @update:model-value="v => emit('volume', v)"
            />
          </div>
        </div>
        <button class="ib" aria-label="上一个" @click="emit('prev')">
          <Icon name="prev" :size="variant === 'desktop' ? 15 : 17" />
        </button>
        <button class="ib" aria-label="下一个" @click="emit('next')">
          <Icon name="next" :size="variant === 'desktop' ? 15 : 17" />
        </button>
        <span class="time">{{ fmt(position) }} / {{ fmt(duration) }}</span>
      </div>
      <div class="right">
        <button class="tb" @click="emit('quality')">{{ qualityLabel }}</button>
        <button v-if="partsCount >= 2" class="tb" @click="emit('parts')">选集 {{ partsCount }}</button>
        <button class="tb" @click="emit('rate')">{{ rate }}x</button>
        <button class="ib" aria-label="字幕" @click="emit('subtitle')">
          <Icon name="lyric" :size="16" />
        </button>
        <button class="ib" aria-label="设置" @click="emit('settings')">
          <Icon name="settings" :size="16" />
        </button>
        <button v-if="pipSupported" class="ib" aria-label="画中画" @click="emit('pip')">
          <Icon name="pip" :size="16" />
        </button>
        <button class="ib" :aria-label="fullscreen ? '退出全屏' : '全屏'" @click="emit('fullscreen')">
          <Icon :name="fullscreen ? 'shrink' : 'expand'" :size="16" />
        </button>
      </div>
    </div>
  </div>
</template>

<style scoped>
.cbar {
  position: absolute;
  inset: 0;
  display: flex;
  flex-direction: column;
  justify-content: flex-end;
  padding: 0 10px 6px;
  background: linear-gradient(180deg, rgba(0, 0, 0, 0.45) 0%, transparent 22%, transparent 62%, rgba(0, 0, 0, 0.78) 100%);
  transition: opacity 200ms ease;
  z-index: 5;
}
.cbar.hide {
  opacity: 0;
  pointer-events: none;
}
.spacer {
  flex: 1;
}
.top-line {
  position: absolute;
  top: 0;
  left: 0;
  right: 0;
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 10px;
}
.tinfo {
  flex: 1;
  min-width: 0;
}
.tinfo b {
  display: block;
  font-size: 13px;
  font-weight: 600;
  color: #fff;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.tinfo span {
  display: block;
  font-size: 11px;
  color: rgba(255, 255, 255, 0.66);
}
.top-right {
  display: flex;
  align-items: center;
  gap: 6px;
}
.dm-input {
  width: 0;
  padding: 0;
  border: 0;
  border-radius: 999px;
  background: rgba(255, 255, 255, 0.14);
  color: #fff;
  font-size: 12px;
  transition: width 200ms ease, padding 200ms ease;
}
.dm-input.open,
.dm-input:focus {
  width: 168px;
  padding: 6px 12px;
  outline: none;
}
.dm-input::placeholder {
  color: rgba(255, 255, 255, 0.55);
}
/* 进度轨：视觉 4px / 热区 14px */
.track {
  height: 14px;
  display: flex;
  align-items: center;
  cursor: pointer;
  touch-action: none;
  position: relative;
}
.vol {
  display: flex;
  align-items: center;
}
/* 音量条悬停面板（与 MiniBar 同形态）：浮层底板 + 固定宽滑轨，保证可见可拖 */
.vol-slider {
  width: 0;
  overflow: hidden;
  transition: width 0.2s var(--ease), margin 0.2s;
  display: flex;
  align-items: center;
}
.vol-slider.open {
  width: auto;
  margin-right: 4px;
  padding: 4px 9px;
  gap: 8px;
  background: rgba(20, 20, 30, 0.92);
  border: 1px solid rgba(255, 255, 255, 0.12);
  border-radius: 8px;
  box-shadow: 0 6px 18px -8px rgba(0, 0, 0, 0.55);
}
.vol-slider :deep(.slider) {
  width: 78px;
}
.vol-slider :deep(.slider-track) {
  height: 5px;
  background: rgba(214, 220, 236, 0.42);
  box-shadow: inset 0 0 0 1px rgba(255, 255, 255, 0.14);
}
.vol-slider :deep(.slider-thumb) {
  width: 12px;
  height: 12px;
  margin-left: -6px;
  transform: translateY(-50%) scale(1);
}
.track.dragging .rail {
  height: 6px;
}
.drag-tip {
  position: absolute;
  bottom: 18px;
  transform: translateX(-50%);
  padding: 2px 7px;
  border-radius: 6px;
  background: rgba(0, 0, 0, 0.75);
  color: #fff;
  font-size: 11px;
  white-space: nowrap;
  pointer-events: none;
}
.rail {
  position: relative;
  width: 100%;
  height: 4px;
  border-radius: 2px;
  background: rgba(255, 255, 255, 0.2);
  overflow: visible;
}
.buf {
  position: absolute;
  left: 0;
  top: 0;
  bottom: 0;
  border-radius: 2px;
  background: rgba(255, 255, 255, 0.32);
}
.played {
  position: absolute;
  left: 0;
  top: 0;
  bottom: 0;
  border-radius: 2px;
  background: #f472b6;
}
.thumb {
  position: absolute;
  top: 50%;
  width: 12px;
  height: 12px;
  margin: -6px 0 0 -6px;
  border-radius: 50%;
  background: #fff;
  box-shadow: 0 1px 4px rgba(0, 0, 0, 0.5);
}
.row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  margin-top: 2px;
}
/* 手机档紧凑化（v1.0.0 用户口径「MV 播放没有播放/暂停等按钮切换」）：
   小屏宽度下按钮过多互相挤压，主键（播放/暂停）可被挤出可视区。
   phone 档隐藏次要键（音量滑块组 / 上一个），保播放暂停 / 下一个 / 时间 /
   清晰度 / 选集 / 倍速 / 字幕 / 设置 / 全屏；音量走系统键，上一首由队列面板承担。 */
.cbar.is-phone .vol,
.cbar.is-phone .left .ib[aria-label='上一个'] {
  display: none;
}
/* 设备底栏与导航栏可能覆盖画面；仅全屏播放器使用控制条内部安全区。 */
.cbar.is-phone.fs {
  padding-bottom: max(18px, env(safe-area-inset-bottom, 0px));
}
.cbar.is-phone.fs .row {
  margin-bottom: 6px;
}
.cbar.is-phone.fs .top-line {
  padding-top: max(8px, env(safe-area-inset-top, 0px));
}
.cbar.is-phone .row {
  gap: 4px;
}
.cbar.is-phone .left,
.cbar.is-phone .right {
  gap: 2px;
}
.left,
.right {
  display: flex;
  align-items: center;
  gap: 6px;
}
.ib {
  min-width: 30px;
  height: 30px;
  padding: 0 4px;
  display: grid;
  place-items: center;
  border: 0;
  border-radius: 8px;
  background: transparent;
  color: #fff;
  cursor: pointer;
  -webkit-tap-highlight-color: transparent;
}
.ib:hover {
  background: rgba(255, 255, 255, 0.14);
}
.ib.main {
  min-width: 34px;
}
.ib.on {
  color: #f472b6;
}
.tb {
  height: 28px;
  padding: 0 8px;
  border: 0;
  border-radius: 8px;
  background: transparent;
  color: #fff;
  font-size: 12px;
  cursor: pointer;
  white-space: nowrap;
  -webkit-tap-highlight-color: transparent;
}
.tb:hover {
  background: rgba(255, 255, 255, 0.14);
}
.time {
  font-size: 11px;
  color: rgba(255, 255, 255, 0.8);
  font-variant-numeric: tabular-nums;
  white-space: nowrap;
}
.is-desktop .tb {
  font-size: 12.5px;
}
</style>
