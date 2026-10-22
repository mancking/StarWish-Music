<script setup lang="ts">
import { computed } from 'vue'
import { findLyricIndex } from '@shared/lrc'
import { usePlayerStore } from '@/stores/player'
import { useUiStore } from '@/stores/ui'

/**
 * 任务栏 / 菜单栏歌词（单行）。
 *
 * 独立 BrowserWindow：透明、置顶、鼠标穿透，贴在屏幕工作区底部（Windows/Linux）
 * 或顶部（macOS）。与桌面歌词的区别是不占地方、只显示当前一句。
 */

const player = usePlayerStore()
const ui = useUiStore()

const text = computed(() => {
  const lines = player.lyric?.lines || []
  if (!lines.length) return player.song?.name || ''
  const idx = findLyricIndex(lines, player.displayPosition + (ui.settings.lyricOffset || 0) / 1000)
  return idx >= 0 ? lines[idx].text : ''
})
</script>

<template>
  <div class="tb">
    <span class="dot" :class="{ on: player.playing }" />
    <span class="txt">{{ text || '星河音乐' }}</span>
  </div>
</template>

<style scoped>
.tb {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
  height: 100%;
  padding: 0 14px;
  font-size: 13px;
  color: #e8ecf6;
  text-shadow: 0 1px 3px rgba(0, 0, 0, 0.85);
  background: transparent;
  overflow: hidden;
}
.dot {
  flex: none;
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: rgba(255, 255, 255, 0.35);
}
.dot.on {
  background: var(--accent);
  box-shadow: 0 0 8px var(--accent);
}
.txt {
  max-width: 100%;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
</style>
