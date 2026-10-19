<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { useRouter } from 'vue-router'
import { findLyricIndex, formatTime } from '@shared/lrc'
import type { LyricLine } from '@shared/types'
import Icon from '@/components/Icon.vue'
import Cover from '@/components/Cover.vue'
import Slider from '@/components/Slider.vue'
import Menu from '@/components/Menu.vue'
import type { MenuItem } from '@/components/menu-types'
import { usePlayerStore, type StageMode } from '@/stores/player'
import { useLibraryStore } from '@/stores/library'
import { useUiStore } from '@/stores/ui'
import { songSourceLabel } from '@/utils/labels'

const router = useRouter()
const player = usePlayerStore()
const library = useLibraryStore()
const ui = useUiStore()

const lyricBox = ref<HTMLElement | null>(null)
const canvas = ref<HTMLCanvasElement | null>(null)
const menu = ref<{ x: number; y: number } | null>(null)
const dragging = ref(false)
const dragValue = ref(0)

const stages: { key: StageMode; label: string; icon: string }[] = [
  { key: 'lyrics', label: '歌词舞台', icon: 'lyric' },
  { key: 'particle', label: '粒子舞台', icon: 'sparkles' },
  { key: 'cinema', label: '电影镜头', icon: 'video' },
  { key: 'podcast', label: '播客 / DJ', icon: 'radio' },
]

const song = computed(() => player.song)
const isWin = computed(() => window.sw?.platform === 'win32')
const liked = computed(() => (song.value ? library.isFavorite(song.value.id) : false))
const offsetSec = computed(() => (ui.settings.lyricOffset || 0) / 1000)
const lines = computed<LyricLine[]>(() => player.lyric?.lines || [])
const hasLyric = computed(() => lines.value.length > 0)

const activeIndex = computed(() => findLyricIndex(lines.value, player.displayPosition + offsetSec.value))
const activeLine = computed(() => (activeIndex.value >= 0 ? lines.value[activeIndex.value] : null))

const lineProgress = computed(() => {
  const idx = activeIndex.value
  if (idx < 0) return 0
  const cur = lines.value[idx]
  const next = lines.value[idx + 1]
  const start = cur.time
  const end = next ? next.time : start + 4
  const t = (player.displayPosition + offsetSec.value - start) / Math.max(0.2, end - start)
  return Math.max(0, Math.min(1, t))
})

const displayPos = computed(() => (dragging.value ? dragValue.value : player.displayPosition))

watch(activeIndex, async idx => {
  if (idx < 0 || !lyricBox.value) return
  await nextTick()
  const node = lyricBox.value.querySelector<HTMLElement>(`[data-idx="${idx}"]`)
  const box = lyricBox.value
  if (!node) return
  const boxRect = box.getBoundingClientRect()
  const nodeRect = node.getBoundingClientRect()
  const target = box.scrollTop + (nodeRect.top - boxRect.top) - box.clientHeight / 2 + nodeRect.height / 2
  box.scrollTo({ top: Math.max(0, target), behavior: 'smooth' })
})

function onSeek(v: number): void {
  dragging.value = false
  void player.seekTo(v)
}

function seekLine(line: LyricLine): void {
  void player.seekTo(Math.max(0, line.time - offsetSec.value))
}

function qualityLabel(): string {
  const q = player.state.quality
  return q === 'flac24bit' ? 'Hi-Res' : q === 'flac' ? '无损' : q === '320k' ? '320K' : '128K'
}

const modeIcon = computed(() => {
  const m = player.state.mode
  return m === 'repeat-one' ? 'repeat-one' : m === 'shuffle' ? 'shuffle' : 'repeat'
})

