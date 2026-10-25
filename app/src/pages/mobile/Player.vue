<script setup lang="ts">
/**
 * 手机 / 平板播放页
 *
 * 布局（竖屏单列）：顶部标题行（「正在播放」14px + 文案 12px + 红心 #FF4D4F 右侧 40px）
 * → 唱片区（唱片直径 = 屏宽 62% 下限 240px）→ 歌名 16px 600 + 歌手 12px
 * → 进度条 → 主控 5 钮（上一首 44 / 播放 56 / 下一首 44 / 列表 / 更多）
 * → 底部四等分操作行（音效 / 倍速 / 背景 / 定时，图标 22px + 文字 11px）。
 *
 * 手势：左右滑 = 页面级双切换（左滑=封面页、右滑=歌词页）；
 * 切歌 = 唱片区垂直滑（上=下一首 / 下=上一首）；唱片外左半屏亮度 / 右半屏音量（仅封面页）；
 * 歌词页上下滑只滚歌词；双击播停；上滑收起开队列。
 *
 * 背景：settings.playerBg 四模式由 PlayerBackground 渲染
 * （封面魔法色渐变 / 歌词墙 / 粒子 / 舞台），切换入口 =「背景」按钮位（长按弹面板）+ 更多菜单。
 */
import { computed, ref, watch } from 'vue'
import { useRouter } from 'vue-router'
import Icon from '@/components/Icon.vue'
import EqPanel from '@/components/player/EqPanel.vue'
import CoverStage from '@/player-music/components/CoverStage.vue'
import LyricsPane from '@/player-music/components/LyricsPane.vue'
import ProgressBar from '@/player-music/components/ProgressBar.vue'
import TransportBar from '@/player-music/components/TransportBar.vue'
import FunctionBar from '@/player-music/components/FunctionBar.vue'
import GestureHud from '@/player-music/components/GestureHud.vue'
import PlayerBackground from '@/player-music/components/PlayerBackground.vue'
import { useLyricSync } from '@/player-music/lyrics'
import { usePlaybackGestures } from '@/player-music/usePlaybackGestures'
import { useMvHint } from '@/player-music/mv-hint'
import { BG_ICON, BG_LABEL, BG_ORDER, LOOP_ICON, type BgMode } from '@/player-music/stages'
import { registerPopupCloser } from '@/mobile/popup-stack'
import { usePlayerStore } from '@/stores/player'
import { useLibraryStore } from '@/stores/library'
import { useUiStore } from '@/stores/ui'
import { lsSet, platform } from '@/platform'

const router = useRouter()
const player = usePlayerStore()
const library = useLibraryStore()
const ui = useUiStore()

const kind = computed(() => (platform.value.kind === 'pad' ? 'pad' : 'phone'))
const settings = computed(() => ui.settings as Record<string, any>)
const song = computed(() => player.song)
const liked = computed(() => (song.value ? library.isFavorite(song.value.id) : false))
const stage = computed(() => player.stage)
const lyricSync = useLyricSync(
  computed(() => player.lyric),
  computed(() => player.displayPosition)
)

/* ---------------- 背景模式（四模式 + 长按面板） ---------------- */
const bgMode = computed<BgMode>(() => {
  const v = String(settings.value.playerBg || 'cover')
  return (BG_ORDER as string[]).includes(v) ? (v as BgMode) : 'cover'
})
const bgLabel = computed(() => BG_LABEL[bgMode.value])
const bgIcon = computed(() => BG_ICON[bgMode.value])
const bgPanelOpen = ref(false)

function cycleBg(): void {
  const order = platform.value.car ? (['cover', 'gradient'] as BgMode[]) : BG_ORDER
  const i = order.indexOf(bgMode.value)
  const next = order[(i + 1) % order.length]!
  void ui.patch({ playerBg: next })
}
function pickBg(m: BgMode): void {
  void ui.patch({ playerBg: m })
  bgPanelOpen.value = false
}
/** 视觉设置收纳（A4）：转速档位在背景面板与更多菜单内 */
function pickSpin(sec: 8 | 16 | 24): void {
  void ui.patch({ playerSpinSec: sec })
}
const spinSec = computed<8 | 16 | 24>(() => {
  const v = Number(settings.value.playerSpinSec)
  return v === 8 || v === 16 || v === 24 ? v : 16
})

