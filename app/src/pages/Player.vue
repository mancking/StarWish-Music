<script setup lang="ts">
/**
 * 桌面 / 平板播放页：唱片区与歌词区各占一半，左侧实时频谱位于进度条上方。
 * 底部固定播放条 60px（全局 MiniBar，App.vue）；MINI 模式由 win:mini IPC 管理。
 *
 * 背景：settings.playerBg 四模式（封面魔法色渐变 / 歌词墙 / 粒子 / 舞台）
 * 由 PlayerBackground 渲染；切换入口 = 顶栏「背景」按钮 + 更多菜单。
 * 红心收藏色 #FF4D4F（QQ 红，区别于音乐主色紫）。
 */
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { useRouter } from 'vue-router'
import Icon from '@/components/Icon.vue'
import EqPanel from '@/components/player/EqPanel.vue'
import CoverStage from '@/player-music/components/CoverStage.vue'
import LyricsPane from '@/player-music/components/LyricsPane.vue'
import ProgressBar from '@/player-music/components/ProgressBar.vue'
import TransportBar from '@/player-music/components/TransportBar.vue'
import FunctionBar from '@/player-music/components/FunctionBar.vue'
import PlayerBackground from '@/player-music/components/PlayerBackground.vue'
import { useMvHint } from '@/player-music/mv-hint'
import { useLyricSync } from '@/player-music/lyrics'
import { BG_ICON, BG_LABEL, BG_ORDER, LOOP_ICON, type BgMode } from '@/player-music/stages'
import { usePlayerStore } from '@/stores/player'
import { useLibraryStore } from '@/stores/library'
import { useUiStore } from '@/stores/ui'
import { lsGet, lsSet, platform } from '@/platform'
import { call } from '@/api'
import CarPlayer from '@/pages/CarPlayer.vue'

defineOptions({ name: 'Player' })

const router = useRouter()
const player = usePlayerStore()
const library = useLibraryStore()
const ui = useUiStore()
const settings = computed(() => ui.settings as Record<string, any>)

const car = computed(() => platform.value.car)
const kind = computed(() => (platform.value.kind === 'pad' ? 'pad' : 'desktop'))
const lyric = useLyricSync(
  computed(() => player.lyric),
  computed(() => player.displayPosition)
)
const spectrumBars = Array.from({ length: 36 }, (_, index) => ({
  delay: `${(index % 9) * 0.07}s`,
  height: `${18 + ((index * 17 + index * index * 3) % 72)}%`,
}))

const queueOpen = ref(false)
const eqOpen = ref(false)
const lyricsVisible = ref(lsGet('lyrics_panel') !== '0')
const sleepOpen = ref(false)
const bgPanelOpen = ref(false)

const song = computed(() => player.song)
/* 规格 2.18：播放页 MV 按钮（mvBySong 命中才显示，5 分钟缓存 + 30s 失败防抖） */
const mvHint = useMvHint()
watch(song, s => void mvHint.refresh(s), { immediate: true })
function openMv(): void {
  const item = mvHint.list.value[0]
  if (!item || mvHint.cooling()) return
  router.push(`/mv/${item.source || 'bili'}/${item.sourceId || item.bvid || ''}`)
}
const cover = computed(() => player.coverUrl || '')
const liked = computed(() => (song.value ? library.isFavorite(song.value.id) : false))
const modeIcon = computed(() => LOOP_ICON[player.state.mode] || 'repeat')

/* ---------------- 背景模式（四模式） ---------------- */
const bgMode = computed<BgMode>(() => {
  const v = String(settings.value.playerBg || 'cover')
  return (BG_ORDER as string[]).includes(v) ? (v as BgMode) : 'cover'
})
const bgLabel = computed(() => BG_LABEL[bgMode.value])
const bgIcon = computed(() => BG_ICON[bgMode.value])

function cycleBg(): void {
  const i = BG_ORDER.indexOf(bgMode.value)
  void ui.patch({ playerBg: BG_ORDER[(i + 1) % BG_ORDER.length]! })
}
function pickBg(m: BgMode): void {
  void ui.patch({ playerBg: m })
  bgPanelOpen.value = false
}
const spinSec = computed<8 | 16 | 24>(() => {
  const v = Number(settings.value.playerSpinSec)
  return v === 8 || v === 16 || v === 24 ? v : 16
})
function pickSpin(sec: 8 | 16 | 24): void {
  void ui.patch({ playerSpinSec: sec })
}

