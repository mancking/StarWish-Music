<script setup lang="ts">
/**
 * 桌面 / 平板播放页（规格书 1.1 ~ 1.11）
 *
 * 页面只做装配：封面与歌词在 CoverStage / LyricsPane，
 * 进度、控制、功能行在 ProgressBar / TransportBar / FunctionBar，
 * 粒子与频谱按端降级（0.3），EQ 面板在 EqPanel。
 */
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { useRouter } from 'vue-router'
import Icon from '@/components/Icon.vue'
import ParticleField from '@/components/player/ParticleField.vue'
import SpectrumBars from '@/components/player/SpectrumBars.vue'
import EqPanel from '@/components/player/EqPanel.vue'
import CoverStage from '@/player/components/CoverStage.vue'
import LyricsPane from '@/player/components/LyricsPane.vue'
import ProgressBar from '@/player/components/ProgressBar.vue'
import TransportBar from '@/player/components/TransportBar.vue'
import FunctionBar from '@/player/components/FunctionBar.vue'
import { useLyricSync } from '@/player/lyrics'
import { LOOP_ICON, STAGE_ICON, STAGE_LABEL } from '@/player/stages'
import { usePlayerStore } from '@/stores/player'
import { useLibraryStore } from '@/stores/library'
import { useUiStore } from '@/stores/ui'
import { lsGet, lsSet, particleCount, platform } from '@/platform'
import CarPlayer from '@/pages/CarPlayer.vue'

defineOptions({ name: 'Player' })

const router = useRouter()
const player = usePlayerStore()
const library = useLibraryStore()
const ui = useUiStore()

const car = computed(() => platform.value.car)
const kind = computed(() => (platform.value.kind === 'pad' ? 'pad' : 'desktop'))
const lyric = useLyricSync(
  computed(() => player.lyric),
  computed(() => player.displayPosition)
)

const queueOpen = ref(false)
const eqOpen = ref(false)
const lyricsVisible = ref(lsGet('lyrics_panel') !== '0')
const sleepOpen = ref(false)

const song = computed(() => player.song)
const cover = computed(() => player.coverUrl || '')
const liked = computed(() => (song.value ? library.isFavorite(song.value.id) : false))
const stage = computed(() => player.stage)
const stageLabel = computed(() => STAGE_LABEL[stage.value] || '封面')
const stageIcon = computed(() => STAGE_ICON[stage.value] || 'disc')
const modeIcon = computed(() => LOOP_ICON[player.state.mode] || 'repeat')

function setStage(s: 'cover' | 'lyrics' | 'particle' | 'stage'): void {
  player.setStage(s)
}

function cycleVisual(): void {
  player.cycleStage()
}

function toggleLyricsPanel(): void {
  lyricsVisible.value = !lyricsVisible.value
  lsSet('lyrics_panel', lyricsVisible.value ? '1' : '0')
}

function toggleLike(): void {
  if (song.value) void library.toggleFavorite(song.value)
}

function openSleep(): void {
  sleepOpen.value = !sleepOpen.value
}

function setSleep(minutes: number): void {
  player.setSleep(minutes)
  sleepOpen.value = false
  ui.toast(minutes ? `已设置 ${minutes} 分钟后停止播放` : '已取消定时关闭', 'info', 1800)
}

function openEq(): void {
  eqOpen.value = true
}

onMounted(() => {
  if (!player.song && player.state.queue.length) void player.playAt(0)
})

onBeforeUnmount(() => {
  queueOpen.value = false
})

watch(
  () => player.stage,
  s => {
    if (s === 'lyrics') lyricsVisible.value = true
  }
)
</script>

