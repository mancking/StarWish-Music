<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import Icon from '@/components/Icon.vue'
import SongList from '@/components/SongList.vue'
import { useLibraryStore } from '@/stores/library'
import { usePlayerStore } from '@/stores/player'
import { useUiStore } from '@/stores/ui'
import { tryCall } from '@/api'
import { platform } from '@/platform'

const library = useLibraryStore()
const player = usePlayerStore()
const ui = useUiStore()

const filter = ref('')
/** 手机/平板走系统媒体库（MediaStore），桌面走目录扫描 */
const mobile = computed(() => platform.value.kind === 'phone' || platform.value.kind === 'pad')

/** 规格书 3.4 / Bug 18：歌曲 / 歌手 / 专辑 三分组 Tab */
type GroupTab = 'songs' | 'artists' | 'albums'
const group = ref<GroupTab>('songs')
/** 分组视图里被选中的歌手 / 专辑（null = 聚合列表） */
const picked = ref<{ kind: 'artist' | 'album'; name: string } | null>(null)

const artists = computed(() => {
  const map = new Map<string, { name: string; count: number; pic: string }>()
  for (const s of library.localSongs) {
    const k = s.singer || '未知歌手'
    const cur = map.get(k)
    if (cur) cur.count++
    else map.set(k, { name: k, count: 1, pic: s.pic || '' })
  }
  const f = filter.value.trim().toLowerCase()
  const all = [...map.values()].sort((a, b) => b.count - a.count)
  return f ? all.filter(x => x.name.toLowerCase().includes(f)) : all
})

const albums = computed(() => {
  const map = new Map<string, { name: string; count: number; pic: string; singer: string }>()
  for (const s of library.localSongs) {
    const k = s.album || '未知专辑'
    const cur = map.get(k)
    if (cur) cur.count++
    else map.set(k, { name: k, count: 1, pic: s.pic || '', singer: s.singer || '' })
  }
  const f = filter.value.trim().toLowerCase()
  const all = [...map.values()].sort((a, b) => b.count - a.count)
  return f ? all.filter(x => x.name.toLowerCase().includes(f)) : all
})

/** 分组视图点进某歌手/专辑后的歌曲列表 */
const pickedSongs = computed(() => {
  if (!picked.value) return []
  const k = picked.value.name.toLowerCase()
  return library.localSongs.filter(s =>
    picked.value!.kind === 'artist'
      ? (s.singer || '未知歌手').toLowerCase() === k
      : (s.album || '未知专辑').toLowerCase() === k
  )
})

const songs = computed(() => {
  const k = filter.value.trim().toLowerCase()
  if (!k) return library.localSongs
  return library.localSongs.filter(
    s => s.name.toLowerCase().includes(k) || s.singer.toLowerCase().includes(k) || (s.album || '').toLowerCase().includes(k)
  )
})

const scanning = computed(() => ['scanning', 'parsing'].includes(library.scanProgress.phase))
const loadingMore = ref(false)
const hasMore = computed(() => library.localSongs.length < library.localCount)

async function loadMore(): Promise<void> {
  loadingMore.value = true
  try {
    await library.loadMoreLocal()
  } finally {
    loadingMore.value = false
  }
}
const progressPct = computed(() => {
  const p = library.scanProgress
  if (!p.found) return 0
  return Math.min(100, Math.round((p.parsed / p.found) * 100))
})

onMounted(async () => {
  await library.refreshLocal()
  const p = await tryCall<any>('library:progress')
  if (p) library.scanProgress = p
})

function cancel(): void {
  void (window as any).sw.invoke('library:cancel')
}

/** 规格书 4.4：权限被拒时给友好提示，而不是抛栈 */
async function scanNow(): Promise<void> {
  try {
    await library.pickAndScan()
  } catch (e: any) {
    ui.toast(e?.message || '扫描失败，请检查系统「音乐和音频」权限', 'error', 3600)
  }
}

async function rescan(): Promise<void> {
  try {
    await library.scan()
  } catch (e: any) {
    ui.toast(e?.message || '扫描失败，请检查系统「音乐和音频」权限', 'error', 3600)
  }
}
</script>