function toggleLyricsPanel(): void {
  lyricsVisible.value = !lyricsVisible.value
  lsSet('lyrics_panel', lyricsVisible.value ? '1' : '0')
}

function toggleLike(): void {
  if (song.value) void library.toggleFavorite(song.value)
}
function goMore(): void {
  router.push('/discover')
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

/**MINI 模式独立悬浮窗（贴边 5s 缩边条 / hover 呼出） */
function openMini(): void {
  void call('win:mini').catch(() => ui.toast('迷你模式启动失败', 'error', 1800))
}

onMounted(() => {
  if (!player.song && player.state.queue.length) void player.playAt(0)
})

onBeforeUnmount(() => {
  queueOpen.value = false
})
</script>

<template>
  <CarPlayer v-if="car" />

  <div v-else class="player" :class="kind">
 <!-- 背景（四模式：封面魔法色渐变 / 歌词墙 / 粒子 / 舞台，三端复用组件） -->
    <PlayerBackground
      class="bg"
      :cover="cover"
      :lines="lyric.lines.value"
      :active-index="lyric.activeIndex.value"
    />

    <header class="top">
      <button class="ghost" aria-label="返回" @click="router.back()">
        <Icon name="shrink" :size="18" />
      </button>
      <div class="tmeta">
        <b>{{ song?.name || '未在播放' }}</b>
        <span>{{ song?.singer || '星河音乐' }}</span>
      </div>
      <div class="tactions">
        <button class="pill" :title="`背景：${bgLabel}（点击切换）`" @click="cycleBg">
          <Icon :name="bgIcon" :size="15" />
          <span>{{ bgLabel }}</span>
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
        <button class="ghost" aria-label="更多" title="更多" @click="goMore">
          <Icon name="more" :size="17" />
        </button>
 <!--MINI 模式（贴边自动缩边条 / hover 呼出） -->
        <button class="ghost" aria-label="迷你模式" title="迷你模式（贴边自动收窄）" @click="openMini">
          <Icon name="minus" :size="16" />
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
        />
        <!-- 进度条上方：实时频谱 + 功能行（音效 / 倍速 / 背景切换 / 定时） -->
        <div v-if="lyricsVisible" class="spectrum" :class="{ playing: player.playing }" aria-label="实时频谱" role="img">
          <span v-for="(bar, index) in spectrumBars" :key="index" :style="{ height: bar.height, animationDelay: bar.delay }" />
        </div>

        <div class="meta">
          <h1>{{ song?.name || '未在播放' }}</h1>
          <p>{{ song?.singer || '—' }}</p>
        </div>

        <FunctionBar
          class="functions"
          variant="desktop"
          :rate="player.state.rate"
          :bg-label="bgLabel"
          :bg-icon="bgIcon"
          :bg-active="bgMode !== 'cover'"
          :eq-active="eqOpen"
          :sleep-on="player.sleepUntil > 0"
          :mv-on="mvHint.has.value"
          @eq="openEq"
          @rate="player.cycleRate()"
          @bg="cycleBg()"
          @bg-panel="bgPanelOpen = true"
          @sleep="openSleep()"
          @mv="openMv"
        />

        <ProgressBar
          class="progress"
          :position="player.displayPosition"
          :duration="player.duration"
          variant="desktop"
          accent="#a78bfa"
          @seek="player.seekTo"
        />

        <!-- 底部主控：播放模式 / 上一首 / 播放暂停 / 下一首 / 播放队列 -->
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
        >
          <template #prepend>
            <button class="like transport-like" :class="{ on: liked }" aria-label="收藏" @click.stop="toggleLike">
              <Icon :name="liked ? 'heart-filled' : 'heart'" :size="18" />
            </button>
          </template>
        </TransportBar>
      </section>

      <!-- 唱片与歌词两栏各占一半；实时频谱显示在左栏进度条上方。 -->
      <aside v-if="lyricsVisible" class="right" aria-label="歌词">
        <div class="lyric-head">LYRICS</div>
        <LyricsPane
          class="lyric-pane"
          :lines="lyric.lines.value"
          :active-index="lyric.activeIndex.value"
          :position="player.displayPosition"
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

    <!-- 背景模式面板（3.14 切换入口：「背景」按钮长按） -->
    <div v-if="bgPanelOpen" class="mask" @click.self="bgPanelOpen = false">
      <div class="panel small">
        <header class="phead">
          <b>播放页背景</b>
          <button class="txt" @click="bgPanelOpen = false">关闭</button>
        </header>
        <div class="sleep-grid">
          <button
            v-for="m in BG_ORDER"
            :key="m"
            class="txt"
            :class="{ on: bgMode === m }"
            @click="pickBg(m)"
          >
            {{ BG_LABEL[m] }}
          </button>
        </div>
        <p class="panel-sub">唱片转速（QQ 口径 24 / 16 / 8 秒一圈）</p>
        <div class="sleep-grid">
          <button class="txt" :class="{ on: spinSec === 24 }" @click="pickSpin(24)">24s</button>
          <button class="txt" :class="{ on: spinSec === 16 }" @click="pickSpin(16)">16s</button>
          <button class="txt" :class="{ on: spinSec === 8 }" @click="pickSpin(8)">8s</button>
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
  inset: 0;
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
/* 唱片与歌词各占一半；实时频谱在进度条上方。 */
.main.split {
  grid-template-columns: minmax(0, 1fr) minmax(0, 1fr);
  gap: 24px;
}
.left {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: flex-end;
  gap: 16px;
  min-height: 0;
  padding-bottom: clamp(18px, 4vh, 48px);
}
.left > .progress,
.left > .transport,
.left > .functions {
  width: min(720px, 100%);
}
.left > .transport { transform: scale(1.12); margin: 4px 0; }
.left > .functions { transform: scale(1.06); margin: 2px 0; }
.transport-like {
  position: static;
  flex: none;
}
.left > .transport :deep(.btn) { flex: none; }
.left > .transport :deep(.btn.main) { width: 58px; height: 58px; }
.left > .transport :deep(.btn:not(.main)) { width: 48px; height: 48px; }
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
/* 3.14：红心收藏色 = QQ 红 #FF4D4F */
.like.on {
  color: #ff4d4f;
}
.like.transport-like {
  position: static;
  width: 40px;
  height: 40px;
  margin-right: 4px;
  flex: none;
}
.main:not(.split) .like.transport-like { position: static; }
.progress {
  width: min(640px, 100%);
}
.transport,
.functions {
  width: min(640px, 100%);
}
.right,
.lyrics-column {
  display: flex;
  flex-direction: column;
  min-width: 0;
  min-height: 0;
}
.lyrics-column {
  overflow: hidden;
  border-left: 0;
  padding-left: 0;
}
.right { overflow: hidden; }
.score-pane {
  display: flex;
  flex-direction: column;
  min-height: 0;
  height: 100%;
}
.spectrum {
  width: min(640px, 86%);
  height: clamp(28px, 5vh, 48px);
  display: flex;
  align-items: end;
  justify-content: center;
  gap: 3px;
  overflow: hidden;
  opacity: .68;
}
.spectrum span {
  flex: 1;
  max-width: 8px;
  min-height: 3px;
  border-radius: 999px;
  background: linear-gradient(180deg, var(--accent, #a78bfa), color-mix(in srgb, var(--accent, #a78bfa) 32%, transparent));
  transform-origin: bottom;
  opacity: .65;
}
.spectrum.playing span { animation: spectrum-pulse 680ms ease-in-out infinite alternate; }
@keyframes spectrum-pulse {
  from { transform: scaleY(.35); opacity: .38; }
  to { transform: scaleY(1); opacity: .9; }
}
.score-empty {
  flex: 1;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 8px;
  color: #8a8a98;
  font-size: 13px;
  text-align: center;
}
.score-empty b {
  color: #c6c6d2;
  font-weight: 500;
}
.score-empty span {
  font-size: 12px;
}
.lyric-head {
  flex: none;
  font-size: 11px;
  letter-spacing: 1.2px;
  color: #858592;
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
.txt.on {
  border-color: #a78bfa;
  color: #a78bfa;
}
.panel-sub {
  margin: 12px 0 8px;
  font-size: 12px;
  color: #9b9ba8;
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
    grid-template-columns: minmax(0, 1fr) minmax(0, 1fr);
    gap: 14px;
    padding-inline: 16px;
  }
  .left {
    gap: 10px;
    padding-bottom: 12px;
  }
  .left > .transport { transform: scale(1.04); }
  .spectrum { width: min(100%, 440px); }
}
@media (max-width: 760px) {
  .main.split {
    grid-template-columns: minmax(0, 1fr);
  }
  .right,
  .lyrics-column {
    display: none;
  }
}
</style>