const menuItems = computed<MenuItem[]>(() => [
  { label: '添加到歌单', icon: 'plus' },
  { label: '下一首播放', icon: 'arrow-down' },
  { label: '打开桌面歌词', icon: 'lyric' },
  { label: `播放速度 ${player.state.rate || 1}×（切换）`, icon: 'gauge' },
  { label: player.sleepUntil ? '取消定时关闭' : '定时关闭 30 分钟', icon: 'clock' },
  { divider: true, label: '' },
  { label: '打开文件所在位置', icon: 'folder-open' },
])

async function onMenuSelect(i: number): Promise<void> {
  menu.value = null
  const s = song.value
  if (!s) return
  if (i === 0) ui.playlistPickerSong = s
  else if (i === 1) await player.addNext(s)
  else if (i === 2) await ui.patch({ showDesktopLyric: !ui.settings.showDesktopLyric })
  else if (i === 3) await player.cycleRate()
  else if (i === 4) await player.setSleep(player.sleepUntil ? 0 : 30)
  else if (i === 6 && s.localPath) await (window as any).sw.invoke('app:showItemInFolder', { path: s.localPath })
}

function openMenu(e: MouseEvent): void {
  menu.value = { x: e.clientX, y: e.clientY }
}

/* ---------------- 粒子舞台 ---------------- */
interface Particle {
  x: number
  y: number
  r: number
  vx: number
  vy: number
  a: number
  hue: number
}
let parts: Particle[] = []
let raf = 0
let w = 0
let h = 0
let dpr = 1

function resizeCanvas(): void {
  const c = canvas.value
  if (!c) return
  const rect = c.getBoundingClientRect()
  dpr = Math.min(2, window.devicePixelRatio || 1)
  w = rect.width
  h = rect.height
  c.width = Math.max(1, Math.round(w * dpr))
  c.height = Math.max(1, Math.round(h * dpr))
  const ctx = c.getContext('2d')
  if (ctx) ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
}

function seedParticles(): void {
  const count = 64
  parts = Array.from({ length: count }, () => ({
    x: Math.random() * w,
    y: Math.random() * h,
    r: 0.8 + Math.random() * 2.6,
    vx: (Math.random() - 0.5) * 0.18,
    vy: -0.12 - Math.random() * 0.35,
    a: 0.12 + Math.random() * 0.55,
    hue: Math.random() > 0.5 ? 340 : 268,
  }))
}

function draw(): void {
  const c = canvas.value
  const ctx = c?.getContext('2d')
  if (!c || !ctx) return
  ctx.clearRect(0, 0, w, h)
  ctx.globalCompositeOperation = 'lighter'
  const accent = ui.accent
  for (const p of parts) {
    p.x += p.vx
    p.y += p.vy
    if (p.y < -10) {
      p.y = h + 10
      p.x = Math.random() * w
    }
    if (p.x < -10) p.x = w + 10
    if (p.x > w + 10) p.x = -10
    const pulse = player.playing ? 1 + Math.sin(performance.now() / 520 + p.x) * 0.35 : 0.7
    ctx.beginPath()
    ctx.fillStyle = p.hue === 340 ? accent : '#a78bfa'
    ctx.globalAlpha = p.a * 0.75
    ctx.arc(p.x, p.y, p.r * pulse, 0, Math.PI * 2)
    ctx.fill()
  }
  ctx.globalAlpha = 1
  ctx.globalCompositeOperation = 'source-over'
  raf = requestAnimationFrame(draw)
}

function startCanvas(): void {
  stopCanvas()
  if (!ui.settings.particle) return
  if (player.stage !== 'particle' && player.stage !== 'cinema') return
  resizeCanvas()
  if (!parts.length || w === 0) seedParticles()
  raf = requestAnimationFrame(draw)
}

function stopCanvas(): void {
  if (raf) cancelAnimationFrame(raf)
  raf = 0
  const c = canvas.value
  const ctx = c?.getContext('2d')
  if (ctx) ctx.clearRect(0, 0, c!.width, c!.height)
}

watch(
  () => [player.stage, ui.settings.particle, player.playing],
  () => {
    if (player.stage === 'particle' || player.stage === 'cinema') startCanvas()
    else stopCanvas()
  }
)

