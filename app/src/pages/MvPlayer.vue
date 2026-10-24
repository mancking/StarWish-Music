<script setup lang="ts">
/**
 * 桌面 / 车机视频播放页（规格书 2.1 ~ 2.12）
 *
 * 画面与手势在 VideoStage，设置面板在 PlaySettingsSheet，
 * 本页负责：取数据、键盘快捷键、控件显隐、离线缓存、音频模式。
 */
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import Icon from '@/components/Icon.vue'
import DanmakuLayer from '@/components/DanmakuLayer.vue'
import EqPanel from '@/components/player/EqPanel.vue'
import AudioModeView from '@/player-video/components/AudioModeView.vue'
import VideoStage from '@/player-video/components/VideoStage.vue'
import PlaySettingsSheet from '@/player-video/components/PlaySettingsSheet.vue'
import ProgressBar from '@/player-music/components/ProgressBar.vue'
import { useVideoSession } from '@/player-video/useVideoSession'
import { parseSubtitles, activeCueAt, nudgeSubtitleOffset, type SubCue } from '@/player-video/subtitles'
import SubtitleOverlay from '@/player-video/components/SubtitleOverlay.vue'
import { useUiStore } from '@/stores/ui'
import { call, isDesktop, on } from '@/api'
import { platform } from '@/platform'
import type { MvItem } from '@shared/types'
import type { QualityOption } from '@/player-video/components/PlaySettingsSheet.vue'

defineOptions({ name: 'MvPlayer' })

const route = useRoute()
const router = useRouter()
const ui = useUiStore()

const car = computed(() => platform.value.car)
const bvid = computed(() => String(route.params.bvid || ''))
// MV/视频统一路由（规格书 2.19 / C-16）：/mv/:source/:id；旧 /mv/:bvid 视作 bili
const source = computed(() => String((route.params as any).source || 'bili'))
const session = useVideoSession(source, bvid)

const stage = ref<InstanceType<typeof VideoStage> | null>(null)
const videoEl = computed(() => stage.value?.el || null)

const playing = ref(false)
const curTime = ref(0)
const duration = ref(0)
const rate = ref(1)
const fill = ref<'contain' | 'cover' | 'fill' | 'actual'>('contain')
const loopMode = ref<'off' | 'one' | 'list'>('off')
const abA = ref<number | null>(null)
const abB = ref<number | null>(null)
const showControls = ref(true)
const settingsOpen = ref(false)
const eqOpen = ref(false)
const audioMode = ref(false)
const frameCover = ref('')
const caching = ref(false)
const cached = ref(false)
/* 规格 2.12 / Bug 8：音频提取（进度 + 可取消） */
const extractId = ref('')
const extractPct = ref<number | undefined>(undefined)

/* 规格 2.11 / Bug 16：外挂字幕（srt/ass 解析 + 延迟 ±0.5s 跨视频记忆） */
const subCues = ref<SubCue[]>([])
const subOffset = ref(Number(localStorage.getItem('xinyuan_subtitle_offset') || '0') || 0)
const activeSub = computed(() => activeCueAt(subCues.value, curTime.value, subOffset.value)?.text || '')
const subFileInput = ref<HTMLInputElement | null>(null)

function onSubtitle(delta: number): void {
  subOffset.value = nudgeSubtitleOffset(subOffset.value, delta)
  localStorage.setItem('xinyuan_subtitle_offset', String(subOffset.value))
  ui.toast(`字幕偏移 ${subOffset.value > 0 ? '+' : ''}${subOffset.value}s`, 'info', 1400)
}

async function onSubtitleFile(e: Event): Promise<void> {
  const input = e.target as HTMLInputElement
  const file = input.files?.[0]
  if (!file) return
  try {
    const raw = await file.text()
    subCues.value = parseSubtitles(raw)
    subOffset.value = 0
    ui.toast(subCues.value.length ? `已加载字幕（${subCues.value.length} 条）` : '字幕解析失败', subCues.value.length ? 'success' : 'error', 2000)
  } catch {
    ui.toast('字幕读取失败', 'error', 1800)
  } finally {
    input.value = ''
  }
}

let hideTimer = 0
let resumeTimer = 0
let offExtract: (() => void) | null = null

