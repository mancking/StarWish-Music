<script setup lang="ts">
import { computed, nextTick, ref, watch } from 'vue'
import { useRouter } from 'vue-router'
import { findLyricIndex, formatTime } from '@shared/lrc'
import Icon from '@/components/Icon.vue'
import Cover from '@/components/Cover.vue'
import { usePlayerStore, type StageMode } from '@/stores/player'
import { useLibraryStore } from '@/stores/library'
import { useUiStore } from '@/stores/ui'
import { lsGet, lsSet, platform } from '@/platform'
import ParticleField from '@/components/player/ParticleField.vue'
import SpectrumBars from '@/components/player/SpectrumBars.vue'
import EqPanel from '@/components/player/EqPanel.vue'

/**
 * 移动端全屏播放页 —— 模板级重写（v2.3.4）。
 *
 * 对标市面移动播放器（网易云 / QQ 音乐 / Apple Music）的三层结构：
 *   ① 顶栏：收起 / 播放来源 / 更多
 *   ② 内容区：封面页 ⇄ 歌词页 双页签切换（歌词整页滚动、当前行高亮居中）
 *   ③ 底栏：进度条（带拖拽把手 + 双侧时间）→ 主控 → 功能图标行
 *
 * 相比旧版的实质变化：
 *   - 歌词从「只显示 3 行」改为整页滚动 + 自动跟随（行业标准）
 *   - 功能图标行补齐：收藏 / 队列 / 倍速 / 定时 / 更多
 *   - 进度条支持按住拖拽、把手可点
 *   - 页面手势（上滑切歌、下滑收起、左右切歌）保留并与页签共存
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

/**
 * 视觉模式（规格书 v2.7 · 1.4）：封面 → 歌词 → 粒子 → 舞台频谱 四态循环，
 * 状态由 player.stage 统一持久化（xinyuan_visual_mode）。
 */
const stage = computed(() => player.stage)
/** 页签：封面 / 歌词 */
const tab = ref<'cover' | 'lyric'>('cover')
/** 更多面板 */
const moreOpen = ref(false)
/** 定时关闭面板 */
const sleepOpen = ref(false)
/** 音效面板（规格书 1.11：手机为底部面板） */
const eqOpen = ref(false)

const STAGE_LABEL: Record<StageMode, string> = {
  cover: '封面',
  lyrics: '歌词',
  particle: '粒子',
  stage: '频谱',
}
const STAGE_ICON: Record<StageMode, string> = {
  cover: 'disc',
  lyrics: 'lyric',
  particle: 'sparkles',
  stage: 'sliders',
}

/** 切视觉模式：歌词模式自动落到歌词页，其余回封面页 */
function setStage(s: StageMode): void {
  player.setStage(s)
  tab.value = s === 'lyrics' ? 'lyric' : 'cover'
}

const progress = computed(() => {
  const d = player.duration || 0
  if (!d) return 0
  return Math.max(0, Math.min(1, player.displayPosition / d))
})

function back(): void {
  if (window.history.length > 1) router.back()
  else router.push('/')
}

/* ---------------- 手势（规格书 v2.7 · 1.10） ----------------
   左半屏上下滑 = 亮度；右半屏上下滑 = 音量；封面左右滑 = 切歌；
   点封面 = 切歌词视图；双击 = 播放/暂停。车机端不进入本页面。 */
let startX = 0
let startY = 0
let lastY = 0
let startAt = 0
let moved = false
let side: 'left' | 'right' = 'left'
let tapTimer = 0
let hudTimer = 0

const brightness = ref(Number(lsGet('brightness') || 1))
const hud = ref<{ kind: 'bright' | 'volume'; value: number } | null>(null)

function showHud(kind: 'bright' | 'volume', value: number): void {
  hud.value = { kind, value }
  window.clearTimeout(hudTimer)
  hudTimer = window.setTimeout(() => {
    hud.value = null
  }, 900)
}

function onDown(e: PointerEvent): void {
  if ((e.target as HTMLElement).closest('button, input, a, .seek, .lyric-scroll, .eq-sheet')) return
  startX = e.clientX
  startY = e.clientY
  lastY = e.clientY
  startAt = Date.now()
  moved = false
  side = e.clientX < window.innerWidth / 2 ? 'left' : 'right'
}

