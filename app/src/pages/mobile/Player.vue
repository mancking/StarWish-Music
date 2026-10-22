<script setup lang="ts">
import { computed, ref } from 'vue'
import { useRouter } from 'vue-router'
import { findLyricIndex, formatTime } from '@shared/lrc'
import Icon from '@/components/Icon.vue'
import Cover from '@/components/Cover.vue'
import { usePlayerStore } from '@/stores/player'
import { useLibraryStore } from '@/stores/library'
import { useUiStore } from '@/stores/ui'

/**
 * 移动端全屏播放页（与桌面 Player.vue 完全独立）。
 *
 * 设计差异：
 *  - 单列沉浸布局，封面占屏 52%，不做左右分栏
 *  - 上下滑切歌、下滑收起、单击暂停（国内音乐 App 的通用肌肉记忆）
 *  - 歌词只显示当前行与前后两行，字号更大
 *  - 所有可点区域 ≥44px，底部让出安全区
 */

const router = useRouter()
const player = usePlayerStore()
const library = useLibraryStore()
const ui = useUiStore()

const song = computed(() => player.song)
const liked = computed(() => (song.value ? library.isFavorite(song.value.id) : false))
const lines = computed(() => player.lyric?.lines || [])
const offset = computed(() => (ui.settings.lyricOffset || 0) / 1000)
const activeIndex = computed(() => findLyricIndex(lines.value, player.displayPosition + offset.value))

/** 当前行与前后各一行，避免小屏歌词刷屏 */
const visibleLines = computed(() => {
  const all = lines.value
  const i = activeIndex.value
  if (i < 0) return all.slice(0, 3).map((l, idx) => ({ ...l, idx }))
  const from = Math.max(0, i - 1)
  return all.slice(from, i + 2).map((l, k) => ({ ...l, idx: from + k }))
})

const progress = computed(() => {
  const d = player.duration || 0
  if (!d) return 0
  return Math.max(0, Math.min(1, player.displayPosition / d))
})

function back(): void {
  if (window.history.length > 1) router.back()
  else router.push('/')
}

/* ---------------- 手势 ---------------- */
let startX = 0
let startY = 0
let startAt = 0
let moved = false

function onDown(e: PointerEvent): void {
  if ((e.target as HTMLElement).closest('button, input, a, .slider')) return
  startX = e.clientX
  startY = e.clientY
  startAt = Date.now()
  moved = false
}

function onMove(e: PointerEvent): void {
  if (!startAt) return
  if (Math.abs(e.clientX - startX) > 8 || Math.abs(e.clientY - startY) > 8) moved = true
}

function onUp(e: PointerEvent): void {
  if (!startAt) return
  const dx = e.clientX - startX
  const dy = e.clientY - startY
  const dt = Date.now() - startAt
  startAt = 0

  // 上滑下一首 / 下滑收起（纵向位移优先）
  if (Math.abs(dy) > 70 && Math.abs(dy) > Math.abs(dx) * 1.4) {
    if (dy < 0) void player.next()
    else back()
    return
  }
  // 左右滑切歌
  if (Math.abs(dx) > 70 && Math.abs(dx) > Math.abs(dy) * 1.4) {
    if (dx < 0) void player.next()
    else void player.prev()
    return
  }
  // 轻点暂停
  if (!moved && dt < 300) void player.toggle()
}

/* ---------------- 进度拖动 ---------------- */
const dragging = ref(false)
const dragValue = ref(0)

function seekStart(e: PointerEvent): void {
  dragging.value = true
  seekMove(e)
}
function seekMove(e: PointerEvent): void {
  if (!dragging.value) return
  const el = e.currentTarget as HTMLElement
  const r = el.getBoundingClientRect()
  const p = Math.max(0, Math.min(1, (e.clientX - r.left) / r.width))
  dragValue.value = p * (player.duration || 0)
}
function seekEnd(): void {
  if (!dragging.value) return
  dragging.value = false
  void player.seekTo(dragValue.value)
}

const shownPos = computed(() => (dragging.value ? dragValue.value : player.displayPosition))

async function toggleLike(): Promise<void> {
  if (!song.value) return
  await library.toggleFavorite(song.value)
  ui.toast(liked.value ? '已取消喜欢' : '已加入我喜欢的音乐', liked.value ? 'info' : 'success', 1400)
}
</script>

<template>
  <div class="m-player" @pointerdown="onDown" @pointermove="onMove" @pointerup="onUp">
    <!-- 背景：封面模糊 + 压暗 -->
    <div class="bg">
      <img v-if="player.coverUrl" :src="player.coverUrl" class="bg-img" alt="" />
      <div class="bg-mask" />
    </div>

    <header class="head">
      <button class="round" @click="back"><Icon name="chevron-down" :size="24" /></button>
      <div class="head-mid">
        <span>正在播放</span>
        <b>{{ song?.name || '未在播放' }}</b>
      </div>
      <button class="round" @click="player.queueOpen = true"><Icon name="queue" :size="21" /></button>
    </header>

    <div class="stage">
      <Cover :src="player.coverUrl" :size="300" radius="22" class="cover" />
    </div>

    <div class="lyric">
      <div
        v-for="l in visibleLines"
        :key="l.idx"
        class="line"
        :class="{ on: l.idx === activeIndex }"
        @click="player.seekTo(l.time)"
      >
        {{ l.text }}
      </div>
      <div v-if="!lines.length" class="line empty">
        {{ player.lyricLoading ? '正在匹配歌词…' : '暂无歌词' }}
      </div>
    </div>

    <div class="info">
      <div class="title-row">
        <div class="meta">
          <b>{{ song?.name || '未在播放' }}</b>
          <span>{{ song?.singer || '—' }}</span>
        </div>
        <button class="round sm" :class="{ liked }" @click="toggleLike">
          <Icon :name="liked ? 'heart-filled' : 'heart'" :size="20" />
        </button>
      </div>
    </div>

    <div class="bottom">
      <div
        class="seek"
        @pointerdown="seekStart"
        @pointermove="seekMove"
        @pointerup="seekEnd"
        @pointercancel="seekEnd"
      >
        <div class="seek-fill" :style="{ width: (dragging ? dragValue / (player.duration || 1) : progress) * 100 + '%' }" />
      </div>
      <div class="times">
        <span>{{ formatTime(shownPos) }}</span>
        <span>{{ formatTime(player.duration || 0) }}</span>
      </div>

      <div class="controls">
        <button class="round sm mode" @click="player.cycleMode()">{{ player.modeLabel }}</button>
        <button class="round lg" @click="player.prev()"><Icon name="prev" :size="26" /></button>
        <button class="play" @click="player.toggle()">
          <Icon :name="player.playing ? 'pause' : 'play'" :size="30" />
        </button>
        <button class="round lg" @click="player.next()"><Icon name="next" :size="26" /></button>
        <button class="round sm" @click="ui.playlistPickerSong = song"><Icon name="plus" :size="19" /></button>
      </div>
    </div>
  </div>