let ro: ResizeObserver | null = null

onMounted(() => {
  if (canvas.value) {
    ro = new ResizeObserver(() => {
      resizeCanvas()
      parts = []
    })
    ro.observe(canvas.value)
  }
  startCanvas()
})

onBeforeUnmount(() => {
  stopCanvas()
  ro?.disconnect()
})

function back(): void {
  if (window.history.length > 1) router.back()
  else router.push('/')
}

/* 舞台切换手势：右上角按钮在 Windows 上可能被窗口控制区遮挡，
   左右滑动页面或点击页面左右边缘即可切换（从按钮/滑杆上起手的不触发）。 */
function cycleStage(dir: 1 | -1): void {
  const i = stages.findIndex(s => s.key === player.stage)
  const next = stages[(i + dir + stages.length) % stages.length]
  player.setStage(next.key)
  ui.toast(`已切换到${next.label}`, 'info', 1400)
}
let gX = 0
let gY = 0
let gT = 0
function onGestureStart(e: PointerEvent): void {
  if ((e.target as HTMLElement).closest('button, input, a, .slider, canvas')) return
  gX = e.clientX
  gY = e.clientY
  gT = Date.now()
}
function onGestureEnd(e: PointerEvent): void {
  if (!gT) return
  const dx = e.clientX - gX
  const dy = e.clientY - gY
  const dt = Date.now() - gT
  gT = 0
  if (dt > 800) return
  if (Math.abs(dx) > 60 && Math.abs(dx) > Math.abs(dy) * 1.5) {
    cycleStage(dx < 0 ? 1 : -1)
    return
  }
  if (Math.abs(dx) < 10 && Math.abs(dy) < 10) {
    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect()
    if (e.clientX - rect.left < 48) cycleStage(-1)
    else if (rect.right - e.clientX < 48) cycleStage(1)
  }
}
</script>

