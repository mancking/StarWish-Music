<script setup lang="ts">
import { computed, defineOptions, onMounted, ref } from 'vue'
import { useRouter } from 'vue-router'
import Icon from '@/components/Icon.vue'
import SongRows from '@/components/mobile/SongRows.vue'
import { call } from '@/api'
import { usePlayerStore } from '@/stores/player'
import type { Song } from '@shared/types'

/**
 * 移动端「全部新歌」页（模板级独立实现）。
 *
 * 首页的新歌速递只有 6 首，需要完整列表时进入本页；
 * 独立成页而不是塞进「发现」的分段 tab，是为了在窄屏下保持
 * 「整页滚动曲单 + 一键播放」的播放器语义。
 */
defineOptions({ name: 'NewSongs' })

const router = useRouter()
const player = usePlayerStore()

const songs = ref<Song[]>([])
const loading = ref(true)
const error = ref('')

const count = computed(() => songs.value.length)

async function load(): Promise<void> {
  loading.value = true
  error.value = ''
  try {
    songs.value = await call<Song[]>('music:new')
    if (!songs.value.length) error.value = '暂时没有新歌'
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
  if (!songs.value.length) return
  void player.playSongs(songs.value, 0)
}

onMounted(() => void load())
</script>

<template>
  <div class="page m-new">
    <div class="nw-topbar">
      <button class="tb-btn" aria-label="返回" @click="back"><Icon name="chevron-left" :size="22" /></button>
      <span class="tb-title">全部新歌</span>
      <span class="tb-space" />
    </div>

    <div class="nw-head">
      <div class="nw-info">
        <h1>新歌速递</h1>
        <p>每日更新的最新上架曲目，共 {{ count }} 首</p>
      </div>
      <button class="nw-play" :disabled="!count" @click="playAll">
        <Icon name="play" :size="17" />播放
      </button>
    </div>

    <div v-if="loading" class="nw-sk">
      <div v-for="i in 8" :key="i" class="sk" style="height: 58px; border-radius: 12px; margin-bottom: 6px" />
    </div>

    <div v-else-if="error" class="empty" style="padding: 44px 16px">
      <Icon name="info" :size="30" :stroke="1.3" />
      <div class="empty-title">{{ error }}</div>
      <button class="btn" style="margin-top: 10px" @click="load">重试</button>
    </div>

    <SongRows v-else :songs="songs" show-index empty-text="暂无新歌" />
  </div>
</template>

<style scoped>
.m-new {
  padding: 0 16px 28px;
}
.nw-topbar {
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

.nw-head {
  display: flex;
  align-items: center;
  gap: 14px;
  padding: 14px 0 18px;
}
.nw-info {
  flex: 1;
  min-width: 0;
}
.nw-info h1 {
  margin: 0;
  font-size: 22px;
  font-weight: 800;
  color: var(--text);
}
.nw-info p {
  margin: 6px 0 0;
  font-size: 12.5px;
  color: var(--text-3);
}
.nw-play {
  flex: none;
  display: inline-flex;
  align-items: center;
  gap: 6px;
  height: 42px;
  padding: 0 20px;
  border: 0;
  border-radius: 14px;
  background: var(--accent);
  color: #fff;
  font-size: 14px;
  font-weight: 700;
  -webkit-tap-highlight-color: transparent;
}
.nw-play:disabled {
  opacity: 0.45;
}
</style>
