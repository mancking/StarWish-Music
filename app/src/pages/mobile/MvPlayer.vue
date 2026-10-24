<script setup lang="ts">
/**
 * 手机 / 平板视频播放页（规格书 2.1 ~ 2.12）
 *
 * 画面、AB 段回跳、亮度/音量/进度手势全部在 VideoStage 里；
 * 本页只负责取数据（useVideoSession）、控件显隐、设置面板与音频模式切换。
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
import type { MvItem } from '@shared/types'
import type { QualityOption } from '@/player-video/components/PlaySettingsSheet.vue'

defineOptions({ name: 'MobileMvPlayer' })

const route = useRoute()
const router = useRouter()
const ui = useUiStore()

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
const sheetOpen = ref(false)
const partsOpen = ref(false)
const eqOpen = ref(false)
const audioMode = ref(false)

/* 规格 2.11 / Bug 16：外挂字幕（srt/ass 解析 + 延迟 ±0.5s），替换僵尸按钮 */
const subCues = ref<SubCue[]>([])
const subOffset = ref(Number(localStorage.getItem('xinyuan_subtitle_offset') || '0') || 0)
const subFileInput = ref<HTMLInputElement | null>(null)
const activeSub = computed(() => activeCueAt(subCues.value, curTime.value, subOffset.value)?.text || '')

function onSubtitle(delta: number): void {
  subOffset.value = nudgeSubtitleOffset(subOffset.value, delta)
  localStorage.setItem('xinyuan_subtitle_offset', String(subOffset.value))
  ui.toast(`字幕偏移 ${subOffset.value > 0 ? '+' : ''}${subOffset.value}s`, 'info', 1400)
}

/* 规格 2.12：仅下载音频 —— 拉音频流直存媒体库（不转码，原容器保存） */
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
    await nativeCall('SwBridge', 'saveToMedia', {
      name: `${(session.title.value || '视频音频').replace(/[\/:*?"<>|]/g, '_')}.${ext}`,
      mime,
      data: btoa(String.fromCharCode(...buf.subarray(0, 8 * 1024 * 1024))),
    })
    ui.toast('音频已保存到媒体库', 'success', 2000)
  } catch (e: any) {
    ui.toast(e?.message || '提取失败', 'error', 2000)
  } finally {
    extractingAudio.value = false
  }
}

/* 规格 2.15：截图（移动端存系统媒体库） */
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

/* ---------------- 控件显隐（规格书 2.1：3 秒无操作隐藏） ---------------- */
function poke(): void {
  showControls.value = true
  window.clearTimeout(hideTimer)
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
  sheetOpen.value = false
}

function toggleFullscreen(): void {
  const v = videoEl.value
  if (!v) return
  if (document.fullscreenElement) void document.exitFullscreen()
  else void v.requestFullscreen?.().catch(() => undefined)
}

/* ---------------- 音频模式（规格书 2.12） ---------------- */
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
    /* 跨域帧不可导出时退回封面图 */
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
  partsOpen.value = false
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
  // Bug 37 / F-15：MV 音量设置真实生效
  {
    const mvVol = Number((ui.settings as any).mvVolume)
    if (Number.isFinite(mvVol) && mvVol > 0 && videoEl.value) {
      videoEl.value.volume = Math.max(0, Math.min(1, mvVol / 100))
    }
  }
  duration.value = dur
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
  // 规格 2.14 自动连播：相关推荐第一条（3 秒 toast，可返回取消）
  if ((ui.settings as any).mvAutoNext !== false && session.related.value.length) {
    const nextVideo = session.related.value[0]!
    ui.toast(`即将播放：${nextVideo.title || '相关推荐'}`, 'info', 3000)
    window.setTimeout(() => {
      if (!playing.value && curTime.value >= (duration.value || 0) - 0.6) onOpenVideo(nextVideo)
    }, 3000)
    return
  }
  showControls.value = true
}

function onOpenVideo(item: MvItem): void {
  void router.push(`/mv/${item.bvid}`)
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
  const resume = await session.load(Number(route.query.p) || 1)
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
})

watch(playing, v => {
  if (v) poke()
  else showControls.value = true
})
</script>

