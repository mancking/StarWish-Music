<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import Icon from '@/components/Icon.vue'
import SongList from '@/components/SongList.vue'
import PlatformSelect, { type PlatformOption } from '@/components/PlatformSelect.vue'
import { call } from '@/api'
import { usePlayerStore } from '@/stores/player'
import { useUiStore } from '@/stores/ui'
import type { Song } from '@shared/types'
import { platformLabel } from '@/utils/labels'

const route = useRoute()
const router = useRouter()
const player = usePlayerStore()
const ui = useUiStore()

const songs = ref<Song[]>([])
const loading = ref(false)
const error = ref('')
const platform = ref('')
const took = ref(0)

const keyword = computed(() => String(route.query.q || '').trim())

const HOT = ['周杰伦', '林俊杰', '陈奕迅', '五月天', '邓紫棋', '薛之谦', '李荣浩', '毛不易', 'Taylor Swift', '米津玄師']

const platforms: PlatformOption[] = [
  { key: '', name: '全部音源' },
  { key: 'wy', name: platformLabel('wy') },
  { key: 'qq', name: platformLabel('qq') },
  { key: 'kg', name: platformLabel('kg') },
  { key: 'kw', name: platformLabel('kw') },
  { key: 'mg', name: platformLabel('mg') },
]

async function search(): Promise<void> {
  const q = keyword.value
  if (!q) {
    songs.value = []
    return
  }
  loading.value = true
  error.value = ''
  songs.value = []
  const t0 = performance.now()
  try {
    songs.value = await call<Song[]>('music:search', { keyword: q, page: 1, platform: platform.value || undefined })
    took.value = Math.round(performance.now() - t0)
    if (!songs.value.length) error.value = ''
  } catch (e: any) {
    error.value = e?.message || '搜索失败'
  } finally {
    loading.value = false
  }
}

function quickSearch(k: string): void {
  router.push({ path: '/search', query: { q: k } })
}

watch(keyword, () => void search())
watch(platform, () => void search())
onMounted(() => void search())
</script>

<template>
  <div class="page search-page">
    <div v-if="!keyword" class="landing">
      <div class="search-hero">
        <Icon name="search" :size="26" :stroke="1.5" />
        <h1>搜索音乐</h1>
        <p>输入歌名、歌手或专辑，从多个音源与插件中聚合结果</p>
      </div>
      <div class="hot">
        <div class="hot-label">试试这些</div>
        <div class="hot-tags">
          <button v-for="k in HOT" :key="k" class="chip" @click="quickSearch(k)">{{ k }}</button>
        </div>
      </div>
    </div>

    <template v-else>
      <header class="head">
        <div>
          <h1>
            搜索「<span class="kw">{{ keyword }}</span>」
          </h1>
          <p v-if="!loading && !error">
            找到 {{ songs.length }} 首结果<span v-if="took"> · 耗时 {{ took }}ms</span>
          </p>
          <p v-else-if="loading">正在聚合多个音源…</p>
        </div>
        <div class="head-actions">
          <button class="btn primary sm" :disabled="!songs.length" @click="player.playSongs(songs, 0)">
            <Icon name="play" :size="13" />播放全部
          </button>
          <button class="btn sm" :disabled="!songs.length" @click="player.addToQueue(songs)">
            <Icon name="queue" :size="13" />加入队列
          </button>
        </div>
      </header>

      <div class="platform-bar">
        <PlatformSelect
          v-model="platform"
          :options="platforms"
          align="right"
        />
        <button class="icon-btn" title="重新搜索" @click="search"><Icon name="refresh" :size="14" /></button>
      </div>

      <div v-if="error" class="empty" style="padding: 60px 20px">
        <Icon name="wifi" :size="32" :stroke="1.3" />
        <div class="empty-title">搜索失败</div>
        <div class="empty-desc">{{ error }}</div>
        <button class="btn" style="margin-top: 8px" @click="search">重试</button>
      </div>

      <SongList
        v-else
        :songs="songs"
        :loading="loading"
        empty-text="没有找到相关歌曲"
        empty-desc="换个关键词，或切换到「全部音源」再试试"
      />
    </template>
  </div>
</template>

<style scoped>
.search-page {
  padding-top: 14px;
}
.landing {
  padding-top: 40px;
}
.search-hero {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 8px;
  color: var(--text-3);
  text-align: center;
}
.search-hero h1 {
  font-size: 24px;
  font-weight: 700;
  color: var(--text);
}
.search-hero p {
  font-size: 12.5px;
  max-width: 520px;
  line-height: 1.7;
}
.hot {
  margin-top: 34px;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 12px;
}
.hot-label {
  font-size: 11px;
  letter-spacing: 1.2px;
  color: var(--text-3);
  text-transform: uppercase;
}
.hot-tags {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  justify-content: center;
  max-width: 620px;
}
.head {
  display: flex;
  align-items: flex-end;
  justify-content: space-between;
  gap: 16px;
}
.head h1 {
  font-size: 24px;
  font-weight: 700;
}
.kw {
  color: var(--accent);
}
.head p {
  margin-top: 5px;
  font-size: 12px;
  color: var(--text-3);
}
.head-actions {
  display: flex;
  gap: 8px;
}
.platform-bar {
  display: flex;
  align-items: center;
  justify-content: flex-end;
  gap: 8px;
  margin: 16px 0 14px;
}
.icon-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 30px;
  height: 30px;
  border-radius: 8px;
  color: var(--text-2);
  transition: background 0.15s, color 0.15s;
}
.icon-btn:hover {
  background: var(--hover);
  color: var(--text);
}
</style>