function onMove(e: PointerEvent): void {
  if (!startAt) return
  const dx = e.clientX - startX
  const dy = e.clientY - startY
  if (Math.abs(dx) > 8 || Math.abs(dy) > 8) moved = true
  if (!moved) return
  // 横向滑动留给切歌，只有纵向才调亮度/音量
  if (Math.abs(dx) > Math.abs(dy)) return
  const step = (lastY - e.clientY) / Math.max(320, window.innerHeight)
  lastY = e.clientY
  if (side === 'left') {
    const v = Math.min(1, Math.max(0.1, Math.round((brightness.value + step * 1.6) * 100) / 100))
    brightness.value = v
    lsSet('brightness', String(v))
    showHud('bright', v)
  } else {
    const v = Math.min(1, Math.max(0, Math.round((player.state.volume + step * 1.6) * 100) / 100))
    void player.setVolume(v)
    showHud('volume', v)
  }
}

function onUp(e: PointerEvent): void {
  if (!startAt) return
  const dx = e.clientX - startX
  const dy = e.clientY - startY
  const dt = Date.now() - startAt
  startAt = 0
  if (moved) {
    if (Math.abs(dx) > 70 && Math.abs(dx) > Math.abs(dy) * 1.4) {
      if (dx < 0) void player.next()
      else void player.prev()
    }
    return
  }
  if (dt >= 300) return
  // 双击播放/暂停，单击封面切歌词
  if (tapTimer) {
    window.clearTimeout(tapTimer)
    tapTimer = 0
    void player.toggle()
    return
  }
  tapTimer = window.setTimeout(() => {
    tapTimer = 0
    if (tab.value === 'cover' && lines.value.length) tab.value = 'lyric'
  }, 240)
}

/* ---------------- 进度拖动 ---------------- */
const dragging = ref(false)
const dragValue = ref(0)
const seekBar = ref<HTMLElement | null>(null)

