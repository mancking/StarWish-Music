<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import Icon from '@/components/Icon.vue'
import SongList from '@/components/SongList.vue'
import PlatformSelect, { type PlatformOption } from '@/components/PlatformSelect.vue'
import { call, on } from '@/api'
import { usePlayerStore } from '@/stores/player'
import { useUiStore } from '@/stores/ui'
import type { PlaylistMeta, Song } from '@shared/types'
import { platformLabel } from '@/utils/labels'
import {
  searchHistory,
  pushSearchHistory,
  removeSearchHistory,
  clearSearchHistory,
} from '@/platform/search-history'

/**
 * 搜索页（规格书 3.7 / Bug 15 / Bug 17）
 * 历史 chips（xinyuan_search_history，≤20 条可删可清）+
 * 聚合结果三 Tab（歌曲 / 歌单 / 歌手）。
 */
const route = useRoute()
const router = useRouter()
const player = usePlayerStore()
const ui = useUiStore()

const songs = ref<Song[]>([])
const playlists = ref<PlaylistMeta[]>([])
const loading = ref(false)
const error = ref('')
const platform = ref('')
const took = ref(0)
/** Bug 17：结果分区 Tab */
const tab = ref<'songs' | 'playlists' | 'artists'>('songs')

const keyword = computed(() => String(route.query.q || '').trim())

// 移动端：顶部搜索框已移除，这里内联一个输入框，让底部「搜索」tab 自成一体（__MOBILE__ 构建期常量，桌面死分支摇掉）
const isMobile = __MOBILE__
const draft = ref('')
function submitDraft(): void {
  const k = draft.value.trim()
  if (k) quickSearch(k)
}

const history = searchHistory()

const HOT = ['周杰伦', '林俊杰', '陈奕迅', '五月天', '邓紫棋', '薛之谦', '李荣浩', '毛不易', 'Taylor Swift', '米津玄師']

/** Bug 123：平台 Tab 动态 —— sources:platforms 实时拉取 + sources:changed 刷新（自定义 platform 音源上 Tab） */
const platforms = ref<PlatformOption[]>([
  { key: '', name: '全部音源' },
  { key: 'wy', name: platformLabel('wy') },
  { key: 'qq', name: platformLabel('qq') },
  { key: 'kg', name: platformLabel('kg') },
  { key: 'kw', name: platformLabel('kw') },
  { key: 'mg', name: platformLabel('mg') },
])
async function refreshPlatforms(): Promise<void> {
  try {
    const list = await call<{ platform: string; name: string }[]>('sources:platforms')
    const seen = new Set(['', 'wy', 'qq', 'kg', 'kw', 'mg'])
    const extra = (list || [])
      .filter(x => x?.platform && !seen.has(x.platform))
      .map(x => ({ key: x.platform, name: x.name || platformLabel(x.platform) }))
    platforms.value = [
      { key: '', name: '全部音源' },
      { key: 'wy', name: platformLabel('wy') },
      { key: 'qq', name: platformLabel('qq') },
      { key: 'kg', name: platformLabel('kg') },
      { key: 'kw', name: platformLabel('kw') },
      { key: 'mg', name: platformLabel('mg') },
      ...extra,
    ]
  } catch {
    /* 拉取失败保持默认 */
  }
}

/** Bug 17 歌手 Tab：从聚合歌曲结果按歌手聚合（头像占位 + 歌曲数） */
const artists = computed(() => {
  const map = new Map<string, { name: string; count: number; pic: string }>()
  for (const s of songs.value) {
    const first = String(s.singer || '').split('/')[0]?.trim()
    if (!first || first === '未知歌手') continue
    const cur = map.get(first)
    if (cur) cur.count++
    else map.set(first, { name: first, count: 1, pic: s.pic || '' })
  }
  return [...map.values()].sort((a, b) => b.count - a.count).slice(0, 24)
})

function searchArtist(name: string): void {
  quickSearch(name)
}

async function openPlaylist(p: PlaylistMeta): Promise<void> {
  // 榜单/播客复用歌单详情页模板（路由 /playlist/:source/:id）
  const [, source, id] = p.id.match(/^([a-z]+):(.+)$/) || []
  if (source && id) void router.push(`/playlist/${source}/${id}`)
  else ui.toast('暂不支持打开该歌单', 'info', 1600)
}

