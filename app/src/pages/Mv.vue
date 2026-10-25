<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import { useRouter } from 'vue-router'
import Icon from '@/components/Icon.vue'
import Cover from '@/components/Cover.vue'
import { call } from '@/api'
import { isVideoPlayed, markVideoPlayed, onVideoPlayed } from '@/utils/video-played'
import type { MvItem } from '@shared/types'

/**
 * 视频 / MV 聚合页
 * B站 + 云村 + Q音 + 酷狗 + 酷我 **四平台聚合为一个信息流**（不再按平台分 Tab），
 * 后端并发搜索后按「归一标题+歌手」去重、轮转交织，卡片右上角标来源。
 * 顶部胶囊只是对已聚合结果做来源过滤（不重新请求、不切分列表）。
 * 酷狗/酷我直链需平台签名 → 播放交给签名源插件，未装插件时播放器给出安装指引。
 */
const router = useRouter()

const keyword = ref('音乐')
const list = ref<MvItem[]>([])
const loading = ref(false)
const loadingMore = ref(false)
const error = ref('')
const page = ref(1)
const hasMore = ref(true)
/** 聚合模式：默认 'all' = 四平台聚合；其余值仅作本地过滤 */
const source = ref('all')

/** 源能力：签名源（kg/kw）直链需平台签名，播放依赖签名源插件 */
const isSignedSource = (v: MvItem): boolean => v.source === 'kg' || v.source === 'kw'

/** 来源过滤胶囊（过滤已聚合结果，不重新请求） */
const SOURCE_TABS = [
  { key: 'all', label: '全部' },
  { key: 'bili', label: 'B站' },
  { key: 'wy', label: '云村' },
  { key: 'qq', label: 'Q音' },
  { key: 'kg', label: '酷狗' },
  { key: 'kw', label: '酷我' },
]

const shown = computed(() =>
  source.value === 'all' ? list.value : list.value.filter(v => (v.source || 'bili') === source.value)
)

function sourceLabel(v: MvItem): string {
  const map: Record<string, string> = { bili: 'B站', wy: '云村', qq: 'Q音', kg: '酷狗', kw: '酷我' }
  return map[v.source || 'bili'] || v.source || 'B站'
}

function mvId(v: MvItem): string {
  return v.sourceId || v.bvid || ''
}

/** 播放足迹：播放过的视频隐去卡片播放按钮（v1.0.0 用户口径） */
const playedIds = ref<Set<string>>(new Set())
function vid(v: MvItem): string {
  return `${v.source || 'bili'}:${mvId(v)}`
}
function refreshPlayed(): void {
  playedIds.value = new Set(list.value.filter(v => isVideoPlayed(vid(v))).map(vid))
}
let offPlayed: (() => void) | null = null
onMounted(() => {
  offPlayed = onVideoPlayed(() => refreshPlayed())
})
onBeforeUnmount(() => offPlayed?.())

function open(v: MvItem): void {
  markVideoPlayed(vid(v))
  const src = v.source || 'bili'
  // 带上搜索卡片已有的标题/封面/歌手：Q音、酷狗、酷我的详情接口不返回元数据，
  // 播放页用 query 兜底，避免进去后标题空白
  router.push({
    path: `/mv/${src}/${mvId(v)}`,
    query: {
      title: v.title || '',
      pic: v.pic || '',
      author: v.author || '',
      dur: String(v.durationSec || 0),
    },
  })
}

async function search(): Promise<void> {
  loading.value = true
  error.value = ''
  page.value = 1
  hasMore.value = true
  try {
    const res = await call<MvItem[]>('music:mv', {
      keyword: keyword.value.trim() || '音乐',
      page: 1,
      source: 'all',
    })
    list.value = res
    hasMore.value = res.length > 0
    if (!res.length) error.value = '没有找到相关视频，换个关键词试试'
  } catch (e: any) {
    error.value = e?.message || '视频加载失败'
  } finally {
    loading.value = false
  }
}

function switchSource(k: string): void {
  source.value = k
}

async function loadMore(): Promise<void> {
  if (loadingMore.value || !hasMore.value) return
  loadingMore.value = true
  try {
    const next = page.value + 1
    const res = await call<MvItem[]>('music:mv', {
      keyword: keyword.value.trim() || '音乐',
      page: next,
      source: 'all',
    })
    const seen = new Set(list.value.map(v => `${v.source || 'bili'}:${mvId(v)}`))
    const fresh = res.filter(v => !seen.has(`${v.source || 'bili'}:${mvId(v)}`))
    if (!fresh.length && !res.length) {
      hasMore.value = false
    } else {
      list.value = [...list.value, ...fresh]
      page.value = next
      if (res.length === 0) hasMore.value = false
    }
  } catch {
    // 分页加载失败静默，保留已有内容
  } finally {
    loadingMore.value = false
  }
}

function fmt(n: number): string {
  if (n >= 10000) return `${(n / 10000).toFixed(1)}万`
  return String(n)
}

onMounted(() => void search())
</script>

