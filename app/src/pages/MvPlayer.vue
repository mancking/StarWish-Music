<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import Icon from '@/components/Icon.vue'
import Cover from '@/components/Cover.vue'
import { call } from '@/api'
import { formatTime } from '@shared/lrc'
import { usePlayerStore } from '@/stores/player'
import { useUiStore } from '@/stores/ui'
import type { MvItem, Song } from '@shared/types'

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
const loading = ref(true)
const videoError = ref('')
const listError = ref('')
const related = ref<MvItem[]>([])
const videoEl = ref<HTMLVideoElement | null>(null)

const poster = computed(() => info.value?.pic || '')
const videoSrc = computed(() => (videoUrl.value ? `swmedia://stream/?u=${encodeURIComponent(videoUrl.value)}` : ''))
const hasParts = computed(() => parts.value.length > 1)
const forceLoad = ref(false)
/** 超长分P（整场合集）体积可能数 GB，直接加载会长时间卡住，先提示用户选集 */
const tooLong = computed(() => (current.value?.duration || 0) > 3600 && !forceLoad.value)

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
  videoUrl.value = ''
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

async function selectPart(p: Part, autoplay = true): Promise<void> {
  current.value = p
  forceLoad.value = false
  if ((p.duration || 0) > 3600) {
    loading.value = false
    videoUrl.value = ''
    videoError.value = ''
    router.replace({ path: `/mv/${bvid.value}`, query: p.page > 1 ? { p: String(p.page) } : {} })
    return
  }
  loading.value = true
  videoError.value = ''
  videoUrl.value = ''
  router.replace({ path: `/mv/${bvid.value}`, query: p.page > 1 ? { p: String(p.page) } : {} })
  try {
    const r = await call<{ url: string; type: string }>('music:mvurl', { bvid: bvid.value, cid: p.cid })
    videoUrl.value = r.url
    if (autoplay) {
      requestAnimationFrame(() => {
        const v = videoEl.value
        if (v) {
          v.load()
          void v.play().catch(() => {})
        }
      })
    }
  } catch (e: any) {
    videoError.value = e?.message || '视频流解析失败'
  } finally {
    loading.value = false
  }
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

watch(bvid, () => void load())

onMounted(() => void load())
onBeforeUnmount(() => {
  videoEl.value?.pause()
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
        <div class="video-box">
          <video
            v-if="videoSrc"
            ref="videoEl"
            :src="videoSrc"
            :poster="poster"
            class="video"
            controls
            autoplay
            playsinline
            @error="onVideoError"
          />
          <div v-else class="video-state">
            <Icon v-if="loading" name="loading" :size="26" class="spin" />
            <Icon v-else-if="tooLong" name="list" :size="28" :stroke="1.4" />
            <Icon v-else name="video" :size="28" :stroke="1.4" />
            <template v-if="tooLong">
              <span class="state-title">这是一个超长合集（{{ formatTime(current?.duration || 0) }}）</span>
              <span class="state-desc">文件体积较大，建议从右侧「分集」中选择单曲分 P 播放</span>
              <button class="btn sm" @click="forceLoad = true; current && selectPart(current, true)">仍要加载</button>
            </template>
            <template v-else>
              <span>{{ loading ? '正在解析视频流…' : videoError || '暂无可用视频流' }}</span>
              <button v-if="!loading && current" class="btn sm" @click="selectPart(current, true)">重试</button>
            </template>
          </div>
          <div v-if="videoError && videoSrc" class="video-overlay">
            <span>{{ videoError }}</span>
            <button class="btn sm" @click="current && selectPart(current, true)">重试</button>
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

        <div v-if="hasParts" class="parts">
          <button
            v-for="p in parts"
            :key="p.cid"
            class="part"
            :class="{ active: current?.cid === p.cid }"
            @click="selectPart(p)"
          >
            <span class="part-no">{{ p.page }}</span>
            <span class="part-name ellipsis">{{ p.part }}</span>
            <span class="part-dur mono">{{ p.duration ? formatTime(p.duration) : '' }}</span>
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
.state-title {
  color: rgba(255, 255, 255, 0.85);
  font-size: 13.5px;
  font-weight: 600;
}
.state-desc {
  font-size: 11.5px;
  color: rgba(255, 255, 255, 0.5);
  max-width: 380px;
  line-height: 1.7;
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
</style>
