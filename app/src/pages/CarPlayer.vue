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
import ProgressBar from '@/player/components/ProgressBar.vue'
import { usePlayerStore } from '@/stores/player'

defineOptions({ name: 'CarPlayer' })

const router = useRouter()
const player = usePlayerStore()

const song = computed(() => player.song)
const modeLabel = computed(() => (player.state.mode === 'repeat-one' ? '单曲循环' : '列表循环'))

function cycleMode(): void {
  player.cycleMode()
}
</script>

<template>
  <div class="car">
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
        <ProgressBar
          class="bar"
          :position="player.displayPosition"
          :duration="player.duration"
          variant="car"
          accent="#fbbf24"
          @seek="player.seekTo"
        />
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
</style>
