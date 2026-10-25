<script setup lang="ts">
/**
 * 手机 / 平板视频播放页
 *
 * 默认形态 = 图2（B站移动端）：页面 = 内嵌播放器（contain、页内播放、非全屏）
 * + 播放器下方信息区三段式（精简）
 *   ① 简介（标题/播放量/发布时间，超 3 行折叠「展开/收起」）
 *   ② 更多推荐（缩略图 160×90 + 标题 + UP主 + 播放量 + 时长角标）
 *   ③ 「加载更多」按钮（3.15.7：宽 200/高 40/圆角 20；加载中/到底/失败冷却）
 * 全屏是用户主动选择（点全屏按钮），进入后按 3.15.6 矩阵适配（VideoStage）；
 * 禁止「视频铺满竖屏 + 信息浮层压画面」（P18/P19 图1 错误形态）。
 * 弹幕入口在控制条（弹幕开关 + 输入框），不在页面信息区。
 * 播完态：遮罩 + 推荐面板 + 右下 48px 重播按钮 + ~2s 自动连播（可取消）。
 */
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import Icon from '@/components/Icon.vue'
import DanmakuLayer from '@/components/DanmakuLayer.vue'
import EqPanel from '@/components/player/EqPanel.vue'
import AudioModeView from '@/player-video/components/AudioModeView.vue'
import VideoStage from '@/player-video/components/VideoStage.vue'
import PlaySettingsSheet from '@/player-video/components/PlaySettingsSheet.vue'
import ControlBar from '@/player-video/components/ControlBar.vue'
import { useVideoSession } from '@/player-video/useVideoSession'
import { useAudioModeBridge } from '@/player-video/useAudioModeBridge'
import { parseSubtitles, activeCueAt, nudgeSubtitleOffset, type SubCue } from '@/player-video/subtitles'
import SubtitleOverlay from '@/player-video/components/SubtitleOverlay.vue'
import { useUiStore } from '@/stores/ui'
import type { MvItem } from '@shared/types'
import type { QualityOption } from '@/player-video/components/PlaySettingsSheet.vue'

defineOptions({ name: 'MobileMvPlayer' })

const route = useRoute()
const router = useRouter()
const ui = useUiStore()

const bvid = computed(() => String(route.params.id || route.params.bvid || ''))
// MV/视频统一路由 ：/mv/:source/:id；旧 /mv/:bvid 视作 bili
const source = computed(() => String((route.params as any).source || 'bili'))
const isBili = computed(() => !source.value || source.value === 'bili')
const session = useVideoSession(source, bvid, {
 // 列表页带过来的兜底元数据
  title: String(route.query.title || ''),
  pic: String(route.query.pic || ''),
  author: String(route.query.author || ''),
  durationSec: Number(route.query.dur || 0) || 0,
})

const stage = ref<InstanceType<typeof VideoStage> | null>(null)
const videoEl = computed(() => stage.value?.el || null)

const playing = ref(false)
const curTime = ref(0)
const duration = ref(0)
const rate = ref(1)
const fill = ref<'contain' | 'cover' | 'fill' | 'actual' | 'force16x9'>('contain')
const loopMode = ref<'off' | 'one' | 'list'>('off')
const abA = ref<number | null>(null)
const abB = ref<number | null>(null)
const showControls = ref(true)
const sheetOpen = ref(false)
const partsOpen = ref(false)
const eqOpen = ref(false)
const audioMode = ref(false)
/** /P15：CSS 全屏态（用户主动进入，非自动；F-40 禁 webkitEnterFullscreen） */
const fullscreen = ref(false)
/** 播完态（B站）：遮罩 + 推荐面板 + 重播 */
const ended = ref(false)
let autoNextTimer = 0

const FILL_ORDER = ['contain', 'cover', 'fill', 'actual', 'force16x9'] as const
const FILL_LABEL: Record<string, string> = { contain: '适应窗口', cover: '填充', fill: '拉伸', actual: '100%', force16x9: '16:9' }
const RATES = [0.5, 0.75, 1, 1.25, 1.5, 2]