<template>
  <div class="page">
    <header class="head">
      <div>
        <h1>本地音乐</h1>
        <p>
          {{ library.localCount }} 首歌曲<span v-if="mobile"> · 来自系统音乐库</span><span v-else-if="ui.settings.localDirs.length"> · 已添加 {{ ui.settings.localDirs.length }} 个文件夹</span>
        </p>
      </div>
      <div class="actions">
        <button class="btn primary" :disabled="scanning" @click="scanNow">
          <Icon name="scan" :size="15" />{{ scanning ? '扫描中…' : mobile ? '扫描系统音乐库' : '添加文件夹并扫描' }}
        </button>
        <button v-if="!mobile" class="btn" :disabled="scanning" @click="rescan"><Icon name="refresh" :size="15" />重新扫描</button>
        <button v-if="scanning" class="btn" @click="cancel">取消</button>
      </div>
    </header>

    <div v-if="scanning" class="scan-panel">
      <div class="scan-top">
        <div class="scan-text">
          <Icon name="scan" :size="15" class="spin" />
          <span>正在扫描 {{ library.scanProgress.found }} 个文件，已解析 {{ library.scanProgress.parsed }} 个</span>
        </div>
        <span class="mono">{{ progressPct }}%</span>
      </div>
      <div class="bar"><div class="bar-fill" :style="{ width: progressPct + '%' }" /></div>
      <div class="scan-current ellipsis">{{ library.scanProgress.current }}</div>
    </div>

    <div v-if="ui.settings.localDirs.length" class="dirs">
      <span class="dirs-label">音乐文件夹</span>
      <span v-for="d in ui.settings.localDirs" :key="d" class="dir-chip" :title="d">
        <Icon name="folder" :size="12" />{{ d }}
      </span>
    </div>

    <div class="toolbar">
      <div class="search">
        <Icon name="search" :size="14" />
        <input v-model="filter" placeholder="在本地曲库中筛选" spellcheck="false" />
      </div>
      <div class="toolbar-right">
        <span class="count">{{ songs.length }} 首</span>
        <button class="btn sm" :disabled="!songs.length" @click="player.playSongs(songs, 0)">
          <Icon name="play" :size="13" />播放全部
        </button>
      </div>
    </div>

    <nav class="gtabs">
      <button :class="{ on: group === 'songs' }" @click="group = 'songs'; picked = null">歌曲</button>
      <button :class="{ on: group === 'artists' }" @click="group = 'artists'; picked = null">歌手 {{ artists.length || '' }}</button>
      <button :class="{ on: group === 'albums' }" @click="group = 'albums'; picked = null">专辑 {{ albums.length || '' }}</button>
    </nav>

    <template v-if="group === 'songs'">
      <SongList
        :songs="songs"
        empty-text="本地曲库还是空的"
        empty-desc="点击右上角「添加文件夹并扫描」，支持 MP3 / FLAC / M4A / OGG / WAV 等格式，会自动读取内嵌封面与标签"
      />
    </template>

    <template v-else>
      <!-- 歌手/专辑详情：沿用 SongList，标题行可返回聚合 -->
      <div v-if="picked" class="picked-head">
        <button class="btn sm" @click="picked = null"><Icon name="chevron-left" :size="13" />返回</button>
        <b>{{ picked.name }}</b>
        <span class="count">{{ pickedSongs.length }} 首</span>
        <span class="flex1" />
        <button class="btn sm primary" :disabled="!pickedSongs.length" @click="player.playSongs(pickedSongs, 0)">
          <Icon name="play" :size="13" />播放全部
        </button>
      </div>
      <SongList
        v-if="picked"
        :songs="pickedSongs"
        :empty-text="`该${picked.kind === 'artist' ? '歌手' : '专辑'}下暂无曲目`"
      />
      <div v-else class="ggrid">
        <button v-for="g in group === 'artists' ? artists : albums" :key="g.name" class="gcard" @click="picked = { kind: group === 'artists' ? 'artist' : 'album', name: g.name }">
          <span class="gpic" :class="{ round: group === 'artists' }" :style="g.pic ? { backgroundImage: `url(${g.pic})` } : undefined">
            <Icon v-if="!g.pic" :name="group === 'artists' ? 'artist' : 'disc'" :size="20" />
          </span>
          <span class="gmeta">
            <b class="ellipsis">{{ g.name }}</b>
            <i>{{ g.count }} 首</i>
          </span>
        </button>
        <div v-if="!(group === 'artists' ? artists : albums).length" class="empty-group">暂无数据</div>
      </div>
    </template>

    <!-- 规格书 4.1：分页懒加载，避免一次渲染上千条 -->
    <div v-if="hasMore" class="more">
      <button class="btn" :disabled="loadingMore" @click="loadMore">
        <Icon name="chevron-down" :size="14" />{{ loadingMore ? '加载中…' : `加载更多（已显示 ${library.localSongs.length} / ${library.localCount}）` }}
      </button>
    </div>
  </div>
