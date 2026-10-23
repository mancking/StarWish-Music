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

    <SongList
      :songs="songs"
      empty-text="本地曲库还是空的"
      empty-desc="点击右上角「添加文件夹并扫描」，支持 MP3 / FLAC / M4A / OGG / WAV 等格式，会自动读取内嵌封面与标签"
    />

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
</style>