/* ---------------- 简介（三段式 ①，超 3 行折叠） ---------------- */
const descExpanded = ref(false)
const intro = computed(() => ({
  title: session.title.value,
  play: Number(session.info.value?.play || 0),
  pubdate: Number(session.info.value?.pubdate || 0),
  desc: String(session.info.value?.desc || ''),
}))
const pubText = computed(() => {
  const t = intro.value.pubdate
  if (!t) return ''
  const d = new Date(t * 1000)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
})
function fmtPlay(n: number): string {
  if (n >= 100000000) return `${(n / 100000000).toFixed(1)}亿`
  if (n >= 10000) return `${(n / 10000).toFixed(1)}万`
  return String(n || 0)
}

/* ---------------- 规格 2.11 / ：外挂字幕（srt/ass + 延迟 ±0.5s） ---------------- */
const subCues = ref<SubCue[]>([])
const subOffset = ref(Number(localStorage.getItem('xinyuan_subtitle_offset') || '0') || 0)
const subFileInput = ref<HTMLInputElement | null>(null)
const activeSub = computed(() => activeCueAt(subCues.value, curTime.value, subOffset.value)?.text || '')

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
const frameCover = ref('')

let hideTimer = 0
let resumeTimer = 0

const LOOP_LABEL: Record<'off' | 'one' | 'list', string> = { off: '不循环', one: '单片循环', list: '列表循环' }

const qualityOptions = computed<QualityOption[]>(() =>
  session.qualities.value.map(q => ({ id: String(q.qn), label: q.label }))
)
const curQualityLabel = computed(() => {
  const q = session.qualities.value.find(x => x.qn === session.qn.value)
  return q?.label || '自动'
})

/* ---------------- 控件显隐（3s 无操作隐藏；全屏态与内嵌态一致） ---------------- */
function poke(): void {
  showControls.value = true
  window.clearTimeout(hideTimer)
  hideTimer = window.setTimeout(() => {
    if (playing.value && !ended.value) showControls.value = false
  }, 3000)
}

/* ---------------- 播放控制 ---------------- */
function togglePlay(): void {
  const v = videoEl.value
  if (!v) return
 // 先按目标态翻 UI，video 的 play/pause 事件随后会校正
  playing.value = v.paused
  if (v.paused) void v.play().catch(() => { playing.value = false })
  else v.pause()
  poke()
}

function seekTo(sec: number): void {
  const v = videoEl.value
  if (!v) return
  v.currentTime = Math.max(0, Math.min(sec, duration.value || v.duration || 0))
}

function setRate(r: number): void {
  rate.value = r
  if (videoEl.value) videoEl.value.playbackRate = r
  sheetOpen.value = false
}

function cycleFill(): void {
  const i = FILL_ORDER.indexOf(fill.value)
  fill.value = FILL_ORDER[(i + 1) % FILL_ORDER.length]!
}

function setLoop(mode: 'off' | 'one' | 'list'): void {
  loopMode.value = mode
  sheetOpen.value = false
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
  sheetOpen.value = false
}

/** 画质切换（ControlBar 清晰度按钮 → 打开设置面板画质区） */
function openQuality(): void {
  sheetOpen.value = true
}

async function togglePip(): Promise<void> {
  const v = videoEl.value as any
  if (!v) return
  try {
    if ((document as any).pictureInPictureElement) await (document as any).exitPictureInPicture()
    else if (v.requestPictureInPicture) await v.requestPictureInPicture()
    else if (v.webkitSetPresentationMode) v.webkitSetPresentationMode('picture-in-picture')
    else ui.toast('当前系统不支持画中画', 'info', 1600)
  } catch {
    ui.toast('画中画启动失败', 'error', 1600)
  }
}

/**
 * /P15：全屏 = 用户主动选择；F-40 = CSS 全屏（不用 webkitEnterFullscreen）。
 * v1.0.0 用户口径修订：移动端全屏后**真正旋转方向**——进入全屏锁横屏、
 * 退出恢复系统方向（WebView 里 CSS 只换布局不转屏，必须走原生
 * SwBridge.setOrientation，Android 侧 setRequestedOrientation 落地）。
 */
