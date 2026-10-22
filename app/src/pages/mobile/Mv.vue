<script setup lang="ts">
import { computed, defineOptions, onMounted, ref } from 'vue'
import { useRouter } from 'vue-router'
import Icon from '@/components/Icon.vue'
import Cover from '@/components/Cover.vue'
import { call } from '@/api'
import type { MvItem } from '@shared/types'

/**
 * 移动端视频页 —— 模板级独立实现（非桌面网格缩放）。
 *
 * 与桌面差异：大号内联搜索框 + 热词横滑胶囊、视频 2 列封面卡（时长角标、
 * 播放量角标）、滚动到底自动加载更多——符合手机竖屏刷视频的肌肉记忆。
 */
defineOptions({ name: 'Mv' })

const router = useRouter()

const keyword = ref('')
const draft = ref('')
const list = ref<MvItem[]>([])
const loading = ref(false)
const loadingMore = ref(false)
const error = ref('')
const page = ref(1)
const hasMore = ref(true)

const HOT = ['周杰伦', '演唱会', 'MV', 'Live', '音乐现场', '新歌', '经典老歌', '粤语']

async function search(): Promise<void> {
  const k = keyword.value.trim() || '音乐'
  loading.value = true
  error.value = ''
  page.value = 1
  hasMore.value = true
  try {
    const res = await call<MvItem[]>('music:mv', { keyword: k, page: 1 })
    list.value = res
    hasMore.value = res.length > 0
    if (!res.length) error.value = '没有找到相关视频，换个关键词试试'
  } catch (e: any) {
    error.value = e?.message || '视频加载失败'
  } finally {
    loading.value = false
  }
}

function submit(): void {
  keyword.value = draft.value.trim() || keyword.value
  void search()
}

function quick(k: string): void {
  draft.value = k
  keyword.value = k
  void search()
}

function fmtPlay(n: number): string {
  if (n >= 100000000) return `${(n / 100000000).toFixed(1)}亿`
  if (n >= 10000) return `${(n / 10000).toFixed(1)}万`
  return String(n)
}

async function loadMore(): Promise<void> {
  if (loadingMore.value || !hasMore.value || loading.value) return
  loadingMore.value = true
  try {
    const next = page.value + 1
    const res = await call<MvItem[]>('music:mv', { keyword: keyword.value.trim() || '音乐', page: next })
    const seen = new Set(list.value.map(v => v.bvid))
    const fresh = res.filter(v => !seen.has(v.bvid))
    if (!fresh.length && !res.length) hasMore.value = false
    else {
      list.value = [...list.value, ...fresh]
      page.value = next
      if (!res.length) hasMore.value = false
    }
  } catch { /* 分页失败静默 */ } finally {
    loadingMore.value = false
  }
}

function onScroll(e: Event): void {
  const el = e.target as HTMLElement
  if (el.scrollTop + el.clientHeight >= el.scrollHeight - 400) void loadMore()
}

const PLACEHOLDER = computed(() => (keyword.value ? keyword.value : '搜索视频 / MV'))
const HOT_SUGGESTIONS = HOT

onMounted(() => void search())
</script>