<template>
  <div class="page mv-page">
    <header class="head">
      <div>
        <h1>视频 / MV</h1>
        <p>来自视频音源的 MV / 现场，内置播放器支持分集切换</p>
      </div>
      <div class="search-box">
        <Icon name="search" :size="15" />
        <input v-model="keyword" placeholder="搜索 MV、现场、音乐视频" spellcheck="false" @keydown.enter="search" />
        <button class="btn sm primary" @click="search">搜索</button>
      </div>
    </header>

 <!-- 源 Tab（.10） -->
    <nav class="src-tabs">
      <button
        v-for="t in SOURCE_TABS"
        :key="t.key"
        :class="{ on: source === t.key }"
        @click="switchSource(t.key)"
      >
        {{ t.label }}
      </button>
    </nav>

    <div v-if="loading" class="grid">
      <div v-for="i in 8" :key="i" class="sk" style="aspect-ratio: 16 / 10; border-radius: 12px" />
    </div>

    <div v-else-if="error" class="empty" style="padding: 70px 20px">
      <Icon name="video" :size="32" :stroke="1.3" />
      <div class="empty-title">{{ error }}</div>
      <button class="btn" style="margin-top: 8px" @click="search">重试</button>
    </div>

    <div v-else class="grid">
      <div v-for="v in shown" :key="`${v.source || 'bili'}:${mvId(v)}`" class="mv-card" @click="open(v)">
        <div class="thumb">
          <Cover :src="v.pic" :alt="v.title" size="100%" :radius="12" />
          <span class="src-tag">{{ sourceLabel(v) }}</span>
          <span v-if="v.durationSec || v.duration" class="dur">{{ v.duration || fmt(Number(v.durationSec) || 0) }}</span>
          <span v-if="v.play" class="play-count"><Icon name="play" :size="10" />{{ fmt(v.play) }}</span>
          <span v-if="!playedIds.has(vid(v))" class="overlay"><Icon name="play-circle" :size="38" /></span>
          <span v-if="isSignedSource(v)" class="signed">需签名源插件</span>
        </div>
        <div class="mv-title clamp-2">{{ v.title }}</div>
        <div class="mv-author ellipsis">{{ v.author }}</div>
      </div>
    </div>

    <div v-if="!loading && !error && list.length" class="load-more">
      <button v-if="hasMore" class="btn" :disabled="loadingMore" @click="loadMore">
        {{ loadingMore ? '加载中…' : '加载更多' }}
      </button>
      <span v-else class="end-hint">已经到底啦</span>
    </div>
  </div>
</template>

<style scoped>
.head {
  display: flex;
  align-items: flex-end;
  justify-content: space-between;
  gap: 18px;
  padding: 14px 0 20px;
}
h1 {
  font-size: 27px;
  font-weight: 700;
}
.head p {
  margin-top: 5px;
  font-size: 12px;
  color: var(--text-3);
}
.search-box {
  display: flex;
  align-items: center;
  gap: 8px;
  height: 34px;
  padding: 0 6px 0 11px;
  border-radius: 10px;
  background: var(--panel);
  border: 1px solid var(--line);
  color: var(--text-3);
  width: 380px;
  max-width: 42vw;
}
.search-box input {
  flex: 1;
  min-width: 0;
  border: none;
  background: none;
  outline: none;
  font-size: 12.5px;
  color: var(--text);
}
.grid {
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: 20px 16px;
}
.mv-card {
  cursor: pointer;
  min-width: 0;
}
.thumb {
  position: relative;
  aspect-ratio: 16 / 10;
  border-radius: 12px;
  overflow: hidden;
  background: var(--panel);
  transition: transform 0.22s var(--ease), box-shadow 0.22s;
}
.mv-card:hover .thumb {
  transform: translateY(-2px);
  box-shadow: 0 16px 30px -18px rgba(0, 0, 0, 0.7);
}
.dur {
  position: absolute;
  right: 8px;
  bottom: 7px;
  padding: 1px 6px;
  border-radius: 4px;
  background: rgba(0, 0, 0, 0.65);
  color: #fff;
  font-size: 10px;
}
.play-count {
  position: absolute;
  left: 8px;
  bottom: 7px;
  display: inline-flex;
  align-items: center;
  gap: 3px;
  color: rgba(255, 255, 255, 0.85);
  font-size: 10px;
  text-shadow: 0 1px 4px rgba(0, 0, 0, 0.6);
}
.overlay {
  position: absolute;
  inset: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  color: #fff;
  background: rgba(0, 0, 0, 0.28);
  opacity: 0;
  transition: opacity 0.2s;
}
.mv-card:hover .overlay {
  opacity: 1;
}
.mv-title {
  margin-top: 9px;
  font-size: 12.5px;
  line-height: 1.45;
  font-weight: 500;
  min-height: 36px;
}
.mv-author {
  margin-top: 2px;
  font-size: 11px;
  color: var(--text-3);
}
.src-tabs {
  display: flex;
  gap: 6px;
  margin-bottom: 16px;
}
.src-tabs button {
  height: 30px;
  padding: 0 14px;
  border-radius: 15px;
  border: 1px solid var(--line);
  background: transparent;
  color: var(--text-2);
  font-size: 12.5px;
  cursor: pointer;
}
.src-tabs button.on {
  background: var(--accent-soft, rgba(167, 139, 250, 0.16));
  border-color: var(--accent);
  color: var(--accent);
}
.src-tag {
  position: absolute;
  left: 8px;
  top: 8px;
  padding: 1px 6px;
  border-radius: 4px;
  background: rgba(0, 0, 0, 0.55);
  color: #fff;
  font-size: 10px;
}
.signed {
  position: absolute;
  right: 8px;
  top: 8px;
  padding: 1px 6px;
  border-radius: 4px;
  background: rgba(0, 0, 0, 0.62);
  color: #fbbf24;
  font-size: 10px;
}
.load-more {
  display: flex;
  justify-content: center;
  align-items: center;
  padding: 26px 0 12px;
}
.end-hint {
  font-size: 12px;
  color: var(--text-3);
}
@media (max-width: 1300px) {
  .grid {
    grid-template-columns: repeat(3, minmax(0, 1fr));
  }
}
</style>
