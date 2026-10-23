<script setup lang="ts">
import { computed, onMounted } from 'vue'
import { useRouter } from 'vue-router'
import Icon from '@/components/Icon.vue'
import SongList from '@/components/SongList.vue'
import { useLibraryStore } from '@/stores/library'
import { usePlayerStore } from '@/stores/player'

const library = useLibraryStore()
const player = usePlayerStore()
const router = useRouter()

const songs = computed(() => library.favorites)

onMounted(() => void library.refreshFavorites())
</script>

<template>
  <div class="page">
    <header class="hero">
      <div class="art"><Icon name="heart-filled" :size="56" /></div>
      <div class="info">
        <div class="kicker"><Icon name="heart-filled" :size="12" />收藏夹</div>
        <h1>我喜欢的音乐</h1>
        <p>收藏夹 · {{ songs.length }} 首 · 保存在本地</p>
        <div class="actions">
          <button class="btn primary" :disabled="!songs.length" @click="player.playSongs(songs, 0)">
            <Icon name="play" :size="15" />播放全部
          </button>
          <button class="btn" :disabled="!songs.length" @click="player.addToQueue(songs)">
            <Icon name="queue" :size="15" />加入队列
          </button>
        </div>
      </div>
    </header>

    <SongList
      :songs="songs"
      empty-text="还没有喜欢的歌曲"
      empty-desc="在歌曲右侧点击爱心，或在播放页点亮红心，歌曲会出现在这里"
    >
    </SongList>

    <div v-if="!songs.length" class="tip">
      <button class="btn" @click="router.push('/discover')"><Icon name="compass" :size="14" />去发现音乐</button>
    </div>
  </div>
</template>

<style scoped>
.hero {
  display: flex;
  align-items: center;
  gap: 24px;
  padding: 14px 0 26px;
}
.art {
  width: 168px;
  height: 168px;
  display: grid;
  place-items: center;
  border-radius: 16px;
  color: rgba(255, 255, 255, 0.92);
  background: linear-gradient(135deg, #a78bfa, #f472b6);
  box-shadow: 0 22px 50px -22px rgba(0, 0, 0, 0.75);
}
.kicker {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  font-size: 10.5px;
  letter-spacing: 1.2px;
  color: var(--accent);
  text-transform: uppercase;
  margin-bottom: 8px;
}
h1 {
  font-size: 28px;
  font-weight: 700;
}
.info p {
  margin-top: 8px;
  font-size: 12px;
  color: var(--text-3);
}
.actions {
  display: flex;
  gap: 9px;
  margin-top: 18px;
}
.tip {
  display: flex;
  justify-content: center;
  margin-top: -18px;
  margin-bottom: 30px;
}
</style>
