<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import Icon from '@/components/Icon.vue'
import Cover from '@/components/Cover.vue'
import SongList from '@/components/SongList.vue'
import Modal from '@/components/Modal.vue'
import { call } from '@/api'
import { usePlayerStore } from '@/stores/player'
import { useLibraryStore } from '@/stores/library'
import { useUiStore } from '@/stores/ui'
import type { Song } from '@shared/types'
import { platformLabel } from '@/utils/labels'

const route = useRoute()
const router = useRouter()
const player = usePlayerStore()
const library = useLibraryStore()
const ui = useUiStore()

const songs = ref<Song[]>([])
const loading = ref(true)
const error = ref('')
const name = ref('')
const pic = ref('')
const desc = ref('')
const author = ref('')
const isLocal = ref(false)

const renaming = ref(false)
const renameValue = ref('')
const confirmDelete = ref(false)
const importing = ref(false)

const localMeta = computed(() => library.playlists.find(p => p.id === String(route.params.id)))
const count = computed(() => songs.value.length)

async function load(): Promise<void> {
  loading.value = true
  error.value = ''
  songs.value = []
  try {
    if (route.name === 'toplist') {
      const r = await call<{ name: string; songs: Song[] }>('music:toplist', {
        platform: route.params.platform,
        id: route.params.id,
      })
      name.value = r.name
      songs.value = r.songs
      pic.value = r.songs[0]?.pic || ''
      desc.value = '实时更新的平台榜单'
      author.value = String(route.params.platform).toUpperCase()
      isLocal.value = false
      if (!r.songs.length) error.value = '该榜单暂时没有数据'
    } else {
      const id = String(route.params.id)
      const src = (route.query.src as string) || ''
      if (!src || id.startsWith('pl_')) {
        isLocal.value = true
        const meta = library.playlists.find(p => p.id === id)
        if (!meta) {
          error.value = '歌单不存在或已被删除'
          return
        }
        name.value = meta.name
        pic.value = meta.pic || ''
        desc.value = meta.description || ''
        author.value = '我的歌单'
        songs.value = await call<Song[]>('db:playlist:songs', { id })
      } else {
        isLocal.value = false
        const r = await call<{ name: string; pic: string; description: string; songs: Song[] }>('music:playlist', {
          id,
          source: src,
        })
        name.value = r.name || (route.query.name as string) || '歌单'
        pic.value = r.pic
        desc.value = r.description
        author.value = platformLabel(src)
        songs.value = r.songs
        if (!r.songs.length) error.value = '该歌单暂时没有可播放的歌曲'
      }
    }
  } catch (e: any) {
    error.value = e?.message || '加载失败'
  } finally {
    loading.value = false
  }
}

function playAll(): void {
  if (!songs.value.length) return
  void player.playSongs(songs.value, 0)
}

function addAllToQueue(): void {
  if (!songs.value.length) return
  void player.addToQueue(songs.value)
}

async function importToMine(): Promise<void> {
  if (!songs.value.length || importing.value) return
  importing.value = true
  try {
    const pl = await library.createPlaylist(name.value || '导入的歌单')
    if (!pl) throw new Error('创建歌单失败')
    await library.addSongsToPlaylist(pl.id, songs.value)
    if (pic.value) await call('db:playlist:update', { id: pl.id, patch: { pic: pic.value, description: desc.value } })
    await library.refreshPlaylists()
    ui.toast(`已收藏到「${pl.name}」`, 'success')
    router.push(`/playlist/${pl.id}`)
  } catch (e: any) {
    ui.toast(e.message, 'error')
  } finally {
    importing.value = false
  }
}

function startRename(): void {
  renameValue.value = name.value
  renaming.value = true
}

async function doRename(): Promise<void> {
  const v = renameValue.value.trim()
  if (!v) {
    renaming.value = false
    return
  }
  await library.renamePlaylist(String(route.params.id), v)
  name.value = v
  renaming.value = false
}

async function doDelete(): Promise<void> {
  await library.deletePlaylist(String(route.params.id))
  confirmDelete.value = false
  router.push('/')
}

watch(
  () => route.fullPath,
  () => void load()
)

onMounted(() => void load())
</script>

