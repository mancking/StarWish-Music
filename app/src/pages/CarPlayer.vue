<script setup lang="ts">
/**
 * 车机横屏播放页（规格书 v2.7 · 1.1 / 1.4 / 1.7 / 1.11）
 * 左 1/3 歌名 28px + 歌手 18px，右 2/3 三按钮（播放 80px，其余 64px）；无封面/歌词/粒子/频谱；
 * 视觉模式固定封面（无按钮）；循环仅两态；音效仅 3 个预设且无滑块；不做手势与快捷键。
 */
import { computed, ref } from 'vue'
import Icon from '@/components/Icon.vue'
import EqPanel from '@/components/player/EqPanel.vue'
import { usePlayerStore } from '@/stores/player'
import { formatTime } from '@shared/lrc'

const player = usePlayerStore()
const eqOpen = ref(false)

const song = computed(() => player.song)
const title = computed(() => song.value?.name || '未在播放')
const artist = computed(() => song.value?.singer || '星河音乐')
const playing = computed(() => player.state.status === 'playing')
const loopOne = computed(() => player.state.mode === 'repeat-one')
const progress = computed(() => (player.duration > 0 ? player.displayPosition / player.duration : 0))
</script>

<template>
  <div class="car">
    <div class="car-head">
      <span class="brand">星河音乐</span>
      <span class="hint">驾驶模式 · 已简化控制</span>
    </div>

    <div class="car-body">
      <section class="meta">
        <h1 class="title" :title="title">{{ title }}</h1>
        <p class="artist">{{ artist }}</p>
        <div class="bar"><i :style="{ width: `${Math.min(100, progress * 100)}%` }" /></div>
        <p class="time">
          {{ formatTime(player.displayPosition) }} / {{ formatTime(player.duration) }}
        </p>
      </section>

      <section class="ctrl">
        <button class="btn" title="上一首" @click="player.prev()"><Icon name="prev" :size="34" /></button>
        <button class="btn primary" :title="playing ? '暂停' : '播放'" @click="player.toggle()">
          <Icon :name="playing ? 'pause' : 'play'" :size="44" />
        </button>
        <button class="btn" title="下一首" @click="player.next()"><Icon name="next" :size="34" /></button>
      </section>

      <section class="sub">
        <button class="btn small" :class="{ on: player.state.mode !== 'order' }" title="循环模式" @click="player.cycleMode()">
          <Icon :name="loopOne ? 'repeat-one' : 'repeat'" :size="26" />
          <span>{{ loopOne ? '单曲循环' : '列表循环' }}</span>
        </button>
        <button class="btn small" title="音效" @click="eqOpen = true">
          <Icon name="sliders" :size="26" />
          <span>音效</span>
        </button>
      </section>
    </div>

    <EqPanel v-if="eqOpen" class="car-eq" @close="eqOpen = false" />
  </div>
</template>

<style scoped>
.car {
  position: absolute;
  inset: 0;
  display: flex;
  flex-direction: column;
  gap: 18px;
  padding: 32px 40px;
  color: #fbbf24;
  background: radial-gradient(1200px 600px at 20% -10%, #2a1f0a 0%, #0b0b10 60%);
  overflow: hidden;
}
.car-head {
  display: flex;
  align-items: baseline;
  gap: 16px;
  font-size: 20px;
  color: #9b9ba8;
}
.car-head .brand {
  font-weight: 600;
  color: #fbbf24;
}
.car-body {
  flex: 1;
  display: grid;
  grid-template-columns: minmax(0, 1fr) minmax(0, 2fr);
  gap: 32px;
  align-items: center;
}
.meta {
  min-width: 0;
}
.title {
  margin: 0 0 10px;
  font-size: 28px;
  font-weight: 700;
  line-height: 1.3;
  color: #fbbf24;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.artist {
  margin: 0 0 20px;
  font-size: 18px;
  color: #d8d8e2;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.bar {
  height: 6px;
  border-radius: 3px;
  background: #262633;
  overflow: hidden;
}
.bar i {
  display: block;
  height: 100%;
  background: #fbbf24;
  transition: width 0.2s linear;
}
.time {
  margin: 8px 0 0;
  font-size: 18px;
  color: #9b9ba8;
}
.ctrl {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 28px;
}
.sub {
  display: flex;
  justify-content: center;
  gap: 20px;
  grid-column: 1 / -1;
}
.btn {
  display: inline-flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 4px;
  width: 64px;
  height: 64px;
  border: 0;
  border-radius: 16px;
  color: #fbbf24;
  background: #13131b;
  font-size: 14px;
  cursor: pointer;
}
.btn.primary {
  width: 80px;
  height: 80px;
  border-radius: 50%;
  background: #fbbf24;
  color: #0b0b10;
}
.btn.small {
  width: auto;
  min-width: 64px;
  height: 56px;
  padding: 0 18px;
  flex-direction: row;
  gap: 8px;
  font-size: 16px;
  color: #d8d8e2;
}
.btn.small.on {
  color: #fbbf24;
}
.btn:active {
  transform: scale(0.96);
}
.car-eq {
  position: absolute;
  right: 32px;
  bottom: 24px;
  width: 380px;
}
</style>
