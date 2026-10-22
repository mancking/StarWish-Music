<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import Icon from '@/components/Icon.vue'
import Cover from '@/components/Cover.vue'
import SongRows from '@/components/mobile/SongRows.vue'
import { call } from '@/api'
import { usePlayerStore } from '@/stores/player'
import { useLibraryStore } from '@/stores/library'
import { useUiStore } from '@/stores/ui'
import type { Song } from '@shared/types'
import { platformLabel } from '@/utils/labels'

/**
 * 移动端歌单 / 榜单详情页（模板级独立实现）。
 *
 * 桌面 Playlist.vue 的表格语义（专辑列、时长列、桌面右键菜单）在窄屏
 * 完全失效——用户表现为「点进榜单/新歌打不开列表」。这里为移动端重写：
 *   ① 沉浸式头部：大封面 + 名称 + 平台 + 曲目数 + 操作按钮
 *   ② 工具条：播放全部 / 加入队列 / 收藏 / 排序
 *   ③ 行式曲单（mobile/SongRows.vue），更多操作走底部抽屉
 */
defineOptions({ name: 'PlaylistDetail' })

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
const isPodcast = ref(false)
const importing = ref(false)
const sortDesc = ref(false)

const isToplist = computed(() => route.name === 'toplist')
const count = computed(() => songs.value.length)

const sorted = computed(() => {
  const list = songs.value.slice()
  if (sortDesc.value) list.reverse()
  return list
})

async function load(): Promise<void> {
  loading.value = true
  error.value = ''
  songs.value = []
  try {
    if (isToplist.value) {
      const r = await call<{ name: string; songs: Song[] }>('music:toplist', {
        platform: route.params.platform,
        id: route.params.id,
      })
      name.value = r.name || '排行榜'
      songs.value = r.songs || []
      pic.value = r.songs?.[0]?.pic || ''
      desc.value = '实时更新的平台榜单'
      author.value = platformLabel(String(route.params.platform || 'wy'))
      isLocal.value = false
      if (!r.songs?.length) error.value = '该榜单暂时没有数据'
    } else if (route.name === 'podcast') {
      isPodcast.value = true
      isLocal.value = false
      name.value = (route.query.name as string) || '播客'
      pic.value = (route.query.pic as string) || ''
      author.value = (route.query.author as string) || '播客'
      desc.value = '单集全部在播放器内播放，不会跳转浏览器'
      const feed = String(route.query.feed || '')
      songs.value = await call<Song[]>('podcast:episodes', { feed, limit: 100 })
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
        songs.value = r.songs || []
        if (!r.songs?.length) error.value = '该歌单暂时没有可播放的歌曲'
      }
    }
  } catch (e: any) {
    error.value = e?.message || '加载失败'
  } finally {
    loading.value = false
  }
}

function back(): void {
  if (window.history.length > 1) router.back()
  else router.push('/')
}

function playAll(): void {
  if (!sorted.value.length) return
  void player.playSongs(sorted.value, 0)
}

function addAllToQueue(): void {
  if (!sorted.value.length) return
  void player.addToQueue(sorted.value)
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
    router.replace(`/playlist/${pl.id}`)
  } catch (e: any) {
    ui.toast(e.message, 'error')
  } finally {
    importing.value = false
  }
}

watch(() => route.fullPath, () => void load())
onMounted(() => void load())
</script>