<template>
  <CarPlayer v-if="car" />

  <div v-else class="player" :class="kind">
    <!-- 背景（规格书 1.2：封面 blur(30px) brightness(.4) + 50% 黑遮罩） -->
    <div
      class="bg"
      :style="cover ? { backgroundImage: `url(${cover})`, filter: `blur(${platform.blur}px) brightness(.4)` } : undefined"
    />
    <div class="veil" />

    <ParticleField v-if="stage === 'particle'" :count="particleCount()" :enabled="true" />
    <SpectrumBars v-if="stage === 'stage'" placement="bottom" />

    <header class="top">
      <button class="ghost" aria-label="返回" @click="router.back()">
        <Icon name="shrink" :size="18" />
      </button>
      <div class="tmeta">
        <b>{{ song?.name || '未在播放' }}</b>
        <span>{{ song?.singer || '星河音乐' }}</span>
      </div>
      <div class="tactions">
        <button class="pill" :class="{ on: stage === 'lyrics' }" @click="cycleVisual">
          <Icon :name="stageIcon" :size="15" />
          <span>{{ stageLabel }}</span>
        </button>
        <button class="ghost" :class="{ on: lyricsVisible }" aria-label="歌词面板" @click="toggleLyricsPanel">
          <Icon name="lyric" :size="17" />
        </button>
        <button class="ghost" aria-label="播放队列" @click="queueOpen = !queueOpen">
          <Icon name="queue" :size="17" />
        </button>
        <button class="ghost" aria-label="音效" @click="openEq">
          <Icon name="sliders" :size="17" />
        </button>
        <button class="ghost" aria-label="桌面歌词" @click="ui.patch({ showDesktopLyric: !ui.settings.showDesktopLyric })">
          <Icon name="quote" :size="17" />
        </button>
      </div>
    </header>

    <main class="main" :class="{ split: lyricsVisible }">
      <section class="left">
        <CoverStage
          :kind="kind"
          :cover="cover"
          :name="song?.name || ''"
          :singer="song?.singer || ''"
          :playing="player.playing"
          :visible="stage !== 'lyrics'"
          @tap="setStage(stage === 'lyrics' ? 'cover' : 'lyrics')"
        />

        <div class="meta">
          <h1>{{ song?.name || '未在播放' }}</h1>
          <p>{{ song?.singer || '—' }}</p>
          <button class="like" :class="{ on: liked }" aria-label="收藏" @click="toggleLike">
            <Icon :name="liked ? 'heart-filled' : 'heart'" :size="17" />
          </button>
        </div>

        <ProgressBar
          class="progress"
          :position="player.displayPosition"
          :duration="player.duration"
          variant="desktop"
          accent="#a78bfa"
          @seek="player.seekTo"
        />

        <TransportBar
          class="transport"
          :playing="player.playing"
          variant="desktop"
          :mode-label="player.modeLabel"
          :mode-icon="modeIcon"
          @prev="player.prev()"
          @next="player.next()"
          @toggle="player.toggle()"
          @cycle-mode="player.cycleMode()"
          @queue="queueOpen = !queueOpen"
        />

        <FunctionBar
          class="functions"
          variant="desktop"
          :rate="player.state.rate"
          :stage-label="stageLabel"
          :stage-icon="stageIcon"
          :stage-active="stage !== 'cover'"
          :eq-active="eqOpen"
          :sleep-on="player.sleepUntil > 0"
          @eq="openEq"
          @rate="player.cycleRate()"
          @visual="cycleVisual()"
          @sleep="openSleep()"
        />
      </section>

      <aside v-if="lyricsVisible" class="right">
        <div class="lyric-head">LYRICS</div>
        <LyricsPane
          class="lyric-pane"
          :lines="lyric.lines.value"
          :active-index="lyric.activeIndex.value"
          variant="desktop"
          @seek="player.seekTo"
        />
      </aside>
    </main>

    <!-- 队列 -->
    <div v-if="queueOpen" class="mask" @click.self="queueOpen = false">
      <div class="panel">
        <header class="phead">
          <b>播放队列 · {{ player.state.queue.length }}</b>
          <div class="pacts">
            <button class="txt" @click="player.clearQueue()">清空</button>
            <button class="txt" @click="queueOpen = false">关闭</button>
          </div>
        </header>
        <div class="qlist">
          <button
            v-for="(s, i) in player.state.queue"
            :key="s.id + i"
            class="qrow"
            :class="{ on: i === player.state.index }"
            @click="player.playAt(i)"
          >
            <span class="qno">{{ i + 1 }}</span>
            <span class="qt">{{ s.name }}</span>
            <span class="qs">{{ s.singer }}</span>
          </button>
        </div>
      </div>
    </div>

    <!-- 定时关闭 -->
    <div v-if="sleepOpen" class="mask" @click.self="sleepOpen = false">
      <div class="panel small">
        <header class="phead">
          <b>定时关闭</b>
          <button class="txt" @click="sleepOpen = false">关闭</button>
        </header>
        <div class="sleep-grid">
          <button v-for="m in [15, 30, 60, 90]" :key="m" class="txt" @click="setSleep(m)">{{ m }} 分钟</button>
          <button class="txt" @click="setSleep(0)">取消定时</button>
        </div>
      </div>
    </div>

    <EqPanel v-if="eqOpen" @close="eqOpen = false" />
  </div>
</template>

