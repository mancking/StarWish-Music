<script setup lang="ts">
/**
 * 手机 / 平板播放页（规格书 1.1 ~ 1.11）
 *
 * 这一版只做「装配」：封面、歌词、进度、主控、功能行全部来自
 * src/player/components，手势来自 src/player/usePlaybackGestures，
 * 页面本身不再重复实现这些逻辑。
 */
import { computed, ref, watch } from 'vue'
import { useRouter } from 'vue-router'
import Icon from '@/components/Icon.vue'
import ParticleField from '@/components/player/ParticleField.vue'
import SpectrumBars from '@/components/player/SpectrumBars.vue'
import EqPanel from '@/components/player/EqPanel.vue'
import CoverStage from '@/player-music/components/CoverStage.vue'
import LyricsPane from '@/player-music/components/LyricsPane.vue'
import ProgressBar from '@/player-music/components/ProgressBar.vue'
import TransportBar from '@/player-music/components/TransportBar.vue'
import FunctionBar from '@/player-music/components/FunctionBar.vue'
import { useLyricSync } from '@/player-music/lyrics'
import { usePlaybackGestures } from '@/player-music/usePlaybackGestures'
import GestureHud from '@/player-music/components/GestureHud.vue'
import { useMvHint, mvFailToast } from '@/player-music/mv-hint'
import PlayerBackground from '@/player-music/components/PlayerBackground.vue'
import { registerPopupCloser } from '@/mobile/popup-stack'
import { LOOP_ICON, STAGE_ICON, STAGE_LABEL, STAGE_ORDER } from '@/player-music/stages'
import { usePlayerStore, type StageMode } from '@/stores/player'
import { useLibraryStore } from '@/stores/library'
import { useUiStore } from '@/stores/ui'
import { lsGet, lsSet, platform, particleCount } from '@/platform'

const router = useRouter()
const player = usePlayerStore()
const library = useLibraryStore()
const ui = useUiStore()

const kind = computed(() => (platform.value.kind === 'pad' ? 'pad' : 'phone'))
const settings = computed(() => ui.settings as { particle?: boolean } | undefined)
const song = computed(() => player.song)
const liked = computed(() => (song.value ? library.isFavorite(song.value.id) : false))
const stage = computed<StageMode>(() => player.stage)
const lyricSync = useLyricSync(
  computed(() => player.lyric),
  computed(() => player.displayPosition)
)

/* ---------------- 视觉模式（规格书 1.4：四态循环） ---------------- */
const visual = computed(() => STAGE_LABEL[stage.value])
const visualIcon = computed(() => STAGE_ICON[stage.value])
const loopIcon = computed(() => LOOP_ICON[player.state.mode] || 'repeat')

function cycleVisual(): void {
  const i = STAGE_ORDER.indexOf(stage.value)
  player.setStage(STAGE_ORDER[(i + 1) % STAGE_ORDER.length]!)
}

/* ---------------- 手势（规格书 1.10 / Bug 11/19/20/41 模块化重构） ---------------- */
const gestures = usePlaybackGestures({
  getVolume: () => player.state.volume,
  onVolume: v => void player.setVolume(v),
  onToggle: () => void player.toggle(),
  onSwipeView: dir => player.setStage(dir === 'lyrics' ? 'lyrics' : 'cover'),
  onCollapse: () => {
    // Bug 11 上滑收起：开 Up Next 队列面板（返回键/下滑关闭，逐级退出由 back-handler 兜底）
    queueOpen.value = true
  },
  view: () => (stage.value === 'lyrics' ? 'lyrics' : 'cover'),
  enabled: () => platform.value.kind !== 'car',
  onTapCover: () => player.setStage('lyrics'),
})

watch(gestures.brightness, v => lsSet('brightness', String(v)))

/** 视图平移（规格书 1.10/6.9）：跟手 + 松手 200ms 回弹/翻页 */
const viewStyle = computed(() => {
  const dragging = gestures.viewShift.value !== 0
  const base = stage.value === 'lyrics' ? -100 : 0
  return {
    transform: `translateX(calc(${base}% + ${gestures.viewShift.value}px))`,
    transition: dragging ? 'none' : 'transform 200ms ease',
  }
})