function setOrientation(orientation: 'landscape' | 'unlock'): void {
  try {
    const cap: any = (globalThis as any).Capacitor
    if (cap?.nativePromise) void cap.nativePromise('SwBridge', 'setOrientation', { orientation }).catch(() => undefined)
  } catch {
    /* 非真机环境（冒烟/浏览器）忽略 */
  }
}

function toggleFullscreen(): void {
  fullscreen.value = !fullscreen.value
  setOrientation(fullscreen.value ? 'landscape' : 'unlock')
  poke()
}

/* ---------------- 弹幕（入口在控制条） ---------------- */
function onDanmaku(on: boolean): void {
  session.setDanmakuEnabled(on)
}
function onDanmakuSend(text: string): void {
  ui.toast(isBili.value ? `弹幕已发送（本地回显）：${text}` : '当前视频不支持弹幕', 'info', 1600)
}

/* ---------------- 规格 2.12：仅下载音频 / 提取 ---------------- */
const extractingAudio = ref(false)
async function startExtract(): Promise<void> {
  if (extractingAudio.value) return
  const url = session.rawUrl.value
  if (!url) {
    ui.toast('当前没有可提取的音频流', 'error', 1800)
    return
  }
  extractingAudio.value = true
  try {
    const res = await fetch(`/swmedia/?u=${encodeURIComponent(url)}`)
    if (!res.ok) throw new Error(`音频获取失败（HTTP ${res.status}）`)
    const buf = new Uint8Array(await res.arrayBuffer())
    const ext = /\.m4a(\?|$)/i.test(url) ? 'm4a' : /\.flac(\?|$)/i.test(url) ? 'flac' : 'mp3'
    const mime = ext === 'm4a' ? 'audio/mp4' : ext === 'flac' ? 'audio/flac' : 'audio/mpeg'
    const { nativeCall } = await import('@/mobile/bridge')
    const { bytesToBase64 } = await import('@/mobile/base64')
    await nativeCall('SwBridge', 'saveToMedia', {
      name: `${(session.title.value || '视频音频').replace(/[\/:*?"<>|]/g, '_')}.${ext}`,
      mime,
 //分块 base64，且不再静默截断到 8MB
      data: bytesToBase64(buf),
    })
    ui.toast('音频已保存到媒体库', 'success', 2000)
  } catch (e: any) {
    ui.toast(e?.message || '提取失败', 'error', 2000)
  } finally {
    extractingAudio.value = false
  }
}

/* ---------------- 规格 2.15：截图（移动端存系统媒体库） ---------------- */
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
    const { nativeCall } = await import('@/mobile/bridge')
    await nativeCall('SwBridge', 'saveToMedia', {
      name: `${session.title.value || '视频截图'}.png`,
      mime: 'image/png',
      data: dataUrl.split(',')[1] || '',
    })
    ui.toast('截图已保存到媒体库', 'success', 2000)
  } catch (e: any) {
    ui.toast(e?.message || '截图失败', 'error', 2000)
  }
}

/* ---------------- 音频模式 ---------------- */
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
  sheetOpen.value = false
}

function exitAudioMode(): void {
  audioMode.value = false
  poke()
}

/* 规格 / ：音频模式下系统返回先切回视频模式（逐级） */
useAudioModeBridge(audioMode, enterAudioMode, exitAudioMode)

function cycleLoopMode(): void {
  const order = ['off', 'one', 'list'] as const
  const i = order.indexOf(loopMode.value)
  loopMode.value = order[(i + 1) % order.length]!
}

function cycleRateMode(): void {
  const i = RATES.indexOf(rate.value)
  setRate(RATES[(i + 1) % RATES.length]!)
}

/* ---------------- 分 P（右侧栏/选集） ---------------- */
async function pickPart(part: { cid: string; page: number; title: string }): Promise<void> {
  partsOpen.value = false
  ended.value = false
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
  else if (session.related.value.length) void onOpenVideo(session.related.value[0]!)
  else ui.toast('已经是最后一个分P', 'info', 1400)
}

