<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import Icon from '@/components/Icon.vue'
import Cover from '@/components/Cover.vue'
import DanmakuLayer from '@/components/DanmakuLayer.vue'
import { call, isDesktop } from '@/api'
import { formatTime } from '@shared/lrc'
import { usePlayerStore } from '@/stores/player'
import { useUiStore } from '@/stores/ui'
import type { DanmakuItem, MvItem, Song } from '@shared/types'

interface Part {
  cid: string
  page: number
  part: string
  duration: number
}

const route = useRoute()
const router = useRouter()
const player = usePlayerStore()
const ui = useUiStore()

const bvid = computed(() => String(route.params.bvid || ''))
const info = ref<{
  cid: string
  title: string
  pic: string
  author: string
  play: number
  danmaku: number
  like: number
  coin: number
  favorite: number
  duration: number
  pubdate: number
  desc: string
} | null>(null)
const parts = ref<Part[]>([])
const current = ref<Part | null>(null)
const videoUrl = ref('')
/** 已离线缓存的本地文件路径（非空则直接本地播放，零流量秒开） */
const offlineLocal = ref('')
/** 当前分P 的远程流 URL（保存 / 离线缓存 / 重新解析用） */
const remoteUrl = ref('')
const loading = ref(true)
const videoError = ref('')
const listError = ref('')
const related = ref<MvItem[]>([])
const videoEl = ref<HTMLVideoElement | null>(null)
const boxEl = ref<HTMLDivElement | null>(null)