const LOOP_LABEL: Record<'off' | 'one' | 'list', string> = { off: '不循环', one: '单片循环', list: '列表循环' }
const LOOP_ORDER = ['off', 'one', 'list'] as const
const FILL_ORDER = ['contain', 'cover', 'fill', 'actual'] as const
const FILL_LABEL: Record<string, string> = { contain: '适应窗口', cover: '填充', fill: '拉伸', actual: '100%' }
const RATES = [0.5, 0.75, 1, 1.25, 1.5, 2]

const qualityOptions = computed<QualityOption[]>(() =>
  session.qualities.value.map(q => ({ id: String(q.qn), label: q.label }))
)
const abLabel = computed(() => {
  if (abA.value === null) return 'AB 循环'
  if (abB.value === null) return 'A 已设 · 再点设 B'
  return 'AB 循环已开'
})
const fitLabel = computed(() => FILL_LABEL[fill.value] || '适应窗口')

/* ---------------- 控件显隐（2.1：3 秒自动隐藏，车机常显） ---------------- */
function poke(): void {
  showControls.value = true
  window.clearTimeout(hideTimer)
  if (car.value) return
  hideTimer = window.setTimeout(() => {
    if (playing.value) showControls.value = false
  }, 3000)
}

/* ---------------- 播放控制 ---------------- */
function togglePlay(): void {
  const v = videoEl.value
  if (!v) return
  if (v.paused) void v.play().catch(() => undefined)
  else v.pause()
  poke()
}

function seekTo(sec: number): void {
  const v = videoEl.value
  if (!v) return
  v.currentTime = Math.max(0, Math.min(sec, duration.value || v.duration || 0))
}

function nudge(delta: number): void {
  seekTo(curTime.value + delta)
  poke()
}

function setRate(r: number): void {
  rate.value = r
  if (videoEl.value) videoEl.value.playbackRate = r
  settingsOpen.value = false
}

function cycleFill(): void {
  const i = FILL_ORDER.indexOf(fill.value)
  fill.value = FILL_ORDER[(i + 1) % FILL_ORDER.length]!
  poke()
}

function setLoop(mode: 'off' | 'one' | 'list'): void {
  loopMode.value = mode
  settingsOpen.value = false
}

function markAB(): void {
  const t = curTime.value
  if (abA.value === null) {
    abA.value = t
    abB.value = null
    ui.toast(`A 点 ${Math.round(t)}s`, 'info', 1400)
    return
  }
  if (abB.value === null && t > abA.value + 0.5) {
    abB.value = t
    ui.toast(`B 点 ${Math.round(t)}s，开始 AB 循环`, 'info', 1600)
    return
  }
  abA.value = null
  abB.value = null
  ui.toast('已关闭 AB 循环', 'info', 1400)
}

async function changeQn(id: string): Promise<void> {
  const qn = Number(id)
  if (!qn || qn === session.qn.value || !session.current.value) return
  const at = curTime.value
  await session.selectPart(session.current.value, qn)
  setTimeout(() => seekTo(at), 260)
  settingsOpen.value = false
}

async function togglePip(): Promise<void> {
  const v = videoEl.value as any
  if (!v) return
  try {
    if ((document as any).pictureInPictureElement) await (document as any).exitPictureInPicture()
    else if (v.requestPictureInPicture) await v.requestPictureInPicture()
    else ui.toast('当前系统不支持画中画', 'info', 1600)
  } catch {
    ui.toast('画中画启动失败', 'error', 1600)
  }
  settingsOpen.value = false
}

function toggleFullscreen(): void {
  const v = videoEl.value
  if (!v) return
  if (document.fullscreenElement) void document.exitFullscreen()
  else void v.requestFullscreen?.().catch(() => undefined)
}