<template>
  <div class="page m-mv">
    <!-- 搜索头：大输入框 + 热词 -->
    <div class="mv-search">
      <div class="mv-input">
        <Icon name="search" :size="17" class="mv-input-icon" />
        <input
          v-model="draft"
          type="search"
          :placeholder="PLACEHOLDER"
          enterkeyhint="search"
          @keydown.enter="submit"
        />
        <button class="mv-go" @click="submit">搜索</button>
      </div>
      <div class="mv-hot">
        <button v-for="k in HOT_SUGGESTIONS" :key="k" class="mv-hot-tag" @click="quick(k)">{{ k }}</button>
      </div>
    </div>

    <!-- 骨架 -->
    <div v-if="loading" class="mv-grid">
      <div v-for="i in 6" :key="i" class="sk" style="height: 150px; border-radius: 14px" />
    </div>

    <div v-else-if="error && !list.length" class="empty" style="padding: 60px 16px">
      <Icon name="video" :size="32" :stroke="1.3" />
      <div class="empty-title">{{ error }}</div>
      <button class="btn primary" style="margin-top: 12px" @click="search">重试</button>
    </div>

    <!-- 视频卡：2 列 -->
    <template v-else>
      <div class="mv-grid">
        <button v-for="v in list" :key="v.bvid" class="mv-card" @click="router.push(`/mv/${v.bvid}`)">
          <div class="mv-cover-wrap">
            <Cover :src="v.pic || ''" :size="180" radius="12" class="mv-cover" />
            <span v-if="v.duration" class="mv-badge">{{ v.duration }}</span>
            <span v-if="v.play" class="mv-badge play"><Icon name="play" :size="10" />{{ fmtPlay(v.play) }}</span>
          </div>
          <div class="mv-title">{{ v.title }}</div>
          <div class="mv-sub">{{ v.author || '' }}</div>
        </button>
      </div>
      <div v-if="loadingMore" class="mv-more">加载中…</div>
      <div v-else-if="!hasMore && list.length" class="mv-more">没有更多了</div>
      <div ref="sentinel" style="height: 1px" />
    </template>
  </div>
</template>

<style scoped>
.mv-search {
  padding-top: 6px;
}
.mv-input {
  display: flex;
  align-items: center;
  gap: 8px;
  height: 48px;
  padding: 0 6px 0 14px;
  border-radius: 14px;
  border: 1px solid var(--line);
  background: var(--bg-2);
}
.mv-input-icon {
  color: var(--text-3);
}
.mv-input input {
  flex: 1;
  min-width: 0;
  border: 0;
  background: none;
  color: var(--text);
  font-size: 14.5px;
  outline: none;
}
.mv-go {
  flex: none;
  height: 36px;
  padding: 0 18px;
  border: 0;
  border-radius: 11px;
  background: var(--accent);
  color: #fff;
  font-size: 13.5px;
  font-weight: 600;
  -webkit-tap-highlight-color: transparent;
}
.mv-hot {
  display: flex;
  gap: 8px;
  overflow-x: auto;
  margin: 10px -16px 2px;
  padding: 2px 16px;
  scrollbar-width: none;
}
.mv-hot::-webkit-scrollbar {
  display: none;
}
.mv-hot-tag {
  flex: none;
  height: 34px;
  padding: 0 14px;
  border-radius: 17px;
  border: 0;
  background: var(--bg-2);
  color: var(--text-2);
  font-size: 12.5px;
  -webkit-tap-highlight-color: transparent;
}
.mv-hot-tag:active {
  filter: brightness(1.2);
}

.mv-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 16px 12px;
  margin-top: 14px;
}
.mv-card {
  border: 0;
  background: none;
  padding: 0;
  text-align: left;
  -webkit-tap-highlight-color: transparent;
}
.mv-card:active .mv-cover {
  transform: scale(0.97);
  transition: transform 0.12s;
}
.mv-cover-wrap {
  position: relative;
}
.mv-badge {
  position: absolute;
  right: 6px;
  bottom: 6px;
  display: inline-flex;
  align-items: center;
  gap: 3px;
  height: 20px;
  padding: 0 7px;
  border-radius: 6px;
  background: rgba(0, 0, 0, 0.62);
  color: #fff;
  font-size: 10.5px;
}
.mv-badge.play {
  left: 6px;
  right: auto;
}
.mv-title {
  margin-top: 8px;
  font-size: 13px;
  font-weight: 600;
  line-height: 1.45;
  color: var(--text);
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
}
.mv-sub {
  margin-top: 3px;
  font-size: 11.5px;
  color: var(--text-3);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.mv-more {
  text-align: center;
  padding: 18px 0 6px;
  font-size: 12px;
  color: var(--text-3);
}
</style>