<template>
  <div
    class="player"
    :class="`stage-${player.stage}`"
    @pointerdown="onGestureStart"
    @pointerup="onGestureEnd"
  >
    <!-- 背景：专辑封面大模糊；无封面时兜底氛围渐变（coverUrl 可能为空） -->
    <div class="bg-layer">
      <img v-if="player.coverUrl" :src="player.coverUrl" class="bg-img" alt="" />
      <div class="bg-fallback" />
      <div class="bg-mask" />
    </div>

    <!-- 顶栏 -->
    <header class="p-head drag">
      <button class="icon-btn no-drag" title="收起" @click="back"><Icon name="chevron-down" :size="22" /></button>
      <div class="p-head-mid">
        <span class="p-kicker">正在播放</span>
        <span class="p-source ellipsis">
          {{ song ? song.singer : '星河音乐' }}
          <span v-if="player.lyric?.source" class="lyric-src">· 歌词来自{{ player.lyric.source }}</span>
        </span>
      </div>
      <div class="p-head-actions no-drag">
        <button class="stage-btn" :class="{ active: player.stage === 'lyrics' }" title="歌词舞台" @click="player.setStage('lyrics')">
          <Icon name="lyric" :size="15" /><span>歌词</span>
        </button>
        <button class="stage-btn" :class="{ active: player.stage === 'particle' }" title="粒子舞台" @click="player.setStage('particle')">
          <Icon name="sparkles" :size="15" /><span>粒子</span>
        </button>
        <button class="stage-btn" :class="{ active: player.stage === 'cinema' }" title="电影镜头" @click="player.setStage('cinema')">
          <Icon name="video" :size="15" /><span>电影</span>
        </button>
        <button class="stage-btn" :class="{ active: player.stage === 'podcast' }" title="播客 / DJ" @click="player.setStage('podcast')">
          <Icon name="radio" :size="15" /><span>DJ</span>
        </button>
      </div>
      <!-- Windows 右上角悬浮窗口控制按钮（约 138px），让位避免遮挡 stage 按钮 -->
      <div v-if="isWin" class="win-ctl-area no-drag" aria-hidden="true" />
    </header>

    <!-- 主体 -->
    <main class="p-body">
      <section class="left">
        <div class="stage-wrap">
          <canvas ref="canvas" class="particles" />
          <div class="glow" />
          <div class="vinyl-wrap" :class="{ spinning: player.playing, cinema: player.stage === 'cinema' }">
            <div class="vinyl">
              <div class="grooves" />
              <div class="label">
                <Cover :src="player.coverUrl || song?.pic || ''" :alt="song?.name || '星河'" size="100%" round cover="1" />
              </div>
              <div class="hole" />
            </div>
          </div>
        </div>

        <div v-if="player.stage === 'podcast'" class="wave">
          <span v-for="i in 42" :key="i" :style="{ animationDelay: (i % 9) * 0.09 + 's', height: 12 + ((i * 7) % 34) + 'px' }" />
        </div>

        <div class="song-info">
          <h1 class="ellipsis">{{ song?.name || '未在播放' }}</h1>
          <p class="ellipsis">
            {{ song?.singer || '在星河里，找到属于你的声音' }}
            <span v-if="song?.album" class="album"> · {{ song.album }}</span>
          </p>
          <div class="tags">
            <span v-if="song" class="pill">{{ songSourceLabel(song) }}</span>
            <span v-if="song?.localPath" class="pill">本地文件</span>
            <span v-if="player.lyric?.hasWordByWord" class="pill">逐字歌词</span>
            <span v-if="player.state.status === 'loading'" class="pill loading">缓冲中…</span>
            <span v-if="player.state.error" class="pill error">{{ player.state.error }}</span>
          </div>
        </div>
      </section>

      <section class="right">
        <div v-if="player.stage === 'podcast'" class="podcast-panel">
          <div class="podcast-badge"><Icon name="radio" :size="16" />播客 / DJ 模式</div>
          <p>低能耗渲染，粒子与歌词已降级，适合长时间收听。</p>
          <div class="podcast-bars">
            <span v-for="i in 24" :key="i" :style="{ animationDelay: (i % 7) * 0.11 + 's' }" />
          </div>
        </div>

        <div v-else-if="!hasLyric" class="lyric-empty">
          <Icon name="lyric" :size="30" :stroke="1.3" />
          <div class="empty-title">{{ player.lyricLoading ? '正在匹配歌词…' : '暂无歌词' }}</div>
          <div class="empty-desc">
            {{ player.lyricLoading ? '从音源与平台曲库中检索中' : '该歌曲暂未找到歌词，你仍可以继续欣赏音乐' }}
          </div>
          <button v-if="!player.lyricLoading && song" class="btn sm" style="margin-top: 6px" @click="player.reloadLyric()">
            <Icon name="refresh" :size="13" />重新匹配歌词
          </button>
        </div>

        <div v-else ref="lyricBox" class="lyrics" :style="{ fontSize: ui.settings.lyricFontSize + 'px' }">
          <div class="lyric-inner">
            <div
              v-for="(line, i) in lines"
              :key="i"
              class="line"
              :class="{ active: i === activeIndex, near: Math.abs(i - activeIndex) === 1 }"
              :data-idx="i"
              @click="seekLine(line)"
            >
              <div class="line-main">
                <span v-if="line.words && i === activeIndex" class="word-line">
                  <span
                    v-for="(wd, wi) in line.words"
                    :key="wi"
                    class="word"
                    :class="{ on: (player.displayPosition + offsetSec) * 1000 >= wd.t }"
                    >{{ wd.w }}</span
                  >
                </span>
                <span v-else>{{ line.text || '♪' }}</span>
              </div>
              <div v-if="line.trans" class="line-trans">{{ line.trans }}</div>
            </div>
            <div class="lyric-pad" />
          </div>
        </div>
      </section>
    </main>

    <!-- 底部控制 -->
    <footer class="p-foot">
      <div class="progress-row">
        <span class="time mono">{{ formatTime(displayPos) }}</span>
        <Slider
          class="p-progress"
          :model-value="displayPos"
          :max="player.duration || 1"
          :step="0.5"
          :buffered="player.state.buffered"
          @update:model-value="v => { dragging = true; dragValue = v }"
          @change="onSeek"
        />
        <span class="time mono">{{ formatTime(player.duration) }}</span>
      </div>

      <div class="controls">
        <div class="side">
          <button class="icon-btn" :title="player.modeLabel" @click="player.cycleMode()">
            <Icon :name="modeIcon" :size="18" />
          </button>
          <button class="icon-btn" :class="{ liked }" :title="liked ? '取消喜欢' : '喜欢'" @click="song && library.toggleFavorite(song)">
            <Icon :name="liked ? 'heart-filled' : 'heart'" :size="18" />
          </button>
        </div>

        <div class="center">
          <button class="icon-btn big" title="上一首" @click="player.prev()"><Icon name="prev" :size="26" /></button>
          <button class="main-play" :disabled="!song" @click="player.toggle()">
            <Icon :name="player.playing ? 'pause' : 'play'" :size="28" />
          </button>
          <button class="icon-btn big" title="下一首" @click="player.next()"><Icon name="next" :size="26" /></button>
        </div>

        <div class="side right-side">
          <button class="quality" @click="player.setQuality(player.state.quality === '320k' ? 'flac' : player.state.quality === 'flac' ? '128k' : '320k')">
            {{ qualityLabel() }}
          </button>
          <div class="vol">
            <button class="icon-btn" :title="player.state.muted ? '取消静音' : '静音'" @click="player.toggleMute()">
              <Icon :name="player.state.muted ? 'volume-mute' : player.state.volume < 0.45 ? 'volume-low' : 'volume'" :size="18" />
            </button>
            <Slider
              class="vol-slider"
              :model-value="player.state.muted ? 0 : player.state.volume"
              :max="1"
              :step="0.01"
              @change="v => player.setVolume(v)"
            />
          </div>
          <button class="icon-btn" title="播放队列" @click="player.queueOpen = !player.queueOpen">
            <Icon name="queue" :size="18" />
          </button>
          <button class="icon-btn" title="更多" @click="openMenu"><Icon name="more" :size="18" /></button>
        </div>
      </div>
    </footer>

    <Menu v-if="menu" :x="menu.x" :y="menu.y" :items="menuItems" @select="onMenuSelect" @close="menu = null" />
  </div>