function seekStart(e: PointerEvent): void {
  dragging.value = true
  seekMove(e)
}
function seekMove(e: PointerEvent): void {
  if (!dragging.value) return
  const el = seekBar.value
  if (!el) return
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
const shownProgress = computed(() => {
  const d = player.duration || 0
  if (!d) return 0
  return Math.max(0, Math.min(1, shownPos.value / d))
})

/* ---------------- 歌词自动跟随 ---------------- */
const lyricBox = ref<HTMLElement | null>(null)

watch(activeIndex, async () => {
  if (tab.value !== 'lyric') return
  await nextTick()
  const box = lyricBox.value
  if (!box) return
  const el = box.querySelector<HTMLElement>('.lyric-line.on')
  if (!el) return
  box.scrollTo({ top: el.offsetTop - box.clientHeight / 2 + el.clientHeight / 2, behavior: 'smooth' })
})

function seekLyric(time: number): void {
  void player.seekTo(time)
}

/* ---------------- 操作 ---------------- */
async function toggleLike(): Promise<void> {
  if (!song.value) return
  const was = liked.value
  await library.toggleFavorite(song.value)
  ui.toast(was ? '已取消喜欢' : '已加入我喜欢的音乐', was ? 'info' : 'success', 1400)
}

function openQueue(): void {
  moreOpen.value = false
  player.queueOpen = true
}

const sleepOptions = [15, 30, 60, 90]

async function pickSleep(m: number): Promise<void> {
  sleepOpen.value = false
  await player.setSleep(m)
}

function toggleSleep(): void {
  sleepOpen.value = !sleepOpen.value
  moreOpen.value = false
}
</script>

<template>
  <div class="m-player" @pointerdown="onDown" @pointermove="onMove" @pointerup="onUp">
    <!-- 背景：封面模糊 + 压暗 -->
    <div class="bg">
      <img v-if="player.coverUrl" :src="player.coverUrl" class="bg-img" alt="" />
      <div class="bg-mask" />
    </div>

    <!-- 规格书 1.10：左半屏上下滑调亮度 -->
    <div class="dim" :style="{ opacity: 1 - brightness }" />
    <div v-if="hud" class="hud">
      <Icon :name="hud.kind === 'bright' ? 'sun' : 'volume'" :size="16" />
      <span>{{ Math.round(hud.value * 100) }}%</span>
    </div>

    <!-- ① 顶栏 -->
    <header class="head">
      <button class="round" aria-label="收起" @click="back"><Icon name="chevron-down" :size="24" /></button>
      <div class="head-mid">
        <span>正在播放</span>
        <b>{{ song?.name || '未在播放' }}</b>
      </div>
      <button class="round" aria-label="更多" @click="moreOpen = !moreOpen"><Icon name="more" :size="22" /></button>
    </header>

    <!-- ② 内容区：封面 / 歌词 -->
    <div class="content">
      <!-- 封面页 / 歌词页：带方向的滑动切换，切换不再「跳一下」 -->
      <Transition :name="tab === 'lyric' ? 'pane-left' : 'pane-right'" mode="out-in">
        <!-- 封面页 -->
        <div v-if="tab === 'cover'" class="pane cover-pane" key="cover">
          <!-- 规格书 v2.7 · 1.6：手机顶部 24px 窄条频谱（16 柱） -->
          <SpectrumBars v-if="stage === 'stage'" placement="top" />
          <ParticleField v-if="stage === 'particle'" :count="80" class="pane-particles" />
          <div class="stage">
            <Cover :src="player.coverUrl" :size="200" radius="12" class="cover" />
          </div>
        </div>

        <!-- 歌词页 -->
        <div v-else class="pane lyric-pane" key="lyric">
          <div ref="lyricBox" class="lyric-scroll">
            <div v-if="!lines.length" class="lyric-empty">
              {{ player.lyricLoading ? '正在匹配歌词…' : '暂无歌词' }}
            </div>
            <div
              v-for="(l, idx) in lines"
              :key="idx"
              class="lyric-line"
              :class="{ on: idx === activeIndex }"
              @click="seekLyric(l.time)"
            >
              {{ l.text }}
            </div>
          </div>
        </div>
      </Transition>

      <!-- 歌曲信息 + 页签切换 -->
      <div class="info">
        <div class="title-row">
          <div class="meta">
            <b>{{ song?.name || '未在播放' }}</b>
            <span>{{ song?.singer || '—' }}</span>
          </div>
          <button class="round sm" :class="{ liked }" aria-label="喜欢" @click="toggleLike">
            <Icon :name="liked ? 'heart-filled' : 'heart'" :size="20" />
          </button>
        </div>
        <div class="tabs">
          <button :class="{ on: tab === 'cover' }" @click="tab = 'cover'">封面</button>
          <button :class="{ on: tab === 'lyric' }" @click="tab = 'lyric'">歌词</button>
        </div>
        <!-- 视觉模式：单按钮循环 4 态（规格书 1.4），音效入口（1.11） -->
        <div class="stage-tabs">
          <button class="cycle" @click="player.cycleStage()">
            <Icon :name="STAGE_ICON[stage]" :size="13" />
            {{ STAGE_LABEL[stage] }}
          </button>
          <button class="cycle" @click="eqOpen = true">
            <Icon name="sliders" :size="13" />
            音效
          </button>
        </div>
      </div>
    </div>

    <!-- ③ 底栏 -->
    <div class="bottom">
      <!-- 进度条 -->
      <div class="seek-wrap">
        <div
          ref="seekBar"
          class="seek"
          @pointerdown="seekStart"
          @pointermove="seekMove"
          @pointerup="seekEnd"
          @pointercancel="seekEnd"
        >
          <div class="seek-track" />
          <div class="seek-fill" :style="{ width: shownProgress * 100 + '%' }" />
          <div class="seek-knob" :style="{ left: shownProgress * 100 + '%' }" />
        </div>
        <div class="times">
          <span>{{ formatTime(shownPos) }}</span>
          <span>{{ formatTime(player.duration || 0) }}</span>
        </div>
      </div>

      <!-- 主控 -->
      <div class="controls">
        <button class="round sm mode" aria-label="播放模式" @click="player.cycleMode()">
          <Icon name="repeat" :size="17" />
          <i>{{ player.modeLabel }}</i>
        </button>
        <button class="round lg" aria-label="上一首" @click="player.prev()"><Icon name="prev" :size="26" /></button>
        <button class="play" aria-label="播放或暂停" @click="player.toggle()">
          <Icon :name="player.playing ? 'pause' : 'play'" :size="30" />
        </button>
        <button class="round lg" aria-label="下一首" @click="player.next()"><Icon name="next" :size="26" /></button>
        <button class="round sm rate" aria-label="倍速" @click="player.cycleRate()">
          <Icon name="zap" :size="17" />
          <i>{{ player.state.rate || 1 }}×</i>
        </button>
      </div>

      <!-- 功能图标行 -->
      <div class="func-row">
        <button class="func" :class="{ liked }" @click="toggleLike">
          <Icon :name="liked ? 'heart-filled' : 'heart'" :size="19" />
          <span>{{ liked ? '已喜欢' : '喜欢' }}</span>
        </button>
        <button class="func" @click="openQueue">
          <Icon name="queue" :size="19" />
          <span>队列</span>
        </button>
        <button class="func" @click="player.cycleRate()">
          <Icon name="zap" :size="19" />
          <span>倍速</span>
        </button>
        <button class="func" :class="{ on: sleepOpen || player.sleepUntil > 0 }" @click="toggleSleep">
          <Icon name="clock" :size="19" />
          <span>定时</span>
        </button>
        <button class="func" @click="moreOpen = !moreOpen">
          <Icon name="more" :size="19" />
          <span>更多</span>
        </button>
      </div>
    </div>

    <!-- 定时面板 -->
    <Transition name="fade">
      <div v-if="sleepOpen" class="panel-wrap" @click="sleepOpen = false">
        <div class="panel" @click.stop>
          <div class="panel-title">定时关闭</div>
          <div class="sleep-grid">
            <button v-for="m in sleepOptions" :key="m" class="sleep-item" @click="pickSleep(m)">{{ m }} 分钟</button>
            <button class="sleep-item" @click="pickSleep(0)">取消定时</button>
          </div>
        </div>
      </div>
    </Transition>

    <!-- 更多面板 -->
    <Transition name="fade">
      <div v-if="moreOpen" class="panel-wrap" @click="moreOpen = false">
        <div class="panel" @click.stop>
          <div class="panel-title">更多</div>
          <div class="more-list">
            <button @click="openQueue"><Icon name="queue" :size="18" />播放队列</button>
            <button @click="tab = 'lyric'"><Icon name="lyric" :size="18" />查看歌词</button>
            <button @click="toggleSleep"><Icon name="clock" :size="18" />定时关闭</button>
            <button @click="ui.playlistPickerSong = song"><Icon name="plus" :size="18" />添加到歌单</button>
            <button @click="moreOpen = false"><Icon name="close" :size="18" />取消</button>
          </div>
        </div>
      </div>
    </Transition>
    <!-- 音效面板（规格书 1.11：手机为底部面板） -->
    <Transition name="fade">
      <div v-if="eqOpen" class="panel-wrap eq-sheet" @click="eqOpen = false">
        <div class="panel" @click.stop>
          <EqPanel @close="eqOpen = false" />
        </div>
      </div>
    </Transition>
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
  /* 规格书 v2.7 · 1.2：手机背景为 180deg 渐变，不用模糊封面 */
  background: linear-gradient(180deg, #2a1f4d, #0f0d1f);
}
.bg-img {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  object-fit: cover;
  filter: blur(46px) saturate(1.5);
  transform: scale(1.25);
  opacity: 0.5;
}
.bg-mask {
  position: absolute;
  inset: 0;
  background: linear-gradient(180deg, rgba(6, 8, 14, 0.52), rgba(6, 8, 14, 0.78));
}

/* ---- 顶栏 ---- */
.head {
  position: relative;
  z-index: 3;
  display: flex;
  align-items: center;
  gap: 10px;
  padding: calc(10px + env(safe-area-inset-top, 0px)) 14px 4px;
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
.round.mode,
.round.rate {
  gap: 1px;
  font-size: 9.5px;
  line-height: 1.1;
  color: rgba(255, 255, 255, 0.72);
}
.round.mode i,
.round.rate i {
  font-style: normal;
  white-space: nowrap;
}

/* ---- 内容区 ---- */
.content {
  position: relative;
  z-index: 2;
  flex: 1;
  min-height: 0;
  display: flex;
  flex-direction: column;
}
.pane {
  flex: 1;
  min-height: 0;
  display: flex;
  flex-direction: column;
}
/* 封面 / 歌词 页切换：滑动 + 淡入，避免 v-show 的生硬跳变 */
.pane-left-enter-active,
.pane-left-leave-active,
.pane-right-enter-active,
.pane-right-leave-active {
  transition: opacity 0.2s ease, transform 0.24s cubic-bezier(0.22, 0.61, 0.36, 1);
}
.pane-left-enter-from {
  opacity: 0;
  transform: translateX(28%);
}
.pane-left-leave-to {
  opacity: 0;
  transform: translateX(-22%);
}
.pane-right-enter-from {
  opacity: 0;
  transform: translateX(-28%);
}
.pane-right-leave-to {
  opacity: 0;
  transform: translateX(22%);
}
.cover-pane {
  justify-content: center;
  align-items: center;
}
.stage {
  position: relative;
  display: grid;
  place-items: center;
  padding: 8px 0;
}
.cover {
  box-shadow: 0 26px 60px rgba(0, 0, 0, 0.55);
  /* 规格书 v2.7 · 1.2：手机为 200×200 方形封面、圆角 12、不旋转 */
  border-radius: 12px;
}
.pane-particles {
  position: absolute;
  inset: 0;
  z-index: 0;
}
/* 亮度手势遮罩（规格书 1.10） */
.dim {
  position: absolute;
  inset: 0;
  z-index: 5;
  background: #000;
  pointer-events: none;
  transition: opacity 0.12s linear;
}
.hud {
  position: absolute;
  top: 50%;
  left: 50%;
  z-index: 40;
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 10px 16px;
  border-radius: 12px;
  background: rgba(11, 11, 16, 0.82);
  color: #ececf1;
  font-size: 15px;
  transform: translate(-50%, -50%);
  pointer-events: none;
}

/* 歌词页：整页滚动 + 当前行高亮 */
.lyric-pane {
  padding: 0 26px;
}
.lyric-scroll {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  scrollbar-width: none;
  -webkit-overflow-scrolling: touch;
  padding: 40% 0;
}
.lyric-scroll::-webkit-scrollbar {
  display: none;
}
.lyric-line {
  font-size: 15px;
  line-height: 1.65;
  color: rgba(255, 255, 255, 0.46);
  text-align: center;
  padding: 7px 0;
  transition: color 0.22s, font-size 0.22s, font-weight 0.22s;
}
.lyric-line.on {
  font-size: 19px;
  font-weight: 700;
  color: #fff;
}
.lyric-empty {
  padding: 60% 0;
  text-align: center;
  font-size: 14px;
  color: rgba(255, 255, 255, 0.42);
}

/* 歌曲信息 */
.info {
  flex: none;
  padding: 4px 22px 0;
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
.tabs {
  display: flex;
  gap: 6px;
  margin-top: 10px;
}
.tabs button {
  height: 30px;
  padding: 0 14px;
  border: 0;
  border-radius: 15px;
  background: rgba(255, 255, 255, 0.08);
  color: rgba(255, 255, 255, 0.6);
  font-size: 12.5px;
  -webkit-tap-highlight-color: transparent;
}
.tabs button.on {
  background: rgba(255, 255, 255, 0.9);
  color: #14161d;
  font-weight: 700;
}

/* ---- 舞台切换（移动端） ---- */
.stage-tabs {
  display: flex;
  align-items: center;
  gap: 6px;
  margin-top: 8px;
}
.stage-tabs button {
  flex: 1;
  height: 32px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 4px;
  border: 1px solid rgba(255, 255, 255, 0.16);
  border-radius: 16px;
  background: rgba(255, 255, 255, 0.06);
  color: rgba(255, 255, 255, 0.66);
  font-size: 12px;
  -webkit-tap-highlight-color: transparent;
  transition: background 0.16s, color 0.16s, transform 0.16s;
}
.stage-tabs button:active {
  transform: scale(0.96);
}
.stage-tabs button.on {
  background: rgba(255, 255, 255, 0.92);
  color: #14161d;
  border-color: transparent;
  font-weight: 700;
}
/* 粒子舞台：封面外圈呼吸光晕 */
.stage-halo {
  position: absolute;
  inset: -14%;
  border-radius: 50%;
  pointer-events: none;
  background: radial-gradient(circle, rgba(255, 255, 255, 0.16), transparent 62%);
  filter: blur(18px);
  animation: halo-breathe 3.4s ease-in-out infinite;
}
@keyframes halo-breathe {
  0%,
  100% {
    transform: scale(0.94);
    opacity: 0.6;
  }
  50% {
    transform: scale(1.08);
    opacity: 1;
  }
}
/* DJ 舞台：律动波形 */
.wave {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 3px;
  height: 40px;
  margin-top: 14px;
}
.wave span {
  width: 3px;
  border-radius: 2px;
  background: rgba(255, 255, 255, 0.85);
  animation: wave-beat 1.05s ease-in-out infinite;
}
@keyframes wave-beat {
  0%,
  100% {
    transform: scaleY(0.35);
  }
  50% {
    transform: scaleY(1);
  }
}

/* ---- 底栏 ---- */
.bottom {
  position: relative;
  z-index: 2;
  flex: none;
  padding: 8px 22px calc(14px + env(safe-area-inset-bottom, 0px));
}
.seek-wrap {
  margin-bottom: 4px;
}
.seek {
  position: relative;
  height: 22px;
  display: flex;
  align-items: center;
  cursor: pointer;
  touch-action: none;
}
.seek-track {
  position: absolute;
  left: 0;
  right: 0;
  height: 4px;
  border-radius: 3px;
  background: rgba(255, 255, 255, 0.18);
}
.seek-fill {
  position: absolute;
  left: 0;
  height: 4px;
  border-radius: 3px;
  background: linear-gradient(90deg, #fff, var(--accent));
}
.seek-knob {
  position: absolute;
  top: 50%;
  width: 12px;
  height: 12px;
  margin-left: -6px;
  border-radius: 50%;
  background: #fff;
  transform: translateY(-50%);
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.5);
}
.times {
  display: flex;
  justify-content: space-between;
  font-size: 11px;
  color: rgba(255, 255, 255, 0.55);
  font-variant-numeric: tabular-nums;
}

.controls {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-top: 10px;
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

/* 功能图标行 */
.func-row {
  display: flex;
  align-items: center;
  justify-content: space-around;
  margin-top: 14px;
  padding-top: 10px;
  border-top: 1px solid rgba(255, 255, 255, 0.08);
}
.func {
  flex: 1;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 4px;
  border: 0;
  background: none;
  color: rgba(255, 255, 255, 0.66);
  font-size: 10.5px;
  -webkit-tap-highlight-color: transparent;
}
.func:active {
  color: #fff;
}
.func.liked,
.func.on {
  color: var(--accent);
}

/* ---- 浮层面板 ---- */
.panel-wrap {
  position: absolute;
  inset: 0;
  z-index: 30;
  display: flex;
  align-items: flex-end;
  background: rgba(0, 0, 0, 0.45);
  backdrop-filter: blur(3px);
}
.panel {
  width: 100%;
  padding: 16px 16px calc(20px + env(safe-area-inset-bottom, 0px));
  border-radius: 20px 20px 0 0;
  background: rgba(24, 26, 34, 0.96);
  border: 1px solid rgba(255, 255, 255, 0.08);
  border-bottom: 0;
}
.panel-title {
  font-size: 13px;
  color: rgba(255, 255, 255, 0.55);
  margin-bottom: 10px;
}
.sleep-grid {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 10px;
}
.sleep-item {
  height: 48px;
  border: 0;
  border-radius: 14px;
  background: rgba(255, 255, 255, 0.08);
  color: #fff;
  font-size: 14px;
  -webkit-tap-highlight-color: transparent;
}
.more-list {
  display: flex;
  flex-direction: column;
}
.more-list button {
  display: flex;
  align-items: center;
  gap: 14px;
  height: 50px;
  border: 0;
  border-radius: 12px;
  background: none;
  color: #fff;
  font-size: 15px;
  text-align: left;
  -webkit-tap-highlight-color: transparent;
}
.more-list button:active {
  background: rgba(255, 255, 255, 0.08);
}
.fade-enter-active,
.fade-leave-active {
  transition: opacity 0.18s;
}
.fade-enter-from,
.fade-leave-to {
  opacity: 0;
}
</style>
