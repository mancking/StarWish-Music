<script setup lang="ts">
import { computed, onMounted } from 'vue'
import Icon from '@/components/Icon.vue'
import SongList from '@/components/SongList.vue'
import { useLibraryStore } from '@/stores/library'
import { usePlayerStore } from '@/stores/player'

const library = useLibraryStore()
const player = usePlayerStore()
const songs = computed(() => library.history)

onMounted(() => void library.refreshHistory())
</script>

<template>
  <div class="page">
    <header class="head">
      <div>
        <h1>最近播放</h1>
        <p>{{ songs.length }} 首 · 记录保存在本地</p>
      </div>
      <div class="actions">
        <button class="btn primary" :disabled="!songs.length" @click="player.playSongs(songs, 0)">
          <Icon name="play" :size="15" />播放全部
        </button>
        <button class="btn" :disabled="!songs.length" @click="library.clearHistory()">
          <Icon name="trash" :size="15" />清空历史
        </button>
      </div>
    </header>

    <SongList :songs="songs" empty-text="还没有播放记录" empty-desc="播放过的歌曲会自动记录在这里，方便随时找回" />
  </div>
</template>

<style scoped>
.head {
  display: flex;
  align-items: flex-end;
  justify-content: space-between;
  gap: 18px;
  padding: 14px 0 20px;
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
</style>
