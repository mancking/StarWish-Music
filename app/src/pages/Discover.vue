<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import Icon from '@/components/Icon.vue'
import SongList from '@/components/SongList.vue'
import PlaylistCard from '@/components/PlaylistCard.vue'
import PlatformSelect, { type PlatformOption } from '@/components/PlatformSelect.vue'
import { call } from '@/api'
import { usePlayerStore } from '@/stores/player'
import { useUiStore } from '@/stores/ui'
import type { PlaylistMeta, Song, ToplistTree } from '@shared/types'
import { platformLabel } from '@/utils/labels'

const route = useRoute()
const router = useRouter()
const player = usePlayerStore()
const ui = useUiStore()

type Tab = 'playlists' | 'toplists' | 'new'
const tab = ref<Tab>(((route.query.tab as string) || 'playlists') as Tab)
const cat = ref((route.query.cat as string) || '全部')
const order = ref<'hot' | 'new'>('hot')

const playlists = ref<PlaylistMeta[]>([])
const plLoading = ref(false)
const plPage = ref(1)
const plEnd = ref(false)

const tree = ref<ToplistTree | null>(null)
const treeLoading = ref(true)
const platform = ref('wy')
const currentItem = ref<{ name: string; id: string } | null>(null)
const toplistSongs = ref<Song[]>([])
const tlLoading = ref(false)
const tlError = ref('')

/** 客户端分页：榜单通常为 100 首，按页切分 */
const tlPageSize = 25
const tlPage = ref(1)
const tlPaged = computed(() => {
  const s = (tlPage.value - 1) * tlPageSize
  return toplistSongs.value.slice(s, s + tlPageSize)
})
const tlTotalPages = computed(() => Math.max(1, Math.ceil(toplistSongs.value.length / tlPageSize)))

const newSongs = ref<Song[]>([])
const newLoading = ref(true)

/** 歌单标签：按分组组织，与参考样式一致 */
const TAG_GROUPS: { name: string; tags: string[] }[] = [
  { name: '热门标签', tags: ['全部', '流行', '摇滚', '民谣', '电子', '说唱', '轻音乐', '爵士', '古典', '乡村'] },
  { name: '专区', tags: ['影视原声', 'ACG', '怀旧', '儿童', '校园', '游戏', 'KTV', 'DJ', '器乐', '新世纪'] },
  { name: '主题', tags: ['伤感', '治愈', '励志', '甜蜜', '兴奋', '安静', '思念', '怀旧金曲', '翻唱', '现场'] },
  { name: '心情', tags: ['运动', '夜晚', '学习', '浪漫', '减压', '通勤', '派对', '咖啡', '驾车', '午后'] },
]
const TAGS = TAG_GROUPS.flatMap(g => g.tags)

const platforms = computed<PlatformOption[]>(() => {
  if (!tree.value) return []
  return Object.keys(tree.value.tree).map(k => ({ key: k, name: platformLabel(k) }))
})

const groups = computed(() => tree.value?.tree[platform.value]?.groups || [])

async function loadPlaylists(reset = false): Promise<void> {
  if (plLoading.value) return
  if (reset) {
    plPage.value = 1
    plEnd.value = false
    playlists.value = []
  }
  plLoading.value = true
  try {
    const list = await call<PlaylistMeta[]>('music:playlists', { cat: cat.value, order: order.value, page: plPage.value })
    playlists.value = reset ? list : [...playlists.value, ...list]
    if (list.length < 30) plEnd.value = true
    plPage.value++
  } catch (e: any) {
    ui.toast(`歌单加载失败：${e.message}`, 'error')
    plEnd.value = true
  } finally {
    plLoading.value = false
  }
}

async function loadTree(): Promise<void> {
  treeLoading.value = true
  try {
    tree.value = await call<ToplistTree>('music:toplists')
    const keys = Object.keys(tree.value.tree)
    if (keys.length && !keys.includes(platform.value)) platform.value = keys[0]
    const firstGroup = tree.value.tree[platform.value]?.groups?.[0]
    const first = firstGroup?.items?.find(i => i.id)
    if (first) await selectToplist(first.n, first.id!)
  } catch (e: any) {
    ui.toast(`榜单加载失败：${e.message}`, 'error')
  } finally {
    treeLoading.value = false
  }
}

async function selectToplist(name: string, id: string): Promise<void> {
  currentItem.value = { name, id }
  tlPage.value = 1
  tlLoading.value = true
  tlError.value = ''
  toplistSongs.value = []
  try {
    const r = await call<{ name: string; songs: Song[] }>('music:toplist', { platform: platform.value, id })
    toplistSongs.value = r.songs
    if (!r.songs.length) tlError.value = '该榜单暂时没有返回数据'
  } catch (e: any) {
    tlError.value = e?.message || '榜单加载失败'
  } finally {
    tlLoading.value = false
  }
}