</template>

<style scoped>
.head {
  display: flex;
  align-items: flex-end;
  justify-content: space-between;
  gap: 18px;
  padding: 14px 0 18px;
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
.actions {
  display: flex;
  gap: 8px;
}
.scan-panel {
  padding: 12px 14px;
  border-radius: 12px;
  background: var(--panel);
  border: 1px solid var(--line);
  margin-bottom: 12px;
}
.scan-top {
  display: flex;
  align-items: center;
  justify-content: space-between;
  font-size: 12px;
  margin-bottom: 8px;
}
.scan-text {
  display: flex;
  align-items: center;
  gap: 7px;
  color: var(--text-2);
}
.bar {
  height: 5px;
  border-radius: 4px;
  background: var(--panel-3);
  overflow: hidden;
}
.bar-fill {
  height: 100%;
  border-radius: 4px;
  background: linear-gradient(90deg, var(--accent), var(--accent-2));
  transition: width 0.3s var(--ease);
}
.scan-current {
  margin-top: 7px;
  font-size: 10.5px;
  color: var(--text-3);
}
.spin {
  animation: spin 1.2s linear infinite;
}
@keyframes spin {
  to {
    transform: rotate(360deg);
  }
}
.dirs {
  display: flex;
  flex-wrap: wrap;
  gap: 7px;
  align-items: center;
  margin-bottom: 14px;
}
.dirs-label {
  font-size: 11px;
  color: var(--text-3);
}
.dir-chip {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  max-width: 320px;
  padding: 3px 8px;
  border-radius: 6px;
  background: var(--panel);
  font-size: 10.5px;
  color: var(--text-2);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.toolbar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 14px;
  margin-bottom: 12px;
}
.search {
  display: flex;
  align-items: center;
  gap: 7px;
  height: 30px;
  padding: 0 10px;
  border-radius: 9px;
  background: var(--panel);
  color: var(--text-3);
  width: 260px;
}
.search input {
  flex: 1;
  min-width: 0;
  border: none;
  background: none;
  outline: none;
  font-size: 12px;
  color: var(--text);
}
.toolbar-right {
  display: flex;
  align-items: center;
  gap: 10px;
}
.count {
  font-size: 11px;
  color: var(--text-3);
}
.more {
  display: flex;
  justify-content: center;
  padding: 18px 0 8px;
}
.gtabs {
  display: flex;
  gap: 4px;
  margin: 0 0 12px;
  border-bottom: 1px solid var(--line);
}
.gtabs button {
  border: 0;
  background: transparent;
  color: var(--text-3);
  font-size: 13px;
  padding: 8px 12px;
  cursor: pointer;
  border-bottom: 2px solid transparent;
}
.gtabs button.on {
  color: var(--text);
  border-bottom-color: var(--accent);
}
.ggrid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(240px, 1fr));
  gap: 10px;
}
.gcard {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 8px 10px;
  border: 1px solid var(--line);
  border-radius: 12px;
  background: var(--panel);
  color: var(--text);
  cursor: pointer;
  text-align: left;
}
.gcard:hover {
  background: var(--hover);
}
.gpic {
  width: 44px;
  height: 44px;
  flex: none;
  border-radius: 8px;
  background: var(--panel-3) center / cover no-repeat;
  display: grid;
  place-items: center;
  color: var(--text-3);
}
.gpic.round {
  border-radius: 50%;
}
.gmeta {
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 2px;
}
.gmeta b {
  font-size: 13px;
  font-weight: 600;
}
.gmeta i {
  font-style: normal;
  font-size: 11px;
  color: var(--text-3);
}
.picked-head {
  display: flex;
  align-items: center;
  gap: 10px;
  margin-bottom: 10px;
}
.picked-head b {
  font-size: 15px;
}
.flex1 {
  flex: 1;
}
.empty-group {
  grid-column: 1 / -1;
  text-align: center;
  color: var(--text-3);
  font-size: 13px;
  padding: 40px 0;
}
</style>
