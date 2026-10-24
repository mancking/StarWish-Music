<script setup lang="ts">
/**
 * 车机播放页（规格书 1.1 / 0.2 / 0.3）
 *
 * 横屏单栏：左 1/3 歌名 28px + 歌手 18px，右 2/3 三个大按钮（64 / 80px）。
 * 不显示封面、歌词、粒子、频谱；文字琥珀黄 #FBBF24；控件常显不自动隐藏。
 */
import { computed } from 'vue'
import { useRouter } from 'vue-router'
import Icon from '@/components/Icon.vue'
import ProgressBar from '@/player-music/components/ProgressBar.vue'
import PlayerBackground from '@/player-music/components/PlayerBackground.vue'
import { usePlayerStore } from '@/stores/player'
import { useLibraryStore } from '@/stores/library'

defineOptions({ name: 'CarPlayer' })

const router = useRouter()
const player = usePlayerStore()

const song = computed(() => player.song)
const library = useLibraryStore()
/** Bug 44：四态文案（此前仅两态） */
const MODE_TEXT: Record<string, string> = {
  'repeat-all': '列表循环',
  'repeat-one': '单曲循环',
  shuffle: '随机播放',
  order: '顺序播放',
}
const modeLabel = computed(() => MODE_TEXT[player.state.mode] || '列表循环')
/** Bug 67：缓冲/错误状态文案（32sp，驾驶可见） */
const statusText = computed(() => {
  if (player.state.status === 'loading') return '缓冲中…'
  if (player.state.status === 'error') return player.state.error || '加载失败'
  return ''
})
const liked = computed(() => (song.value ? library.isFavorite(song.value.id) : false))
/** 车机保留两态循环（规格 1.7）：列表/单曲 */
function cycleMode(): void {
  player.cycleMode()
}
async function toggleLike(): Promise<void> {
  if (!song.value) return
  await library.toggleFavorite(song.value)
}
</script>

<template>
  <div class="car">
    <!-- 车机背景降级（4.7）：仅动态渐变/纯色，无封面模糊 -->
    <PlayerBackground class="car-bg" :cover="player.coverUrl" kind="car" />
    <header class="top">
      <button class="back" aria-label="返回" @click="router.back()">
        <Icon name="shrink" :size="24" />
      </button>
      <span class="tag">车机模式 · 驾驶勿扰</span>
    </header>

    <main class="body">
      <section class="info">
        <h1>{{ song?.name || '未在播放' }}</h1>
        <p>{{ song?.singer || '星河音乐' }}</p>
        <!-- Bug 68：行驶中进度条只作指示、禁拖（驾驶安全） -->
        <ProgressBar class="bar" :position="player.displayPosition" :duration="player.duration" variant="car" accent="#fbbf24" />
        <span v-if="statusText" class="status">{{ statusText }}</span>
        <span class="mode" @click="cycleMode">{{ modeLabel }}</span>
      </section>

      <section class="controls">
        <button class="btn side" aria-label="上一首" @click="player.prev()">
          <Icon name="prev" :size="30" />
        </button>
        <button class="btn main" aria-label="播放暂停" @click="player.toggle()">
          <Icon :name="player.playing ? 'pause' : 'play'" :size="38" />
        </button>
        <button class="btn side" aria-label="下一首" @click="player.next()">
          <Icon name="next" :size="30" />
        </button>
        <!-- Bug 44：红心收藏（76dp 热区） -->
        <button class="btn side" :class="{ on: liked }" aria-label="收藏" @click="toggleLike">
          <Icon :name="liked ? 'heart-filled' : 'heart'" :size="28" />
        </button>
      </section>
    </main>
  </div>
</template>

<style scoped>
.car {
  position: fixed;
  inset: 0;
  display: flex;
  flex-direction: column;
  background: #0b0b10;
  color: #fbbf24;
  overflow: hidden;
}
.car-bg {
  position: absolute;
  inset: 0;
  z-index: 0;
}
.car > :not(.car-bg) {
  position: relative;
  z-index: 1;
}
.top {
  display: flex;
  align-items: center;
  gap: 14px;
  height: 64px;
  padding: 0 24px;
}
.back {
  width: 56px;
  height: 56px;
  display: grid;
  place-items: center;
  border: 0;
  border-radius: 14px;
  background: rgba(251, 191, 36, 0.1);
  color: #fbbf24;
  cursor: pointer;
}
.tag {
  font-size: 20px;
  color: rgba(251, 191, 36, 0.72);
}
.body {
  flex: 1;
  display: grid;
  grid-template-columns: 1fr 2fr;
  gap: 32px;
  padding: 12px 32px 32px;
  min-height: 0;
}
.info {
  display: flex;
  flex-direction: column;
  justify-content: center;
  gap: 10px;
  min-width: 0;
}
.info h1 {
  margin: 0;
  font-size: 28px;
  font-weight: 600;
  line-height: 1.3;
  overflow: hidden;
  text-overflow: ellipsis;
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
}
.info p {
  margin: 0;
  font-size: 18px;
  color: rgba(251, 191, 36, 0.68);
}
.bar {
  margin-top: 8px;
}
.mode {
  margin-top: 6px;
  font-size: 20px;
  color: rgba(251, 191, 36, 0.8);
  cursor: pointer;
}
.controls {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 40px;
}
.btn {
  display: grid;
  place-items: center;
  border: 0;
  border-radius: 24px;
  background: rgba(251, 191, 36, 0.12);
  color: #fbbf24;
  cursor: pointer;
}
.btn.side {
  width: 64px;
  height: 64px;
}
.btn.main {
  width: 80px;
  height: 80px;
  background: #fbbf24;
  color: #0b0b10;
}
.btn:active {
  transform: scale(0.97);
}
.status {
  font-size: 20px;
  color: rgba(251, 191, 36, 0.85);
}
.btn.on {
  color: #f472b6;
}
</style>