async function changePlatform(p: string): Promise<void> {
  platform.value = p
  const firstGroup = tree.value?.tree[p]?.groups?.[0]
  const first = firstGroup?.items?.find(i => i.id)
  if (first) await selectToplist(first.n, first.id!)
  else {
    currentItem.value = null
    toplistSongs.value = []
  }
}

function openPlaylist(pl: PlaylistMeta): void {
  router.push({ path: `/playlist/${pl.id}`, query: { src: pl.source || 'wy', name: pl.name } })
}

async function playPlaylist(pl: PlaylistMeta): Promise<void> {
  try {
    const r = await call<{ songs: Song[]; name: string }>('music:playlist', { id: pl.id, source: pl.source || 'wy' })
    if (!r.songs.length) throw new Error('歌单为空')
    await player.playSongs(r.songs, 0)
    ui.toast(`正在播放：${r.name}`, 'success', 1800)
  } catch (e: any) {
    ui.toast(e.message, 'error')
  }
}

async function playToplist(): Promise<void> {
  if (!toplistSongs.value.length) return
  await player.playSongs(toplistSongs.value, 0)
}

async function loadNew(): Promise<void> {
  newLoading.value = true
  try {
    newSongs.value = await call<Song[]>('music:new')
  } catch (e: any) {
    ui.toast(`新歌加载失败：${e.message}`, 'error')
  } finally {
    newLoading.value = false
  }
}

function setTab(t: Tab): void {
  tab.value = t
  router.replace({ path: '/discover', query: { ...route.query, tab: t } })
}

function selectCat(c: string): void {
  cat.value = c
  router.replace({ path: '/discover', query: { ...route.query, tab: 'playlists', cat: c } })
  void loadPlaylists(true)
}

watch(
  () => route.query,
  q => {
    if (q.tab && q.tab !== tab.value) tab.value = q.tab as Tab
    if (typeof q.cat === 'string' && q.cat !== cat.value) {
      cat.value = q.cat
      if (tab.value === 'playlists') void loadPlaylists(true)
    }
  }
)

onMounted(() => {
  void loadPlaylists(true)
  void loadTree()
  void loadNew()
})
</script>

