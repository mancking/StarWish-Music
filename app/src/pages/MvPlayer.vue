<script setup lang="ts">
/**
 * 桌面 / 车机视频播放页
 *
 * 页面纵向结构（B站网页版形态）
 * ① 顶部信息行（标题 + UP主 + 播放量）→ ② 内嵌播放器（内嵌行 contain + 封面静态模糊，
 * ControlBar B 站布局 hover 常驻）→ ③ 互动区（点赞/收藏/分享 + 状态行；弹幕入口在控制条）
 * → ④ 简介（超 3 行折叠「展开/收起」）→ ⑤ 更多推荐 → ⑥ 「加载更多」按钮（3.15.7）。
 *
 * 右侧栏：多P（分P数≥2）→ 分P列表（当前P强调色左边框 3px + 背景 12% 高亮）；
 * 单P → 相关推荐（缩略图/标题/UP主/播放量/时长）。右栏宽 320px。
 * 默认非全屏内嵌；全屏 = F11/按钮/双击画面（用户主动）。
 * 播完态：遮罩 + 推荐面板 + 分享 + 右下 48px 重播；~2s 自动连播（可关）。
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
import { usePlayerStore } from '@/stores/player'
import { call, isDesktop, on } from '@/api'
import { platform } from '@/platform'
import type { MvItem } from '@shared/types'
import type { QualityOption } from '@/player-video/components/PlaySettingsSheet.vue'

defineOptions({ name: 'MvPlayer' })

const route = useRoute()
const router = useRouter()
const ui = useUiStore()
const player = usePlayerStore()

const car = computed(() => platform.value.car)
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
const stageBox = ref<HTMLElement | null>(null)
const videoEl = computed(() => stage.value?.el || null)

// 缓冲中反馈（体验）+ 播放状态同步（播放/暂停按钮切换）
watch(videoEl, (v, old) => {
  if (old) {
    old.removeEventListener('waiting', onBufWait)
    old.removeEventListener('playing', onBufPlay)
    old.removeEventListener('canplay', onBufPlay)
    old.removeEventListener('stalled', onBufWait)
    old.removeEventListener('play', onVideoPlay)
    old.removeEventListener('pause', onVideoPause)
  }
  if (v) {
    v.addEventListener('waiting', onBufWait)
    v.addEventListener('playing', onBufPlay)
    v.addEventListener('canplay', onBufPlay)
    v.addEventListener('stalled', onBufWait)
    v.addEventListener('play', onVideoPlay)
    v.addEventListener('pause', onVideoPause)
    playing.value = !v.paused
    v.volume = Math.max(0, Math.min(1, videoVolume.value))
  }
})
function onVideoPlay(): void {
  playing.value = true
}
function onVideoPause(): void {
  playing.value = false
}
/* 播放器音量：独立于全局主音量的视频音量，按钮+滑条可调 */
const videoVolume = ref(0.8)
const videoMuted = ref(false)
function onVideoVolume(v: number): void {
  videoVolume.value = Math.max(0, Math.min(1, Number(v) || 0))
  if (videoVolume.value > 0) videoMuted.value = false
  const el = videoEl.value
  if (el) {
    el.volume = videoVolume.value
    el.muted = videoMuted.value
  }
  void player.setVolume(videoVolume.value)
}
function onVideoMute(): void {
  videoMuted.value = !videoMuted.value
  const el = videoEl.value
  if (el) el.muted = videoMuted.value
}
function onBufWait(): void {
  buffering.value = true
}
function onBufPlay(): void {
  buffering.value = false
}

const playing = ref(false)
const curTime = ref(0)
const duration = ref(0)
const rate = ref(1)
const fill = ref<'contain' | 'cover' | 'fill' | 'actual' | 'force16x9'>('contain')
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
/**CSS 全屏态（用户主动进入） */
const fullscreen = ref(false)
/** 播完态（B站） */
const ended = ref(false)
/*点赞乐观红心 + 缓冲反馈 + 分P首帧缩略图缓存 */
const liked = ref(false)
const likeCount = ref(0)
const likeBusy = ref(false)
const buffering = ref(false)
let autoNextTimer = 0
/* 规格 2.12 / ：音频提取（进度 + 可取消） */
const extractId = ref('')
const extractPct = ref<number | undefined>(undefined)

