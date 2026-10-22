<script setup lang="ts">
import { computed, defineOptions, onMounted, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import Icon from '@/components/Icon.vue'
import Cover from '@/components/Cover.vue'
import { call } from '@/api'
import { usePlayerStore } from '@/stores/player'
import { useUiStore } from '@/stores/ui'
import type { Song } from '@shared/types'
import { platformLabel } from '@/utils/labels'

/**
 * 移动端发现页 —— 模板级独立实现（非桌面缩放）。
 *
 * 与桌面差异：分段式 tab（歌单/排行/新歌）吸顶、分类横滑胶囊、
 * 歌单 2 列大封面卡、榜单纵向卡列表（点整行即播），无悬浮筛选弹层。
 * 数据走同一组 bridge 通道，切换分类/音源一律立即给骨架反馈。
 */
defineOptions({ name: 'Discover' })

type Tab = 'playlists' | 'toplists' | 'new'
const route = useRoute()
const router = useRouter()
const player = usePlayerStore()
const ui = useUiStore()

const tab = ref<Tab>(((route.query.tab as string) || 'playlists') as Tab)
const cat = ref((route.query.cat as string) || '全部')
const plSource = ref('wy')
const order = ref<'hot' | 'new'>('hot')

const platforms = ['wy', 'qq', 'kg', 'kw', 'mg']

/* ---- 歌单 ---- */
const playlists = ref<any[]>([])
const plLoading = ref(false)
const plError = ref('')
let plReqSeq = 0
const plCache = new Map<string, { list: any[] }>()

const CATS = ['全部', '流行', '摇滚', '民谣', '电子', '说唱', '轻音乐', '爵士', '古风', 'ACG', '怀旧', '运动', '夜晚', '学习']

async function loadPlaylists(): Promise<void> {
  const seq = ++plReqSeq
  const key = `${plSource.value}|${cat.value}|${order.value}`
  const hit = plCache.get(key)
  if (hit) {
    playlists.value = hit.list
    return
  }
  plLoading.value = true
  plError.value = ''
  try {
    const list = await call<any[]>('music:playlists', {
      cat: cat.value,
      order: order.value,
      page: 1,
      source: plSource.value,
    })
    if (list.length) plCache.set(key, { list })
    if (seq !== plReqSeq) return
    playlists.value = list
    if (!list.length) plError.value = '该分类暂无歌单，换一个试试'
  } catch (e: any) {
    if (seq !== plReqSeq) return
    playlists.value = []
    plError.value = e?.message || '歌单加载失败'
  } finally {
    if (seq === plReqSeq) plLoading.value = false
  }
}

function setCat(c: string): void {
  if (cat.value === c) return
  cat.value = c
  router.replace({ path: '/discover', query: { ...route.query, tab: 'playlists', cat: c } })
  void loadPlaylists()
}

function setSource(s: string): void {
  if (plSource.value === s) return
  plSource.value = s
  cat.value = '全部'
  playlists.value = []
  void loadPlaylists()
}

function setOrder(o: 'hot' | 'new'): void {
  if (order.value === o) return
  order.value = o
  void loadPlaylists()
}

/* ---- 榜单 ---- */
const tree = ref<any>(null)
const tlPlatform = ref('wy')
const groups = computed<any[]>(() => tree.value?.tree?.[tlPlatform.value]?.groups || [])
const tlItems = computed<any[]>(() => groups.value.flatMap((g: any) => (g.items || []).map((i: any) => ({ ...i, group: g.name }))))

async function loadTree(): Promise<void> {
  try {
    tree.value = await call<any>('music:toplists')
  } catch {
    tree.value = null
  }
}

async function playToplist(item: any): Promise<void> {
  try {
    const r = await call<{ name: string; songs: Song[] }>('music:toplist', { platform: tlPlatform.value, id: item.id })
    if (!r.songs?.length) throw new Error('该榜单暂无数据')
    await player.playSongs(r.songs, 0)
    ui.toast(`正在播放：${r.name}`, 'success', 1600)
  } catch (e: any) {
    ui.toast(e.message, 'error')
  }
}

/* ---- 新歌 ---- */
const newSongs = ref<Song[]>([])
const newLoading = ref(false)
async function loadNew(): Promise<void> {
  newLoading.value = true
  try {
    newSongs.value = await call<Song[]>('music:new')
  } catch {
    newSongs.value = []
  } finally {
    newLoading.value = false
  }
}

function setTab(t: Tab): void {
  if (tab.value === t) return
  tab.value = t
  router.replace({ path: '/discover', query: { ...route.query, tab: t } })
}

watch(tab, t => {
  if (t === 'new' && !newSongs.value.length && !newLoading.value) void loadNew()
  if (t === 'toplists' && !tree.value) void loadTree()
})

onMounted(() => {
  void loadPlaylists()
  void loadTree()
})
</script>

<template>
  <div class="page m-disc">
    <!-- 分段 tab：吸顶 -->
    <nav class="d-seg">
      <button class="d-seg-item" :class="{ on: tab === 'playlists' }" @click="setTab('playlists')">歌单</button>
      <button class="d-seg-item" :class="{ on: tab === 'toplists' }" @click="setTab('toplists')">排行</button>
      <button class="d-seg-item" :class="{ on: tab === 'new' }" @click="setTab('new')">新歌</button>
    </nav>

    <!-- ============ 歌单 ============ -->
    <template v-if="tab === 'playlists'">
      <!-- 音源 + 排序：横滑胶囊 -->
      <div class="d-row">
        <div class="d-chips">
          <button
            v-for="p in platforms"
            :key="p"
            class="d-chip"
            :class="{ on: plSource === p }"
            @click="setSource(p)"
          >{{ platformLabel(p) }}</button>
        </div>
        <div class="d-order">
          <button :class="{ on: order === 'hot' }" @click="setOrder('hot')">最热</button>
          <i />
          <button :class="{ on: order === 'new' }" @click="setOrder('new')">最新</button>
        </div>
      </div>
      <!-- 分类横滑 -->
      <div class="d-cats">
        <button
          v-for="c in CATS"
          :key="c"
          class="d-cat"
          :class="{ on: cat === c }"
          @click="setCat(c)"
        >{{ c }}</button>
      </div>

      <!-- 骨架 / 空 / 2 列大卡 -->
      <div v-if="plLoading" class="d-grid">
        <div v-for="i in 6" :key="i" class="sk" style="height: 190px; border-radius: 14px" />
      </div>
      <div v-else-if="plError && !playlists.length" class="empty" style="padding: 46px 16px">
        <div class="empty-title">{{ plError }}</div>
      </div>
      <div v-else class="d-grid">
        <button v-for="pl in playlists" :key="pl.id" class="d-pl" @click="router.push({ path: `/playlist/${pl.id}`, query: { src: pl.source || plSource, name: pl.name } })">
          <Cover :src="pl.pic || ''" :size="170" radius="12" class="d-pl-cover" />
          <div class="d-pl-name">{{ pl.name }}</div>
          <div class="d-pl-sub">{{ pl.author || pl.source || '' }}</div>
        </button>
      </div>
    </template>

    <!-- ============ 排行榜 ============ -->
    <template v-else-if="tab === 'toplists'">
      <div class="d-row">
        <div class="d-chips">
          <button
            v-for="p in platforms"
            :key="p"
            class="d-chip"
            :class="{ on: tlPlatform === p }"
            @click="tlPlatform = p"
          >{{ platformLabel(p) }}</button>
        </div>
      </div>
      <div v-if="!groups.length" class="empty" style="padding: 46px 16px">
        <div class="empty-title">榜单加载中…</div>
      </div>
      <div class="d-tl-list">
        <button v-for="(t, i) in tlItems" :key="t.platform + t.id" class="d-tl" @click="playToplist(t)">
          <span class="d-tl-rank" :class="{ top: i < 3 }">{{ i + 1 }}</span>
          <span class="d-tl-meta">
            <span class="d-tl-name">{{ t.n }}</span>
            <span class="d-tl-sub">{{ t.group }}<template v-if="t.freq"> · {{ t.freq }}</template></span>
          </span>
          <Icon name="play" :size="16" class="d-tl-play" />
        </button>
      </div>
    </template>

    <!-- ============ 新歌 ============ -->
    <template v-else>
      <div v-if="newLoading" class="d-list-sk">
        <div v-for="i in 6" :key="i" class="sk" style="height: 56px; border-radius: 12px" />
      </div>
      <div v-else class="m-song-list">
        <button v-for="(s, i) in newSongs" :key="s.id" class="d-new" @click="player.playSongs(newSongs, i)">
          <Cover :src="s.pic || ''" :size="46" radius="9" />
          <span class="d-new-meta">
            <span class="d-new-name">{{ s.name }}</span>
            <span class="d-new-sub">{{ s.singer }}</span>
          </span>
          <Icon name="play" :size="16" class="d-tl-play" />
        </button>
      </div>
    </template>
  </div>
</template>

<style scoped>
/* 分段 tab */
.d-seg {
  position: sticky;
  top: 0;
  z-index: 5;
  display: flex;
  gap: 6px;
  padding: 8px 0 10px;
  background: var(--bg);
}
.d-seg-item {
  flex: 1;
  height: 40px;
  border-radius: 12px;
  border: 0;
  background: var(--bg-2);
  color: var(--text-3);
  font-size: 14px;
  -webkit-tap-highlight-color: transparent;
}
.d-seg-item.on {
  background: var(--accent-soft);
  color: var(--accent);
  font-weight: 700;
}

/* 行内布局 */
.d-row {
  display: flex;
  align-items: center;
  gap: 10px;
  margin-bottom: 10px;
}
.d-chips {
  flex: 1;
  min-width: 0;
  display: flex;
  gap: 6px;
  overflow-x: auto;
  margin: 0 -16px;
  padding: 2px 16px;
  scrollbar-width: none;
}
.d-chips::-webkit-scrollbar {
  display: none;
}
.d-chip {
  flex: none;
  height: 36px;
  padding: 0 14px;
  border-radius: 18px;
  border: 1px solid var(--line);
  background: var(--bg-2);
  color: var(--text-2);
  font-size: 12.5px;
  -webkit-tap-highlight-color: transparent;
}
.d-chip.on {
  border-color: transparent;
  background: var(--accent);
  color: #fff;
  font-weight: 600;
}
.d-order {
  flex: none;
  display: inline-flex;
  align-items: center;
  gap: 8px;
  border: 1px solid var(--line);
  border-radius: 18px;
  padding: 3px 6px;
}
.d-order button {
  height: 30px;
  padding: 0 10px;
  border: 0;
  border-radius: 13px;
  background: none;
  color: var(--text-3);
  font-size: 12.5px;
}
.d-order button.on {
  background: var(--accent);
  color: #fff;
}
.d-order i {
  width: 1px;
  height: 14px;
  background: var(--line);
}
.d-cats {
  display: flex;
  gap: 7px;
  overflow-x: auto;
  margin: 0 -16px 14px;
  padding: 2px 16px;
  scrollbar-width: none;
}
.d-cats::-webkit-scrollbar {
  display: none;
}
.d-cat {
  flex: none;
  height: 34px;
  padding: 0 15px;
  border-radius: 17px;
  border: 0;
  background: var(--bg-2);
  color: var(--text-2);
  font-size: 13px;
  -webkit-tap-highlight-color: transparent;
}
.d-cat.on {
  background: var(--accent-soft);
  color: var(--accent);
  font-weight: 700;
}

/* 歌单 2 列大卡 */
.d-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 16px 12px;
}
.d-pl {
  border: 0;
  background: none;
  padding: 0;
  text-align: left;
  -webkit-tap-highlight-color: transparent;
}
.d-pl:active .d-pl-cover {
  transform: scale(0.97);
  transition: transform 0.12s;
}
.d-pl-name {
  margin-top: 8px;
  font-size: 13.5px;
  font-weight: 600;
  color: var(--text);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.d-pl-sub {
  margin-top: 2px;
  font-size: 11.5px;
  color: var(--text-3);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

/* 榜单纵向卡 */
.d-tl-list,
.m-song-list {
  display: flex;
  flex-direction: column;
  gap: 6px;
}
.d-tl,
.d-new {
  display: flex;
  align-items: center;
  gap: 12px;
  min-height: 56px;
  padding: 6px 10px;
  border: 0;
  border-radius: 13px;
  background: var(--bg-2);
  text-align: left;
  -webkit-tap-highlight-color: transparent;
}
.d-tl:active,
.d-new:active {
  filter: brightness(1.15);
}
.d-tl-rank {
  width: 24px;
  text-align: center;
  font-size: 15px;
  font-weight: 800;
  color: var(--text-3);
}
.d-tl-rank.top {
  color: var(--accent);
}
.d-tl-meta,
.d-new-meta {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 2px;
}
.d-tl-name,
.d-new-name {
  font-size: 14.5px;
  font-weight: 600;
  color: var(--text);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.d-tl-sub,
.d-new-sub {
  font-size: 12px;
  color: var(--text-3);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.d-tl-play {
  flex: none;
  color: var(--text-3);
}
.d-list-sk {
  display: flex;
  flex-direction: column;
  gap: 8px;
}
</style>