<template>
  <div class="page discover">
    <header class="page-head">
      <div>
        <h1>发现音乐</h1>
        <p>歌单、榜单、新歌，一站听遍全平台</p>
      </div>
      <button class="btn" @click="ui.importDialog = true"><Icon name="download" :size="15" />导入平台歌单</button>
    </header>

    <div class="tabs">
      <button class="tab" :class="{ active: tab === 'playlists' }" @click="setTab('playlists')">
        <Icon name="list" :size="15" />推荐歌单
      </button>
      <button class="tab" :class="{ active: tab === 'toplists' }" @click="setTab('toplists')">
        <Icon name="gauge" :size="15" />排行榜
      </button>
      <button class="tab" :class="{ active: tab === 'new' }" @click="setTab('new')">
        <Icon name="music" :size="15" />最新音乐
      </button>
    </div>

    <!-- 歌单 -->
    <section v-if="tab === 'playlists'" class="pane">
      <div class="filter-bar">
        <div class="tags-scroll">
          <div v-for="g in TAG_GROUPS" :key="g.name" class="tag-group">
            <div class="tag-group-name">{{ g.name }}</div>
            <div class="tags">
              <button
                v-for="t in g.tags"
                :key="t"
                class="chip"
                :class="{ active: cat === t }"
                @click="selectCat(t)"
              >{{ t }}</button>
            </div>
          </div>
        </div>
        <div class="sorts">
          <button class="chip" :class="{ active: order === 'hot' }" @click="order = 'hot'; loadPlaylists(true)">最热</button>
          <button class="chip" :class="{ active: order === 'new' }" @click="order = 'new'; loadPlaylists(true)">最新</button>
        </div>
      </div>

      <div v-if="playlists.length" class="pl-grid">
        <PlaylistCard
          v-for="pl in playlists"
          :key="pl.id"
          :playlist="pl"
          @open="openPlaylist(pl)"
          @play="playPlaylist(pl)"
        />
      </div>
      <div v-else-if="plLoading" class="pl-grid">
        <div v-for="i in 10" :key="i" class="sk" style="aspect-ratio: 1; border-radius: 12px" />
      </div>
      <div v-else class="empty">
        <Icon name="list" :size="32" :stroke="1.3" />
        <div class="empty-title">没有找到歌单</div>
        <div class="empty-desc">换个标签试试，或检查网络连接</div>
      </div>

      <div v-if="playlists.length" class="load-more">
        <button class="btn" :disabled="plEnd || plLoading" @click="loadPlaylists(false)">
          {{ plEnd ? '已经到底啦' : plLoading ? '加载中…' : '加载更多' }}
        </button>
      </div>
    </section>

    <!-- 榜单 -->
    <section v-else-if="tab === 'toplists'" class="pane toplist-pane">
      <div class="tl-toolbar">
        <div class="tl-title">
          <span class="title-text">官方榜</span>
        </div>
        <PlatformSelect
          v-model="platform"
          :options="platforms"
          align="right"
        />
      </div>

      <div class="tl-layout">
        <aside class="tl-side">
          <div v-if="treeLoading" class="tl-skeleton">
            <div v-for="i in 8" :key="i" class="sk" style="height: 28px; margin-bottom: 8px" />
          </div>
          <template v-else>
            <div v-for="g in groups" :key="g.g" class="tl-group">
              <div class="tl-group-name">{{ g.g }}</div>
              <button
                v-for="item in g.items"
                :key="item.n + (item.id || '')"
                class="tl-item"
                :class="{ active: currentItem?.id === item.id && currentItem?.name === item.n }"
                :disabled="!item.id"
                @click="item.id && selectToplist(item.n, item.id)"
              >
                <span class="ellipsis">{{ item.n }}</span>
                <Icon v-if="!item.id" name="lock" :size="11" class="lock" />
              </button>
            </div>
          </template>
        </aside>

        <div class="tl-main">
          <div class="tl-head">
            <div>
              <h2>{{ currentItem?.name || '选择榜单' }}</h2>
              <span class="tl-count">{{ toplistSongs.length }} 首</span>
            </div>
            <button class="btn primary sm" :disabled="!toplistSongs.length" @click="playToplist">
              <Icon name="play" :size="13" />播放全部
            </button>
          </div>
          <div v-if="tlError" class="empty" style="padding: 40px">
            <Icon name="info" :size="28" :stroke="1.3" />
            <div class="empty-desc">{{ tlError }}</div>
          </div>
          <template v-else>
            <SongList :songs="tlPaged" :loading="tlLoading" :show-album="true" empty-text="该榜单暂无数据" />
            <nav v-if="tlTotalPages > 1" class="pagination" aria-label="分页">
              <button class="pg-btn" :disabled="tlPage === 1" @click="tlPage = 1" title="首页">
                <Icon name="chevron-left" :size="13" />
                <Icon name="chevron-left" :size="13" style="margin-left: -7px" />
              </button>
              <button class="pg-btn" :disabled="tlPage === 1" @click="tlPage--" title="上一页">
                <Icon name="chevron-left" :size="13" />
              </button>
              <button
                v-for="p in tlTotalPages"
                :key="p"
                class="pg-num"
                :class="{ active: p === tlPage }"
                @click="tlPage = p"
              >{{ p }}</button>
              <button class="pg-btn" :disabled="tlPage === tlTotalPages" @click="tlPage++" title="下一页">
                <Icon name="chevron-right" :size="13" />
              </button>
              <button class="pg-btn" :disabled="tlPage === tlTotalPages" @click="tlPage = tlTotalPages" title="末页">
                <Icon name="chevron-right" :size="13" />
                <Icon name="chevron-right" :size="13" style="margin-left: -7px" />
              </button>
            </nav>
          </template>
        </div>
      </div>
    </section>

    <!-- 新歌 -->
    <section v-else class="pane">
      <div class="section-head" style="margin-top: 4px">
        <div>
          <div class="section-title">新歌速递</div>
          <div class="section-sub">来自在线音源的最新上架单曲</div>
        </div>
        <button class="btn sm" :disabled="!newSongs.length" @click="player.playSongs(newSongs, 0)">
          <Icon name="play" :size="13" />播放全部
        </button>
      </div>
      <SongList :songs="newSongs" :loading="newLoading" empty-text="暂无新歌数据" />
    </section>
  </div>
</template>