<template>
  <div class="mv">
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
          v-if="ui.settings.danmakuEnabled"
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

        <div class="topbar" :class="{ hide: !showControls }">
          <button class="ibtn" aria-label="返回" @click="router.back()">
            <Icon name="shrink" :size="20" />
          </button>
          <div class="tinfo">
            <b>{{ session.title.value }}</b>
            <span>{{ session.author.value }}</span>
          </div>
          <button class="ibtn" aria-label="分集" @click="partsOpen = true">
            <Icon name="list" :size="20" />
          </button>
        </div>

        <button v-if="!playing" class="big-play" aria-label="播放" @click="togglePlay">
          <Icon name="play" :size="30" />
        </button>

        <div class="ctrl" :class="{ hide: !showControls }">
          <div class="row-time">
            <span>{{ fmt(curTime) }}</span>
            <span>{{ fmt(duration) }}</span>
          </div>
          <ProgressBar
            class="bar"
            :position="curTime"
            :duration="duration"
            variant="phone"
            :show-time="false"
            accent="#f472b6"
            @seek="seekTo"
          />
          <div class="btns">
            <button class="ibtn" aria-label="上一P" @click="prevPart">
              <Icon name="prev" :size="18" />
            </button>
            <button class="ibtn" aria-label="播放暂停" @click="togglePlay">
              <Icon :name="playing ? 'pause' : 'play'" :size="22" />
            </button>
            <button class="ibtn" aria-label="下一P" @click="nextPart">
              <Icon name="next" :size="18" />
            </button>
            <button class="txt" @click="cycleFill">{{ FILL_LABEL[fill] }}</button>
            <button class="txt" @click="sheetOpen = true">设置</button>
            <button class="ibtn" aria-label="音频模式" @click="enterAudioMode">
              <Icon name="headphones" :size="18" />
            </button>
            <button class="ibtn" aria-label="全屏" @click="toggleFullscreen">
              <Icon name="expand" :size="18" />
            </button>
          </div>
        </div>
      </template>
    </VideoStage>

    <div v-else class="placeholder">
      <Icon name="video" :size="34" />
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
      @toggle="togglePlay"
      @seek="seekTo"
      @prev="prevPart"
      @next="nextPart"
      @cycle-loop="cycleLoopMode"
      @cycle-rate="cycleRateMode"
      @open-eq="eqOpen = true"
      @exit="exitAudioMode"
    />

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
            <span class="pno">P{{ p.page }}</span>
            <span class="pt">{{ p.title }}</span>
          </button>
        </div>
      </div>
    </div>

    <!-- 相关推荐 -->
    <section class="related">
      <h4>相关推荐</h4>
      <div class="rgrid">
        <button v-for="v in session.related.value" :key="v.bvid" class="rcard" @click="onOpenVideo(v)">
          <span class="rpic" :style="v.pic ? { backgroundImage: `url(${v.pic})` } : undefined" />
          <span class="rt">{{ v.title }}</span>
        </button>
      </div>
    </section>

    <EqPanel v-if="eqOpen" @close="eqOpen = false" />
  </div>
</template>

<style scoped>
.mv {
  position: fixed;
  inset: 0;
  display: flex;
  flex-direction: column;
  background: #000;
  color: #ececf1;
  overflow-y: auto;
}
.stage {
  flex: none;
  width: 100%;
  aspect-ratio: 16 / 9;
  background: #000;
}
.topbar {
  position: absolute;
  inset: 0 0 auto 0;
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 10px 12px;
  background: linear-gradient(180deg, rgba(0, 0, 0, 0.72), transparent);
  transition: opacity 200ms ease;
}
.topbar.hide {
  opacity: 0;
  pointer-events: none;
}
.tinfo {
  flex: 1;
  min-width: 0;
}
.tinfo b {
  display: block;
  font-size: 13px;
  font-weight: 600;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.tinfo span {
  display: block;
  font-size: 11px;
  color: #9b9ba8;
}
.ibtn {
  width: 36px;
  height: 36px;
  display: grid;
  place-items: center;
  border: 0;
  border-radius: 50%;
  background: rgba(0, 0, 0, 0.28);
  color: #fff;
}
.big-play {
  position: absolute;
  left: 50%;
  top: 50%;
  transform: translate(-50%, -50%);
  width: 62px;
  height: 62px;
  display: grid;
  place-items: center;
  border: 0;
  border-radius: 50%;
  background: rgba(11, 11, 16, 0.62);
  color: #fff;
}
.ctrl {
  position: absolute;
  inset: auto 0 0 0;
  padding: 8px 12px 10px;
  background: linear-gradient(0deg, rgba(0, 0, 0, 0.82), transparent);
  transition: opacity 200ms ease;
}
.ctrl.hide {
  opacity: 0;
  pointer-events: none;
}
.row-time {
  display: flex;
  justify-content: space-between;
  font-size: 11px;
  color: rgba(255, 255, 255, 0.8);
  font-variant-numeric: tabular-nums;
}
.btns {
  display: flex;
  align-items: center;
  gap: 10px;
  margin-top: 4px;
}
.txt {
  border: 0;
  background: rgba(255, 255, 255, 0.1);
  color: #fff;
  font-size: 12px;
  padding: 6px 10px;
  border-radius: 999px;
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
}
.audio {
  position: fixed;
  inset: 0;
  z-index: 40;
}
.mask {
  position: fixed;
  inset: 0;
  z-index: 55;
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
  height: 40px;
  padding: 0 10px;
  border-radius: 10px;
  border: 1px solid #262633;
  background: rgba(255, 255, 255, 0.03);
  color: #ececf1;
  font-size: 12px;
  text-align: left;
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
.related {
  padding: 14px 16px 40px;
}
.related h4 {
  margin: 0 0 10px;
  font-size: 13px;
  color: #9b9ba8;
  font-weight: 500;
}
.rgrid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 10px;
}
.rcard {
  border: 0;
  background: transparent;
  padding: 0;
  text-align: left;
  color: #ececf1;
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