/* 规格 2.11 / ：外挂字幕（srt/ass 解析 + 延迟 ±0.5s 跨视频记忆） */
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
const FILL_ORDER = ['contain', 'cover', 'fill', 'actual', 'force16x9'] as const
const FILL_LABEL: Record<string, string> = { contain: '适应窗口', cover: '填充', fill: '拉伸', actual: '100%', force16x9: '16:9' }
const RATES = [0.5, 0.75, 1, 1.25, 1.5, 2]

const qualityOptions = computed<QualityOption[]>(() =>
  session.qualities.value.map(q => ({ id: String(q.qn), label: q.label }))
)
const curQualityLabel = computed(() => {
  const q = session.qualities.value.find(x => x.qn === session.qn.value)
  return q?.label || '自动'
})
const abLabel = computed(() => {
  if (abA.value === null) return 'AB 循环'
  if (abB.value === null) return 'A 已设 · 再点设 B'
  return 'AB 循环已开'
})
const fitLabel = computed(() => FILL_LABEL[fill.value] || '适应窗口')

/* ---------------- 顶部信息行 / 简介 / 互动区数据 ---------------- */
const intro = computed(() => ({
  title: session.title.value,
  author: session.author.value,
  play: Number(session.info.value?.play || 0),
  pubdate: Number(session.info.value?.pubdate || 0),
  desc: String(session.info.value?.desc || ''),
  like: likeCount.value || Number(session.info.value?.like || 0),
  coin: Number(session.info.value?.coin || 0),
  favorite: Number(session.info.value?.favorite || 0),
}))
const descExpanded = ref(false)
const pubText = computed(() => {
  const t = intro.value.pubdate
  if (!t) return ''
  const d = new Date(t * 1000)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
})
async function toggleLike(): Promise<void> {
  if (likeBusy.value) return
  const next = !liked.value
  // 乐观更新：点击即刻红心
  liked.value = next
  likeCount.value = Math.max(0, (likeCount.value || Number(intro.value.like) || 0) + (next ? 1 : -1))
  if (!isBili.value) {
    ui.toast(next ? '已点赞' : '已取消点赞', 'success', 1200)
    return
  }
  likeBusy.value = true
  try {
    const r = await call<{ ok: boolean; message: string }>('bili:like', { bvid: bvid.value, like: next })
    ui.toast(r?.message || (next ? '已点赞' : '已取消点赞'), 'success', 1200)
  } catch (e: any) {
    // 回滚
    liked.value = !next
    likeCount.value = Math.max(0, (likeCount.value || 0) + (next ? -1 : 1))
    ui.toast(e?.message || '点赞失败', 'error', 3600)
  } finally {
    likeBusy.value = false
  }
}

/* 分P封面：pagelist 的 first_frame 随分P列表一次返回，不再逐P取帧 */
function partPic(p: { pic?: string }): string {
  const u = String(p?.pic || '')
  return u.startsWith('//') ? `https:${u}` : u
}

function fmtPlay(n: number): string {
  if (n >= 100000000) return `${(n / 100000000).toFixed(1)}亿`
  if (n >= 10000) return `${(n / 10000).toFixed(1)}万`
  return String(n || 0)
}

/* ---------------- 控件显隐（3s 自动隐藏；桌面 hover 常驻） ---------------- */
const hovering = ref(false)
const controlsVisible = computed(() => car.value || hovering.value || showControls.value)

function poke(): void {
  showControls.value = true
  window.clearTimeout(hideTimer)
  if (car.value || hovering.value) return
  hideTimer = window.setTimeout(() => {
    if (playing.value && !ended.value) showControls.value = false
  }, 3000)
}