const loopIcon = computed(() => LOOP_ICON[player.state.mode] || 'repeat')

/* ---------------- 手势（3.14） ---------------- */
const discEl = ref<HTMLElement | null>(null)

const gestures = usePlaybackGestures({
  getVolume: () => player.state.volume,
  onVolume: v => void player.setVolume(v),
  onToggle: () => void player.toggle(),
 // 方向：左滑=封面页、右滑=歌词页
  onSwipeView: dir => player.setStage(dir === 'lyrics' ? 'lyrics' : 'cover'),
 //唱片区垂直滑切歌
  onDiscSwipe: up => (up ? player.next() : player.prev()),
  inDiscArea: (x, y) => {
    const el = discEl.value
    if (!el) return false
    const r = el.getBoundingClientRect()
    return x >= r.left && x <= r.right && y >= r.top && y <= r.bottom
  },
  onCollapse: () => {
 // 上滑收起：开 Up Next 队列面板（返回键/下滑关闭，逐级退出由 back-handler 兜底）
    queueOpen.value = true
  },
  view: () => (stage.value === 'lyrics' ? 'lyrics' : 'cover'),
  enabled: () => platform.value.kind !== 'car',
  onTapCover: () => player.setStage('lyrics'),
})

watch(gestures.brightness, v => lsSet('brightness', String(v)))

/** 视图平移（歌词页在封面页左侧，右滑进歌词）：跟手 + 松手 200ms 回弹/翻页 */
const viewStyle = computed(() => {
  const dragging = gestures.viewShift.value !== 0
  // DOM 顺序 [lyrics, cover]：封面页基准 -100%，歌词页基准 0
  const base = stage.value === 'cover' ? -100 : 0
  return {
    transform: `translateX(calc(${base}% + ${gestures.viewShift.value}px))`,
    transition: dragging ? 'none' : 'transform 200ms ease',
  }
})

/* ---------------- 弹层登记（返回键先关弹层） ---------------- */
registerPopupCloser(() => {
  if (eqOpen.value) {
    eqOpen.value = false
    return true
  }
  if (bgPanelOpen.value) {
    bgPanelOpen.value = false
    return true
  }
  if (moreOpen.value) {
    moreOpen.value = false
    return true
  }
  if (sleepOpen.value) {
    sleepOpen.value = false
    return true
  }
  return false
})

/* ---------------- 面板 ---------------- */
const moreOpen = ref(false)
const sleepOpen = ref(false)
const queueOpen = ref(false)
const eqOpen = ref(false)
const sleepOptions = [15, 30, 60, 90]
const queue = computed(() => player.state.queue || [])

function openQueue(): void {
  moreOpen.value = false
  queueOpen.value = true
}

function pickSleep(min: number): void {
  player.setSleep(min)
  sleepOpen.value = false
  ui.toast(min ? `${min} 分钟后停止播放` : '已取消定时关闭', 'info', 1600)
}

function seekLyric(time: number): void {
  void player.seekTo(time)
}

function seek(sec: number): void {
  void player.seekTo(sec)
}

async function toggleLike(): Promise<void> {
  if (!song.value) return
  const was = liked.value
  await library.toggleFavorite(song.value)
  ui.toast(was ? '已取消喜欢' : '已加入我喜欢的音乐', was ? 'info' : 'success', 1400)
}

function back(): void {
  router.back()
}

/* ---------------- MV 按钮 ---------------- */
const mvHint = useMvHint()
watch(song, s => void mvHint.refresh(s), { immediate: true })

function openMv(): void {
  const item = mvHint.list.value[0]
  if (!item) return
  if (mvHint.cooling()) return
  // 音乐音频流与 MV 视频流独立：跳转 MV 播放页，返回后歌曲进度保持
  router.push(`/mv/${item.source || 'bili'}/${item.sourceId || item.bvid || ''}`)
}
</script>