const isMobileMv = __MOBILE__
/** 真机封面/海报走 /swmedia/ 代理：B 站图片 CDN 防盗链，直连 403 */
const poster = computed(() => {
  const u = String(info.value?.pic || '')
  if (!/^https?:\/\//i.test(u) || !isMobileMv) return u
  const cap: any = (globalThis as any).Capacitor
  return cap?.isNativePlatform?.() ? `/swmedia/?u=${encodeURIComponent(u)}` : u
})
const videoSrc = computed(() => {
  // 离线本地文件：走 swmedia 本地文件分支（含 Range，秒开）
  if (offlineLocal.value) return `swmedia://stream/?u=${encodeURIComponent(offlineLocal.value)}`
  if (!remoteUrl.value) return ''
  const u = encodeURIComponent(remoteUrl.value)
  // 真机走原生 /swmedia/ 代理（MainActivity 的 SwMediaClient 拦截，注入防盗链头），
  // 桌面 Electron 走主进程 swmedia:// 协议（media.ts）
  const native = (globalThis as any).Capacitor?.isNativePlatform?.() === true
  return native ? `/swmedia/?u=${u}` : `swmedia://stream/?u=${u}`
})
const hasParts = computed(() => parts.value.length > 1)

/* ============================ 自定义播放器控制 ============================ */
const playing = ref(false)
const curTime = ref(0)
const duration = ref(0)
const buffered = ref(0)
const volume = ref(Math.max(0, Math.min(1, ui.settings.mvVolume ?? 0.8)))
const muted = ref(false)
const rate = ref(1)
/** 传给 <video loop>：仅单集循环时为 true（列表循环交给 onEnded 处理） */
const loop = ref(false)
const autoNext = ref(true)
const isFullscreen = ref(false)
const showControls = ref(true)
const ready = ref(false)

const RATES = [0.5, 0.75, 1, 1.25, 1.5, 2]
/** 画面填充模式：contain 适应 / cover 填充 / fill 拉伸 */
const FILL_MODES = ['contain', 'cover', 'fill'] as const
type FillMode = (typeof FILL_MODES)[number]
const FILL_LABEL: Record<FillMode, string> = { contain: '适应', cover: '填充', fill: '拉伸' }
const fillMode = ref<FillMode>('contain')

/* 画质 */
const qualities = ref<{ qn: number; label: string }[]>([])
const curQn = ref(64)

/* 菜单开关 */
const menu = ref<'' | 'settings' | 'speed' | 'quality' | 'loop' | 'fill' | 'more'>('')

/** 循环模式：off 不循环 / one 单集循环 / list 列表循环 */
type LoopMode = 'off' | 'one' | 'list'
const LOOP_MODES: LoopMode[] = ['off', 'one', 'list']
const LOOP_LABEL: Record<LoopMode, string> = { off: '不循环', one: '单集循环', list: '列表循环' }
const loopMode = ref<LoopMode>('off')

/* 离线缓存状态 */
const offlineReady = ref(false)
const caching = ref(false)

/* ---------------- 弹幕 ---------------- */
const danmakuItems = ref<DanmakuItem[]>([])
const danmakuLoading = ref(false)

async function loadDanmaku(cid: string): Promise<void> {
  danmakuItems.value = []
  if (!ui.settings.danmakuEnabled || !cid) return
  danmakuLoading.value = true
  try {
    const list = await call<DanmakuItem[]>('mv:danmaku', { cid })
    danmakuItems.value = Array.isArray(list) ? list : []
  } catch {
    /* 弹幕失败不影响播放，静默降级为无弹幕 */
    danmakuItems.value = []
  } finally {
    danmakuLoading.value = false
  }
}

let hideTimer = 0
function pokeControls(): void {
  showControls.value = true
  window.clearTimeout(hideTimer)
  hideTimer = window.setTimeout(() => {
    if (playing.value && menu.value === '') showControls.value = false
  }, 2600)
}

function fmtTime(s: number): string {
  if (!isFinite(s) || s < 0) s = 0
  const h = Math.floor(s / 3600)
  const m = Math.floor((s % 3600) / 60)
  const sec = Math.floor(s % 60)
  const mm = String(m).padStart(2, '0')
  const ss = String(sec).padStart(2, '0')
  return h > 0 ? `${h}:${mm}:${ss}` : `${mm}:${ss}`
}

function togglePlay(): void {
  const v = videoEl.value
  if (!v) return
  if (v.paused) void v.play().catch(() => {})
  else v.pause()
}

function seekTo(t: number): void {
  const v = videoEl.value
  if (!v || !isFinite(t)) return
  v.currentTime = Math.max(0, Math.min(t, duration.value || v.duration || 0))
}

function nudge(d: number): void {
  seekTo((videoEl.value?.currentTime || 0) + d)
}

function setVolume(val: number): void {
  volume.value = Math.max(0, Math.min(1, val))
  muted.value = volume.value === 0
  if (videoEl.value) {
    videoEl.value.volume = volume.value
    videoEl.value.muted = muted.value
  }
  // 记忆音量：下次进 MV 播放器沿用上次的值
  if (Math.abs((ui.settings.mvVolume ?? -1) - volume.value) > 0.001) void ui.patch({ mvVolume: volume.value })
}

function toggleDanmaku(): void {
  const v = !ui.settings.danmakuEnabled
  ;(ui.settings as any).danmakuEnabled = v
  void call('settings:set', { danmakuEnabled: v })
}

function toggleMute(): void {
  muted.value = !muted.value
  if (videoEl.value) videoEl.value.muted = muted.value
}

function setRate(r: number): void {
  rate.value = r
  if (videoEl.value) videoEl.value.playbackRate = r
  menu.value = ''
}

function setLoop(m: LoopMode): void {
  loopMode.value = m
  // 只有「单集循环」交给 <video loop>；列表循环由 ended 事件切下一集
  loop.value = m === 'one'
  if (videoEl.value) videoEl.value.loop = loop.value
  menu.value = ''
}

/**
 * 切换控制条菜单。按钮已在 open 态时再点一次是「关闭」而不是重新打开——
 * 否则菜单层的点击被按钮先吞掉又立刻重开，看起来像点了没反应。
 */
function toggleMenu(name: Exclude<typeof menu.value, ''>): void {
  menu.value = menu.value === name ? '' : name
}

/** 点击菜单/按钮之外的区域时收起菜单（捕获阶段判定，故用 closest） */
function onBoxDown(e: MouseEvent): void {
  if (!menu.value) return
  const t = e.target as HTMLElement | null
  if (t?.closest('.menu-wrap')) return
  menu.value = ''
}

function setFill(m: FillMode): void {
  fillMode.value = m
  menu.value = ''
}

async function togglePip(): Promise<void> {
  const v = videoEl.value
  if (!v) return
  try {
    if ((document as any).pictureInPictureElement) await (document as any).exitPictureInPicture()
    else await v.requestPictureInPicture()
  } catch {
    ui.toast('当前环境不支持画中画', 'error', 1600)
  }
}

async function toggleFullscreen(): Promise<void> {
  const box = boxEl.value
  if (!box) return
  try {
    if ((document as any).fullscreenElement) await (document as any).exitFullscreen()
    else await box.requestFullscreen()
  } catch {
    /* ignore */
  }
}

function onFsChange(): void {
  isFullscreen.value = !!(document as any).fullscreenElement
}

function onKey(e: KeyboardEvent): void {
  const tag = (e.target as HTMLElement)?.tagName
  if (tag === 'INPUT' || tag === 'TEXTAREA') return
  const k = e.key
  if (k === ' ' || k === 'k') {
    e.preventDefault()
    togglePlay()
  } else if (k === 'ArrowRight' || k === 'l') {
    e.preventDefault()
    nudge(5)
  } else if (k === 'ArrowLeft' || k === 'j') {
    e.preventDefault()
    nudge(-5)
  } else if (k === 'ArrowUp') {
    e.preventDefault()
    setVolume(volume.value + 0.1)
  } else if (k === 'ArrowDown') {
    e.preventDefault()
    setVolume(volume.value - 0.1)
  } else if (k === 'f') {
    void toggleFullscreen()
  } else if (k === 'm') {
    toggleMute()
  } else if (k === 'p') {
    void togglePip()
  } else if (/^[0-9]$/.test(k)) {
    seekTo((Number(k) / 10) * (duration.value || 0))
  }
  pokeControls()
}

/* 进度条拖动 */
function onProgressClick(e: MouseEvent): void {
  const el = e.currentTarget as HTMLElement
  const rect = el.getBoundingClientRect()
  const ratio = (e.clientX - rect.left) / rect.width
  seekTo(ratio * (duration.value || 0))
}

let lastProgSave = 0
function onTimeUpdate(): void {
  const v = videoEl.value
  if (!v) return
  curTime.value = v.currentTime
  // 进度记忆：每 3s 落一次 localStorage（按 bvid+cid），临近结尾不记
  const now = Date.now()
  if (now - lastProgSave < 3000) return
  lastProgSave = now
  if (v.currentTime > 5 && (duration.value || 0) - v.currentTime > 10 && bvid.value && current.value) {
    try {
      localStorage.setItem(progKey(bvid.value, current.value.cid), String(v.currentTime))
    } catch { /* 隐私模式等忽略 */ }
  }
}

/** 视频进度记忆：按 bvid+cid 存取（双端通用，localStorage） */
function progKey(bv: string, cid: string): string {
  return `sw.mvprog:${bv}:${cid}`
}
function lastProgressOf(bv: string, cid: string): number {
  try {
    return Number(localStorage.getItem(progKey(bv, cid)) || 0)
  } catch {
    return 0
  }
}

function onLoadedMeta(): void {
  const v = videoEl.value
  if (!v) return
  duration.value = v.duration || current.value?.duration || 0
  v.volume = volume.value
  v.muted = muted.value
  v.playbackRate = rate.value
  ready.value = true
}

function onProgressEvt(): void {
  const v = videoEl.value
  if (!v || !v.buffered.length) return
  buffered.value = v.buffered.end(v.buffered.length - 1)
}

function onPlay(): void {
  playing.value = true
  pokeControls()
}
function onPause(): void {
  playing.value = false
  showControls.value = true
}

/** 播放结束：单集循环由 <video loop> 处理；列表循环/自动连播切下一集，末尾回到第一集 */
function onEnded(): void {
  const list = parts.value
  const cur = current.value
  if (cur && list.length > 1) {
    const idx = list.findIndex(p => p.cid === cur.cid)
    if (idx >= 0) {
      if (loopMode.value === 'list') {
        // 列表循环：最后一集结束后回到第一集，循环不中断
        void selectPart(list[(idx + 1) % list.length])
        return
      }
      if (autoNext.value && idx + 1 < list.length) {
        void selectPart(list[idx + 1])
        return
      }
    }
  }
  playing.value = false
  showControls.value = true
}

/* ============================ 画质切换 ============================ */
async function changeQuality(q: number): Promise<void> {
  if (q === curQn.value) {
    menu.value = ''
    return
  }
  const keep = videoEl.value?.currentTime || 0
  curQn.value = q
  menu.value = ''
  await resolveStream(q, true, keep)
}

/* ============================ 分集 / 流解析 ============================ */
/** 分集分页渲染：合集可能有几百 P，先渲染前 20 条，滚动到底再追加（每批 20） */
const PART_BATCH = 20
const partsShown = ref(PART_BATCH)
const partsMore = computed(() => parts.value.slice(0, partsShown.value))
const partsPending = computed(() => parts.value.length > partsShown.value)

function onPartsScroll(e: Event): void {
  const el = e.currentTarget as HTMLElement
  if (el.scrollTop + el.clientHeight >= el.scrollHeight - 40) {
    loadMoreParts()
  }
}

/** 立即加载下一批分集（滚动到底自动触发，也可点击按钮） */
function loadMoreParts(): void {
  if (!partsPending.value) return
  partsShown.value = Math.min(partsShown.value + PART_BATCH, parts.value.length)
}

/** 格式化播放量：B站风格 "277.8万 次播放" */
function fmtCount(n: number): string {
  if (n >= 100000000) return `${(n / 100000000).toFixed(1)}亿`
  if (n >= 10000) return `${(n / 10000).toFixed(1)}万`
  return String(n || 0)
}

/** 把 Unix 时间戳格式化为 "2024-01-15" */
function fmtDate(ts: number): string {
  if (!ts) return ''
  const d = new Date(ts * 1000)
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

async function load(): Promise<void> {
  loading.value = true
  videoError.value = ''
  listError.value = ''
  remoteUrl.value = ''
  offlineLocal.value = ''
  parts.value = []
  current.value = null
  try {
    const i = await call<{
      cid: string
      title: string
      pic: string
      author: string
      play: number
      danmaku: number
      like: number
      coin: number
      favorite: number
      duration: number
      pubdate: number
      desc: string
    }>('music:mvinfo', { bvid: bvid.value })
    info.value = i
    try {
      parts.value = await call<Part[]>('music:mvparts', { bvid: bvid.value })
    } catch {
      parts.value = []
    }
    const wantPage = Number(route.query.p) || 0
    const target =
      parts.value.find(p => p.page === wantPage) ||
      parts.value.find(p => p.cid === i.cid) ||
      parts.value[0] ||
      { cid: i.cid, page: 1, part: i.title, duration: 0 }
    if (!parts.value.length) parts.value = [target]
    await selectPart(target, false)
    void loadRelated(i.author)
  } catch (e: any) {
    videoError.value = e?.message || '视频信息加载失败'
    listError.value = videoError.value
  } finally {
    loading.value = false
  }
}

/** 拉取某一分P 的视频流并（可选）续播；优先命中离线缓存 */
async function resolveStream(qn: number | undefined, autoplay: boolean, resumeAt?: number): Promise<void> {
  const p = current.value
  if (!p) return
  loading.value = true
  videoError.value = ''
  ready.value = false
  // 弹幕与视频流并行拉取，失败不影响播放
  void loadDanmaku(p.cid)
  // 桌面端先查离线缓存
  if (isDesktop) {
    try {
      const local = await call<string | null>('video:offline:file', { bvid: bvid.value, cid: p.cid })
      if (local) {
        offlineLocal.value = local
        offlineReady.value = true
        remoteUrl.value = ''
        loading.value = false
        await play(resumeAt)
        return
      }
    } catch {
      /* ignore */
    }
  }
  offlineReady.value = false
  try {
    const r = await call<{ url: string; type: string; qn: number; qualities: { qn: number; label: string }[] }>(
      'music:mvurl',
      { bvid: bvid.value, cid: p.cid, qn }
    )
    remoteUrl.value = r.url
    offlineLocal.value = ''
    if (r.qualities?.length) qualities.value = r.qualities
    if (r.qn) curQn.value = r.qn
    if (autoplay) await play(resumeAt)
  } catch (e: any) {
    videoError.value = e?.message || '视频流解析失败'
  } finally {
    loading.value = false
  }
}

async function play(resumeAt?: number): Promise<void> {
  await nextTick()
  const v = videoEl.value
  if (!v) return
  v.load()
  if (typeof resumeAt === 'number' && resumeAt > 0) {
    const resume = (): void => {
      try {
        v.currentTime = resumeAt
      } catch {
        /* ignore */
      }
      v.removeEventListener('loadedmetadata', resume)
    }
    v.addEventListener('loadedmetadata', resume)
  }
  void v.play().catch(() => {})
}

async function selectPart(p: Part, autoplay = true): Promise<void> {
  releaseCache()
  current.value = p
  // 若目标分P 在未渲染批次内（如带 p= 的深链），扩展渲染范围保证它可见
  const idx = parts.value.findIndex(x => x.cid === p.cid)
  if (idx >= partsShown.value) partsShown.value = Math.min(idx + PART_BATCH, parts.value.length)
  router.replace({ path: `/mv/${bvid.value}`, query: p.page > 1 ? { p: String(p.page) } : {} })
  menu.value = ''
  const saved = autoplay ? lastProgressOf(bvid.value, p.cid) : 0
  if (saved > 15) ui.toast('已恢复到上次播放进度', 'info', 1800)
  await resolveStream(undefined, autoplay, saved > 15 ? saved : undefined)
}

async function loadRelated(author: string): Promise<void> {
  try {
    const list = await call<MvItem[]>('music:mv', { keyword: author || '音乐', page: 1 })
    related.value = list.filter(v => v.bvid !== bvid.value).slice(0, 8)
  } catch {
    related.value = []
  }
}

async function listenAudio(): Promise<void> {
  const p = current.value
  if (!p || !info.value) return
  const song: Song = {
    id: `bili:${bvid.value}-p${p.page}`,
    source: 'bili',
    songId: `${bvid.value}-p${p.page}`,
    name: p.part || info.value.title,
    singer: info.value.author || '视频源作者',
    album: info.value.title,
    duration: p.duration || 0,
    pic: info.value.pic,
    qualitys: ['128k'],
    extra: { bvid: bvid.value, cid: p.cid, page: p.page },
  }
  await player.playSong(song)
  ui.toast('已切换为音频模式播放', 'success', 1600)
  router.push('/player')
}

function back(): void {
  router.push('/mv')
}

function fmt(n: number): string {
  if (n >= 10000) return `${(n / 10000).toFixed(1)}万`
  return String(n)
}

function onVideoError(): void {
  const err = videoEl.value?.error
  videoError.value = err?.message || '视频加载失败，可能受版权或登录限制'
}

/** 释放当前视频的临时播放缓存（切分P / 关页面时调用） */
function releaseCache(): void {
  if (isDesktop && remoteUrl.value) void call('video:cache:release', { url: remoteUrl.value }).catch(() => {})
}

/** 保存整片视频到用户选择的位置（桌面端） */
const savingVideo = ref(false)
async function saveVideo(): Promise<void> {
  if (!remoteUrl.value) return
  savingVideo.value = true
  try {
    const p = await call<string | null>('video:save', {
      url: remoteUrl.value,
      title: `${info.value?.title || '视频'}${current.value && current.value.page > 1 ? `-P${current.value.page}` : ''}`,
    })
    if (p) ui.toast(`已保存到 ${p}`, 'success')
  } catch (e: any) {
    if (e?.message !== 'cancel' && e?.message !== 'canceled') ui.toast(e?.message || '保存失败', 'error')
  } finally {
    savingVideo.value = false
  }
}

/* ============================ 离线缓存 & 缓存管理 ============================ */
interface OfflineItem {
  key: string
  bvid: string
  cid: string
  title: string
  size: number
  savedAt: number
}
const showCachePanel = ref(false)
const offlineList = ref<OfflineItem[]>([])
const offlineTotal = ref(0)
const loadingCache = ref(false)

function fmtSize(bytes: number): string {
  if (bytes >= 1 << 30) return `${(bytes / (1 << 30)).toFixed(2)} GB`
  if (bytes >= 1 << 20) return `${(bytes / (1 << 20)).toFixed(1)} MB`
  if (bytes >= 1 << 10) return `${(bytes / (1 << 10)).toFixed(0)} KB`
  return `${bytes} B`
}

/** 把当前分P 整片下载到离线目录（桌面端） */
async function cacheCurrent(): Promise<void> {
  const p = current.value
  if (!p || !remoteUrl.value || caching.value) return
  caching.value = true
  try {
    await call('video:offline:save', {
      bvid: bvid.value,
      cid: p.cid,
      url: remoteUrl.value,
      title: `${info.value?.title || '视频'}${p.page > 1 ? `-P${p.page}` : ''}`,
    })
    offlineReady.value = true
    ui.toast('已离线缓存，下次播放免流量秒开', 'success', 1800)
    if (showCachePanel.value) void loadCachePanel()
  } catch (e: any) {
    ui.toast(e?.message || '缓存失败', 'error')
  } finally {
    caching.value = false
  }
}

async function loadCachePanel(): Promise<void> {
  loadingCache.value = true
  try {
    const r = await call<{ items: OfflineItem[]; total: number }>('video:offline:list')
    offlineList.value = r.items || []
    offlineTotal.value = r.total || 0
  } catch {
    offlineList.value = []
    offlineTotal.value = 0
  } finally {
    loadingCache.value = false
  }
}

async function openCachePanel(): Promise<void> {
  showCachePanel.value = true
  void loadCachePanel()
}

async function removeCacheItem(key: string): Promise<void> {
  try {
    await call('video:offline:remove', { key })
    await loadCachePanel()
    // 若删的是当前正在离线播放的分P，回退到在线流
    if (offlineLocal.value) {
      const p = current.value
      if (p) {
        const remain = await call<string | null>('video:offline:file', { bvid: bvid.value, cid: p.cid }).catch(() => null)
        if (!remain) {
          offlineLocal.value = ''
          offlineReady.value = false
          void resolveStream(undefined, true, videoEl.value?.currentTime || 0)
        }
      }
    }
  } catch {
    ui.toast('删除失败', 'error')
  }
}

async function clearAllCache(): Promise<void> {
  try {
    await call('video:offline:remove', {})
    await loadCachePanel()
    if (offlineLocal.value) {
      offlineLocal.value = ''
      offlineReady.value = false
      void resolveStream(undefined, true)
    }
  } catch {
    ui.toast('清空失败', 'error')
  }
}

watch(bvid, () => void load())

onMounted(() => {
  void load()
  document.addEventListener('fullscreenchange', onFsChange)
  boxEl.value?.addEventListener('keydown', onKey)
  // 点空白处（video-box 自身，非控制条）关掉展开的菜单
  boxEl.value?.addEventListener('mousedown', onBoxDown, true)
})
onBeforeUnmount(() => {
  videoEl.value?.pause()
  releaseCache()
  window.clearTimeout(hideTimer)
  document.removeEventListener('fullscreenchange', onFsChange)
  boxEl.value?.removeEventListener('keydown', onKey)
  boxEl.value?.removeEventListener('mousedown', onBoxDown, true)
})
</script>

<template>
  <div class="page mv-detail">
    <div class="crumb">
      <button class="icon-btn" @click="back"><Icon name="chevron-left" :size="18" /></button>
      <span class="crumb-text">视频 / MV</span>
      <span class="crumb-sep">/</span>
      <span class="crumb-title ellipsis">{{ info?.title || '加载中…' }}</span>
    </div>

    <div class="watch">
      <div class="player-col">
        <div
          ref="boxEl"
          class="video-box"
          :class="{ idle: !showControls, fullscreen: isFullscreen }"
          tabindex="0"
          @mousemove="pokeControls"
          @click.self="togglePlay"
        >
          <video
            v-if="videoSrc"
            ref="videoEl"
            :src="videoSrc"
            :poster="poster"
            class="video"
            :style="{ objectFit: fillMode }"
            autoplay
            playsinline
            @error="onVideoError"
            @timeupdate="onTimeUpdate"
            @loadedmetadata="onLoadedMeta"
            @progress="onProgressEvt"
            @play="onPlay"
            @pause="onPause"
            @ended="onEnded"
          />
          <div v-else class="video-state">
            <Icon v-if="loading" name="loading" :size="26" class="spin" />
            <Icon v-else name="video" :size="28" :stroke="1.4" />
            <span>{{ loading ? '正在解析视频流…' : videoError || '暂无可用视频流' }}</span>
            <button v-if="!loading && current" class="btn sm" @click="selectPart(current, true)">重试</button>
          </div>

          <DanmakuLayer
            v-if="videoSrc && ui.settings.danmakuEnabled"
            :video="videoEl"
            :items="danmakuItems"
            :enabled="ui.settings.danmakuEnabled"
            :opacity="ui.settings.danmakuOpacity"
            :font-size="ui.settings.danmakuFontSize"
            :speed="ui.settings.danmakuSpeed"
            :area="ui.settings.danmakuArea"
            :anti-subtitle="ui.settings.danmakuAntiSubtitle"
            :block-words="ui.settings.danmakuBlockWords"
          />

          <!-- 播放/暂停大按钮 -->
          <button
            v-if="videoSrc && ready && !playing"
            class="big-play"
            @click.stop="togglePlay"
          >
            <Icon name="play" :size="34" />
          </button>

          <!-- 离线缓存角标 -->
          <span v-if="offlineReady" class="offline-badge"><Icon name="check" :size="11" />已缓存</span>

          <div v-if="videoError && videoSrc" class="video-overlay">
            <span>{{ videoError }}</span>
            <button class="btn sm" @click="current && selectPart(current, true)">重试</button>
          </div>

          <!-- 底部控制条 -->
          <div v-if="videoSrc" class="ctrl" :class="{ hidden: !showControls && playing }" @click.stop>
            <!-- 进度条 -->
            <div class="bar" @click="onProgressClick">
              <div class="bar-buffer" :style="{ width: (buffered / (duration || 1)) * 100 + '%' }"></div>
              <div class="bar-played" :style="{ width: (curTime / (duration || 1)) * 100 + '%' }"></div>
              <div class="bar-thumb" :style="{ left: (curTime / (duration || 1)) * 100 + '%' }"></div>
            </div>

            <!-- 移动端控制条：两行大目标，功能收进图标 chips，无音量滑杆（用系统音量） -->
            <div v-if="isMobileMv" class="ctrl-row m-ctrl">
              <div class="m-row">
                <button class="cbtn" @click="togglePlay">
                  <Icon :name="playing ? 'pause' : 'play'" :size="20" />
                </button>
                <button class="cbtn" @click="nudge(-5)"><Icon name="prev" :size="17" /></button>
                <button class="cbtn" @click="nudge(5)"><Icon name="next" :size="17" /></button>
                <span class="time mono">{{ fmtTime(curTime) }} / {{ fmtTime(duration) }}</span>
                <span class="m-gap" />
                <div class="menu-wrap">
                  <button class="cbtn toggle" :class="{ open: menu === 'quality' }" @click="toggleMenu('quality')">
                    <Icon name="gauge" :size="17" />
                  </button>
                  <div v-if="menu === 'quality'" class="menu">
                    <div class="menu-title">画质</div>
                    <button
                      v-for="q in qualities"
                      :key="q.qn"
                      class="menu-item"
                      :class="{ active: q.qn === curQn }"
                      @click="changeQuality(q.qn)"
                    >
                      {{ q.label }}
                      <Icon v-if="q.qn === curQn" name="check" :size="13" />
                    </button>
                    <div v-if="!qualities.length" class="menu-empty">暂无更多画质</div>
                  </div>
                </div>
                <div class="menu-wrap">
                  <button class="cbtn toggle" :class="{ open: menu === 'speed' }" @click="toggleMenu('speed')">
                    <Icon name="gauge" :size="17" />
                  </button>
                  <div v-if="menu === 'speed'" class="menu">
                    <div class="menu-title">播放速度</div>
                    <button
                      v-for="r in RATES"
                      :key="r"
                      class="menu-item"
                      :class="{ active: r === rate }"
                      @click="setRate(r)"
                    >
                      {{ r === 1 ? '正常' : r + 'x' }}
                      <Icon v-if="r === rate" name="check" :size="13" />
                    </button>
                  </div>
                </div>
                <button class="cbtn" title="画中画" @click="togglePip"><Icon name="album" :size="17" /></button>
                <button class="cbtn" title="全屏" @click="toggleFullscreen">
                  <Icon :name="isFullscreen ? 'shrink' : 'expand'" :size="17" />
                </button>
              </div>
              <div class="menu-wrap">
                <button class="m-chip" :class="{ open: menu === 'more' }" @click="toggleMenu('more')">
                  <Icon name="more" :size="15" />更多
                </button>
                <div v-if="menu === 'more'" class="menu">
                  <div class="menu-title">播放选项</div>
                  <button class="menu-item" :class="{ active: autoNext }" @click="autoNext = !autoNext">
                    自动连播<Icon v-if="autoNext" name="check" :size="13" />
                  </button>
                  <button
                    v-for="m in LOOP_MODES"
                    :key="m"
                    class="menu-item"
                    :class="{ active: m === loopMode }"
                    @click="setLoop(m)"
                  >
                    {{ LOOP_LABEL[m] }}
                    <Icon v-if="m === loopMode" name="check" :size="13" />
                  </button>
                  <div class="menu-title">画面模式</div>
                  <button
                    v-for="m in FILL_MODES"
                    :key="m"
                    class="menu-item"
                    :class="{ active: m === fillMode }"
                    @click="setFill(m)"
                  >
                    {{ FILL_LABEL[m] }}
                    <Icon v-if="m === fillMode" name="check" :size="13" />
                  </button>
                  <div class="menu-title">其他</div>
                  <button class="menu-item" :class="{ active: ui.settings.danmakuEnabled }" @click="toggleDanmaku">
                    弹幕{{ ui.settings.danmakuEnabled ? '（开）' : '（关）' }}
                  </button>
                  <button class="menu-item" @click="toggleMute">
                    {{ muted || volume === 0 ? '开启声音' : '静音' }}
                  </button>
                </div>
              </div>
            </div>
          </div>
        </div>

        <div class="meta">
          <h1 class="clamp-2">{{ info?.title || '视频加载中' }}</h1>
          <div class="stats-row">
            <span class="stat-item">
              <Icon name="play" :size="13" />
              <b>{{ fmtCount(info?.play || 0) }}</b> 次播放
            </span>
            <span class="stat-sep">·</span>
            <span class="stat-item">
              <Icon name="message" :size="13" />
              <b>{{ fmtCount(info?.danmaku || 0) }}</b> 弹幕
            </span>
            <span class="stat-sep">·</span>
            <span class="stat-item">
              <Icon name="heart" :size="13" />
              <b>{{ fmtCount(info?.like || 0) }}</b> 点赞
            </span>
            <span v-if="info?.pubdate" class="stat-sep">·</span>
            <span v-if="info?.pubdate" class="stat-item time">{{ fmtDate(info.pubdate) }}</span>
          </div>
          <div class="meta-row">
            <span class="author"><Icon name="user" :size="13" />{{ info?.author || '未知作者' }}</span>
            <span v-if="current" class="part-now">P{{ current.page }} · {{ current.part }}</span>
            <div class="meta-actions">
              <button class="btn sm" @click="listenAudio"><Icon name="music" :size="13" />听音频</button>
              <button
                v-if="isDesktop && remoteUrl"
                class="btn sm"
                :disabled="savingVideo"
                @click="saveVideo"
              >
                <Icon name="download" :size="13" />{{ savingVideo ? '保存中…' : '保存视频' }}
              </button>
              <button v-if="isDesktop && remoteUrl && !offlineReady" class="btn sm" :disabled="caching" @click="cacheCurrent">
                <Icon name="database" :size="13" />{{ caching ? '缓存中…' : '离线缓存' }}
              </button>
              <button class="btn sm ghost" @click="load"><Icon name="refresh" :size="13" />刷新</button>
            </div>
          </div>
          <p v-if="info?.desc" class="desc clamp-3">{{ info.desc }}</p>
        </div>
      </div>

      <aside class="side">
        <div class="side-head">
          <div>
            <b>{{ hasParts ? '分集' : '视频信息' }}</b>
            <span v-if="hasParts" class="side-count">共 {{ parts.length }} P</span>
          </div>
          <Icon name="list" :size="15" />
        </div>

        <div v-if="hasParts" class="parts" @scroll="onPartsScroll">
          <button
            v-for="p in partsMore"
            :key="p.cid"
            class="part"
            :class="{ active: current?.cid === p.cid }"
            @click="selectPart(p)"
          >
            <span class="part-no">{{ p.page }}</span>
            <span class="part-name ellipsis">{{ p.part }}</span>
            <span class="part-dur mono">{{ p.duration ? formatTime(p.duration) : '' }}</span>
          </button>
          <button v-if="partsPending" class="parts-tip parts-more-btn" @click="loadMoreParts()">
            加载更多分集（{{ partsMore.length }}/{{ parts.length }}）
          </button>
        </div>

        <div v-else class="single-info">
          <Cover :src="poster" :alt="info?.title || ''" size="100%" :radius="10" />
          <p>{{ listError || '该视频为单集内容' }}</p>
        </div>
      </aside>
    </div>

    <section v-if="related.length" class="related">
      <div class="section-head">
        <div>
          <div class="section-title"><Icon name="video" :size="17" />更多视频</div>
          <div class="section-sub">来自同一作者的内容</div>
        </div>
      </div>
      <div class="rel-grid">
        <div v-for="v in related" :key="v.bvid" class="rel-card" @click="router.push(`/mv/${v.bvid}`)">
          <div class="rel-thumb">
            <Cover :src="v.pic" :alt="v.title" size="100%" :radius="10" />
            <span class="rel-dur">{{ v.duration }}</span>
          </div>
          <div class="rel-title clamp-2">{{ v.title }}</div>
          <div class="rel-sub ellipsis">{{ v.author }} · {{ fmt(v.play) }} 播放</div>
        </div>
      </div>
    </section>

    <!-- 缓存管理面板 -->
    <div v-if="showCachePanel" class="cache-mask" @click.self="showCachePanel = false">
      <div class="cache-panel">
        <div class="cache-head">
          <div>
            <b>离线缓存管理</b>
            <span class="cache-sub">共 {{ offlineList.length }} 个视频 · 占用 {{ fmtSize(offlineTotal) }}</span>
          </div>
          <button class="icon-btn" @click="showCachePanel = false"><Icon name="close" :size="16" /></button>
        </div>
        <div class="cache-body">
          <div v-if="loadingCache" class="cache-empty">加载中…</div>
          <div v-else-if="!offlineList.length" class="cache-empty">
            还没有离线缓存，播放视频时点击「离线缓存」即可保存
          </div>
          <div v-else class="cache-list">
            <div v-for="it in offlineList" :key="it.key" class="cache-item">
              <div class="cache-info">
                <div class="cache-title ellipsis">{{ it.title || it.bvid }}</div>
                <div class="cache-meta">{{ fmtSize(it.size) }} · {{ new Date(it.savedAt).toLocaleDateString() }}</div>
              </div>
              <button class="icon-btn danger" title="删除" @click="removeCacheItem(it.key)">
                <Icon name="trash" :size="15" />
              </button>
            </div>
          </div>
        </div>
        <div class="cache-foot">
          <button class="btn sm ghost" :disabled="!offlineList.length" @click="clearAllCache">
            <Icon name="trash" :size="13" />清空全部
          </button>
          <button class="btn sm" @click="showCachePanel = false">关闭</button>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.mv-detail {
  padding-top: 8px;
}
.crumb {
  display: flex;
  align-items: center;
  gap: 6px;
  height: 34px;
  margin-bottom: 8px;
  color: var(--text-3);
  font-size: 12px;
}
.crumb-text {
  color: var(--text-2);
}
.crumb-sep {
  opacity: 0.5;
}
.crumb-title {
  color: var(--text);
  max-width: 60%;
}
.watch {
  display: grid;
  grid-template-columns: minmax(0, 1fr) 300px;
  gap: 18px;
  align-items: start;
}
.video-box {
  position: relative;
  aspect-ratio: 16 / 9;
  background: #000;
  border-radius: 12px;
  overflow: hidden;
  border: 1px solid var(--line);
  outline: none;
}
.video-box.fullscreen {
  border-radius: 0;
  border: none;
}
.video {
  width: 100%;
  height: 100%;
  display: block;
  background: #000;
}
.video-state {
  position: absolute;
  inset: 0;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 10px;
  color: rgba(255, 255, 255, 0.65);
  font-size: 12.5px;
  text-align: center;
  padding: 20px;
}
.big-play {
  position: absolute;
  inset: 0;
  margin: auto;
  width: 68px;
  height: 68px;
  border-radius: 50%;
  border: none;
  background: rgba(0, 0, 0, 0.55);
  color: #fff;
  display: flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
  backdrop-filter: blur(4px);
  transition: background 0.2s, transform 0.2s;
}
.big-play:hover {
  background: rgba(0, 0, 0, 0.75);
  transform: scale(1.06);
}
.offline-badge {
  position: absolute;
  top: 10px;
  left: 10px;
  display: inline-flex;
  align-items: center;
  gap: 4px;
  padding: 3px 9px;
  border-radius: 20px;
  background: rgba(0, 0, 0, 0.6);
  color: #8fe3a0;
  font-size: 10.5px;
  backdrop-filter: blur(4px);
}
.video-overlay {
  position: absolute;
  inset: auto 0 0 0;
  padding: 10px 14px;
  background: linear-gradient(180deg, transparent, rgba(0, 0, 0, 0.75));
  color: #ffb9c4;
  font-size: 12px;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
}

/* ---- 控制条 ---- */
.ctrl {
  position: absolute;
  inset: auto 0 0 0;
  padding: 22px 12px 8px;
  background: linear-gradient(180deg, transparent, rgba(0, 0, 0, 0.82));
  opacity: 1;
  transition: opacity 0.2s, transform 0.2s;
  z-index: 3;
}
.ctrl.hidden {
  opacity: 0;
  transform: translateY(8px);
  pointer-events: none;
}
.bar {
  position: relative;
  height: 4px;
  border-radius: 3px;
  background: rgba(255, 255, 255, 0.22);
  cursor: pointer;
  margin-bottom: 6px;
}
.bar:hover {
  height: 6px;
}
.bar-buffer,
.bar-played {
  position: absolute;
  left: 0;
  top: 0;
  bottom: 0;
  border-radius: 3px;
}
.bar-buffer {
  background: rgba(255, 255, 255, 0.35);
}
.bar-played {
  background: var(--accent, #7c9cff);
}
.bar-thumb {
  position: absolute;
  top: 50%;
  width: 12px;
  height: 12px;
  border-radius: 50%;
  background: #fff;
  transform: translate(-50%, -50%) scale(0);
  transition: transform 0.15s;
  box-shadow: 0 1px 4px rgba(0, 0, 0, 0.5);
}
.bar:hover .bar-thumb {
  transform: translate(-50%, -50%) scale(1);
}
.ctrl-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
}
.ctrl-left,
.ctrl-right {
  display: flex;
  align-items: center;
  gap: 2px;
}
.cbtn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 3px;
  min-width: 30px;
  height: 30px;
  padding: 0 5px;
  border: none;
  border-radius: 6px;
  background: transparent;
  color: rgba(255, 255, 255, 0.92);
  cursor: pointer;
  transition: background 0.15s, color 0.15s;
}
.cbtn:hover {
  background: rgba(255, 255, 255, 0.14);
}
.cbtn:disabled {
  opacity: 0.45;
  cursor: default;
}
.cbtn.toggle.on {
  color: var(--accent, #7c9cff);
}
.cbtn.toggle.open {
  background: rgba(255, 255, 255, 0.16);
}
.tlab {
  font-size: 10.5px;
}
.time {
  margin-left: 8px;
  font-size: 11px;
  color: rgba(255, 255, 255, 0.8);
  white-space: nowrap;
}
.vol {
  display: flex;
  align-items: center;
}
.vol-range {
  width: 0;
  opacity: 0;
  transition: width 0.2s, opacity 0.2s;
  accent-color: var(--accent, #7c9cff);
  cursor: pointer;
}
.vol:hover .vol-range {
  width: 70px;
  opacity: 1;
  margin: 0 6px;
}

/* ---- 下拉菜单 ---- */
.menu-wrap {
  position: relative;
}
.menu {
  position: absolute;
  bottom: 38px;
  right: 0;
  min-width: 120px;
  padding: 6px;
  border-radius: 10px;
  background: rgba(20, 20, 24, 0.96);
  border: 1px solid rgba(255, 255, 255, 0.12);
  backdrop-filter: blur(8px);
  z-index: 5;
}
.menu-title {
  padding: 4px 8px 6px;
  font-size: 10.5px;
  color: rgba(255, 255, 255, 0.5);
}
.menu-item {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  width: 100%;
  padding: 7px 8px;
  border: none;
  border-radius: 6px;
  background: transparent;
  color: rgba(255, 255, 255, 0.9);
  font-size: 12px;
  cursor: pointer;
  text-align: left;
}
.menu-item:hover {
  background: rgba(255, 255, 255, 0.12);
}
.menu-item.active {
  color: var(--accent, #7c9cff);
}
.menu-empty {
  padding: 8px;
  font-size: 11px;
  color: rgba(255, 255, 255, 0.5);
}

/* ---- 缓存管理面板 ---- */
.cache-mask {
  position: fixed;
  inset: 0;
  background: rgba(0, 0, 0, 0.55);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 60;
}
.cache-panel {
  width: 520px;
  max-width: 92vw;
  max-height: 76vh;
  display: flex;
  flex-direction: column;
  border-radius: 14px;
  background: var(--bg, #16161a);
  border: 1px solid var(--line);
  box-shadow: 0 24px 60px -20px rgba(0, 0, 0, 0.7);
  overflow: hidden;
}
.cache-head {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  padding: 14px 16px;
  border-bottom: 1px solid var(--line);
}
.cache-head b {
  font-size: 15px;
  font-weight: 650;
}
.cache-sub {
  display: block;
  margin-top: 4px;
  font-size: 11px;
  color: var(--text-3);
}
.cache-body {
  flex: 1;
  overflow-y: auto;
  padding: 8px;
}
.cache-empty {
  padding: 40px 16px;
  text-align: center;
  font-size: 12px;
  color: var(--text-3);
}
.cache-list {
  display: flex;
  flex-direction: column;
  gap: 2px;
}
.cache-item {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 9px 10px;
  border-radius: 8px;
}
.cache-item:hover {
  background: var(--hover);
}
.cache-info {
  flex: 1;
  min-width: 0;
}
.cache-title {
  font-size: 12.5px;
  color: var(--text);
}
.cache-meta {
  margin-top: 3px;
  font-size: 10.5px;
  color: var(--text-3);
}
.icon-btn.danger:hover {
  color: #ff7c8a;
}
.cache-foot {
  display: flex;
  align-items: center;
  justify-content: flex-end;
  gap: 8px;
  padding: 12px 16px;
  border-top: 1px solid var(--line);
}

.meta {
  padding: 12px 2px 0;
}
.meta h1 {
  font-size: 17px;
  font-weight: 650;
  line-height: 1.45;
}
.stats-row {
  display: flex;
  align-items: center;
  gap: 6px;
  margin-top: 10px;
  font-size: 12px;
  color: var(--text-3);
  flex-wrap: wrap;
}
.stat-item {
  display: inline-flex;
  align-items: center;
  gap: 4px;
}
.stat-item b {
  color: var(--text-2);
  font-weight: 600;
}
.stat-sep {
  opacity: 0.4;
}
.stat-item.time {
  font-variant-numeric: tabular-nums;
}
.desc {
  margin-top: 10px;
  padding: 10px 12px;
  font-size: 12px;
  line-height: 1.7;
  color: var(--text-2);
  background: var(--panel);
  border: 1px solid var(--line);
  border-radius: 8px;
  max-height: 60px;
  overflow: hidden;
}
.meta-row {
  display: flex;
  align-items: center;
  gap: 14px;
  margin-top: 10px;
  font-size: 11.5px;
  color: var(--text-3);
  flex-wrap: wrap;
}
.author {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  color: var(--text-2);
}
.part-now {
  padding: 2px 8px;
  border-radius: 20px;
  background: var(--accent-soft);
  color: var(--accent);
  font-size: 10.5px;
}
.meta-actions {
  margin-left: auto;
  display: flex;
  gap: 8px;
}
.side {
  border: 1px solid var(--line);
  border-radius: 12px;
  background: var(--panel);
  overflow: hidden;
  max-height: calc(100vh - 210px);
  display: flex;
  flex-direction: column;
}
.side-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 11px 13px;
  border-bottom: 1px solid var(--line);
  font-size: 12.5px;
}
.side-head b {
  font-weight: 600;
}
.side-count {
  margin-left: 7px;
  font-size: 10.5px;
  color: var(--text-3);
}
.parts {
  overflow-y: auto;
  max-height: 42vh; /* 不限高则容器随内容撑高、永不触发内部滚动 */
  padding: 6px;
}
.part {
  display: flex;
  align-items: center;
  gap: 9px;
  width: 100%;
  padding: 8px 8px;
  border-radius: 8px;
  font-size: 12px;
  color: var(--text-2);
  text-align: left;
}
.part:hover {
  background: var(--hover);
  color: var(--text);
}
.part.active {
  background: var(--accent-soft);
  color: var(--accent);
}
.part-no {
  width: 18px;
  flex: none;
  font-size: 10.5px;
  color: var(--text-3);
  text-align: center;
}
.part.active .part-no {
  color: var(--accent);
}
.part-name {
  flex: 1;
  min-width: 0;
}
.part-dur {
  font-size: 10px;
  color: var(--text-3);
}
.parts-tip {
  padding: 9px 8px 6px;
  text-align: center;
  font-size: 10.5px;
  color: var(--text-3);
}
.parts-more-btn {
  display: block;
  width: 100%;
  border: 1px dashed var(--panel-3);
  border-radius: 8px;
  background: transparent;
  cursor: pointer;
  font: inherit;
  color: var(--text-2);
}
.parts-more-btn:hover {
  color: var(--text);
  border-color: var(--accent, #7c9cff);
}
.single-info {
  padding: 12px;
  font-size: 11.5px;
  color: var(--text-3);
}
.single-info p {
  margin-top: 10px;
  line-height: 1.6;
}
.related {
  margin-top: 28px;
}
.rel-grid {
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: 16px;
}
.rel-card {
  cursor: pointer;
  min-width: 0;
}
.rel-thumb {
  position: relative;
  aspect-ratio: 16 / 10;
  border-radius: 10px;
  overflow: hidden;
  background: var(--panel);
}
.rel-dur {
  position: absolute;
  right: 6px;
  bottom: 5px;
  padding: 1px 5px;
  border-radius: 3px;
  background: rgba(0, 0, 0, 0.65);
  color: #fff;
  font-size: 9.5px;
}
.rel-title {
  margin-top: 7px;
  font-size: 12px;
  line-height: 1.4;
  min-height: 34px;
}
.rel-sub {
  margin-top: 2px;
  font-size: 10.5px;
  color: var(--text-3);
}
.spin {
  animation: spin 1s linear infinite;
}
@keyframes spin {
  to {
    transform: rotate(360deg);
  }
}
@media (max-width: 1200px) {
  .watch {
    grid-template-columns: minmax(0, 1fr) 260px;
  }
  .rel-grid {
    grid-template-columns: repeat(3, minmax(0, 1fr));
  }
}

/* ---- 移动端控制条：两行布局，chips 横滑 ---- */
.m-ctrl {
  display: flex;
  flex-direction: column;
  gap: 6px;
  padding: 6px 10px calc(8px + env(safe-area-inset-bottom, 0px));
}
.m-ctrl .m-row {
  display: flex;
  align-items: center;
  gap: 4px;
}
.m-ctrl .m-row.chips {
  gap: 7px;
  overflow-x: auto;
  scrollbar-width: none;
  padding: 2px 0;
}
.m-ctrl .m-row.chips::-webkit-scrollbar {
  display: none;
}
.m-ctrl .m-gap {
  flex: 1;
}
.m-ctrl .m-chip {
  flex: none;
  display: inline-flex;
  align-items: center;
  gap: 5px;
  height: 34px;
  padding: 0 13px;
  border-radius: 17px;
  border: 1px solid rgba(255, 255, 255, 0.25);
  background: rgba(255, 255, 255, 0.1);
  color: #fff;
  font-size: 12.5px;
  -webkit-tap-highlight-color: transparent;
}
.m-ctrl .m-chip.on {
  background: var(--accent);
  border-color: transparent;
}
.m-ctrl .menu {
  bottom: 44px;
}
</style>