/* ---------------- 截图（规格书 2.15）：只截视频画面，不含控件与弹幕 ---------------- */
async function screenshot(): Promise<void> {
  const v = videoEl.value
  if (!v || !v.videoWidth) {
    ui.toast('当前没有可截图的画面', 'info', 1600)
    return
  }
  try {
    const c = document.createElement('canvas')
    c.width = v.videoWidth
    c.height = v.videoHeight
    const ctx = c.getContext('2d')
    if (!ctx) throw new Error('画布不可用')
    ctx.drawImage(v, 0, 0, c.width, c.height)
    const dataUrl = c.toDataURL('image/png')
    if (isDesktop) {
      const r = await call<{ file: string }>('app:saveImage', { name: session.title.value || '视频截图', dataUrl })
      ui.toast(`已保存：${r.file}`, 'success', 2600)
    } else if (__MOBILE__) {
      // 移动端：base64 交给原生 saveToMedia 入系统媒体库（桌面构建 DCE 掉原生桥依赖）
      const { nativeCall } = await import('@/mobile/bridge')
      await nativeCall('SwBridge', 'saveToMedia', {
        name: `${session.title.value || '视频截图'}.png`,
        mime: 'image/png',
        data: dataUrl.split(',')[1] || '',
      })
      ui.toast('截图已保存到媒体库', 'success', 2000)
    }
  } catch (e: any) {
    ui.toast(e?.message || '截图失败', 'error', 2000)
  }
}

/* ---------------- 离线缓存（规格书 3.5 / 2.x 视频缓存） ---------------- */
async function toggleCache(): Promise<void> {
  const p = session.current.value
  if (!p || caching.value) return
  caching.value = true
  try {
    if (cached.value) {
      // Bug 109：remove 传 manifest 键（bvid+cid 由主进程统一算）
      await call('video:offline:remove', { bvid: bvid.value, cid: p.cid })
      cached.value = false
      ui.toast('已移除离线缓存', 'info', 1600)
    } else {
      // Bug 109/T-02：save 全字段透传（url 必带）
      await call('video:offline:save', {
        bvid: bvid.value,
        cid: p.cid,
        url: session.rawUrl.value,
        quality: session.qn.value,
        title: session.title.value,
      })
      cached.value = true
      ui.toast('已缓存到本地', 'success', 1800)
    }
  } catch (e: any) {
    ui.toast(e?.message || '缓存失败', 'error', 2400)
  } finally {
    caching.value = false
  }
}

/* ---------------- 音频模式（2.12） ---------------- */
function captureFrame(): void {
  const v = videoEl.value
  if (!v || !v.videoWidth) return
  try {
    const c = document.createElement('canvas')
    c.width = v.videoWidth
    c.height = v.videoHeight
    const ctx = c.getContext('2d')
    if (!ctx) return
    ctx.drawImage(v, 0, 0, c.width, c.height)
    frameCover.value = c.toDataURL('image/jpeg', 0.82)
  } catch {
    frameCover.value = session.poster.value
  }
}

function enterAudioMode(): void {
  captureFrame()
  audioMode.value = true
  showControls.value = false
  settingsOpen.value = false
}

function exitAudioMode(): void {
  audioMode.value = false
  poke()
}

async function startExtract(): Promise<void> {
  if (extractId.value) return
  const url = session.rawUrl.value
  if (!url) {
    ui.toast('当前没有可提取的音频流', 'error', 1800)
    return
  }
  try {
    const r = await call<{ id: string }>('audio:extract', { url, title: session.title.value })
    extractId.value = r.id
    extractPct.value = 0
  } catch (e: any) {
    ui.toast(e?.message || '提取失败', 'error', 2000)
  }
}

function cancelExtractTask(): void {
  if (extractId.value) void call('audio:extractCancel', { id: extractId.value }).catch(() => undefined)
  extractId.value = ''
  extractPct.value = undefined
}

function cycleLoopMode(): void {
  const i = LOOP_ORDER.indexOf(loopMode.value)
  loopMode.value = LOOP_ORDER[(i + 1) % LOOP_ORDER.length]!
}

function cycleRateMode(): void {
  const i = RATES.indexOf(rate.value)
  setRate(RATES[(i + 1) % RATES.length]!)
}

/* ---------------- 分 P ---------------- */
async function pickPart(part: { cid: string; page: number; title: string }): Promise<void> {
  const resume = await session.selectPart(part)
  if (resume) ui.toast('已恢复到上次播放进度', 'info', 1600)
}

function prevPart(): void {
  const list = session.parts.value
  const cur = session.current.value
  const i = cur ? list.findIndex(p => p.cid === cur.cid) : -1
  if (i > 0) void pickPart(list[i - 1]!)
  else seekTo(0)
}

