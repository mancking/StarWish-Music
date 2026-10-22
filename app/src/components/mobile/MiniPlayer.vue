<script setup lang="ts">
import { computed } from 'vue'
import { useRouter } from 'vue-router'
import Icon from '@/components/Icon.vue'
import Cover from '@/components/Cover.vue'
import { usePlayerStore } from '@/stores/player'

/**
 * 移动端全局迷你播放条：56px，贴在 TabBar 之上。
 * 点整条进全屏播放页，右侧按钮直接控制播放/暂停。
 */

const player = usePlayerStore()
const router = useRouter()

const song = computed(() => player.song)
const title = computed(() => song.value?.name || '未在播放')
const sub = computed(() => song.value?.singer || '选一首歌开始')
const progress = computed(() => {
  const d = player.duration || 0
  if (!d) return 0
  return Math.max(0, Math.min(100, (player.displayPosition / d) * 100))
})

function open(): void {
  if (!song.value) return
  router.push('/player')
}
</script>

<template>
  <div v-if="song" class="mini" @click="open">
    <div class="mini-progress" :style="{ width: progress + '%' }" />
    <Cover :src="player.coverUrl" :size="40" radius="10" class="mini-cover" />
    <div class="mini-text">
      <b>{{ title }}</b>
      <span>{{ sub }}</span>
    </div>
    <button class="mini-btn" @click.stop="player.toggle()">
      <Icon :name="player.playing ? 'pause' : 'play'" :size="20" />
    </button>
    <button class="mini-btn" @click.stop="player.next()">
      <Icon name="next" :size="18" />
    </button>
  </div>
</template>

<style scoped>
.mini {
  position: relative;
  flex: none;
  display: flex;
  align-items: center;
  gap: 10px;
  height: 56px;
  padding: 0 12px;
  margin: 0 8px 6px;
  border-radius: 14px;
  background: var(--bg-2);
  border: 1px solid var(--line);
  overflow: hidden;
  cursor: pointer;
  -webkit-tap-highlight-color: transparent;
}
.mini-progress {
  position: absolute;
  left: 0;
  bottom: 0;
  height: 2px;
  background: var(--accent);
  transition: width 0.3s linear;
}
.mini-cover {
  flex: none;
}
.mini-text {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 1px;
}
.mini-text b {
  font-size: 13px;
  font-weight: 600;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.mini-text span {
  font-size: 11.5px;
  color: var(--text-3);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.mini-btn {
  flex: none;
  width: 38px;
  height: 38px;
  display: grid;
  place-items: center;
  border: 0;
  border-radius: 10px;
  background: transparent;
  color: var(--text);
  cursor: pointer;
}
.mini-btn:active {
  background: var(--hover);
}
</style>