/* ---------------- 事件 ---------------- */
async function onLoaded(dur: number): Promise<void> {
 // / ：MV 音量设置真实生效
  {
    const mvVol = Number((ui.settings as any).mvVolume)
    if (Number.isFinite(mvVol) && mvVol > 0 && videoEl.value) {
      videoEl.value.volume = Math.max(0, Math.min(1, mvVol / 100))
    }
  }
  duration.value = dur
  ended.value = false
  const v = videoEl.value
  if (!v) return
  v.playbackRate = rate.value
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
  if (cid) session.rememberPosition(cid, t, duration.value || 0)
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
  // 播完态（B站）：遮罩 + 推荐面板 + 重播；~2s 自动连播（可关，F-15 mvAutoNext）
  ended.value = true
  showControls.value = false
  window.clearTimeout(autoNextTimer)
  if ((ui.settings as any).mvAutoNext !== false) {
    autoNextTimer = window.setTimeout(() => {
      if (ended.value) {
        const next =
          (i >= 0 && i < list.length - 1 && list[i + 1] && { bvid, ...list[i + 1]! } as any) ||
          session.related.value[0]
        if (next) void onOpenVideo(next as MvItem)
      }
    }, 2000)
  }
}

/** 播完态：重播（显式按钮，不是点画面重播） */
function replay(): void {
  ended.value = false
  window.clearTimeout(autoNextTimer)
  seekTo(0)
  void videoEl.value?.play().catch(() => undefined)
  poke()
}

function onOpenVideo(item: MvItem): void {
  ended.value = false
  window.clearTimeout(autoNextTimer)
  void router.push(`/mv/${item.source || 'bili'}/${item.sourceId || item.bvid || ''}`)
}

/* ---------------- 生命周期 ---------------- */
onMounted(async () => {
  const resume = await session.load(Number(route.query.p) || 1)
  // 3.15.7：首屏推荐第一页
  void session.loadRelated()
  poke()
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
  window.clearTimeout(autoNextTimer)
  // 离开播放页：无论是否处于全屏都恢复系统方向，避免方向锁残留
  setOrientation('unlock')
})

watch(playing, v => {
  if (v) poke()
  else showControls.value = true
})
</script>