function nextPart(): void {
  const list = session.parts.value
  const cur = session.current.value
  const i = cur ? list.findIndex(p => p.cid === cur.cid) : -1
  if (i >= 0 && i < list.length - 1) void pickPart(list[i + 1]!)
  else ui.toast('已经是最后一个分P', 'info', 1400)
}

/* ---------------- 事件 ---------------- */
async function onLoaded(dur: number): Promise<void> {
  duration.value = dur
  const v = videoEl.value
  if (!v) return
  v.playbackRate = rate.value
  // Bug 37 / F-15：MV 音量设置真实生效（schema 为 0~100 滑条，scale 100）
  const mvVol = Number((ui.settings as any).mvVolume)
  if (Number.isFinite(mvVol) && mvVol > 0) v.volume = Math.max(0, Math.min(1, mvVol / 100))
  const cid = session.current.value?.cid
  const resume = cid ? session.savedPosition(cid) : 0
  if (resume > 15) {
    v.currentTime = resume
    ui.toast('已从上次位置继续播放', 'info', 1800)
  }
  void v.play().catch(() => undefined)
}

function onTime(t: number): void {
  curTime.value = t
  const cid = session.current.value?.cid
  // F-15：「记忆播放进度」开关关闭时不写续播点
  if (cid && (ui.settings as any).mvRememberProgress !== false) {
    session.rememberPosition(cid, t, duration.value || 0)
  }
}

function onEnded(): void {
  playing.value = false
  if (loopMode.value === 'one') {
    seekTo(0)
    void videoEl.value?.play().catch(() => undefined)
    return
  }
  const list = session.parts.value
  const cur = session.current.value
  const i = cur ? list.findIndex(p => p.cid === cur.cid) : -1
  if (loopMode.value === 'list' && i >= 0 && i < list.length - 1) {
    void pickPart(list[i + 1]!)
    return
  }
  // 规格 2.14 自动连播：分P 播完且无下一P → 相关推荐第一条（toast 可取消）
  if ((ui.settings as any).mvAutoNext !== false && session.related.value.length) {
    const nextVideo = session.related.value[0]!
    ui.toast(`即将播放：${nextVideo.title || '相关推荐'}`, 'info', 3000)
    window.setTimeout(() => {
      if (!playing.value && curTime.value >= (duration.value || 0) - 0.6) openVideo(nextVideo)
    }, 3000)
    return
  }
  showControls.value = true
}

function openVideo(item: MvItem): void {
  void router.push(`/mv/${item.bvid}`)
}

/* ---------------- 键盘快捷键（2.5 / 2.7 / 1.9 对齐） ---------------- */
function onKey(e: KeyboardEvent): void {
  const el = e.target as HTMLElement | null
  if (el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.isContentEditable)) return
  switch (e.key) {
    case ' ':
      e.preventDefault()
      togglePlay()
      break
    case 'ArrowRight':
      e.preventDefault()
      nudge(e.ctrlKey || e.metaKey ? 30 : 5)
      break
    case 'ArrowLeft':
      e.preventDefault()
      nudge(e.ctrlKey || e.metaKey ? -30 : -5)
      break
    case 'ArrowUp':
      e.preventDefault()
      if (videoEl.value) videoEl.value.volume = Math.min(1, videoEl.value.volume + 0.05)
      poke()
      break
    case 'ArrowDown':
      e.preventDefault()
      if (videoEl.value) videoEl.value.volume = Math.max(0, videoEl.value.volume - 0.05)
      poke()
      break
    case 'f':
    case 'F':
      toggleFullscreen()
      break
    case 'Escape':
      if (document.fullscreenElement) void document.exitFullscreen()
      break
    default:
      break
  }
}

/* ---------------- 工具 ---------------- */
function fmt(t: number): string {
  const s = Math.max(0, Math.floor(t || 0))
  const m = Math.floor(s / 60)
  const r = s % 60
  return `${String(m).padStart(2, '0')}:${String(r).padStart(2, '0')}`
}

