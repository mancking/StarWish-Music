<script setup lang="ts">
import { onMounted, ref } from 'vue'
import { useRouter } from 'vue-router'
import Icon from '@/components/Icon.vue'
import Cover from '@/components/Cover.vue'
import { call } from '@/api'
import type { MvItem } from '@shared/types'

const router = useRouter()

const keyword = ref('音乐')
const list = ref<MvItem[]>([])
const loading = ref(false)
const loadingMore = ref(false)
const error = ref('')
const page = ref(1)
const hasMore = ref(true)

async function search(): Promise<void> {
  loading.value = true
  error.value = ''
  page.value = 1
  hasMore.value = true
  try {
    const res = await call<MvItem[]>('music:mv', { keyword: keyword.value.trim() || '音乐', page: 1 })
    list.value = res
    hasMore.value = res.length > 0
    if (!res.length) error.value = '没有找到相关视频，换个关键词试试'
  } catch (e: any) {
    error.value = e?.message || '视频加载失败'
  } finally {
    loading.value = false
  }
}

async function loadMore(): Promise<void> {
  if (loadingMore.value || !hasMore.value) return
  loadingMore.value = true
  try {
    const next = page.value + 1
    const res = await call<MvItem[]>('music:mv', { keyword: keyword.value.trim() || '音乐', page: next })
    const seen = new Set(list.value.map(v => v.bvid))
    const fresh = res.filter(v => !seen.has(v.bvid))
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

function open(v: MvItem): void {
  router.push(`/mv/${v.bvid}`)
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

    <div v-if="loading" class="grid">
      <div v-for="i in 8" :key="i" class="sk" style="aspect-ratio: 16 / 10; border-radius: 12px" />
    </div>

    <div v-else-if="error" class="empty" style="padding: 70px 20px">
      <Icon name="video" :size="32" :stroke="1.3" />
      <div class="empty-title">{{ error }}</div>
      <button class="btn" style="margin-top: 8px" @click="search">重试</button>
    </div>

    <div v-else class="grid">
      <div v-for="v in list" :key="v.bvid" class="mv-card" @click="open(v)">
        <div class="thumb">
          <Cover :src="v.pic" :alt="v.title" size="100%" :radius="12" />
          <span class="dur">{{ v.duration }}</span>
          <span class="play-count"><Icon name="play" :size="10" />{{ fmt(v.play) }}</span>
          <span class="overlay"><Icon name="play-circle" :size="38" /></span>
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