async function search(): Promise<void> {
  const q = keyword.value
  if (!q) {
    songs.value = []
    playlists.value = []
    return
  }
  pushSearchHistory(q)
  loading.value = true
  error.value = ''
  songs.value = []
  playlists.value = []
  const t0 = performance.now()
  try {
    const [list, pls] = await Promise.all([
      call<Song[]>('music:search', { keyword: q, page: 1, platform: platform.value || undefined }),
      platform.value === '' || platform.value === 'wy'
        ? call<PlaylistMeta[]>('music:searchPlaylists', { keyword: q, page: 1 }).catch(() => [])
        : Promise.resolve([] as PlaylistMeta[]),
    ])
    songs.value = list
    playlists.value = pls
    took.value = Math.round(performance.now() - t0)
    if (!list.length && !pls.length) error.value = ''
  } catch (e: any) {
    error.value = e?.message || '搜索失败'
  } finally {
    loading.value = false
  }
}

function quickSearch(k: string): void {
  router.push({ path: '/search', query: { q: k } })
}

watch(keyword, () => {
  tab.value = 'songs'
  void search()
})
watch(platform, () => void search())
onMounted(() => {
  void refreshPlatforms()
  void search()
  on('sources:changed', () => void refreshPlatforms())
})
</script>

<template>
  <div class="page search-page">
    <div v-if="!keyword" class="landing">
      <div class="search-hero">
        <Icon name="search" :size="26" :stroke="1.5" />
        <h1>搜索音乐</h1>
        <p>输入歌名、歌手或专辑，从多个音源与插件中聚合结果</p>
      </div>
      <div v-if="isMobile" class="m-search">
        <Icon name="search" :size="16" class="m-search-icon" />
        <input
          v-model="draft"
          type="text"
          placeholder="搜索歌名、歌手、专辑"
          spellcheck="false"
          enterkeyhint="search"
          @keydown.enter="submitDraft"
        />
      </div>
      <div v-if="history.length" class="hot">
        <div class="hot-head">
          <div class="hot-label">搜索历史</div>
          <button class="clear" @click="clearSearchHistory">清空</button>
        </div>
        <div class="hot-tags">
          <span v-for="k in history" :key="k" class="chip-wrap">
            <button class="chip" @click="quickSearch(k)">{{ k }}</button>
            <button class="chip-x" :aria-label="`删除 ${k}`" @click="removeSearchHistory(k)">
              <Icon name="close" :size="11" />
            </button>
          </span>
        </div>
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
            找到 {{ songs.length }} 首歌曲<template v-if="playlists.length"> · {{ playlists.length }} 张歌单</template><span v-if="took"> · 耗时 {{ took }}ms</span>
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

      <!-- Bug 17：歌曲 / 歌单 / 歌手 三 Tab -->
      <nav class="tabs">
        <button :class="{ on: tab === 'songs' }" @click="tab = 'songs'">歌曲 {{ songs.length || '' }}</button>
        <button :class="{ on: tab === 'playlists' }" @click="tab = 'playlists'">歌单 {{ playlists.length || '' }}</button>
        <button :class="{ on: tab === 'artists' }" @click="tab = 'artists'">歌手 {{ artists.length || '' }}</button>
        <span class="tabs-spacer" />
        <PlatformSelect v-model="platform" :options="platforms" align="right" />
        <button class="icon-btn" title="重新搜索" @click="search"><Icon name="refresh" :size="14" /></button>
      </nav>

      <div v-if="error" class="empty" style="padding: 60px 20px">
        <Icon name="wifi" :size="32" :stroke="1.3" />
        <div class="empty-title">搜索失败</div>
        <div class="empty-desc">{{ error }}</div>
        <button class="btn" style="margin-top: 8px" @click="search">重试</button>
      </div>

      <template v-else>
        <SongList
          v-show="tab === 'songs'"
          :songs="songs"
          :loading="loading"
          empty-text="没有找到相关歌曲"
          empty-desc="换个关键词，或切换到「全部音源」再试试"
        />

        <div v-if="tab === 'playlists'" class="pl-grid">
          <button v-for="p in playlists" :key="p.id" class="pl-card" @click="openPlaylist(p)">
            <span class="pl-pic" :style="p.pic ? { backgroundImage: `url(${p.pic})` } : undefined">
              <span class="pl-count"><Icon name="play" :size="10" />{{ p.played ? Math.round(p.played / 10000) + '万' : '' }}</span>
            </span>
            <span class="pl-name">{{ p.name }}</span>
            <span class="pl-by">{{ p.count || 0 }} 首 · {{ p.author || '歌单' }}</span>
          </button>
          <div v-if="!loading && !playlists.length" class="empty-tab">
            <Icon name="list" :size="28" :stroke="1.3" />
            <div class="empty-title">没有找到相关歌单</div>
          </div>
        </div>

        <div v-if="tab === 'artists'" class="ar-grid">
          <button v-for="a in artists" :key="a.name" class="ar-card" @click="searchArtist(a.name)">
            <span class="ar-pic" :style="a.pic ? { backgroundImage: `url(${a.pic})` } : undefined">
              <Icon v-if="!a.pic" name="artist" :size="22" />
            </span>
            <span class="ar-name">{{ a.name }}</span>
            <span class="ar-count">{{ a.count }} 首</span>
          </button>
          <div v-if="!loading && !artists.length" class="empty-tab">
            <Icon name="artist" :size="28" :stroke="1.3" />
            <div class="empty-title">没有找到相关歌手</div>
          </div>
        </div>
      </template>
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
.m-search {
  margin: 22px auto 0;
  max-width: 520px;
  height: 44px;
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 0 14px;
  border-radius: 12px;
  background: var(--panel);
  border: 1px solid var(--line);
}
.m-search:focus-within {
  border-color: var(--accent);
  background: var(--panel-2);
}
.m-search-icon {
  color: var(--text-3);
  flex: none;
}
.m-search input {
  flex: 1;
  min-width: 0;
  border: none;
  background: none;
  outline: none;
  font-size: 14px;
  color: var(--text);
}
.m-search input::placeholder {
  color: var(--text-3);
}
.hot {
  margin-top: 34px;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 12px;
}
.hot-head {
  display: flex;
  align-items: center;
  gap: 10px;
}
.hot-label {
  font-size: 11px;
  letter-spacing: 1.2px;
  color: var(--text-3);
  text-transform: uppercase;
}
.clear {
  border: 0;
  background: transparent;
  color: var(--text-3);
  font-size: 12px;
  cursor: pointer;
}
.clear:hover {
  color: var(--text);
}
.hot-tags {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  justify-content: center;
  max-width: 620px;
}
.chip-wrap {
  position: relative;
  display: inline-flex;
  align-items: center;
}
.chip-wrap .chip {
  padding-right: 26px;
}
.chip-x {
  position: absolute;
  right: 3px;
  display: grid;
  place-items: center;
  width: 16px;
  height: 16px;
  border: 0;
  border-radius: 50%;
  background: rgba(255, 255, 255, 0.08);
  color: var(--text-3);
  cursor: pointer;
}
.chip-x:hover {
  background: rgba(255, 255, 255, 0.16);
  color: var(--text);
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
.tabs {
  display: flex;
  align-items: center;
  gap: 4px;
  margin: 16px 0 12px;
  border-bottom: 1px solid var(--line);
  padding-bottom: 0;
}
.tabs > button {
  border: 0;
  background: transparent;
  color: var(--text-3);
  font-size: 13px;
  padding: 8px 12px;
  cursor: pointer;
  border-bottom: 2px solid transparent;
}
.tabs > button.on {
  color: var(--text);
  border-bottom-color: var(--accent);
}
.tabs-spacer {
  flex: 1;
}
.empty-tab {
  grid-column: 1 / -1;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 8px;
  padding: 48px 0;
  color: var(--text-3);
}
.empty-title {
  font-size: 14px;
}
.pl-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(150px, 1fr));
  gap: 14px;
}
.pl-card {
  display: flex;
  flex-direction: column;
  gap: 6px;
  border: 0;
  background: transparent;
  color: var(--text);
  text-align: left;
  cursor: pointer;
  padding: 0;
}
.pl-pic {
  position: relative;
  aspect-ratio: 1;
  border-radius: 10px;
  background: var(--panel) center / cover no-repeat;
}
.pl-count {
  position: absolute;
  top: 6px;
  right: 6px;
  display: inline-flex;
  align-items: center;
  gap: 3px;
  font-size: 10px;
  color: #fff;
  background: rgba(0, 0, 0, 0.5);
  border-radius: 8px;
  padding: 2px 6px;
}
.pl-name {
  font-size: 13px;
  font-weight: 500;
  overflow: hidden;
  text-overflow: ellipsis;
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
}
.pl-by {
  font-size: 11px;
  color: var(--text-3);
}
.ar-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(110px, 1fr));
  gap: 14px;
}
.ar-card {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 6px;
  border: 0;
  background: transparent;
  color: var(--text);
  cursor: pointer;
  padding: 8px 4px;
  border-radius: 12px;
}
.ar-card:hover {
  background: var(--hover);
}
.ar-pic {
  width: 72px;
  height: 72px;
  border-radius: 50%;
  background: var(--panel) center / cover no-repeat;
  display: grid;
  place-items: center;
  color: var(--text-3);
}
.ar-name {
  font-size: 13px;
  font-weight: 500;
  max-width: 100%;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.ar-count {
  font-size: 11px;
  color: var(--text-3);
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