/* ---------------- 生命周期 ---------------- */
onMounted(async () => {
  // F-15：默认画质按设置（0=自动走源默认档）
  const defaultQn = Number((ui.settings as any).mvQuality) || 0
  offExtract = on('audio:extract:progress', (p: any) => {
    if (!p || p.id !== extractId.value) return
    if (p.error) {
      ui.toast(p.error, 'error', 2200)
      extractId.value = ''
      extractPct.value = undefined
      return
    }
    extractPct.value = Number(p.pct) || 0
    if (p.pct >= 100 || p.file) {
      extractId.value = ''
      extractPct.value = undefined
      ui.toast('已保存为 MP3 并加入本地曲库', 'success', 2400)
    }
  })
  const resume = await session.load(Number(route.query.p) || 1)
  if (defaultQn && !session.qn.value && session.current.value) {
    await session.selectPart(session.current.value, defaultQn)
  }
  poke()
  window.addEventListener('keydown', onKey)
  window.clearInterval(resumeTimer)
  resumeTimer = window.setInterval(() => {
    const cid = session.current.value?.cid
    if (cid && playing.value) session.rememberPosition(cid, curTime.value, duration.value || 0)
  }, 5000)
  if (resume) ui.toast('已恢复到上次播放进度', 'info', 1600)
})

onBeforeUnmount(() => {
  window.clearTimeout(hideTimer)
  window.clearInterval(resumeTimer)
  window.removeEventListener('keydown', onKey)
  if (offExtract) offExtract()
  if (isDesktop) {
    const url = session.src.value
    if (url) void call('video:cache:release', { url }).catch(() => undefined)
  }
})

watch(playing, v => {
  if (v) poke()
  else showControls.value = true
})
</script>