<template>
  <div class="mv" :class="{ fullscreen }">
    <!-- 页面主体（图2 B站形态：内嵌播放器在上 + 信息区三段式在下） -->
    <template v-if="!fullscreen">
      <!-- 内嵌播放器（内嵌行：contain + 封面静态模糊背景） -->
      <div class="stage-wrap">
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
          :auto-hide="true"
          :resume-at="session.current.value?.cid ? session.savedPosition(session.current.value.cid) : 0"
          @loaded="onLoaded"
          @time="onTime"
          @ended="onEnded"
          @playing="v => (playing = v)"
          @toggle="togglePlay"
          @tap="poke"
          @seek="seekTo"
          @volume="() => undefined"
        >
          <template #overlay>
            <DanmakuLayer
              v-if="ui.settings.danmakuEnabled && isBili"
              :video="videoEl"
              :items="session.danmaku.value"
              :enabled="ui.settings.danmakuEnabled"
              :opacity="Number((ui.settings as any).danmakuOpacity ?? 100) / 100"
              :font-size="((ui.settings as any).danmakuFontSize || 'medium')"
              :speed="((ui.settings as any).danmakuSpeed || 'normal')"
              :area="((ui.settings as any).danmakuArea || 'quarter')"
              :anti-subtitle="!!(ui.settings as any).danmakuAntiSubtitle"
              :block-words="(ui.settings as any).danmakuBlockWords || ''"
            />
            <SubtitleOverlay :text="activeSub" />

            <!-- 播放中中央大按钮（2s 后消失） -->
            <button v-if="!playing && !ended" class="big-play" aria-label="播放" @click="togglePlay">
              <Icon name="play" :size="30" />
            </button>

            <!-- 返回按钮（内嵌态叠在播放器左上） -->
            <button class="back-btn" aria-label="返回" @click="router.back()">
              <Icon name="chevron-left" :size="20" />
            </button>

            <!-- 播完态：遮罩 + 推荐面板 + 重播（画面内浮层，与信息区不冲突） -->
            <div v-if="ended" class="ended-mask" @click.stop>
              <div class="ended-panel">
                <b>更多推荐</b>
                <button
                  v-for="v in session.related.value.slice(0, 3)"
                  :key="v.bvid || v.sourceId"
                  class="ended-row"
                  @click="onOpenVideo(v)"
                >
                  <span class="e-pic" :style="v.pic ? { backgroundImage: `url(${v.pic})` } : undefined" />
                  <span class="e-title">{{ v.title }}</span>
                </button>
              </div>
              <button class="replay" aria-label="重播" @click="replay">
                <Icon name="refresh" :size="22" />
              </button>
            </div>

            <!-- 控制条（3s 自动隐藏；弹幕开关 + 输入框在此） -->
            <ControlBar
              :playing="playing"
              :position="curTime"
              :duration="duration"
              :quality-label="curQualityLabel"
              :parts-count="session.parts.value.length"
              :rate="rate"
              :fullscreen="fullscreen"
              :danmaku-supported="isBili"
              :danmaku-enabled="!!ui.settings.danmakuEnabled"
              :title="session.title.value"
              :author="session.author.value"
              :visible="showControls && !ended"
              variant="phone"
              @toggle="togglePlay"
              @next="nextPart"
              @seek="seekTo"
              @quality="openQuality"
              @parts="partsOpen = true"
              @rate="cycleRateMode"
              @subtitle="onSubtitle(0.5)"
              @settings="sheetOpen = true"
              @pip="togglePip"
              @fullscreen="toggleFullscreen"
              @danmaku="onDanmaku"
              @danmaku-send="onDanmakuSend"
            />
          </template>
        </VideoStage>

        <div v-else class="placeholder">
          <Icon name="video" :size="34" />
          <p>{{ session.error.value || (session.loading.value ? '正在解析视频…' : '暂无视频源') }}</p>
          <button v-if="session.error.value" class="retry" @click="session.load(1)">重试</button>
        </div>
      </div>

 <!-- 信息区三段式（① 简介 → ② 更多推荐 → ③ 加载更多；无 UP主区/互动区） -->
      <div class="info-flow">
        <!-- ① 简介（标题/播放量/发布时间，超 3 行折叠） -->
        <section class="intro">
          <h1 class="i-title">{{ intro.title }}</h1>
          <p class="i-stat">
            <span>{{ fmtPlay(intro.play) }} 播放</span>
            <span v-if="pubText">{{ pubText }}</span>
            <span v-if="intro.desc" class="i-toggle" @click="descExpanded = !descExpanded">
              {{ descExpanded ? '收起' : '展开' }}
            </span>
          </p>
          <p v-if="intro.desc" class="i-desc" :class="{ expanded: descExpanded }">{{ intro.desc }}</p>
        </section>

        <!-- ② 更多推荐（缩略图 160×90 + 标题 14px + UP主 12px + 播放量 + 时长角标） -->
        <section class="recs">
          <h4>更多推荐</h4>
          <button v-for="v in session.related.value" :key="v.bvid || v.sourceId" class="rcard" @click="onOpenVideo(v)">
            <span class="rpic" :style="v.pic ? { backgroundImage: `url(${v.pic})` } : undefined">
              <span v-if="v.duration" class="rdur">{{ v.duration }}</span>
            </span>
            <span class="rmeta">
              <span class="rt">{{ v.title }}</span>
              <span class="ra">{{ v.author }} · {{ fmtPlay(Number(v.play || 0)) }}播放</span>
            </span>
          </button>
        </section>

        <!-- ③ 加载更多按钮（3.15.7：显式条目，非自动无限滚动） -->
        <div v-if="session.related.value.length || session.relatedLoading.value" class="load-more">
          <button
            v-if="!session.relatedDone.value"
            class="lm-btn"
            :disabled="session.relatedLoading.value || session.relatedCooling.value"
            @click="session.retryRelated()"
          >
            <span v-if="session.relatedLoading.value" class="spin" />
            {{ session.relatedCooling.value ? '稍候再试' : session.relatedLoading.value ? '加载中…' : session.relatedFailed.value ? '加载失败，点击重试' : '加载更多' }}
          </button>
          <p v-else class="lm-end">没有更多了</p>
        </div>
      </div>
    </template>

 <!-- CSS 全屏态（用户主动进入；F-40 CSS 全屏；全屏后按 3.15.6 矩阵适配） -->
    <template v-else>
      <VideoStage
        v-if="session.src.value"
        ref="stage"
        class="stage fs"
        :src="session.src.value"
        :poster="session.poster.value"
        :fit="fill"
        :ab-a="abA"
        :ab-b="abB"
        :duration="duration"
        :rate="rate"
        :auto-hide="true"
        :fullscreen="true"
        @loaded="onLoaded"
        @time="onTime"
        @ended="onEnded"
        @toggle="togglePlay"
        @tap="poke"
        @seek="seekTo"
        @volume="() => undefined"
      >
        <template #overlay>
          <DanmakuLayer
            v-if="ui.settings.danmakuEnabled && isBili"
            :video="videoEl"
            :items="session.danmaku.value"
            :enabled="ui.settings.danmakuEnabled"
            :opacity="Number((ui.settings as any).danmakuOpacity ?? 100) / 100"
            :font-size="((ui.settings as any).danmakuFontSize || 'medium')"
            :speed="((ui.settings as any).danmakuSpeed || 'normal')"
            :area="((ui.settings as any).danmakuArea || 'quarter')"
            :anti-subtitle="!!(ui.settings as any).danmakuAntiSubtitle"
            :block-words="(ui.settings as any).danmakuBlockWords || ''"
          />
          <SubtitleOverlay :text="activeSub" />
          <button v-if="!playing && !ended" class="big-play" aria-label="播放" @click="togglePlay">
            <Icon name="play" :size="34" />
          </button>
          <div v-if="ended" class="ended-mask" @click.stop>
            <div class="ended-panel">
              <b>更多推荐</b>
              <button
                v-for="v in session.related.value.slice(0, 3)"
                :key="v.bvid || v.sourceId"
                class="ended-row"
                @click="onOpenVideo(v)"
              >
                <span class="e-pic" :style="v.pic ? { backgroundImage: `url(${v.pic})` } : undefined" />
                <span class="e-title">{{ v.title }}</span>
              </button>
            </div>
            <button class="replay" aria-label="重播" @click="replay">
              <Icon name="refresh" :size="22" />
            </button>
          </div>
          <ControlBar
            :playing="playing"
            :position="curTime"
            :duration="duration"
            :quality-label="curQualityLabel"
            :parts-count="session.parts.value.length"
            :rate="rate"
            :fullscreen="true"
            :danmaku-supported="isBili"
            :danmaku-enabled="!!ui.settings.danmakuEnabled"
            :title="session.title.value"
            :author="session.author.value"
            :visible="showControls && !ended"
            variant="phone"
            @toggle="togglePlay"
            @next="nextPart"
            @seek="seekTo"
            @quality="openQuality"
            @parts="partsOpen = true"
            @rate="cycleRateMode"
            @subtitle="onSubtitle(0.5)"
            @settings="sheetOpen = true"
            @pip="togglePip"
            @fullscreen="toggleFullscreen"
            @danmaku="onDanmaku"
            @danmaku-send="onDanmakuSend"
          />
        </template>
      </VideoStage>
    </template>

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
      @toggle="togglePlay"
      @seek="seekTo"
      @prev="prevPart"
      @next="nextPart"
      @cycle-loop="cycleLoopMode"
      @cycle-rate="cycleRateMode"
      @open-eq="eqOpen = true"
      @exit="exitAudioMode"
    />

    <Teleport to="body">
    <PlaySettingsSheet
      :open="sheetOpen"
      variant="sheet"
      :qualities="qualityOptions"
      :quality="String(session.qn.value)"
      :rate="rate"
      :fill="fill"
      :loop-mode="loopMode"
      :ab-a="abA"
      :ab-b="abB"
      :pip-supported="true"
      :audio-mode="audioMode"
      @close="sheetOpen = false"
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
    </Teleport>

    <input ref="subFileInput" type="file" accept=".srt,.ass,.vtt,text/plain" style="display: none" @change="onSubtitleFile" />

    <!-- 分集列表 -->
    <div v-if="partsOpen" class="mask" @click.self="partsOpen = false">
      <div class="panel">
        <div class="grip" />
        <header class="phead">
          <b>选集 · {{ session.parts.value.length }}</b>
          <button class="done" @click="partsOpen = false">关闭</button>
        </header>
        <div class="plist">
          <button
            v-for="p in session.parts.value"
            :key="p.cid"
            class="prow"
            :class="{ on: p.cid === session.current.value?.cid }"
            @click="pickPart(p)"
          >
            <span
              class="pthumb"
              :style="p.pic ? { backgroundImage: `url('${p.pic}')` } : undefined"
            >
              <span v-if="!p.pic" class="pno">P{{ p.page }}</span>
            </span>
            <span class="pt">{{ p.title }}</span>
          </button>
        </div>
      </div>
    </div>

    <EqPanel v-if="eqOpen" @close="eqOpen = false" />
  </div>