<template>
  <div
    class="mp"
    :class="`is-${kind}`"
    :style="{ filter: `brightness(${gestures.brightness.value})` }"
  >
 <!-- 背景（四模式：封面魔法色渐变 / 歌词墙 / 粒子 / 舞台） -->
    <PlayerBackground
      class="bg"
      :cover="player.coverUrl"
      :lines="lyricSync.lines.value"
      :active-index="lyricSync.activeIndex.value"
    />

    <header class="bar">
      <button class="icon-btn" aria-label="返回" @click="back">
        <Icon name="shrink" :size="20" />
      </button>
      <div class="mid">
        <b>正在播放</b>
        <span>{{ song?.album || song?.singer || '星河音乐' }}</span>
      </div>
      <button class="icon-btn" aria-label="更多" @click="moreOpen = true">
        <Icon name="more" :size="20" />
      </button>
    </header>

    <main class="body">
      <section
        class="stage-area"
        @touchstart="gestures.onTouchStart"
        @touchmove="gestures.onTouchMove"
        @touchend="gestures.onTouchEnd"
      >
        <div class="views" :style="viewStyle">
 <!--歌词页在封面页左侧（右滑进歌词、左滑回封面） -->
          <div class="view">
            <LyricsPane
              v-if="stage === 'lyrics'"
              class="pane"
              :lines="lyricSync.lines.value"
              :active-index="lyricSync.activeIndex.value"
              :position="player.displayPosition"
              variant="phone"
              @seek="seekLyric"
            />
          </div>
          <div class="view">
            <div v-if="stage === 'cover'" ref="discEl" class="disc-wrap">
              <CoverStage
                :kind="kind"
                :cover="player.coverUrl"
                :name="song?.name"
                :singer="song?.singer"
                :playing="player.playing"
                @tap="player.setStage('lyrics')"
              />
            </div>
          </div>
        </div>
        <GestureHud v-if="gestures.hudKind.value" :kind="gestures.hudKind.value" :percent="gestures.hudPercent.value" />
      </section>

      <section class="info">
        <div class="names">
          <b class="name">{{ song?.name || '未在播放' }}</b>
          <span class="singer">{{ song?.singer || '星河音乐' }}</span>
        </div>
      </section>

      <!-- 进度条上方：喜欢、功能行（音效 / 倍速 / 封面切换 / 定时）、更多 -->
      <section class="above-progress">
        <button class="t-like" :class="{ on: liked }" aria-label="喜欢" @click="toggleLike">
          <Icon :name="liked ? 'heart-filled' : 'heart'" :size="20" />
        </button>

        <FunctionBar
          class="func-row"
          :rate="player.state.rate"
          :bg-label="bgLabel"
          :bg-icon="bgIcon"
          :bg-active="bgMode !== 'cover'"
          :eq-active="eqOpen"
          :sleep-on="player.sleepUntil > 0"
          :mv-on="mvHint.has.value"
          variant="phone"
          @eq="eqOpen = true"
          @rate="player.cycleRate()"
          @bg="cycleBg()"
          @bg-panel="bgPanelOpen = true"
          @sleep="sleepOpen = true"
          @mv="openMv"
        />

        <button class="t-more" aria-label="更多" @click="moreOpen = true">
          <Icon name="more" :size="20" />
        </button>
      </section>

      <ProgressBar
        :position="player.displayPosition"
        :duration="player.duration"
        variant="phone"
        @seek="seek"
      />

      <!-- 底部主控：播放模式 / 上一首 / 播放暂停 / 下一首 / 播放列表 -->
      <TransportBar
        :playing="player.playing"
        variant="phone"
        :mode-label="player.modeLabel"
        :mode-icon="loopIcon"
        :show-more="false"
        @prev="player.prev()"
        @next="player.next()"
        @toggle="player.toggle()"
        @cycle-mode="player.cycleMode()"
        @queue="openQueue"
      />
    </main>

    <!-- 播放队列 -->
    <div v-if="queueOpen" class="sheet-mask" @click.self="queueOpen = false">
      <div class="sheet">
        <div class="grip" />
        <header class="sheet-head">
          <b>播放队列 · {{ queue.length }}</b>
          <button class="done" @click="queueOpen = false">完成</button>
        </header>
        <div class="queue">
          <button
            v-for="(s, i) in queue"
            :key="s.id + i"
            class="q-row"
            :class="{ on: s.id === song?.id }"
            @click="player.playAt(i)"
          >
            <span class="q-index">{{ i + 1 }}</span>
            <span class="q-name">{{ s.name }}</span>
            <span class="q-singer">{{ s.singer }}</span>
          </button>
        </div>
      </div>
    </div>

    <!-- 定时关闭 -->
    <div v-if="sleepOpen" class="sheet-mask" @click.self="sleepOpen = false">
      <div class="sheet">
        <div class="grip" />
        <header class="sheet-head">
          <b>定时关闭</b>
          <button class="done" @click="sleepOpen = false">取消</button>
        </header>
        <div class="grid">
          <button v-for="m in sleepOptions" :key="m" class="cell" @click="pickSleep(m)">
            {{ m }} 分钟
          </button>
          <button class="cell" @click="pickSleep(0)">关闭定时</button>
        </div>
      </div>
    </div>

    <!-- 背景模式面板（3.14 切换入口：「背景」按钮长按） -->
    <div v-if="bgPanelOpen" class="sheet-mask" @click.self="bgPanelOpen = false">
      <div class="sheet">
        <div class="grip" />
        <header class="sheet-head">
          <b>播放页背景</b>
          <button class="done" @click="bgPanelOpen = false">关闭</button>
        </header>
        <div class="bg-grid">
          <button
            v-for="m in BG_ORDER"
            :key="m"
            class="cell"
            :class="{ on: bgMode === m }"
            @click="pickBg(m)"
          >
            {{ BG_LABEL[m] }}
          </button>
        </div>
        <p class="panel-sub">唱片转速（QQ 口径 24 / 16 / 8 秒一圈）</p>
        <div class="bg-grid">
          <button class="cell" :class="{ on: spinSec === 24 }" @click="pickSpin(24)">24s</button>
          <button class="cell" :class="{ on: spinSec === 16 }" @click="pickSpin(16)">16s</button>
          <button class="cell" :class="{ on: spinSec === 8 }" @click="pickSpin(8)">8s</button>
        </div>
      </div>
    </div>

    <!-- 更多 -->
    <div v-if="moreOpen" class="sheet-mask" @click.self="moreOpen = false">
      <div class="sheet">
        <div class="grip" />
        <header class="sheet-head">
          <b>更多</b>
          <button class="done" @click="moreOpen = false">取消</button>
        </header>
        <button class="row" @click="openQueue">
          <Icon name="queue" :size="18" /> 播放队列
        </button>
        <button class="row" @click="player.setStage(stage === 'lyrics' ? 'cover' : 'lyrics'); moreOpen = false">
          <Icon name="lyric" :size="18" /> {{ stage === 'lyrics' ? '返回封面' : '查看歌词' }}
        </button>
        <button class="row" @click="sleepOpen = true; moreOpen = false">
          <Icon name="clock" :size="18" /> 定时关闭
        </button>
        <button class="row" @click="eqOpen = true; moreOpen = false">
          <Icon name="sliders" :size="18" /> 音效均衡器
        </button>
        <button class="row" @click="bgPanelOpen = true; moreOpen = false">
          <Icon :name="bgIcon" :size="18" /> 背景与转速
        </button>
      </div>
    </div>

    <EqPanel v-if="eqOpen" @close="eqOpen = false" />
  </div>
