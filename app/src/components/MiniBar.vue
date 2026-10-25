<script setup lang="ts">
import { computed, ref } from 'vue'
import { useRouter } from 'vue-router'
import { formatTime } from '@shared/lrc'
import Icon from './Icon.vue'
import Cover from './Cover.vue'
import Slider from './Slider.vue'
import { usePlayerStore } from '@/stores/player'
import { useLibraryStore } from '@/stores/library'
import { useUiStore } from '@/stores/ui'

const router = useRouter()
const player = usePlayerStore()
const library = useLibraryStore()
const ui = useUiStore()

const volOpen = ref(false)
const qualityLabel = computed(() => {
  const q = player.state.quality
  return q === 'flac24bit' ? 'Hi-Res' : q === 'flac' ? '无损' : q === '320k' ? '320K' : '128K'
})

const liked = computed(() => (player.song ? library.isFavorite(player.song.id) : false))

function openPlayer(): void {
  router.push('/player')
}

function cycleQuality(): void {
  const order = ['128k', '320k', 'flac', 'flac24bit']
  const i = order.indexOf(player.state.quality)
  void player.setQuality(order[(i + 1) % order.length])
}

function onSeek(v: number): void {
  void player.seekTo(v)
}

function onVolume(v: number): void {
  void player.setVolume(v)
}

const modeIcon = computed(() => {
  const m = player.state.mode
  return m === 'repeat-one' ? 'repeat-one' : m === 'shuffle' ? 'shuffle' : 'repeat'
})

const volIcon = computed(() => {
  if (player.state.muted || player.state.volume === 0) return 'volume-mute'
  return player.state.volume < 0.45 ? 'volume-low' : 'volume'
})
</script>

<template>
  <footer class="minibar">
    <div class="left" :class="{ clickable: !!player.song }" @click="openPlayer">
      <Cover :src="player.coverUrl || player.song?.pic || ''" :alt="player.song?.name || '星河'" :size="52" :radius="10" cover="1" />
      <div class="meta">
        <div class="title ellipsis">{{ player.song?.name || '未在播放' }}</div>
        <div class="sub ellipsis">{{ player.song?.singer || '选一首歌，开始今天的星河' }}</div>
      </div>
      <button
        v-if="player.song"
        class="icon-btn heart"
        :class="{ liked }"
        :title="liked ? '取消喜欢' : '喜欢'"
        @click.stop="library.toggleFavorite(player.song)"
      >
        <Icon :name="liked ? 'heart-filled' : 'heart'" :size="17" />
      </button>
    </div>

    <div class="center">
      <div class="controls">
        <button class="icon-btn sm" :title="player.modeLabel" @click="player.cycleMode()">
          <Icon :name="modeIcon" :size="16" />
        </button>
        <button class="icon-btn sm" title="上一首" @click="player.prev()"><Icon name="prev" :size="18" /></button>
        <button class="play-btn" :disabled="!player.song && !player.state.queue.length" @click="player.toggle()">
          <Icon :name="player.playing ? 'pause' : 'play'" :size="20" />
        </button>
        <button class="icon-btn sm" title="下一首" @click="player.next()"><Icon name="next" :size="18" /></button>
        <button
          class="icon-btn sm"
          :class="{ active: player.state.status === 'error' }"
          :title="player.state.error || '播放状态正常'"
          @click="player.toggle()"
        >
          <Icon name="zap" :size="16" />
        </button>
      </div>

      <div class="progress-row">
        <span class="time mono">{{ formatTime(player.displayPosition) }}</span>
        <Slider
          class="progress"
          :model-value="player.displayPosition"
          :max="player.duration || 1"
          :step="0.5"
          :buffered="player.state.buffered"
          thin
          @change="onSeek"
        />
        <span class="time mono">{{ formatTime(player.duration) }}</span>
      </div>
    </div>

    <div class="right">
      <button class="quality" :title="'音质：' + qualityLabel" @click="cycleQuality">{{ qualityLabel }}</button>

      <div class="volume" @mouseenter="volOpen = true" @mouseleave="volOpen = false">
        <button class="icon-btn sm" :title="player.state.muted ? '取消静音' : '静音'" @click="player.toggleMute()">
          <Icon :name="volIcon" :size="17" />
        </button>
        <div class="vol-slider" :class="{ open: volOpen }">
          <Slider
            :model-value="player.state.muted ? 0 : player.state.volume"
            :max="1"
            :step="0.01"
            thin
            @update:model-value="onVolume"
          />
          <span class="vol-num">{{ Math.round((player.state.muted ? 0 : player.state.volume) * 100) }}</span>
        </div>
      </div>

      <button class="icon-btn sm" :class="{ active: player.queueOpen }" title="播放队列" @click="player.queueOpen = !player.queueOpen">
        <Icon name="queue" :size="17" />
      </button>
      <button
        class="icon-btn sm"
        :class="{ active: ui.settings.showDesktopLyric }"
        title="桌面歌词"
        @click="ui.patch({ showDesktopLyric: !ui.settings.showDesktopLyric })"
      >
        <Icon name="lyric" :size="17" />
      </button>
      <button class="icon-btn sm" title="打开播放页" @click="openPlayer"><Icon name="expand" :size="16" /></button>
    </div>
  </footer>