<template>
  <div class="mvp" :class="{ car }">
    <VideoStage
      v-if="session.src.value"
      ref="stage"
      class="stage"
      :src="session.src.value"
      :poster="session.poster.value"
      :fit="fill"
      :ab-a="abA"
      :ab-b="abB"
      :duration="duration"
      :rate="rate"
      :auto-hide="!car"
      @loaded="onLoaded"
      @time="onTime"
      @ended="onEnded"
      @toggle="togglePlay"
      @tap="poke"
      @seek="seekTo"
      @volume="() => undefined"
    >
      <template #overlay>
        <SubtitleOverlay :text="activeSub" :car="car" />
        <DanmakuLayer
          v-if="ui.settings.danmakuEnabled && !car"
          :video="videoEl"
          :items="session.danmaku.value"
          :enabled="ui.settings.danmakuEnabled"
          :opacity="Number((ui.settings as any).danmakuOpacity ?? 100) / 100"
          :font-size="(ui.settings as any).danmakuFontSize || 'medium'"
          :speed="(ui.settings as any).danmakuSpeed || 'normal'"
          :area="(ui.settings as any).danmakuArea || 'quarter'"
          :anti-subtitle="!!(ui.settings as any).danmakuAntiSubtitle"
          :block-words="(ui.settings as any).danmakuBlockWords || ''"
        />

        <div class="top" :class="{ hide: !showControls }">
          <button class="ghost" aria-label="返回" @click="router.back()">
            <Icon name="shrink" :size="18" />
          </button>
          <div class="meta">
            <b>{{ session.title.value }}</b>
            <span>{{ session.author.value }}</span>
          </div>
          <div class="top-right">
            <span class="fit" @click="cycleFill">{{ fitLabel }}</span>
            <button v-if="!car" class="ghost" aria-label="设置" @click="settingsOpen = !settingsOpen">
              <Icon name="settings" :size="17" />
            </button>
          </div>
        </div>

        <button v-if="!playing" class="center-play" aria-label="播放" @click="togglePlay">
          <Icon name="play" :size="30" />
        </button>

        <div class="bar" :class="{ hide: !showControls, car }">
          <ProgressBar
            class="progress"
            :position="curTime"
            :duration="duration"
            variant="desktop"
            :show-time="false"
            accent="#f472b6"
            @seek="seekTo"
          />
          <div class="bar-row">
            <button class="ghost" aria-label="上一P" @click="prevPart">
              <Icon name="prev" :size="16" />
            </button>
            <button class="ghost" aria-label="播放暂停" @click="togglePlay">
              <Icon :name="playing ? 'pause' : 'play'" :size="20" />
            </button>
            <button class="ghost" aria-label="下一P" @click="nextPart">
              <Icon name="next" :size="16" />
            </button>
            <span class="time">{{ fmt(curTime) }} / {{ fmt(duration) }}</span>
            <div class="spacer" />
            <span v-if="car" class="tag">音频模式</span>
            <template v-else>
              <button class="txt" @click="cycleLoopMode">{{ LOOP_LABEL[loopMode] }}</button>
              <button class="txt" @click="markAB">{{ abLabel }}</button>
              <button class="txt" @click="setRate(rate === 2 ? 0.5 : RATES[RATES.indexOf(rate) + 1] || 1)">{{ rate }}x</button>
              <button class="ghost" aria-label="音频模式" @click="enterAudioMode">
                <Icon name="headphones" :size="17" />
              </button>
              <button class="ghost" aria-label="画中画" @click="togglePip">
                <Icon name="pip" :size="17" />
              </button>
              <button class="ghost" aria-label="截图" @click="screenshot">
                <Icon name="camera" :size="17" />
              </button>
              <button class="ghost" aria-label="缓存" @click="toggleCache">
                <Icon :name="cached ? 'download-filled' : 'download'" :size="17" />
              </button>
              <button class="ghost" aria-label="全屏" @click="toggleFullscreen">
                <Icon name="expand" :size="17" />
              </button>
            </template>
          </div>
        </div>
      </template>
    </VideoStage>

    <div v-else class="placeholder">
      <Icon name="video" :size="36" />
      <p>{{ session.error.value || (session.loading.value ? '正在解析视频…' : '暂无视频源') }}</p>
      <button v-if="session.error.value" class="retry" @click="session.load(1)">重试</button>
    </div>

    <AudioModeView
      v-if="audioMode"
      class="audio"
      :title="session.title.value"
      :singer="session.author.value"
      :cover="frameCover || session.poster.value"
      :cur-time="curTime"
      :duration="duration"
      :playing="playing"
      :loop-label="LOOP_LABEL[loopMode]"
      :rate-label="`${rate}x`"
      :car="car"
      @toggle="togglePlay"
      @seek="seekTo"
      @prev="prevPart"
      @next="nextPart"
      @cycle-loop="cycleLoopMode"
      @cycle-rate="cycleRateMode"
      @open-eq="eqOpen = true"
      @exit="exitAudioMode"
      @extract="startExtract"
      @extract-cancel="cancelExtractTask"
      :extract-pct="extractPct"
    />

    <PlaySettingsSheet
      :open="settingsOpen"
      variant="popover"
      :qualities="qualityOptions"
      :quality="String(session.qn.value)"
      :rate="rate"
      :fill="fill"
      :loop-mode="loopMode"
      :ab-a="abA"
      :ab-b="abB"
      :pip-supported="true"
      :audio-mode="audioMode"
      @close="settingsOpen = false"
      @quality="changeQn"
      @rate="setRate"
      @fill="cycleFill"
      @loop="setLoop"
      @ab="markAB"
      @pip="togglePip"
      @audio="enterAudioMode"
      @subtitle="onSubtitle"
      @subtitle-load="subFileInput?.click()"
      @shot="screenshot"
      @audio-only="startExtract"
      :subtitle-delay="subOffset"
    />

    <input ref="subFileInput" type="file" accept=".srt,.ass,.vtt,text/plain" style="display: none" @change="onSubtitleFile" />

    <section v-if="!audioMode" class="below">
      <div class="parts" v-if="session.parts.value.length > 1">
        <h4>选集 · {{ session.parts.value.length }}</h4>
        <div class="pgrid">
          <button
            v-for="p in session.parts.value"
            :key="p.cid"
            class="prow"
            :class="{ on: p.cid === session.current.value?.cid }"
            @click="pickPart(p)"
          >
            <span class="pno">P{{ p.page }}</span>
            <span class="pt">{{ p.title }}</span>
          </button>
        </div>
      </div>
      <div class="related">
        <h4>相关推荐</h4>
        <div class="rgrid">
          <button v-for="v in session.related.value" :key="v.bvid" class="rcard" @click="openVideo(v)">
            <span class="rpic" :style="v.pic ? { backgroundImage: `url(${v.pic})` } : undefined" />
            <span class="rt">{{ v.title }}</span>
          </button>
        </div>
      </div>
    </section>

    <EqPanel v-if="eqOpen" @close="eqOpen = false" />
  </div>
</template>