</template>

<style scoped>
.m-player {
  position: fixed;
  inset: 0;
  display: flex;
  flex-direction: column;
  overflow: hidden;
  color: #f4f6fb;
  background: #0a0b10;
  isolation: isolate;
  touch-action: pan-y;
  animation: mIn 0.3s var(--ease);
}
@keyframes mIn {
  from {
    transform: translateY(14px) scale(0.995);
  }
}
.bg {
  position: absolute;
  inset: 0;
  z-index: 0;
}
.bg-img {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  object-fit: cover;
  filter: blur(46px) saturate(1.5);
  transform: scale(1.25);
}
.bg-mask {
  position: absolute;
  inset: 0;
  background: linear-gradient(180deg, rgba(6, 8, 14, 0.52), rgba(6, 8, 14, 0.78));
}

.head {
  position: relative;
  z-index: 2;
  display: flex;
  align-items: center;
  gap: 10px;
  padding: calc(10px + env(safe-area-inset-top, 0px)) 14px 6px;
}
.head-mid {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 1px;
}
.head-mid span {
  font-size: 10.5px;
  letter-spacing: 0.14em;
  color: rgba(255, 255, 255, 0.55);
}
.head-mid b {
  max-width: 100%;
  font-size: 13.5px;
  font-weight: 600;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.round {
  flex: none;
  width: 44px;
  height: 44px;
  display: grid;
  place-items: center;
  border: 0;
  border-radius: 14px;
  background: rgba(255, 255, 255, 0.09);
  color: #fff;
  cursor: pointer;
  -webkit-tap-highlight-color: transparent;
}
.round:active {
  background: rgba(255, 255, 255, 0.16);
}
.round.sm {
  width: 42px;
  height: 42px;
  border-radius: 13px;
}
.round.lg {
  width: 54px;
  height: 54px;
  border-radius: 17px;
}
.round.liked {
  color: var(--accent);
}
.round.mode {
  font-size: 10px;
  line-height: 1.15;
  color: rgba(255, 255, 255, 0.72);
  text-align: center;
  padding: 0 2px;
}

.stage {
  position: relative;
  z-index: 2;
  flex: none;
  display: grid;
  place-items: center;
  padding: 14px 0 6px;
}
.cover {
  box-shadow: 0 26px 60px rgba(0, 0, 0, 0.55);
  border-radius: 22px;
}

.lyric {
  position: relative;
  z-index: 2;
  flex: 1;
  min-height: 0;
  display: flex;
  flex-direction: column;
  justify-content: center;
  gap: 8px;
  padding: 0 30px;
}
.line {
  font-size: 15px;
  line-height: 1.5;
  color: rgba(255, 255, 255, 0.5);
  text-align: center;
  transition: color 0.24s, font-size 0.24s;
}
.line.on {
  font-size: 19px;
  font-weight: 650;
  color: #fff;
}
.line.empty {
  color: rgba(255, 255, 255, 0.42);
}

.info {
  position: relative;
  z-index: 2;
  padding: 6px 22px 0;
}
.title-row {
  display: flex;
  align-items: center;
  gap: 12px;
}
.meta {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 2px;
}
.meta b {
  font-size: 19px;
  font-weight: 700;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.meta span {
  font-size: 12.5px;
  color: rgba(255, 255, 255, 0.6);
}

.bottom {
  position: relative;
  z-index: 2;
  flex: none;
  padding: 12px 22px calc(16px + env(safe-area-inset-bottom, 0px));
}
.seek {
  height: 26px;
  display: flex;
  align-items: center;
  cursor: pointer;
  touch-action: none;
}
.seek::before {
  content: '';
  position: absolute;
  left: 22px;
  right: 22px;
  height: 4px;
  border-radius: 3px;
  background: rgba(255, 255, 255, 0.18);
}
.seek-fill {
  position: relative;
  height: 4px;
  border-radius: 3px;
  background: linear-gradient(90deg, #fff, var(--accent));
  max-width: calc(100% - 44px);
}
.times {
  display: flex;
  justify-content: space-between;
  font-size: 11px;
  color: rgba(255, 255, 255, 0.55);
  margin-top: -2px;
}
.controls {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-top: 14px;
}
.play {
  width: 68px;
  height: 68px;
  display: grid;
  place-items: center;
  border: 0;
  border-radius: 50%;
  background: #fff;
  color: #14161d;
  cursor: pointer;
  box-shadow: 0 10px 26px rgba(0, 0, 0, 0.4);
}
.play:active {
  transform: scale(0.96);
}
</style>