</template>

<style scoped>
.minibar {
  height: var(--minibar-h);
  flex: none;
  display: grid;
  grid-template-columns: minmax(220px, 1fr) minmax(340px, 1.4fr) minmax(220px, 1fr);
  align-items: center;
  gap: 18px;
  padding: 0 20px;
  background: var(--bg-2);
  border-top: 1px solid var(--line);
  position: relative;
  z-index: 6;
}
.left {
  display: flex;
  align-items: center;
  gap: 11px;
  min-width: 0;
}
.left.clickable {
  cursor: pointer;
}
.left.clickable:hover .title {
  color: var(--accent);
}
.meta {
  min-width: 0;
  flex: 1;
}
.title {
  font-size: 13px;
  font-weight: 550;
  transition: color 0.16s;
}
.sub {
  font-size: 11.5px;
  color: var(--text-3);
  margin-top: 2px;
}
.heart.liked {
  color: var(--accent);
}
.center {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 2px;
}
.controls {
  display: flex;
  align-items: center;
  gap: 6px;
}
.icon-btn.sm {
  width: 30px;
  height: 30px;
  border-radius: 8px;
}
.play-btn {
  width: 40px;
  height: 40px;
  border-radius: 50%;
  display: flex;
  align-items: center;
  justify-content: center;
  background: linear-gradient(135deg, var(--accent), var(--accent-2));
  color: #fff;
  margin: 0 4px;
  box-shadow: 0 6px 16px -6px var(--accent);
  transition: transform 0.16s, filter 0.16s;
}
.play-btn:hover {
  filter: brightness(1.08);
}
.play-btn:active {
  transform: scale(0.94);
}
.play-btn:disabled {
  opacity: 0.45;
  cursor: not-allowed;
}
.progress-row {
  display: flex;
  align-items: center;
  gap: 9px;
  width: 100%;
}
.progress {
  flex: 1;
}
.time {
  font-size: 10.5px;
  color: var(--text-3);
  min-width: 34px;
  text-align: center;
}
.right {
  display: flex;
  align-items: center;
  justify-content: flex-end;
  gap: 2px;
}
.quality {
  height: 22px;
  padding: 0 8px;
  border-radius: 6px;
  border: 1px solid var(--line-2);
  font-size: 10px;
  font-weight: 600;
  letter-spacing: 0.4px;
  color: var(--text-2);
  margin-right: 4px;
}
.quality:hover {
  color: var(--accent);
  border-color: var(--accent);
}
.volume {
  display: flex;
  align-items: center;
}
/* 音量条悬停面板：底栏背景与滑轨同为深色时，细轨几乎不可见，故加浮层底板 + 百分比读数 */
.vol-slider {
  width: 0;
  overflow: hidden;
  transition: width 0.2s var(--ease), margin 0.2s;
  display: flex;
  align-items: center;
}
.vol-slider.open {
  width: auto;
  margin-right: 4px;
  padding: 4px 9px 4px 9px;
  gap: 8px;
  background: var(--panel-2);
  border: 1px solid var(--line-2);
  border-radius: 8px;
  box-shadow: 0 6px 18px -8px rgba(0, 0, 0, 0.55);
}
.vol-slider .slider {
  width: 78px;
}
.vol-num {
  min-width: 26px;
  font-size: 10.5px;
  font-weight: 600;
  color: var(--text-2);
  text-align: right;
}
@media (max-width: 1200px) {
  .minibar {
    grid-template-columns: minmax(180px, 0.9fr) minmax(320px, 1.5fr) minmax(160px, 0.8fr);
    gap: 12px;
    padding: 0 14px;
  }
  .quality {
    display: none;
  }
}
</style>
