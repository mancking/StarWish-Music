<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { findLyricIndex } from '@shared/lrc'
import Icon from '@/components/Icon.vue'
import { usePlayerStore } from '@/stores/player'
import { useUiStore } from '@/stores/ui'

/**
 * 桌面歌词悬浮窗。
 *
 * 定尺 400×60、底部居中、置顶、可拖动、位置由主进程持久化。
 * 版式只有两行：当前行 16px 白色居中 + 下一行 12px #63636F。
 * 明确不做字号/大小/双行滚动设置项——按钮只有锁定与关闭。
 */

const player = usePlayerStore()
const ui = useUiStore()
const hover = ref(false)

const offset = computed(() => (ui.settings.lyricOffset || 0) / 1000)
const lines = computed(() => player.lyric?.lines || [])
const idx = computed(() => findLyricIndex(lines.value, player.displayPosition + offset.value))
const current = computed(() => (idx.value >= 0 ? lines.value[idx.value] : null))
const next = computed(() => (idx.value >= 0 ? lines.value[idx.value + 1] : lines.value[0]))

const curText = computed(() => {
  if (current.value) return current.value.text || '♪'
  return player.song ? `${player.song.name} · 纯音乐` : '星河音乐 · 等待播放'
})
const nextText = computed(() => next.value?.text || '')

async function toggleLock(): Promise<void> {
  await ui.patch({ desktopLyricLock: !ui.settings.desktopLyricLock })
}

async function closeWin(): Promise<void> {
  await ui.patch({ showDesktopLyric: false })
}

onMounted(() => {
  document.body.classList.add('lyric-window')
})
</script>

<template>
  <div
    class="lw"
    :class="{ locked: ui.settings.desktopLyricLock }"
    @mouseenter="hover = true"
    @mouseleave="hover = false"
  >
    <div class="lines drag">
      <div class="cur" :class="{ dim: !current }">{{ curText }}</div>
      <div v-if="nextText" class="next">{{ nextText }}</div>
    </div>

    <div class="acts no-drag" :class="{ show: hover }">
      <button class="mini" :title="ui.settings.desktopLyricLock ? '解锁（可拖动）' : '锁定（鼠标穿透）'" @click="toggleLock">
        <Icon :name="ui.settings.desktopLyricLock ? 'lock' : 'shrink'" :size="12" />
      </button>
      <button class="mini" title="关闭桌面歌词" @click="closeWin"><Icon name="close" :size="12" /></button>
    </div>
  </div>
</template>

<style scoped>
.lw {
  position: relative;
  width: 100%;
  height: 100vh;
  box-sizing: border-box;
  display: flex;
  flex-direction: column;
  justify-content: center;
  gap: 2px;
  padding: 0 16px;
  background: rgba(11, 11, 16, 0.55);
  border: 1px solid rgba(255, 255, 255, 0.08);
  border-radius: 12px;
  backdrop-filter: blur(14px);
  overflow: hidden;
  cursor: move;
}
.lw.locked {
  background: transparent;
  border-color: transparent;
  backdrop-filter: none;
  cursor: default;
}
.lines {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 1px;
  min-width: 0;
}
.cur {
  max-width: 100%;
  font-size: 16px;
  line-height: 1.25;
  font-weight: 600;
  color: #ffffff;
  text-align: center;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  text-shadow: 0 1px 6px rgba(0, 0, 0, 0.65);
}
.cur.dim {
  color: rgba(255, 255, 255, 0.55);
  font-weight: 500;
}
.next {
  max-width: 100%;
  font-size: 12px;
  line-height: 1.3;
  color: #63636f;
  text-align: center;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.acts {
  position: absolute;
  top: 4px;
  right: 6px;
  display: flex;
  gap: 4px;
  opacity: 0;
  transition: opacity 0.16s;
}
.acts.show {
  opacity: 1;
}
.mini {
  width: 20px;
  height: 20px;
  display: grid;
  place-items: center;
  border: 0;
  border-radius: 6px;
  background: rgba(255, 255, 255, 0.1);
  color: rgba(255, 255, 255, 0.78);
  cursor: pointer;
}
.mini:hover {
  background: rgba(255, 255, 255, 0.22);
  color: #fff;
}
</style>