<template>
  <div class="page m-pl">
    <!-- 返回栏 -->
    <div class="pl-topbar">
      <button class="tb-btn" aria-label="返回" @click="back"><Icon name="chevron-left" :size="22" /></button>
      <span class="tb-title ellipsis">{{ name || (isToplist ? '排行榜' : '歌单') }}</span>
      <span class="tb-space" />
    </div>

    <!-- 骨架 -->
    <div v-if="loading" class="pl-skeleton">
      <div class="sk" style="height: 190px; border-radius: 16px" />
      <div class="sk" style="height: 20px; width: 60%; margin-top: 16px" />
      <div class="sk" style="height: 44px; border-radius: 12px; margin-top: 18px" />
      <div v-for="i in 6" :key="i" class="sk" style="height: 56px; border-radius: 12px; margin-top: 8px" />
    </div>

    <template v-else>
      <!-- 沉浸头部 -->
      <header class="pl-hero">
        <Cover :src="pic" :alt="name" :size="188" radius="16" cover="1" class="pl-cover" />
        <h1 class="pl-name">{{ name }}</h1>
        <div class="pl-meta">
          <span class="pl-tag">
            <Icon :name="isToplist ? 'gauge' : isPodcast ? 'microphone' : isLocal ? 'list' : 'cloud'" :size="12" />
            {{ isToplist ? '排行榜' : isPodcast ? '播客' : isLocal ? '我的歌单' : '平台歌单' }}
          </span>
          <span class="pl-author">{{ author }}</span>
          <span class="pl-count">{{ count }} 首</span>
        </div>
        <p v-if="desc" class="pl-desc">{{ desc }}</p>
      </header>

      <!-- 操作区 -->
      <div class="pl-acts">
        <button class="pl-play" :disabled="!count" @click="playAll">
          <Icon name="play" :size="18" />播放全部
        </button>
        <button class="pl-icon" :disabled="!count" aria-label="加入队列" @click="addAllToQueue">
          <Icon name="queue" :size="20" />
        </button>
        <button v-if="!isLocal && count" class="pl-icon" :disabled="importing" aria-label="收藏" @click="importToMine">
          <Icon name="plus" :size="20" />
        </button>
        <button class="pl-icon" aria-label="倒序排列" :class="{ on: sortDesc }" @click="sortDesc = !sortDesc">
          <Icon name="sort" :size="20" />
        </button>
      </div>

      <div v-if="error" class="empty" style="padding: 44px 16px">
        <Icon name="info" :size="30" :stroke="1.3" />
        <div class="empty-title">{{ error }}</div>
        <button class="btn" style="margin-top: 10px" @click="load">重试</button>
      </div>

      <SongRows
        v-else
        :songs="sorted"
        show-index
        :empty-text="isToplist ? '该榜单暂无曲目' : '这里还没有歌曲'"
        empty-desc="换个来源或稍后再来看看"
      />
    </template>
  </div>
</template>

<style scoped>
.m-pl {
  padding: 0 16px 28px;
}
.pl-topbar {
  position: sticky;
  top: 0;
  z-index: 10;
  display: flex;
  align-items: center;
  gap: 8px;
  height: 48px;
  margin: 0 -16px;
  padding: 0 12px;
  background: color-mix(in srgb, var(--bg) 90%, transparent);
  backdrop-filter: blur(14px);
}
.tb-btn {
  flex: none;
  width: 40px;
  height: 40px;
  display: grid;
  place-items: center;
  border: 0;
  border-radius: 50%;
  background: var(--bg-2);
  color: var(--text);
  -webkit-tap-highlight-color: transparent;
}
.tb-title {
  flex: 1;
  min-width: 0;
  font-size: 15px;
  font-weight: 600;
  color: var(--text);
}
.tb-space {
  width: 40px;
}

.pl-skeleton {
  padding-top: 6px;
}

.pl-hero {
  display: flex;
  flex-direction: column;
  align-items: center;
  text-align: center;
  padding: 10px 0 18px;
}
.pl-cover {
  box-shadow: 0 18px 42px rgba(0, 0, 0, 0.42);
}
.pl-name {
  margin: 16px 0 0;
  font-size: 21px;
  font-weight: 800;
  color: var(--text);
  line-height: 1.35;
  word-break: break-all;
}
.pl-meta {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  justify-content: center;
  gap: 8px;
  margin-top: 10px;
  font-size: 12px;
  color: var(--text-3);
}
.pl-tag {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  padding: 3px 9px;
  border-radius: 10px;
  background: var(--accent-soft);
  color: var(--accent);
  font-weight: 600;
}
.pl-desc {
  margin: 12px 0 0;
  font-size: 13px;
  line-height: 1.7;
  color: var(--text-3);
}

.pl-acts {
  display: flex;
  align-items: center;
  gap: 10px;
  margin-bottom: 14px;
}
.pl-play {
  flex: 1;
  min-height: 48px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
  border: 0;
  border-radius: 14px;
  background: var(--accent);
  color: #fff;
  font-size: 15px;
  font-weight: 700;
  -webkit-tap-highlight-color: transparent;
}
.pl-play:disabled {
  opacity: 0.45;
}
.pl-icon {
  flex: none;
  width: 48px;
  height: 48px;
  display: grid;
  place-items: center;
  border: 1px solid var(--line);
  border-radius: 14px;
  background: var(--bg-2);
  color: var(--text-2);
  -webkit-tap-highlight-color: transparent;
}
.pl-icon.on {
  border-color: transparent;
  background: var(--accent-soft);
  color: var(--accent);
}
</style>