/* ---------------- 弹层登记（Bug 39：返回键先关弹层） ---------------- */
registerPopupCloser(() => {
  if (eqOpen.value) {
    eqOpen.value = false
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

/* ---------------- MV 按钮（规格书 2.18） ---------------- */
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
    <!-- 背景（规格书 4.7 背景四态，Bug 21 接线） -->
    <PlayerBackground class="bg" :cover="player.coverUrl" />
    <div class="dim" />

    <header class="bar">
      <button class="icon-btn" aria-label="返回" @click="back">
        <Icon name="shrink" :size="20" />
      </button>
      <div class="mid">
        <b>{{ stage === 'lyrics' ? '歌词' : '正在播放' }}</b>
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
          <div class="view">
            <CoverStage
              :kind="kind"
              :cover="player.coverUrl"
              :name="song?.name"
              :singer="song?.singer"
              :playing="player.playing"
              @tap="player.setStage('lyrics')"
            />
            <ParticleField
              v-if="stage === 'particle'"
              :count="particleCount()"
              :enabled="settings?.particle !== false"
            />
            <SpectrumBars v-if="stage === 'stage'" placement="top" />
          </div>
          <div class="view">
            <LyricsPane
              v-if="stage === 'lyrics'"
              class="pane"
              :lines="lyricSync.lines.value"
              :active-index="lyricSync.activeIndex.value"
              variant="phone"
              @seek="seekLyric"
            />
          </div>
        </div>
        <GestureHud v-if="gestures.hudKind.value" :kind="gestures.hudKind.value" :percent="gestures.hudPercent.value" />
      </section>

      <section class="info">
        <div class="title-row">
          <div class="names">
            <b class="name">{{ song?.name || '未在播放' }}</b>
            <span class="singer">{{ song?.singer || '星河音乐' }}</span>
          </div>
          <button class="like" :class="{ on: liked }" aria-label="喜欢" @click="toggleLike">
            <Icon :name="liked ? 'heart-filled' : 'heart'" :size="20" />
          </button>
        </div>
      </section>

      <ProgressBar
        :position="player.displayPosition"
        :duration="player.duration"
        variant="phone"
        @seek="seek"
      />

      <TransportBar
        :playing="player.playing"
        variant="phone"
        :mode-label="player.modeLabel"
        :mode-icon="loopIcon"
        @prev="player.prev()"
        @next="player.next()"
        @toggle="player.toggle()"
        @cycle-mode="player.cycleMode()"
        @queue="openQueue"
      />

      <FunctionBar
        :rate="player.state.rate"
        :stage-label="visual"
        :stage-icon="visualIcon"
        :stage-active="stage !== 'cover'"
        :eq-active="eqOpen"
        :sleep-on="player.sleepUntil > 0"
        :mv-on="mvHint.has.value"
        variant="phone"
        @eq="eqOpen = true"
        @rate="player.cycleRate()"
        @visual="cycleVisual()"
        @sleep="sleepOpen = true"
        @mv="openMv"
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
        <button class="row" @click="player.setStage('lyrics'); moreOpen = false">
          <Icon name="lyric" :size="18" /> 查看歌词
        </button>
        <button class="row" @click="sleepOpen = true; moreOpen = false">
          <Icon name="clock" :size="18" /> 定时关闭
        </button>
        <button class="row" @click="eqOpen = true; moreOpen = false">
          <Icon name="sliders" :size="18" /> 音效均衡器
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
  inset: -40px;
  background-size: cover;
  background-position: center;
  filter: blur(30px) brightness(0.4);
  transform: scale(1.1);
  z-index: 0;
}
.dim {
  position: absolute;
  inset: 0;
  background: rgba(0, 0, 0, 0.5);
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
.mid {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 2px;
  min-width: 0;
}
.mid b {
  font-size: 13px;
  font-weight: 600;
}
.mid span {
  font-size: 11px;
  color: #9b9ba8;
  max-width: 60vw;
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
  padding: 0 20px calc(18px + env(safe-area-inset-bottom, 0px));
  gap: 14px;
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
.info {
  flex: none;
}
.title-row {
  display: flex;
  align-items: center;
  gap: 12px;
}
.names {
  flex: 1;
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
  margin-top: 2px;
  font-size: 12px;
  color: #9b9ba8;
}
.like {
  width: 36px;
  height: 36px;
  display: grid;
  place-items: center;
  border: 0;
  background: transparent;
  color: #9b9ba8;
  border-radius: 50%;
}
.like.on {
  color: #f472b6;
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
.grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 8px;
  padding-bottom: 6px;
}
.cell {
  height: 46px;
  border-radius: 12px;
  border: 1px solid #262633;
  background: rgba(255, 255, 255, 0.03);
  color: #ececf1;
  font-size: 14px;
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