<style scoped>
.player {
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
  inset: -8%;
  background: #13131b center/cover no-repeat;
  transform: scale(1.06);
  transition: opacity 300ms ease;
}
.veil {
  position: absolute;
  inset: 0;
  background: rgba(0, 0, 0, 0.5);
}
.top {
  position: relative;
  z-index: 3;
  display: flex;
  align-items: center;
  gap: 12px;
  height: 56px;
  padding: 0 20px;
}
.tmeta {
  flex: 1;
  min-width: 0;
}
.tmeta b {
  display: block;
  font-size: 13px;
  font-weight: 600;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.tmeta span {
  display: block;
  font-size: 11px;
  color: #9b9ba8;
}
.tactions {
  display: flex;
  align-items: center;
  gap: 8px;
}
.ghost {
  width: 32px;
  height: 32px;
  display: grid;
  place-items: center;
  border: 0;
  border-radius: 8px;
  background: transparent;
  color: #ececf1;
  cursor: pointer;
}
.ghost:hover,
.ghost.on {
  background: rgba(255, 255, 255, 0.1);
}
.pill {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  height: 30px;
  padding: 0 12px;
  border: 1px solid #262633;
  border-radius: 999px;
  background: rgba(255, 255, 255, 0.05);
  color: #ececf1;
  font-size: 12px;
  cursor: pointer;
}
.pill.on {
  border-color: #a78bfa;
  color: #a78bfa;
}
.main {
  position: relative;
  z-index: 2;
  flex: 1;
  min-height: 0;
  display: grid;
  grid-template-columns: minmax(0, 1fr);
  gap: 24px;
  padding: 8px 28px 24px;
}
.main.split {
  grid-template-columns: minmax(0, 1fr) 280px;
}
.left {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 14px;
  min-height: 0;
}
.meta {
  position: relative;
  text-align: center;
}
.meta h1 {
  margin: 0;
  font-size: 20px;
  font-weight: 600;
  letter-spacing: 0.2px;
}
.meta p {
  margin: 4px 0 0;
  font-size: 12px;
  color: #9b9ba8;
}
.like {
  position: absolute;
  right: -34px;
  top: 2px;
  width: 28px;
  height: 28px;
  display: grid;
  place-items: center;
  border: 0;
  border-radius: 50%;
  background: transparent;
  color: #9b9ba8;
  cursor: pointer;
}
.like.on {
  color: #f472b6;
}
.progress {
  width: min(560px, 100%);
}
.transport,
.functions {
  width: min(560px, 100%);
}
.right {
  display: flex;
  flex-direction: column;
  min-height: 0;
  border-left: 1px solid rgba(255, 255, 255, 0.06);
  padding-left: 20px;
}
.lyric-head {
  font-size: 11px;
  letter-spacing: 1.6px;
  color: #63636f;
  padding: 6px 0 10px;
}
.lyric-pane {
  flex: 1;
  min-height: 0;
}
.mask {
  position: fixed;
  inset: 0;
  z-index: 20;
  background: rgba(0, 0, 0, 0.55);
  display: flex;
  align-items: center;
  justify-content: center;
}
.panel {
  width: min(520px, 92vw);
  max-height: 72vh;
  overflow-y: auto;
  border-radius: 16px;
  background: #13131b;
  border: 1px solid #262633;
  padding: 14px 18px;
}
.panel.small {
  width: min(380px, 92vw);
}
.phead {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding-bottom: 10px;
}
.pacts {
  display: flex;
  gap: 8px;
}
.txt {
  border: 1px solid #262633;
  background: rgba(255, 255, 255, 0.04);
  color: #ececf1;
  font-size: 12px;
  padding: 6px 12px;
  border-radius: 999px;
  cursor: pointer;
}
.qlist {
  display: flex;
  flex-direction: column;
  gap: 4px;
}
.qrow {
  display: flex;
  align-items: center;
  gap: 10px;
  height: 36px;
  padding: 0 8px;
  border: 0;
  border-radius: 8px;
  background: transparent;
  color: #ececf1;
  font-size: 12px;
  text-align: left;
  cursor: pointer;
}
.qrow:hover {
  background: rgba(255, 255, 255, 0.05);
}
.qrow.on {
  color: #a78bfa;
}
.qno {
  width: 18px;
  color: #63636f;
  font-variant-numeric: tabular-nums;
}
.qt {
  flex: 1;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.qs {
  color: #9b9ba8;
  font-size: 11px;
}
.sleep-grid {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 8px;
}
@media (max-width: 1120px) {
  .main.split {
    grid-template-columns: minmax(0, 1fr);
  }
  .right {
    display: none;
  }
}
</style>