</template>

<style scoped>
.mv {
  position: fixed;
  inset: 0;
  display: flex;
  flex-direction: column;
  background: var(--video-bg, var(--bg));
  color: var(--text);
  overflow-y: auto;
}
.mv.fullscreen {
  overflow: hidden;
}
/* 内嵌播放器：页内 16:9 容器（图2 形态，非全屏） */
.stage-wrap {
  position: relative;
  width: 100%;
  aspect-ratio: 16 / 9;
  flex: none;
  background: var(--video-stage-bg, var(--bg));
}
.stage {
  width: 100%;
  height: 100%;
}
.stage.fs {
  width: 100vw;
  height: 100vh;
}
.placeholder {
  width: 100%;
  aspect-ratio: 16 / 9;
  display: grid;
  place-items: center;
  gap: 10px;
  color: var(--text-2);
  font-size: 13px;
}
.retry {
  border: 1px solid var(--line-2);
  background: transparent;
  color: #f472b6;
  border-radius: 999px;
  padding: 8px 18px;
}
.back-btn {
  position: absolute;
  left: 6px;
  top: 6px;
  width: 36px;
  height: 36px;
  display: grid;
  place-items: center;
  border: 0;
  border-radius: 50%;
  background: rgba(0, 0, 0, 0.32);
  color: #fff;
  z-index: 6;
}
.big-play {
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
  z-index: 6;
}
/* 播完态（B站）：遮罩 + 推荐面板 + 48px 灰色重播按钮 */
.ended-mask {
  position: absolute;
  inset: 0;
  z-index: 7;
  background: rgba(0, 0, 0, 0.66);
  display: flex;
  align-items: center;
  justify-content: center;
}
.ended-panel {
  width: min(320px, 76%);
  padding: 14px;
  border-radius: 14px;
  background: rgba(19, 19, 27, 0.92);
}
.ended-panel b {
  display: block;
  font-size: 13px;
  margin-bottom: 8px;
}
.ended-row {
  display: flex;
  align-items: center;
  gap: 8px;
  width: 100%;
  padding: 6px 0;
  border: 0;
  background: transparent;
  color: var(--text);
  text-align: left;
}
.e-pic {
  width: 96px;
  height: 54px;
  flex: none;
  border-radius: 6px;
  background: var(--bg-3) center/cover no-repeat;
}
.e-title {
  font-size: 12px;
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
}
.replay {
  position: absolute;
  right: 14px;
  bottom: 52px;
  width: 48px;
  height: 48px;
  display: grid;
  place-items: center;
  border: 0;
  border-radius: 50%;
  background: rgba(255, 255, 255, 0.16);
  color: var(--text);
}
/* 信息区三段式 */
.info-flow {
  flex: 1;
  padding: 12px 16px calc(28px + env(safe-area-inset-bottom, 0px));
}
.intro {
  border-bottom: 1px solid rgba(38, 38, 51, 0.8);
  padding-bottom: 12px;
}
.i-title {
  margin: 0;
  font-size: 16px;
  font-weight: 600;
  line-height: 1.45;
}
.i-stat {
  margin: 8px 0 0;
  display: flex;
  align-items: center;
  gap: 10px;
  font-size: 12px;
  color: var(--text-2);
}
.i-toggle {
  color: var(--text-2);
  cursor: pointer;
}
.i-desc {
  margin: 8px 0 0;
  font-size: 13px;
  line-height: 1.6;
  color: #c6c6d2;
  display: -webkit-box;
  -webkit-line-clamp: 3;
  -webkit-box-orient: vertical;
  overflow: hidden;
}
.i-desc.expanded {
  display: block;
  -webkit-line-clamp: unset;
}
.recs {
  padding-top: 12px;
}
.recs h4 {
  margin: 0 0 10px;
  font-size: 14px;
  font-weight: 600;
}
.rcard {
  display: flex;
  gap: 10px;
  width: 100%;
  padding: 0 0 14px;
  border: 0;
  background: transparent;
  text-align: left;
  color: var(--text);
}
.rpic {
  position: relative;
  width: 160px;
  height: 90px;
  flex: none;
  border-radius: 8px;
  background: var(--bg-3) center/cover no-repeat;
}
.rdur {
  position: absolute;
  right: 4px;
  bottom: 4px;
  padding: 1px 5px;
  border-radius: 4px;
  background: rgba(0, 0, 0, 0.7);
  color: #fff;
  font-size: 11px;
}
.rmeta {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 6px;
}
.rt {
  font-size: 14px;
  line-height: 1.4;
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
}
.ra {
  font-size: 12px;
  color: var(--text-2);
}
/* 3.15.7 加载更多按钮：宽 200/高 40/圆角 20/#1C1C27 hover var(--line-2) */
.load-more {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 10px;
  padding-top: 4px;
}
.lm-btn {
  width: 200px;
  height: 40px;
  border: 0;
  border-radius: 20px;
  background: var(--bg-3);
  color: var(--text-1, var(--text));
  font-size: 14px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
}
.lm-btn:hover:not(:disabled) {
  background: var(--line-2);
}
.lm-btn:disabled {
  opacity: 0.6;
  pointer-events: none;
}
.lm-btn:has(+ .lm-end) {
  display: none;
}
.spin {
  width: 16px;
  height: 16px;
  border: 2px solid var(--text-2);
  border-top-color: transparent;
  border-radius: 50%;
  animation: lm-rot 0.8s linear infinite;
}
@keyframes lm-rot {
  to {
    transform: rotate(360deg);
  }
}
.lm-end {
  margin: 0;
  font-size: 12px;
  color: var(--text-2);
  text-align: center;
}
.audio {
  position: fixed;
  inset: 0;
  z-index: 900;
}
.mask {
  position: fixed;
  inset: 0;
  z-index: 950;
  background: rgba(0, 0, 0, 0.55);
  display: flex;
  align-items: flex-end;
}
.panel {
  width: 100%;
  max-height: 62vh;
  overflow-y: auto;
  padding: 8px 16px calc(16px + env(safe-area-inset-bottom, 0px));
  border-radius: 18px 18px 0 0;
  background: var(--bg-3);
  border: 1px solid var(--line-2);
}
.grip {
  width: 36px;
  height: 4px;
  margin: 4px auto 8px;
  border-radius: 2px;
  background: rgba(255, 255, 255, 0.16);
}
.phead {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 2px 0 8px;
}
.done {
  border: 0;
  background: transparent;
  color: #f472b6;
  font-size: 14px;
}
.plist {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 8px;
  padding-bottom: 8px;
}
.prow {
  display: flex;
  align-items: center;
  gap: 8px;
  height: 48px;
  padding: 0 10px;
  border-radius: 10px;
  border: 1px solid var(--line-2);
  background: rgba(255, 255, 255, 0.03);
  color: var(--text);
  font-size: 12px;
  text-align: left;
}
.prow.on {
  border-color: #f472b6;
  color: #f472b6;
}
.pno {
  color: var(--text-2);
  flex: none;
}
/* 分P封面：pagelist.first_frame 直链，缺图时退回 P 序号 */
.pthumb {
  width: 56px;
  height: 32px;
  flex: none;
  border-radius: 6px;
  background-color: var(--bg-3);
  background-size: cover;
  background-position: center;
  background-repeat: no-repeat;
  display: grid;
  place-items: center;
  overflow: hidden;
}
.pt {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
</style>