</template>

<style scoped>
.player {
  position: fixed;
  inset: 0;
  display: flex;
  flex-direction: column;
  overflow: hidden;
  color: #f4f6fb;
  background: #0a0b10;
  animation: playerIn 0.36s var(--ease);
}
@keyframes playerIn {
  from {
    opacity: 0;
    transform: translateY(18px);
  }
}
.bg-layer {
  position: absolute;
  inset: 0;
  z-index: 0;
}
.bg-img {
  width: 100%;
  height: 100%;
  object-fit: cover;
  filter: blur(90px) saturate(1.35) brightness(0.55);
  transform: scale(1.25);
  transition: opacity 0.6s;
}
/* 无封面兜底：随主题色微调的氛围渐变（盖在纯黑底之上） */
.bg-fallback {
  position: absolute;
  inset: 0;
  background:
    radial-gradient(90% 70% at 25% 15%, color-mix(in srgb, var(--accent) 28%, transparent), transparent 60%),
    radial-gradient(80% 80% at 80% 85%, rgba(124, 108, 255, 0.22), transparent 65%),
    linear-gradient(160deg, #14162266, #0a0b10);
}
.bg-mask {
  position: absolute;
  inset: 0;
  background:
    radial-gradient(120% 80% at 18% 20%, rgba(255, 77, 109, 0.16), transparent 55%),
    radial-gradient(100% 90% at 85% 80%, rgba(120, 80, 255, 0.18), transparent 60%),
    linear-gradient(180deg, rgba(6, 8, 14, 0.55), rgba(6, 8, 14, 0.88));
}

.p-head {
  position: relative;
  z-index: 3;
  height: 56px;
  flex: none;
  display: flex;
  align-items: center;
  gap: 14px;
  padding: 0 20px;
}
.p-head .icon-btn {
  color: rgba(255, 255, 255, 0.7);
}
.p-head .icon-btn:hover {
  color: #fff;
  background: rgba(255, 255, 255, 0.1);
}
.p-head-mid {
  display: flex;
  flex-direction: column;
  line-height: 1.3;
  min-width: 0;
}
.p-kicker {
  font-size: 9.5px;
  letter-spacing: 2px;
  color: rgba(255, 255, 255, 0.45);
  text-transform: uppercase;
}
.p-source {
  font-size: 12px;
  color: rgba(255, 255, 255, 0.75);
  max-width: 46vw;
}
.lyric-src {
  color: rgba(255, 255, 255, 0.35);
  font-size: 10.5px;
}
.p-head-actions {
  margin-left: auto;
  display: flex;
  gap: 4px;
  padding: 3px;
  border-radius: 11px;
  background: rgba(255, 255, 255, 0.06);
  border: 1px solid rgba(255, 255, 255, 0.08);
}
.stage-btn {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  height: 26px;
  padding: 0 9px;
  border-radius: 8px;
  font-size: 11px;
  color: rgba(255, 255, 255, 0.6);
  transition: all 0.18s;
}
.stage-btn:hover {
  color: #fff;
  background: rgba(255, 255, 255, 0.08);
}
.stage-btn.active {
  color: #fff;
  background: var(--accent);
  box-shadow: 0 4px 12px -4px var(--accent);
}
.win-ctl-area {
  width: 138px;
  height: 100%;
  flex: none;
}

.p-body {
  position: relative;
  z-index: 2;
  flex: 1;
  min-height: 0;
  display: grid;
  grid-template-columns: minmax(360px, 0.95fr) minmax(420px, 1.05fr);
  gap: 30px;
  padding: 4px 46px 0;
}
.left {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  min-width: 0;
}
.stage-wrap {
  position: relative;
  width: min(360px, 30vw);
  aspect-ratio: 1;
  display: flex;
  align-items: center;
  justify-content: center;
}
.particles {
  position: absolute;
  inset: -18%;
  width: 136%;
  height: 136%;
  pointer-events: none;
}
.glow {
  position: absolute;
  width: 78%;
  height: 78%;
  border-radius: 50%;
  background: radial-gradient(circle, var(--accent-soft), transparent 65%);
  filter: blur(30px);
}
.vinyl-wrap {
  position: relative;
  width: 100%;
  height: 100%;
  display: flex;
  align-items: center;
  justify-content: center;
}
.vinyl-wrap.cinema {
  animation: cinema 22s ease-in-out infinite alternate;
}
@keyframes cinema {
  0% {
    transform: scale(1) translateY(0);
  }
  50% {
    transform: scale(1.07) translateY(-6px);
  }
  100% {
    transform: scale(1.03) translateX(5px);
  }
}
.vinyl {
  position: relative;
  width: 100%;
  height: 100%;
  border-radius: 50%;
  background: radial-gradient(circle at 50% 50%, #1a1a1f 0%, #08080a 62%, #141418 100%);
  box-shadow: 0 30px 70px rgba(0, 0, 0, 0.65), inset 0 0 0 1px rgba(255, 255, 255, 0.06);
  display: flex;
  align-items: center;
  justify-content: center;
  animation: spin 26s linear infinite;
  animation-play-state: paused;
}
.vinyl-wrap.spinning .vinyl {
  animation-play-state: running;
}
@keyframes spin {
  to {
    transform: rotate(360deg);
  }
}
.grooves {
  position: absolute;
  inset: 4%;
  border-radius: 50%;
  background: repeating-radial-gradient(circle at 50% 50%, rgba(255, 255, 255, 0.045) 0 1px, transparent 1px 5px);
  opacity: 0.7;
}
.label {
  width: 46%;
  height: 46%;
  border-radius: 50%;
  overflow: hidden;
  box-shadow: 0 0 0 8px rgba(255, 255, 255, 0.04), 0 10px 24px rgba(0, 0, 0, 0.55);
}
.hole {
  position: absolute;
  width: 12px;
  height: 12px;
  border-radius: 50%;
  background: #0a0b10;
  box-shadow: inset 0 0 0 2px rgba(255, 255, 255, 0.18);
}
.wave {
  display: flex;
  align-items: center;
  gap: 3px;
  height: 46px;
  margin-top: -6px;
}
.wave span {
  width: 3px;
  border-radius: 3px;
  background: linear-gradient(180deg, var(--accent), #a78bfa);
  animation: wave 1.1s ease-in-out infinite alternate;
}
@keyframes wave {
  from {
    transform: scaleY(0.35);
    opacity: 0.5;
  }
  to {
    transform: scaleY(1);
    opacity: 1;
  }
}
.song-info {
  text-align: center;
  margin-top: 22px;
  max-width: 92%;
}
.song-info h1 {
  font-size: 24px;
  font-weight: 700;
  letter-spacing: 0.3px;
}
.song-info p {
  margin-top: 6px;
  font-size: 12.5px;
  color: rgba(255, 255, 255, 0.6);
}
.album {
  color: rgba(255, 255, 255, 0.4);
}
.tags {
  display: flex;
  justify-content: center;
  flex-wrap: wrap;
  gap: 6px;
  margin-top: 12px;
}
.pill {
  padding: 2px 8px;
  border-radius: 20px;
  border: 1px solid rgba(255, 255, 255, 0.16);
  font-size: 10px;
  color: rgba(255, 255, 255, 0.65);
}
.pill.loading {
  border-color: rgba(255, 200, 100, 0.4);
  color: #ffd08a;
}
.pill.error {
  border-color: rgba(255, 120, 140, 0.5);
  color: #ffb0bd;
  max-width: 320px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.right {
  position: relative;
  min-width: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 10px 0;
}
.lyrics {
  width: 100%;
  height: min(520px, 56vh);
  overflow-y: auto;
  scrollbar-width: none;
  mask-image: linear-gradient(180deg, transparent, #000 12%, #000 84%, transparent);
  -webkit-mask-image: linear-gradient(180deg, transparent, #000 12%, #000 84%, transparent);
}
.lyrics::-webkit-scrollbar {
  display: none;
}
.lyric-inner {
  padding: 42% 8px;
}
.line {
  padding: 9px 6px;
  border-radius: 8px;
  font-size: 1em;
  line-height: 1.6;
  color: rgba(255, 255, 255, 0.38);
  text-align: left;
  cursor: pointer;
  transition: color 0.24s, transform 0.24s, font-size 0.24s;
  transform-origin: left center;
}
.line:hover {
  color: rgba(255, 255, 255, 0.62);
}
.line.near {
  color: rgba(255, 255, 255, 0.55);
}
.line.active {
  color: #fff;
  font-size: 1.32em;
  font-weight: 650;
  transform: scale(1.02);
}
.line.active .line-main {
  text-shadow: 0 4px 24px var(--accent-soft);
}
.line-trans {
  font-size: 0.72em;
  color: rgba(255, 255, 255, 0.4);
  margin-top: 3px;
  font-weight: 400;
}
.word {
  transition: color 0.18s;
}
.word.on {
  color: var(--accent);
}
.lyric-pad {
  height: 40vh;
}
.lyric-empty {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 8px;
  color: rgba(255, 255, 255, 0.45);
  text-align: center;
}
.lyric-empty .empty-title {
  font-size: 14px;
  color: rgba(255, 255, 255, 0.8);
}
.lyric-empty .empty-desc {
  font-size: 12px;
  max-width: 320px;
  line-height: 1.7;
}
.podcast-panel {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 14px;
  color: rgba(255, 255, 255, 0.6);
  text-align: center;
}
.podcast-badge {
  display: inline-flex;
  align-items: center;
  gap: 7px;
  padding: 6px 12px;
  border-radius: 20px;
  background: rgba(255, 255, 255, 0.08);
  font-size: 12px;
  color: #fff;
}
.podcast-bars {
  display: flex;
  align-items: flex-end;
  gap: 4px;
  height: 90px;
  margin-top: 8px;
}
.podcast-bars span {
  width: 4px;
  height: 30px;
  border-radius: 3px;
  background: linear-gradient(180deg, var(--accent), #a78bfa);
  animation: wave 1.3s ease-in-out infinite alternate;
}

.p-foot {
  position: relative;
  z-index: 3;
  flex: none;
  padding: 6px 46px 22px;
}
.progress-row {
  display: flex;
  align-items: center;
  gap: 12px;
}
.p-progress {
  flex: 1;
}
.time {
  font-size: 11px;
  color: rgba(255, 255, 255, 0.5);
  min-width: 40px;
  text-align: center;
}
.controls {
  display: grid;
  grid-template-columns: 1fr auto 1fr;
  align-items: center;
  margin-top: 4px;
}
.side {
  display: flex;
  align-items: center;
  gap: 4px;
}
.right-side {
  justify-content: flex-end;
}
.center {
  display: flex;
  align-items: center;
  gap: 16px;
}
.icon-btn {
  color: rgba(255, 255, 255, 0.62);
}
.icon-btn:hover {
  color: #fff;
  background: rgba(255, 255, 255, 0.1);
}
.icon-btn.big {
  width: 46px;
  height: 46px;
}
.icon-btn.liked {
  color: var(--accent);
}
.main-play {
  width: 62px;
  height: 62px;
  border-radius: 50%;
  display: flex;
  align-items: center;
  justify-content: center;
  background: #fff;
  color: #14161d;
  box-shadow: 0 14px 34px rgba(0, 0, 0, 0.45);
  transition: transform 0.16s, background 0.16s;
}
.main-play:hover {
  transform: scale(1.04);
  background: var(--accent);
  color: #fff;
}
.main-play:active {
  transform: scale(0.96);
}
.main-play:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}
.quality {
  height: 24px;
  padding: 0 9px;
  border-radius: 6px;
  border: 1px solid rgba(255, 255, 255, 0.2);
  color: rgba(255, 255, 255, 0.7);
  font-size: 10px;
  font-weight: 600;
  letter-spacing: 0.4px;
  margin-right: 6px;
}
.quality:hover {
  color: #fff;
  border-color: #fff;
}
.vol {
  display: flex;
  align-items: center;
  gap: 2px;
}
.vol-slider {
  width: 76px;
}
@media (max-width: 1120px) {
  .p-body {
    grid-template-columns: 1fr;
    gap: 10px;
    padding: 0 26px;
    overflow-y: auto;
  }
  .stage-wrap {
    width: min(260px, 40vh);
  }
  /* 歌词区堆叠到唱片/歌名下方，窄屏与移动端才能看到歌词 */
  .right {
    display: block;
    padding: 0;
  }
  .lyrics {
    height: min(460px, 52vh);
  }
  .lyric-inner {
    padding: 20% 8px;
  }
  .p-foot {
    padding: 4px 26px 16px;
  }
  .vol-slider {
    display: none;
  }
  .stage-btn span {
    display: none;
  }
}
</style>