</template>

<style scoped>
.mp {
  position: fixed;
  inset: 0;
  display: flex;
  flex-direction: column;
  background: #0b0b10;
  color: #ececf1;
  overflow: hidden;
}
.bg {
  position: absolute;
  inset: 0;
  z-index: 0;
}
.bar {
  position: relative;
  z-index: 2;
  height: 48px;
  flex: none;
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 0 8px;
  padding-top: env(safe-area-inset-top, 0px);
}
.icon-btn {
  width: 40px;
  height: 40px;
  display: grid;
  place-items: center;
  border: 0;
  background: transparent;
  color: #ececf1;
  border-radius: 50%;
}
.icon-btn.like.on {
  /* 3.14：红心收藏色 = QQ 红 #FF4D4F（区别于音乐主色紫） */
  color: #ff4d4f;
}
.mid {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 2px;
  min-width: 0;
}
.mid b {
  font-size: 14px;
  font-weight: 600;
}
.mid span {
  font-size: 12px;
  color: #9b9ba8;
  max-width: 56vw;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.body {
  position: relative;
  z-index: 2;
  flex: 1;
  min-height: 0;
  display: flex;
  flex-direction: column;
  padding: 0 20px calc(14px + env(safe-area-inset-bottom, 0px));
  gap: 8px;
}
.stage-area {
  position: relative;
  flex: 1;
  min-height: 0;
  display: flex;
  align-items: center;
  justify-content: center;
}
.pane {
  width: 100%;
  height: 100%;
}
.views {
  display: flex;
  width: 100%;
  height: 100%;
  will-change: transform;
}
.view {
  flex: none;
  width: 100%;
  height: 100%;
  display: flex;
  align-items: center;
  justify-content: center;
  min-width: 0;
}
.disc-wrap {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 100%;
  height: 100%;
}
.info {
  flex: none;
}
/* 进度条上方工具行：喜欢（左）/ 功能行（中）/ 更多（右） */
.above-progress {
  flex: none;
  display: flex;
  align-items: center;
  gap: 4px;
}
.above-progress .func-row {
  flex: 1;
  min-width: 0;
}
.t-like,
.t-more {
  flex: none;
  width: 36px;
  height: 36px;
  display: grid;
  place-items: center;
  border: 0;
  border-radius: 50%;
  background: transparent;
  color: #9b9ba8;
  -webkit-tap-highlight-color: transparent;
  touch-action: manipulation;
}
.t-like:active,
.t-more:active {
  background: rgba(255, 255, 255, 0.08);
}
.t-like.on {
  color: #ff4d4f;
}
.names {
  display: flex;
  flex-direction: column;
  gap: 2px;
  min-width: 0;
}
.name {
  display: block;
  font-size: 16px;
  font-weight: 600;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.singer {
  display: block;
  font-size: 12px;
  color: #9b9ba8;
}
.sheet-mask {
  position: fixed;
  inset: 0;
  z-index: 50;
  background: rgba(0, 0, 0, 0.55);
  display: flex;
  align-items: flex-end;
}
.sheet {
  width: 100%;
  max-height: 62vh;
  overflow-y: auto;
  padding: 8px 16px calc(16px + env(safe-area-inset-bottom, 0px));
  border-radius: 18px 18px 0 0;
  background: #13131b;
  border: 1px solid #262633;
}
.grip {
  width: 36px;
  height: 4px;
  margin: 4px auto 8px;
  border-radius: 2px;
  background: rgba(255, 255, 255, 0.16);
}
.sheet-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 2px 0 10px;
}
.sheet-head b {
  font-size: 15px;
}
.done {
  border: 0;
  background: transparent;
  color: #a78bfa;
  font-size: 14px;
}
.panel-sub {
  margin: 12px 0 8px;
  font-size: 12px;
  color: #9b9ba8;
}
.queue {
  display: flex;
  flex-direction: column;
}
.q-row {
  display: flex;
  align-items: center;
  gap: 10px;
  height: 44px;
  padding: 0 4px;
  border: 0;
  background: transparent;
  color: #ececf1;
  text-align: left;
  border-bottom: 1px solid rgba(38, 38, 51, 0.6);
}
.q-row.on {
  color: #a78bfa;
}
.q-index {
  width: 20px;
  font-size: 12px;
  color: #63636f;
}
.q-name {
  flex: 1;
  min-width: 0;
  font-size: 14px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.q-singer {
  font-size: 12px;
  color: #9b9ba8;
  max-width: 32%;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.grid,
.bg-grid {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 8px;
  padding-bottom: 6px;
}
.grid {
  grid-template-columns: repeat(2, minmax(0, 1fr));
}
.cell {
  height: 46px;
  border-radius: 12px;
  border: 1px solid #262633;
  background: rgba(255, 255, 255, 0.03);
  color: #ececf1;
  font-size: 14px;
}
.cell.on {
  border-color: #a78bfa;
  color: #a78bfa;
  background: rgba(167, 139, 250, 0.12);
}
.row {
  display: flex;
  align-items: center;
  gap: 10px;
  width: 100%;
  height: 48px;
  border: 0;
  background: transparent;
  color: #ececf1;
  font-size: 14px;
  border-bottom: 1px solid rgba(38, 38, 51, 0.6);
}
</style>
