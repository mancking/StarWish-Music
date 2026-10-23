<script setup lang="ts">
import { computed, defineOptions, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import Icon from '@/components/Icon.vue'
import Cover from '@/components/Cover.vue'
import DanmakuLayer from '@/components/DanmakuLayer.vue'
import { call } from '@/api'
import { useUiStore } from '@/stores/ui'
import type { MvItem } from '@shared/types'

/**
 * 移动端视频播放页 —— 模板级全新实现（参照 B 站移动端播放页信息架构）：
 *   视频区（16:9 置顶，手势区外）→ 标题/数据/UP 主 → 分 P 横滑 → 相关视频列表
 *   控制以底部条 + 底部抽屉「更多」呈现；进度记忆与桌面共用同一存储键。
 * 数据走与桌面同一组 bridge 通道，不含任何桌面桌面弹层/缓存管理。
 */
defineOptions({ name: 'MvPlayer' })

interface Part {
  cid: string
  page: number
  part: string
  duration?: number
}

const FILL_MODES = ['contain', 'cover', 'fill'] as const
const FILL_LABEL: Record<string, string> = { contain: '适应', cover: '裁剪填充', fill: '拉伸' }
const RATES = [0.5, 0.75, 1, 1.25, 1.5, 2]

const route = useRoute()
const router = useRouter()
const ui = useUiStore()

const bvid = computed(() => String(route.params.bvid || ''))
const info = ref<any>(null)
const parts = ref<Part[]>([])
const current = ref<Part | null>(null)
const related = ref<MvItem[]>([])
const loading = ref(true)
const videoError = ref('')
const videoSrc = ref('')
const qualities = ref<{ qn: number; label: string }[]>([])
const curQn = ref(0)

const videoEl = ref<HTMLVideoElement | null>(null)
const playing = ref(false)
const curTime = ref(0)
const duration = ref(0)
const rate = ref(1)
const fillMode = ref<(typeof FILL_MODES)[number]>('contain')
const autoNext = ref(true)
const loopMode = ref<'off' | 'one' | 'list'>('off')

/* AB 段循环（规格书 v2.7 · 2.5）：第一次点设 A（绿），第二次设 B（粉），第三次清除 */
const abA = ref<number | null>(null)
const abB = ref<number | null>(null)
const abLabel = computed(() => {
  if (abA.value === null) return 'AB 循环'
  if (abB.value === null) return `A ${fmtTime(abA.value)}`
  return `AB ${fmtTime(abA.value)}-${fmtTime(abB.value)}`
})
function markAB(): void {
  const t = videoEl.value?.currentTime ?? curTime.value
  if (abA.value === null) abA.value = t
  else if (abB.value === null) {
    if (t > abA.value + 0.5) abB.value = t
    else abA.value = t
  } else {
    abA.value = null
    abB.value = null
  }
}
const muted = ref(false)
const volume = ref(1)
const showSheet = ref(false)
const showControls = ref(true)
const danmakuItems = ref<any[]>([])

let hideTimer = 0
let lastProgSave = 0

const picUrl = (u?: string): string => {
  const s = String(u || '')
  if (!/^https?:\/\//i.test(s)) return s
  const cap: any = (globalThis as any).Capacitor
  return cap?.isNativePlatform?.() ? `/swmedia/?u=${encodeURIComponent(s)}` : s
}

const poster = computed(() => picUrl(info.value?.pic))
const fmtTime = (t: number): string => {
  const s = Math.max(0, Math.floor(t || 0))
  const m = Math.floor(s / 60)
  const r = s % 60
  return `${String(m).padStart(2, '0')}:${String(r).padStart(2, '0')}`
}
const fmtCount = (n: number): string => (n >= 10000 ? `${(n / 10000).toFixed(1)}万` : String(n || 0))

function progKey(cid: string): string {
  return `xinyuan_resume_${bvid.value}_${cid}`
}

/** 时间推进：AB 段到 B 点回跳 A 点（规格书 2.5） */
function onTimeUpdate(): void {
  const v = videoEl.value
  if (!v) return
  curTime.value = v.currentTime
  if (abA.value !== null && abB.value !== null && v.currentTime >= abB.value - 0.05) v.currentTime = abA.value
}

function poke(): void {
  showControls.value = true
  clearTimeout(hideTimer)
  hideTimer = window.setTimeout(() => {
    if (playing.value) showControls.value = false
  }, 2600)
}

async function load(): Promise<void> {
  loading.value = true
  videoError.value = ''
  videoSrc.value = ''
  parts.value = []
  current.value = null
  try {
    info.value = await call<any>('music:mvinfo', { bvid: bvid.value })
    try {
      parts.value = await call<Part[]>('music:mvparts', { bvid: bvid.value })
    } catch {
      parts.value = []
    }
    const wantPage = Number(route.query.p) || 1
    const target = parts.value.find(p => p.page === wantPage) || parts.value[0] || null
    if (target) await selectPart(target, true)
    else videoError.value = '没有可播放的分 P'
    loadRelated()
    loadDanmaku(target?.cid || info.value?.cid || '')
  } catch (e: any) {
    videoError.value = e?.message || '视频信息加载失败'
  } finally {
    loading.value = false
  }
}

async function loadRelated(): Promise<void> {
  try {
    const list = await call<MvItem[]>('music:mv', { keyword: info.value?.author || '音乐', page: 1 })
    related.value = list.filter(v => v.bvid !== bvid.value).slice(0, 10)
  } catch {
    related.value = []
  }
}

async function loadDanmaku(cid: string): Promise<void> {
  if (!cid || !ui.settings.danmakuEnabled) {
    danmakuItems.value = []
    return
  }
  try {
    danmakuItems.value = await call<any[]>('mv:danmaku', { cid })
  } catch {
    danmakuItems.value = []
  }
}

async function selectPart(p: Part, autoplay = true): Promise<void> {
  current.value = p
  videoError.value = ''
  loading.value = true
  try {
    const r = await call<{ url: string; type: string; qn: number; qualities: { qn: number; label: string }[] }>(
      'music:mvurl',
      { bvid: bvid.value, cid: p.cid, qn: curQn.value || undefined }
    )
    videoSrc.value = r.url
    if (r.qualities?.length) qualities.value = r.qualities
    if (r.qn) curQn.value = r.qn
    if (autoplay) {
      const saved = Number(localStorage.getItem(progKey(p.cid)) || 0)
      const resume = saved > 15 ? saved : 0
      if (resume) ui.toast('已恢复到上次播放进度', 'info', 1800)
      requestAnimationFrame(() => {
        const v = videoEl.value
        if (!v) return
        if (resume) {
          const seek = (): void => {
            v.currentTime = resume
            v.removeEventListener('loadedmetadata', seek)
          }
          v.addEventListener('loadedmetadata', seek)
        }
        void v.play().catch(() => undefined)
      })
    }
    loadDanmaku(p.cid)
  } catch (e: any) {
    videoError.value = e?.message || '视频流解析失败'
  } finally {
    loading.value = false
  }
}

function togglePlay(): void {
  const v = videoEl.value
  if (!v) return
  if (v.paused) void v.play().catch(() => undefined)
  else v.pause()
  poke()
}

function seekTo(t: number): void {
  const v = videoEl.value
  if (!v) return
  v.currentTime = Math.max(0, Math.min(t, duration.value || 0))
}

function onBarClick(e: MouseEvent): void {
  const el = e.currentTarget as HTMLElement
  const rect = el.getBoundingClientRect()
  seekTo(((e.clientX - rect.left) / rect.width) * (duration.value || 0))
}

function setRate(r: number): void {
  rate.value = r
  if (videoEl.value) videoEl.value.playbackRate = r
}

function setFill(m: (typeof FILL_MODES)[number]): void {
  fillMode.value = m
  if (videoEl.value) videoEl.value.style.objectFit = m
}

function toggleDanmaku(): void {
  const v = !ui.settings.danmakuEnabled
  ;(ui.settings as any).danmakuEnabled = v
  void call('settings:set', { danmakuEnabled: v })
  if (v && current.value) void loadDanmaku(current.value.cid)
  else danmakuItems.value = []
}

function changeQn(qn: number): void {
  curQn.value = qn
  const t = videoEl.value?.currentTime || 0
  if (current.value) void selectPart(current.value, playing.value)
  setTimeout(() => seekTo(t), 400)
  showSheet.value = false
}

function toggleFullscreen(): void {
  const v = videoEl.value
  if (!v) return
  if (document.fullscreenElement) void document.exitFullscreen()
  else void v.requestFullscreen?.().catch(() => undefined)
}

/** 画中画（规格书 2.9）：Android 8+ / iOS 14+ 支持，不支持时提示 */
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

function onEnded(): void {
  const v = videoEl.value
  if (v && current.value) {
    try {
      localStorage.removeItem(progKey(current.value.cid))
    } catch { /* ignore */ }
  }
  if (loopMode.value === 'one') {
    seekTo(0)
    void v?.play().catch(() => undefined)
    return
  }
  const idx = parts.value.findIndex(p => p.cid === current.value?.cid)
  const next = parts.value[idx + 1]
  if (next && (autoNext.value || loopMode.value === 'list')) void selectPart(next, true)
}

function back(): void {
  if (window.history.length > 1) router.back()
  else router.push('/mv')
}

onMounted(() => void load())
onBeforeUnmount(() => {
  const v = videoEl.value
  if (v && current.value && v.currentTime > 5) {
    try {
      localStorage.setItem(progKey(current.value.cid), String(v.currentTime))
    } catch { /* ignore */ }
  }
})
watch(bvid, () => void load())
</script>

<template>
  <div class="page mvp" @click="poke" @touchstart="poke">
    <!-- 视频区：置顶 16:9 -->
    <div class="stage">
      <video
        v-if="videoSrc"
        ref="videoEl"
        :src="videoSrc"
        :poster="poster"
        :style="{ objectFit: fillMode }"
        class="video"
        playsinline
        @click.stop="togglePlay"
        @timeupdate="onTimeUpdate"
        @loadedmetadata="duration = videoEl?.duration || 0"
        @play="playing = true; poke()"
        @pause="playing = false; showControls = true"
        @ended="onEnded"
      />
      <div v-else class="stage-state">
        <Icon v-if="loading" name="loading" :size="26" class="spin" />
        <Icon v-else name="video" :size="30" :stroke="1.4" />
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

      <div v-if="videoSrc" class="ovl" :class="{ hidden: !showControls && playing }" @click.stop>
        <button class="ovl-back" @click="back"><Icon name="chevron-left" :size="20" /></button>
        <div class="ovl-bar" @click.stop>
          <button class="o-btn" @click="togglePlay"><Icon :name="playing ? 'pause' : 'play'" :size="20" /></button>
          <div class="o-bar" @click.stop="onBarClick($event)">
            <div class="o-played" :style="{ width: (curTime / (duration || 1)) * 100 + '%' }" />
          </div>
          <span class="o-time mono">{{ fmtTime(curTime) }}/{{ fmtTime(duration) }}</span>
          <button class="o-btn" @click="showSheet = true"><Icon name="more" :size="18" /></button>
          <button class="o-btn" @click="toggleFullscreen"><Icon name="expand" :size="18" /></button>
        </div>
      </div>
    </div>

    <!-- 标题与数据 -->
    <div class="head">
      <h1>{{ info?.title || '视频加载中' }}</h1>
      <div class="stats">
        <span><Icon name="play" :size="12" />{{ fmtCount(info?.play || 0) }}</span>
        <span><Icon name="message" :size="12" />{{ fmtCount(info?.danmaku || 0) }}</span>
        <span><Icon name="heart" :size="12" />{{ fmtCount(info?.like || 0) }}</span>
        <span class="author">{{ info?.author || '' }}</span>
      </div>
      <p v-if="info?.desc" class="desc">{{ info.desc }}</p>
    </div>

    <!-- 分 P：横滑 -->
    <section v-if="parts.length > 1" class="sec">
      <div class="sec-title">分集（{{ parts.length }}）</div>
      <div class="h-scroll">
        <button
          v-for="p in parts"
          :key="p.cid"
          class="p-chip"
          :class="{ on: current?.cid === p.cid }"
          @click="selectPart(p, true)"
        >P{{ p.page }} {{ p.part }}</button>
      </div>
    </section>

    <!-- 相关视频 -->
    <section class="sec">
      <div class="sec-title">相关视频</div>
      <div class="r-list">
        <button v-for="v in related" :key="v.bvid" class="r-item" @click="router.push(`/mv/${v.bvid}`)">
          <Cover :src="picUrl(v.pic)" :size="124" radius="10" class="r-cover" />
          <span class="r-meta">
            <span class="r-title">{{ v.title }}</span>
            <span class="r-sub">{{ v.author }} · {{ fmtCount(v.play) }} 播放</span>
          </span>
        </button>
        <div v-if="!related.length" class="none">暂无相关推荐</div>
      </div>
    </section>

    <!-- 更多：紧凑底部抽屉（参照 B 站：图标网格 + 单行横滑选择，不铺满全屏） -->
    <div v-if="showSheet" class="sheet-mask" @click.self="showSheet = false">
      <div class="sheet">
        <div class="sheet-grip" />
        <div class="sheet-head">
          <b>播放设置</b>
          <button class="sheet-done" @click="showSheet = false">完成</button>
        </div>

        <div class="sheet-sec">
          <div class="sheet-title">画质</div>
          <div class="sheet-scroll">
            <button
              v-for="q in qualities"
              :key="q.qn"
              class="s-chip"
              :class="{ on: q.qn === curQn }"
              @click="changeQn(q.qn)"
            >{{ q.label }}</button>
            <span v-if="!qualities.length" class="none">当前流无多画质</span>
          </div>
        </div>

        <div class="sheet-sec">
          <div class="sheet-title">倍速</div>
          <div class="sheet-scroll">
            <button v-for="r in RATES" :key="r" class="s-chip" :class="{ on: r === rate }" @click="setRate(r)">
              {{ r === 1 ? '正常' : r + 'x' }}
            </button>
          </div>
        </div>

        <div class="sheet-sec">
          <div class="sheet-title">画面</div>
          <div class="sheet-scroll">
            <button v-for="m in FILL_MODES" :key="m" class="s-chip" :class="{ on: m === fillMode }" @click="setFill(m)">
              {{ FILL_LABEL[m] }}
            </button>
          </div>
        </div>

        <div class="sheet-sec">
          <div class="sheet-title">播放</div>
          <div class="sheet-grid">
            <button class="g-item" :class="{ on: autoNext }" @click="autoNext = !autoNext">自动连播</button>
            <button class="g-item" :class="{ on: loopMode === 'one' }" @click="loopMode = loopMode === 'one' ? 'off' : 'one'">单集循环</button>
            <button class="g-item" :class="{ on: loopMode === 'list' }" @click="loopMode = loopMode === 'list' ? 'off' : 'list'">列表循环</button>
            <button class="g-item" :class="{ on: abA !== null }" @click="markAB">{{ abLabel }}</button>
            <button class="g-item" @click="togglePip">画中画</button>
            <button class="g-item" :class="{ on: ui.settings.danmakuEnabled }" @click="toggleDanmaku">弹幕</button>
            <button class="g-item" :class="{ on: !muted }" @click="muted = !muted; if (videoEl) videoEl.muted = muted">{{ muted ? '已静音' : '声音开' }}</button>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.mvp {
  padding: 0 0 30px;
}
.stage {
  position: relative;
  width: 100%;
  aspect-ratio: 16 / 9;
  background: #000;
}
.video {
  width: 100%;
  height: 100%;
  display: block;
}
.stage-state {
  position: absolute;
  inset: 0;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 10px;
  color: #cfd6e4;
  font-size: 13px;
}
.ovl {
  position: absolute;
  inset: 0;
  display: flex;
  flex-direction: column;
  justify-content: space-between;
  background: linear-gradient(180deg, rgba(0, 0, 0, 0.4), transparent 30%, transparent 60%, rgba(0, 0, 0, 0.55));
  transition: opacity 0.2s;
}
.ovl.hidden {
  opacity: 0;
  pointer-events: none;
}
.ovl-back {
  width: 42px;
  height: 42px;
  margin: 8px;
  border: 0;
  border-radius: 50%;
  background: rgba(0, 0, 0, 0.35);
  color: #fff;
  display: inline-flex;
  align-items: center;
  justify-content: center;
}
.ovl-bar {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 8px 12px calc(8px + env(safe-area-inset-bottom, 0px));
}
.o-btn {
  width: 40px;
  height: 40px;
  border: 0;
  border-radius: 50%;
  background: rgba(255, 255, 255, 0.12);
  color: #fff;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  flex: none;
}
.o-bar {
  flex: 1;
  height: 4px;
  border-radius: 2px;
  background: rgba(255, 255, 255, 0.25);
  position: relative;
  padding: 8px 0;
  background-clip: content-box;
}
.o-played {
  position: absolute;
  left: 0;
  top: 8px;
  height: 4px;
  border-radius: 2px;
  background: var(--accent);
}
.o-time {
  flex: none;
  font-size: 11px;
  color: #fff;
}
.spin {
  animation: spin 1.2s linear infinite;
}
@keyframes spin {
  to {
    transform: rotate(360deg);
  }
}

/* 标题区 */
.head {
  padding: 12px 16px 2px;
}
.head h1 {
  font-size: 16.5px;
  font-weight: 700;
  line-height: 1.5;
  color: var(--text);
}
.stats {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 10px;
  margin-top: 8px;
  font-size: 12px;
  color: var(--text-3);
}
.stats span {
  display: inline-flex;
  align-items: center;
  gap: 4px;
}
.stats .author {
  color: var(--text-2);
  font-weight: 600;
}
.desc {
  margin: 8px 0 0;
  font-size: 12.5px;
  line-height: 1.7;
  color: var(--text-3);
}

/* 分区 */
.sec {
  margin-top: 20px;
}
.sec-title {
  font-size: 15px;
  font-weight: 700;
  color: var(--text);
  margin: 0 16px 10px;
}
.h-scroll {
  display: flex;
  gap: 8px;
  overflow-x: auto;
  margin: 0 -16px;
  padding: 2px 16px;
  scrollbar-width: none;
}
.h-scroll::-webkit-scrollbar {
  display: none;
}
.p-chip {
  flex: none;
  max-width: 200px;
  height: 38px;
  padding: 0 14px;
  border-radius: 12px;
  border: 1px solid var(--line);
  background: var(--bg-2);
  color: var(--text-2);
  font-size: 12.5px;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  -webkit-tap-highlight-color: transparent;
}
.p-chip.on {
  border-color: transparent;
  background: var(--accent);
  color: #fff;
  font-weight: 600;
}

/* 相关视频 */
.r-list {
  display: flex;
  flex-direction: column;
  gap: 6px;
  padding: 0 16px;
}
.r-item {
  display: flex;
  gap: 10px;
  align-items: flex-start;
  padding: 6px;
  border: 0;
  border-radius: 12px;
  background: none;
  text-align: left;
  -webkit-tap-highlight-color: transparent;
}
.r-item:active {
  background: var(--bg-2);
}
.r-cover {
  flex: none;
}
.r-meta {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 4px;
  padding-top: 2px;
}
.r-title {
  font-size: 13.5px;
  font-weight: 600;
  line-height: 1.45;
  color: var(--text);
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
}
.r-sub {
  font-size: 11.5px;
  color: var(--text-3);
}
.none {
  padding: 16px;
  font-size: 12.5px;
  color: var(--text-3);
}

/* 底部抽屉（紧凑：横滑单行 + 图标网格） */
.sheet-mask {
  position: fixed;
  inset: 0;
  z-index: 60;
  background: rgba(4, 6, 14, 0.55);
  display: flex;
  align-items: flex-end;
}
.sheet {
  width: 100%;
  max-height: 56vh;
  overflow-y: auto;
  border-radius: 18px 18px 0 0;
  background: var(--bg);
  border-top: 1px solid var(--line);
  padding: 8px 16px calc(14px + env(safe-area-inset-bottom, 0px));
}
.sheet-grip {
  width: 40px;
  height: 4px;
  border-radius: 2px;
  background: var(--line);
  margin: 4px auto 6px;
}
.sheet-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 2px 0 6px;
}
.sheet-head b {
  font-size: 14px;
}
.sheet-done {
  height: 28px;
  padding: 0 12px;
  border-radius: 14px;
  background: var(--bg-2);
  color: var(--text-2);
  font-size: 12.5px;
}
.sheet-sec + .sheet-sec {
  margin-top: 12px;
}
.sheet-title {
  font-size: 12px;
  font-weight: 600;
  color: var(--text-3);
  margin-bottom: 6px;
}
/* 单行横滑，避免选项多时把抽屉撑高 */
.sheet-scroll {
  display: flex;
  gap: 8px;
  overflow-x: auto;
  padding-bottom: 2px;
  scrollbar-width: none;
}
.sheet-scroll::-webkit-scrollbar {
  display: none;
}
.sheet-scroll .s-chip {
  flex: 0 0 auto;
}
.sheet-grid {
  display: grid;
  grid-template-columns: repeat(4, 1fr);
  gap: 8px;
}
.g-item {
  height: 46px;
  border-radius: 12px;
  border: 1px solid var(--line);
  background: var(--bg-2);
  color: var(--text-2);
  font-size: 12px;
  line-height: 1.25;
  padding: 0 4px;
}
.g-item.on {
  border-color: color-mix(in srgb, var(--accent) 60%, transparent);
  background: color-mix(in srgb, var(--accent) 16%, var(--bg-2));
  color: var(--accent);
  font-weight: 600;
}
.s-chip {
  height: 34px;
  padding: 0 14px;
  border-radius: 17px;
  border: 1px solid var(--line);
  background: var(--bg-2);
  color: var(--text-2);
  font-size: 12.5px;
  white-space: nowrap;
  -webkit-tap-highlight-color: transparent;
}
.s-chip.on {
  border-color: transparent;
  background: var(--accent);
  color: #fff;
  font-weight: 600;
}
</style>