/* ---------------- 播放控制 ---------------- */
function togglePlay(): void {
  const v = videoEl.value
  if (!v) return
  if (v.paused) {
    v.play().catch((e: any) => {
      if (String(e?.name) === 'AbortError') return // 切分P打断不算错误
 // 播放失败不再静默：给出可感知提示与媒体错误详情
      const reason = v.error ? String(v.error.message || '媒体加载失败') : String(e?.message || '未知原因')
      ui.toast(`播放失败：${reason}`, 'error', 4200)
    })
  } else {
    v.pause()
  }
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

/**全屏 = 用户主动（F11 / 按钮 / 双击画面）；CSS 全屏态 */
function toggleFullscreen(): void {
  fullscreen.value = !fullscreen.value
  poke()
}

/* ---------------- 弹幕（入口在控制条） ---------------- */
function onDanmaku(on: boolean): void {
  session.setDanmakuEnabled(on)
}
function onDanmakuSend(text: string): void {
  ui.toast(isBili.value ? `弹幕已发送（本地回显）：${text}` : '当前视频不支持弹幕', 'info', 1600)
}

/* ---------------- 截图 ：只截视频画面，不含控件与弹幕 ---------------- */
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

/* ---------------- 离线缓存 ---------------- */
async function toggleCache(): Promise<void> {
  const p = session.current.value
  if (!p || caching.value) return
  caching.value = true
  try {
    if (cached.value) {
      await call('video:offline:remove', { bvid: bvid.value, cid: p.cid })
      cached.value = false
      ui.toast('已移除离线缓存', 'info', 1600)
    } else {
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

/* 规格 / ：音频模式下系统返回先切回视频模式（逐级） */
useAudioModeBridge(audioMode, enterAudioMode, exitAudioMode)

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
  else if (session.related.value.length) void openVideo(session.related.value[0]!)
  else ui.toast('已经是最后一个分P', 'info', 1400)
}

/* ---------------- 事件 ---------------- */
async function onLoaded(dur: number): Promise<void> {
  duration.value = dur
  ended.value = false
  const v = videoEl.value
  if (!v) return
  v.playbackRate = rate.value
  const mvVol = Number((ui.settings as any).mvVolume)
  const gv = Number((ui.settings as any).playerVolume)
  if (Number.isFinite(mvVol) && mvVol >= 0.01) v.volume = Math.max(0, Math.min(1, mvVol))
  else if (Number.isFinite(gv) && gv > 0) v.volume = Math.max(0, Math.min(1, gv / 100))
  videoVolume.value = v.volume
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
 // 播完态（B站）：遮罩 + 推荐面板 + 重播；~2s 自动连播（mvAutoNext，桌面默认关）
  ended.value = true
  showControls.value = false
  window.clearTimeout(autoNextTimer)
  if ((ui.settings as any).mvAutoNext !== false) {
    autoNextTimer = window.setTimeout(() => {
      if (!ended.value) return
      const next = (i >= 0 && i < list.length - 1 && list[i + 1]!) || session.related.value[0]
      if (next) openVideo('bvid' in next || 'sourceId' in next ? next : (next as any))
    }, 2000)
  }
}

function replay(): void {
  ended.value = false
  window.clearTimeout(autoNextTimer)
  seekTo(0)
  void videoEl.value?.play().catch(() => undefined)
  poke()
}

function openVideo(item: MvItem): void {
  ended.value = false
  window.clearTimeout(autoNextTimer)
  void router.push(`/mv/${item.source || 'bili'}/${item.sourceId || item.bvid || ''}`)
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
      if (fullscreen.value) fullscreen.value = false
      else if (settingsOpen.value) settingsOpen.value = false
      else router.back()
      break
    default:
      break
  }
}

/* ---------------- 生命周期 ---------------- */
onMounted(async () => {
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
  // 3.15.7：首屏推荐第一页
  void session.loadRelated()
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
  window.clearTimeout(autoNextTimer)
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
  <div class="mvp" :class="{ car, fullscreen }">
 <!-- 页面主体（非全屏）：左内容（信息行→播放器→互动区→简介→推荐→加载更多）+ 右侧栏 -->
    <div v-if="!fullscreen" class="layout">
      <div class="main-col">
        <!-- ① 顶部信息行（标题 + UP主 + 播放量） -->
        <header class="info-line">
          <button class="ghost" aria-label="返回" @click="router.back()">
            <Icon name="chevron-left" :size="18" />
          </button>
          <div class="il-meta">
            <b>{{ intro.title }}</b>
            <span>
              <template v-if="intro.author">{{ intro.author }} · </template>{{ fmtPlay(intro.play) }} 播放<template v-if="pubText"> · {{ pubText }}</template>
            </span>
          </div>
        </header>

        <!-- ② 内嵌播放器（内嵌行：contain + 封面静态模糊；双击画面进全屏 2.5） -->
        <div
          ref="stageBox"
          class="stage-wrap"
          @mouseenter="hovering = true; poke()"
          @mouseleave="hovering = false; poke()"
          @dblclick="toggleFullscreen"
        >
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
            :resume-at="session.current.value?.cid ? session.savedPosition(session.current.value.cid) : 0"
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
                v-if="ui.settings.danmakuEnabled && !car && isBili"
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

              <div v-if="buffering && !ended" class="buf-spin" aria-label="缓冲中"><span /></div>
              <button v-if="!playing && !ended" class="center-play" aria-label="播放" @click="togglePlay">
                <Icon name="play" :size="30" />
              </button>

              <!-- 播完态：遮罩 + 推荐面板 + 重播 -->
              <div v-if="ended" class="ended-mask" @click.stop>
                <div class="ended-panel">
                  <b>更多推荐</b>
                  <button
                    v-for="v in session.related.value.slice(0, 4)"
                    :key="v.bvid || v.sourceId"
                    class="ended-row"
                    @click="openVideo(v)"
                  >
                    <span class="e-pic" :style="v.pic ? { backgroundImage: `url(${v.pic})` } : undefined" />
                    <span class="e-title">{{ v.title }}</span>
                  </button>
                </div>
                <button class="replay" aria-label="重播" @click="replay">
                  <Icon name="refresh" :size="22" />
                </button>
              </div>

 <!-- 控制条（B站布局：左播放/下一个/时间；右清晰度→选集→倍速→字幕→设置→PiP→全屏；hover 常驻） -->
              <ControlBar
                v-if="!car"
                :playing="playing"
                :position="curTime"
                :duration="duration"
                :quality-label="curQualityLabel"
                :parts-count="session.parts.value.length"
                :rate="rate"
                :fullscreen="false"
                :danmaku-supported="isBili"
                :danmaku-enabled="!!ui.settings.danmakuEnabled"
                :visible="controlsVisible && !ended"
                variant="desktop"
                :volume="videoVolume"
                :muted="videoMuted"
                @toggle="togglePlay"
                @prev="prevPart"
                @next="nextPart"
                @seek="seekTo"
                @quality="settingsOpen = true"
                @parts="settingsOpen = false"
                @rate="cycleRateMode"
                @subtitle="onSubtitle(0.5)"
                @settings="settingsOpen = true"
                @pip="togglePip"
                @fullscreen="toggleFullscreen"
                @danmaku="onDanmaku"
                @danmaku-send="onDanmakuSend"
                @volume="onVideoVolume"
                @mute="onVideoMute"
              />
              <!-- 车机简化控制（4.5：仅播放/上下首，默认音频模式） -->
              <div v-else class="car-bar">
                <button class="car-btn" @click="prevPart"><Icon name="prev" :size="26" /></button>
                <button class="car-btn main" @click="togglePlay"><Icon :name="playing ? 'pause' : 'play'" :size="30" /></button>
                <button class="car-btn" @click="nextPart"><Icon name="next" :size="26" /></button>
                <span class="car-tag">音频模式</span>
              </div>
            </template>
          </VideoStage>

          <div v-else class="placeholder">
            <Icon name="video" :size="36" />
            <p>{{ session.error.value || (session.loading.value ? '正在解析视频…' : '暂无视频源') }}</p>
            <button v-if="session.error.value" class="retry" @click="session.load(1)">重试</button>
          </div>
        </div>

        <!-- ③ 互动区（点赞/收藏/分享 + 状态行；弹幕入口在控制条） -->
        <div v-if="!car" class="actions">
          <button class="act" :class="{ liked }" :disabled="likeBusy" @click="toggleLike">
            <Icon :name="liked ? 'heart-filled' : 'heart'" :size="16" /><span>{{ fmtPlay(intro.like) }}</span>
          </button>
          <button class="act" @click="toggleCache">
            <Icon name="download" :size="16" /><span>{{ cached ? '已缓存' : '缓存' }}</span>
          </button>
          <button class="act" @click="enterAudioMode">
            <Icon name="headphones" :size="16" /><span>音频模式</span>
          </button>
          <button class="act" @click="screenshot">
            <Icon name="camera" :size="16" /><span>截图</span>
          </button>
          <span class="act-state">{{ fmtPlay(intro.play) }} 播放 · {{ fmtPlay(intro.coin) }} 弹幕/投币</span>
          <span class="act-fit" @click="cycleFill">画面：{{ fitLabel }}</span>
        </div>

        <!-- ④ 简介（超 3 行折叠「展开/收起」） -->
        <section class="intro">
          <p class="i-stat">
            <span>{{ intro.author || '未知UP主' }}</span>
            <span>{{ fmtPlay(intro.play) }} 播放</span>
            <span v-if="pubText">{{ pubText }}</span>
            <span v-if="intro.desc" class="i-toggle" @click="descExpanded = !descExpanded">{{ descExpanded ? '收起' : '展开' }}</span>
          </p>
          <p v-if="intro.desc" class="i-desc" :class="{ expanded: descExpanded }">{{ intro.desc }}</p>
        </section>

        <!-- ⑤ 更多推荐（左列内；缩略图 160×90 + 标题 14px + UP主 12px + 播放量 + 时长角标） -->
        <section class="recs">
          <h4>更多推荐</h4>
          <button v-for="v in session.related.value" :key="v.bvid || v.sourceId" class="rcard" @click="openVideo(v)">
            <span class="rpic" :style="v.pic ? { backgroundImage: `url(${v.pic})` } : undefined">
              <span v-if="v.duration" class="rdur">{{ v.duration }}</span>
            </span>
            <span class="rmeta">
              <span class="rt">{{ v.title }}</span>
              <span class="ra">{{ v.author }} · {{ fmtPlay(Number(v.play || 0)) }}播放</span>
            </span>
          </button>
        </section>

        <!-- ⑥ 加载更多按钮（3.15.7：IntersectionObserver 200px 内显示；每页 10 条） -->
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

 <!-- 右侧栏：多P → 分P列表；单P → 相关推荐 -->
      <aside v-if="!car" class="sidebar">
        <template v-if="session.parts.value.length >= 2">
          <h4>选集 · {{ session.parts.value.length }}</h4>
          <div class="part-list">
            <button
              v-for="p in session.parts.value"
              :key="p.cid"
              class="part-row"
              :class="{ on: p.cid === session.current.value?.cid }"
              @click="pickPart(p)"
            >
              <span
                class="p-thumb"
                :class="{ empty: !partPic(p) }"
                :style="partPic(p) ? { backgroundImage: `url('${partPic(p)}')` } : undefined"
              >
                <span v-if="!partPic(p)" class="p-no">P{{ p.page }}</span>
              </span>
              <span class="p-info">
                <b>{{ p.title }}</b>
                <span v-if="p.duration" class="p-dur">{{ Math.floor(p.duration / 60) }}:{{ String(Math.floor(p.duration % 60)).padStart(2, '0') }}</span>
              </span>
            </button>
          </div>
        </template>
        <template v-else-if="session.related.value.length">
          <h4>相关推荐</h4>
          <div class="side-recs">
            <button v-for="v in session.related.value" :key="v.bvid || v.sourceId" class="srcard" @click="openVideo(v)">
              <span class="srpic" :style="v.pic ? { backgroundImage: `url(${v.pic})` } : undefined" />
              <span class="srmeta">
                <b>{{ v.title }}</b>
                <span>{{ v.author }} · {{ fmtPlay(Number(v.play || 0)) }}播放</span>
              </span>
            </button>
          </div>
        </template>
      </aside>
    </div>

    <!-- CSS 全屏态（用户主动进入；3.15.6 矩阵适配在 VideoStage） -->
    <VideoStage
      v-else-if="session.src.value"
      ref="stage"
      class="stage fs-stage"
      :src="session.src.value"
      :poster="session.poster.value"
      :fit="fill"
      :ab-a="abA"
      :ab-b="abB"
      :duration="duration"
      :rate="rate"
      :auto-hide="!car"
      :fullscreen="true"
      :volume="videoVolume"
      :muted="videoMuted"
      @loaded="onLoaded"
      @time="onTime"
      @ended="onEnded"
      @toggle="togglePlay"
      @tap="poke"
      @seek="seekTo"
      @volume="() => undefined"
    >
      <template #overlay>
        <SubtitleOverlay :text="activeSub" />
        <DanmakuLayer
          v-if="ui.settings.danmakuEnabled && isBili"
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
        <button v-if="!playing && !ended" class="center-play" aria-label="播放" @click="togglePlay">
          <Icon name="play" :size="32" />
        </button>
        <div v-if="ended" class="ended-mask" @click.stop>
          <div class="ended-panel">
            <b>更多推荐</b>
            <button
              v-for="v in session.related.value.slice(0, 4)"
              :key="v.bvid || v.sourceId"
              class="ended-row"
              @click="openVideo(v)"
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
          :visible="controlsVisible && !ended"
          variant="desktop"
          :volume="videoVolume"
          :muted="videoMuted"
          @toggle="togglePlay"
          @prev="prevPart"
          @next="nextPart"
          @seek="seekTo"
          @quality="settingsOpen = true"
          @rate="cycleRateMode"
          @subtitle="onSubtitle(0.5)"
          @settings="settingsOpen = true"
          @pip="togglePip"
          @fullscreen="toggleFullscreen"
          @danmaku="onDanmaku"
          @danmaku-send="onDanmakuSend"
          @volume="onVideoVolume"
          @mute="onVideoMute"
        />
      </template>
    </VideoStage>

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

    <EqPanel v-if="eqOpen" @close="eqOpen = false" />
  </div>
</template>

<style scoped>
.mvp {
  min-height: 100%;
  display: flex;
  flex-direction: column;
  background: var(--video-bg, var(--bg));
  color: var(--text);
}
.mvp.fullscreen {
  overflow: hidden;
}
.layout {
  display: grid;
  grid-template-columns: minmax(0, 1fr) 320px;
  gap: 20px;
  padding: 12px 20px 40px;
  align-items: start;
}
.main-col {
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 12px;
}
/* ① 顶部信息行 */
.info-line {
  display: flex;
  align-items: center;
  gap: 10px;
}
.il-meta {
  flex: 1;
  min-width: 0;
}
.il-meta b {
  display: block;
  font-size: 17px;
  font-weight: 600;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.il-meta span {
  display: block;
  font-size: 12px;
  color: var(--text-2);
  margin-top: 2px;
}
/* ② 内嵌播放器 */
.stage-wrap {
  position: relative;
  width: 100%;
  aspect-ratio: 16 / 9;
  border-radius: 12px;
  overflow: hidden;
  background: var(--video-stage-bg, var(--bg));
}
.stage {
  width: 100%;
  height: 100%;
}
.fs-stage {
  position: fixed;
  inset: 0;
  z-index: 800;
  width: 100vw;
  height: 100vh;
}
.mvp.car .stage-wrap {
  aspect-ratio: auto;
  flex: 1;
  border-radius: 0;
}
.placeholder {
  position: absolute;
  inset: 0;
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
  color: var(--text);
  cursor: pointer;
}
.ghost:hover {
  background: var(--hover);
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
  z-index: 6;
}
/* 播完态 */
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
  width: min(420px, 70%);
  padding: 14px;
  border-radius: 14px;
  background: rgba(19, 19, 27, 0.92);
}
.ended-panel b {
  display: block;
  font-size: 14px;
  margin-bottom: 8px;
}
.ended-row {
  display: flex;
  align-items: center;
  gap: 10px;
  width: 100%;
  padding: 6px 0;
  border: 0;
  background: transparent;
  color: var(--text);
  text-align: left;
  cursor: pointer;
}
.e-pic {
  width: 120px;
  height: 68px;
  flex: none;
  border-radius: 6px;
  background: var(--bg-3) center/cover no-repeat;
}
.e-title {
  font-size: 13px;
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
}
.replay {
  position: absolute;
  right: 16px;
  bottom: 56px;
  width: 48px;
  height: 48px;
  display: grid;
  place-items: center;
  border: 0;
  border-radius: 50%;
  background: rgba(255, 255, 255, 0.16);
  color: var(--text);
  cursor: pointer;
}
/* 车机简化控制 */
.car-bar {
  position: absolute;
  inset: auto 0 0 0;
  height: 56px;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 26px;
  background: linear-gradient(0deg, rgba(0, 0, 0, 0.8), transparent);
}
.car-btn {
  width: 56px;
  height: 56px;
  display: grid;
  place-items: center;
  border: 0;
  border-radius: 50%;
  background: transparent;
  color: #fbbf24;
  cursor: pointer;
}
.car-btn.main {
  width: 80px;
  height: 80px;
  background: #fbbf24;
  color: #0b0b10;
}
.car-tag {
  font-size: 15px;
  color: #fbbf24;
}
/* ③ 互动区 */
.actions {
  display: flex;
  align-items: center;
  gap: 10px;
}
.act {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  height: 34px;
  padding: 0 14px;
  border: 0;
  border-radius: 999px;
  background: var(--panel);
  color: var(--text);
  font-size: 13px;
  cursor: pointer;
}
.act.liked {
  color: #ff4d4f;
}
.act.liked :deep(svg) {
  color: #ff4d4f;
  fill: #ff4d4f;
}
.buf-spin {
  position: absolute;
  inset: 0;
  display: grid;
  place-items: center;
  pointer-events: none;
  z-index: 5;
}
.buf-spin span {
  width: 34px;
  height: 34px;
  border-radius: 50%;
  border: 3px solid rgba(255, 255, 255, 0.25);
  border-top-color: #fff;
  animation: buf-rot 0.9s linear infinite;
}
@keyframes buf-rot {
  to { transform: rotate(360deg); }
}
.act:hover {
  background: var(--panel-3);
}
.act-state {
  font-size: 12px;
  color: var(--text-2);
}
.act-fit {
  margin-left: auto;
  font-size: 12px;
  color: var(--text-2);
  padding: 4px 10px;
  border-radius: 999px;
  background: var(--panel-2);
  cursor: pointer;
}
/* ④ 简介 */
.intro {
  border-bottom: 1px solid rgba(38, 38, 51, 0.8);
  padding-bottom: 12px;
}
.i-stat {
  margin: 0;
  display: flex;
  align-items: center;
  gap: 12px;
  font-size: 12.5px;
  color: var(--text-2);
}
.i-stat span:first-child {
  color: var(--text);
  font-weight: 600;
}
.i-toggle {
  color: var(--text-2);
  cursor: pointer;
}
.i-desc {
  margin: 8px 0 0;
  font-size: 13.5px;
  line-height: 1.65;
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
/* ⑤ 更多推荐 */
.recs h4,
.sidebar h4 {
  margin: 0 0 10px;
  font-size: 14px;
  font-weight: 600;
}
.recs {
  margin-top: 4px;
}
.rcard {
  display: flex;
  gap: 12px;
  width: 100%;
  padding: 0 0 14px;
  border: 0;
  background: transparent;
  text-align: left;
  color: var(--text);
  cursor: pointer;
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
  gap: 8px;
}
.rt {
  font-size: 14px;
  line-height: 1.45;
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
}
.ra {
  font-size: 12px;
  color: var(--text-2);
}
/* ⑥ 加载更多（3.15.7） */
.load-more {
  display: flex;
  flex-direction: column;
  align-items: center;
  padding-top: 4px;
}
.lm-btn {
  width: 200px;
  height: 40px;
  border: 0;
  border-radius: 20px;
  background: var(--bg-3);
  color: var(--text);
  font-size: 14px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
  cursor: pointer;
}
.lm-btn:hover:not(:disabled) {
  background: var(--bg-3);
}
.lm-btn:disabled {
  opacity: 0.6;
  pointer-events: none;
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
}
/* 右侧栏（宽 320px） */
.sidebar {
  position: sticky;
  top: 12px;
  max-height: calc(100vh - 24px);
  overflow-y: auto;
  border-left: 1px solid rgba(255, 255, 255, 0.06);
  padding-left: 16px;
}
.part-list,
.side-recs {
  display: flex;
  flex-direction: column;
  gap: 8px;
}
.part-row {
  display: flex;
  gap: 10px;
  width: 100%;
  padding: 6px;
  border: 0;
  border-left: 3px solid transparent;
  border-radius: 8px;
  background: transparent;
  text-align: left;
  color: var(--text);
  cursor: pointer;
}
.part-row:hover {
  background: rgba(255, 255, 255, 0.05);
}
/* 当前P高亮：强调色左边框 3px + 背景 12% */
.part-row.on {
  border-left-color: #a78bfa;
  background: rgba(167, 139, 250, 0.12);
}
.p-thumb {
  width: 120px;
  height: 68px;
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
.p-thumb.empty {
  background-image: linear-gradient(135deg, var(--bg-3), var(--bg-2));
}
.p-thumb img {
  width: 100%;
  height: 100%;
  object-fit: cover;
  display: block;
}
.p-no {
  font-size: 13px;
  font-weight: 700;
  color: #a78bfa;
}
.p-info {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 4px;
}
.p-info b {
  font-size: 13px;
  font-weight: 500;
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
}
.p-dur {
  font-size: 11px;
  color: #63636f;
}
.srcard {
  display: flex;
  gap: 10px;
  width: 100%;
  padding: 4px;
  border: 0;
  border-radius: 8px;
  background: transparent;
  text-align: left;
  color: var(--text);
  cursor: pointer;
}
.srcard:hover {
  background: rgba(255, 255, 255, 0.05);
}
.srpic {
  width: 120px;
  height: 68px;
  flex: none;
  border-radius: 6px;
  background: var(--bg-3) center/cover no-repeat;
}
.srmeta {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 6px;
}
.srmeta b {
  font-size: 13px;
  font-weight: 500;
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
}
.srmeta span {
  font-size: 11.5px;
  color: var(--text-2);
}
.audio {
  position: fixed;
  inset: 0;
  z-index: 60;
}
@media (max-width: 1120px) {
  .layout {
    grid-template-columns: minmax(0, 1fr);
  }
  .sidebar {
    display: none;
  }
}
</style>