<template>
  <div class="page detail">
    <div v-if="loading" class="hero-skeleton">
      <div class="sk" style="width: 180px; height: 180px; border-radius: 16px" />
      <div class="hs-right">
        <div class="sk" style="height: 14px; width: 100px" />
        <div class="sk" style="height: 30px; width: 60%; margin-top: 12px" />
        <div class="sk" style="height: 12px; width: 40%; margin-top: 14px" />
        <div class="sk" style="height: 36px; width: 260px; margin-top: 24px; border-radius: 10px" />
      </div>
    </div>

    <template v-else>
      <header class="hero">
        <Cover :src="pic" :alt="name" :size="180" :radius="16" cover="1" class="hero-cover" />
        <div class="hero-info">
          <div class="kicker">
            <Icon :name="route.name === 'toplist' ? 'gauge' : isLocal ? 'list' : 'cloud'" :size="12" />
            {{ route.name === 'toplist' ? '排行榜' : isLocal ? '我的歌单' : '平台歌单' }}
          </div>
          <div v-if="renaming" class="rename-row">
            <input v-model="renameValue" class="rename-input" maxlength="30" autofocus @keydown.enter="doRename" @keydown.esc="renaming = false" />
            <button class="btn primary sm" @click="doRename">保存</button>
          </div>
          <h1 v-else @dblclick="isLocal && startRename()">{{ name }}</h1>
          <div class="meta">
            <span>{{ author }}</span>
            <span class="dot">·</span>
            <span>{{ count }} 首</span>
            <span v-if="isLocal" class="dot">·</span>
            <span v-if="isLocal" class="hint">双击标题可重命名</span>
          </div>
          <p v-if="desc" class="desc clamp-2">{{ desc }}</p>

          <div class="actions">
            <button class="btn primary" :disabled="!count" @click="playAll"><Icon name="play" :size="15" />播放全部</button>
            <button class="btn" :disabled="!count" @click="addAllToQueue"><Icon name="queue" :size="15" />加入队列</button>
            <button v-if="!isLocal && count" class="btn" :disabled="importing" @click="importToMine">
              <Icon name="plus" :size="15" />{{ importing ? '收藏中…' : '收藏到我的歌单' }}
            </button>
            <button v-if="isLocal" class="icon-btn" title="重命名" @click="startRename"><Icon name="edit" :size="16" /></button>
            <button v-if="isLocal" class="icon-btn danger" title="删除歌单" @click="confirmDelete = true"><Icon name="trash" :size="16" /></button>
          </div>
        </div>
      </header>

      <div v-if="error" class="empty" style="padding: 50px 20px">
        <Icon name="info" :size="30" :stroke="1.3" />
        <div class="empty-title">{{ error }}</div>
        <button class="btn" style="margin-top: 8px" @click="load">重试</button>
      </div>

      <SongList
        v-else
        :songs="songs"
        :playlist-id="isLocal ? String(route.params.id) : ''"
        empty-text="歌单还是空的"
        empty-desc="去发现音乐里找几首歌，或在歌曲菜单中选择「添加到歌单」"
        @remove="load"
      />
    </template>

    <Modal v-model="confirmDelete" title="删除歌单" :width="380">
      <p style="font-size: 13px; line-height: 1.8">
        确定删除歌单「{{ name }}」吗？<br />
        <span style="color: var(--text-3)">只会删除歌单本身，不会删除本地音乐文件。</span>
      </p>
      <template #footer>
        <button class="btn ghost" @click="confirmDelete = false">取消</button>
        <button class="btn primary" @click="doDelete">确认删除</button>
      </template>
    </Modal>
  </div>
</template>

<style scoped>
.detail {
  padding-top: 18px;
}
.hero {
  display: flex;
  gap: 24px;
  padding: 4px 0 26px;
}
.hero-cover {
  box-shadow: 0 22px 50px -22px rgba(0, 0, 0, 0.75);
}
.hero-info {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  justify-content: center;
}
.kicker {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  font-size: 10.5px;
  letter-spacing: 1.2px;
  color: var(--text-3);
  text-transform: uppercase;
  margin-bottom: 8px;
}
h1 {
  font-size: 30px;
  font-weight: 700;
  line-height: 1.25;
  letter-spacing: 0.2px;
}
.meta {
  display: flex;
  align-items: center;
  gap: 7px;
  margin-top: 10px;
  font-size: 12px;
  color: var(--text-2);
  flex-wrap: wrap;
}
.dot {
  color: var(--text-3);
}
.hint {
  color: var(--text-3);
  font-size: 11px;
}
.desc {
  margin-top: 10px;
  font-size: 12px;
  line-height: 1.7;
  color: var(--text-3);
  max-width: 720px;
}
.actions {
  display: flex;
  align-items: center;
  gap: 9px;
  margin-top: 20px;
  flex-wrap: wrap;
}
.icon-btn.danger:hover {
  color: #ff6b81;
  background: rgba(255, 107, 129, 0.12);
}
.rename-row {
  display: flex;
  align-items: center;
  gap: 8px;
}
.rename-input {
  height: 40px;
  padding: 0 12px;
  border-radius: 10px;
  border: 1px solid var(--accent);
  background: var(--panel);
  outline: none;
  font-size: 20px;
  font-weight: 600;
  width: 360px;
  max-width: 60vw;
}
.hero-skeleton {
  display: flex;
  gap: 24px;
  padding: 4px 0 26px;
}
.hs-right {
  flex: 1;
  padding-top: 20px;
}
</style>