<style scoped>
.mvp {
  min-height: 100%;
  display: flex;
  flex-direction: column;
  background: #000;
  color: #ececf1;
}
.stage {
  width: 100%;
  aspect-ratio: 16 / 9;
  background: #000;
}
.mvp.car .stage {
  aspect-ratio: auto;
  flex: 1;
}
.top {
  position: absolute;
  inset: 0 0 auto 0;
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 12px 16px;
  background: linear-gradient(180deg, rgba(0, 0, 0, 0.72), transparent);
  transition: opacity 200ms ease;
}
.top.hide,
.bar.hide {
  opacity: 0;
  pointer-events: none;
}
.meta {
  flex: 1;
  min-width: 0;
}
.meta b {
  display: block;
  font-size: 14px;
  font-weight: 600;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.meta span {
  display: block;
  font-size: 11px;
  color: #9b9ba8;
}
.top-right {
  display: flex;
  align-items: center;
  gap: 8px;
}
.fit {
  font-size: 12px;
  color: #9b9ba8;
  padding: 4px 10px;
  border-radius: 999px;
  background: rgba(255, 255, 255, 0.08);
  cursor: pointer;
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
.ghost:hover {
  background: rgba(255, 255, 255, 0.1);
}
.center-play {
  position: absolute;
  left: 50%;
  top: 50%;
  transform: translate(-50%, -50%);
  width: 64px;
  height: 64px;
  display: grid;
  place-items: center;
  border: 0;
  border-radius: 50%;
  background: rgba(11, 11, 16, 0.62);
  color: #fff;
  cursor: pointer;
}
.bar {
  position: absolute;
  inset: auto 0 0 0;
  height: 48px;
  padding: 0 16px;
  display: flex;
  flex-direction: column;
  justify-content: center;
  background: linear-gradient(0deg, rgba(0, 0, 0, 0.82), transparent);
  transition: opacity 200ms ease;
}
.bar.car {
  height: 56px;
}
.progress {
  width: 100%;
}
.bar-row {
  display: flex;
  align-items: center;
  gap: 8px;
  height: 32px;
}
.time {
  font-size: 12px;
  color: rgba(255, 255, 255, 0.8);
  font-variant-numeric: tabular-nums;
}
.spacer {
  flex: 1;
}
.txt {
  border: 0;
  background: rgba(255, 255, 255, 0.1);
  color: #ececf1;
  font-size: 12px;
  padding: 5px 10px;
  border-radius: 999px;
  cursor: pointer;
}
.tag {
  font-size: 13px;
  color: #fbbf24;
}
.placeholder {
  flex: 1;
  display: grid;
  place-items: center;
  gap: 10px;
  color: #9b9ba8;
  font-size: 13px;
}
.retry {
  border: 1px solid #262633;
  background: transparent;
  color: #f472b6;
  border-radius: 999px;
  padding: 8px 18px;
  cursor: pointer;
}
.audio {
  position: fixed;
  inset: 0;
  z-index: 60;
}
.below {
  padding: 18px 20px 40px;
  display: grid;
  gap: 20px;
}
.below h4 {
  margin: 0 0 10px;
  font-size: 13px;
  color: #9b9ba8;
  font-weight: 500;
}
.pgrid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(180px, 1fr));
  gap: 8px;
}
.prow {
  display: flex;
  align-items: center;
  gap: 8px;
  height: 38px;
  padding: 0 10px;
  border-radius: 10px;
  border: 1px solid #262633;
  background: rgba(255, 255, 255, 0.03);
  color: #ececf1;
  font-size: 12px;
  text-align: left;
  cursor: pointer;
}
.prow.on {
  border-color: #f472b6;
  color: #f472b6;
}
.pno {
  color: #9b9ba8;
  flex: none;
}
.pt {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.rgrid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(200px, 1fr));
  gap: 12px;
}
.rcard {
  border: 0;
  background: transparent;
  padding: 0;
  text-align: left;
  color: #ececf1;
  cursor: pointer;
}
.rpic {
  display: block;
  width: 100%;
  aspect-ratio: 16 / 9;
  border-radius: 10px;
  background: #13131b center/cover no-repeat;
}
.rt {
  display: block;
  margin-top: 6px;
  font-size: 12px;
  line-height: 1.35;
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
}
</style>