<style scoped>
.page-head {
  display: flex;
  align-items: flex-end;
  justify-content: space-between;
  gap: 20px;
  padding-top: 14px;
}
.page-head h1 {
  font-size: 27px;
  font-weight: 700;
  letter-spacing: 0.3px;
}
.page-head p {
  margin-top: 4px;
  font-size: 12.5px;
  color: var(--text-3);
}
.tabs {
  display: flex;
  gap: 4px;
  margin: 18px 0 16px;
  border-bottom: 1px solid var(--line);
  padding-bottom: 0;
}
.tab {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  height: 34px;
  padding: 0 12px;
  font-size: 13px;
  color: var(--text-2);
  position: relative;
  border-radius: 8px 8px 0 0;
}
.tab:hover {
  color: var(--text);
  background: var(--hover);
}
.tab.active {
  color: var(--text);
  font-weight: 600;
}
.tab.active::after {
  content: '';
  position: absolute;
  left: 12px;
  right: 12px;
  bottom: -1px;
  height: 2px;
  border-radius: 2px;
  background: var(--accent);
}
.filter-bar {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 16px;
  margin-bottom: 16px;
}
.tags-scroll {
  flex: 1;
  display: flex;
  flex-direction: column;
  gap: 8px;
  max-height: 220px;
  overflow-y: auto;
  padding: 4px 4px 4px 0;
}
.tag-group {
  display: flex;
  align-items: flex-start;
  gap: 10px;
  min-height: 26px;
}
.tag-group-name {
  font-size: 10.5px;
  color: var(--text-3);
  letter-spacing: 1px;
  width: 56px;
  flex: none;
  padding-top: 6px;
  text-transform: uppercase;
}
.tag-group .tags {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  flex: 1;
}
.sorts {
  display: flex;
  gap: 6px;
  flex: none;
}
.pl-grid {
  display: grid;
  grid-template-columns: repeat(5, minmax(0, 1fr));
  gap: 20px 18px;
}
.load-more {
  display: flex;
  justify-content: center;
  margin-top: 26px;
}
.platform-tabs {
  display: flex;
  gap: 7px;
  margin-bottom: 14px;
}
.tl-toolbar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 14px;
  margin-bottom: 14px;
  padding: 10px 14px;
  background: var(--panel);
  border: 1px solid var(--line);
  border-radius: 10px;
}
.tl-title {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 13px;
  font-weight: 600;
  color: var(--text);
}
.tl-title .title-text {
  position: relative;
  padding-left: 10px;
}
.tl-title .title-text::before {
  content: '';
  position: absolute;
  left: 0;
  top: 4px;
  bottom: 4px;
  width: 3px;
  border-radius: 3px;
  background: var(--accent);
}
.tl-layout {
  display: grid;
  grid-template-columns: 208px minmax(0, 1fr);
  gap: 20px;
  align-items: start;
}
.tl-side {
  max-height: calc(100vh - 300px);
  overflow-y: auto;
  padding-right: 6px;
  position: sticky;
  top: 8px;
}
.tl-group {
  margin-bottom: 12px;
}
.tl-group-name {
  font-size: 10.5px;
  letter-spacing: 1px;
  color: var(--text-3);
  padding: 0 8px 5px;
  text-transform: uppercase;
}
.tl-item {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 6px;
  width: 100%;
  height: 30px;
  padding: 0 9px;
  border-radius: 8px;
  font-size: 12px;
  color: var(--text-2);
  text-align: left;
}
.tl-item span {
  flex: 1;
}
.tl-item:hover:not(:disabled) {
  background: var(--hover);
  color: var(--text);
}
.tl-item.active {
  background: var(--accent-soft);
  color: var(--accent);
  font-weight: 500;
}
.tl-item:disabled {
  opacity: 0.45;
  cursor: not-allowed;
}
.lock {
  color: var(--text-3);
}
.tl-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 10px;
}
.tl-head h2 {
  font-size: 18px;
  font-weight: 650;
}
.tl-count {
  font-size: 11.5px;
  color: var(--text-3);
}
.pagination {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 4px;
  margin: 18px 0 4px;
}
.pg-btn,
.pg-num {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-width: 30px;
  height: 30px;
  padding: 0 8px;
  border-radius: 7px;
  font-size: 12px;
  color: var(--text-2);
  background: var(--panel);
  border: 1px solid transparent;
  transition: background 0.15s, color 0.15s, border-color 0.15s;
}
.pg-btn:hover:not(:disabled),
.pg-num:hover:not(.active) {
  background: var(--panel-2);
  color: var(--text);
  border-color: var(--line-2);
}
.pg-num.active {
  color: var(--accent);
  background: var(--accent-soft);
  border-color: var(--accent-soft);
  font-weight: 600;
}
.pg-btn:disabled {
  opacity: 0.4;
  cursor: not-allowed;
}
@media (max-width: 1300px) {
  .pl-grid {
    grid-template-columns: repeat(4, minmax(0, 1fr));
  }
}
</style>
