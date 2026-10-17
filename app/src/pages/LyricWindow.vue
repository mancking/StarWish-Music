<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { findLyricIndex } from '@shared/lrc'
import Icon from '@/components/Icon.vue'
import { usePlayerStore } from '@/stores/player'
import { useUiStore } from '@/stores/ui'

const player = usePlayerStore()
const ui = useUiStore()
const hover = ref(false)

const offset = computed(() => (ui.settings.lyricOffset || 0) / 1000)
const lines = computed(() => player.lyric?.lines || [])
const idx = computed(() => findLyricIndex(lines.value, player.displayPosition + offset.value))
const current = computed(() => (idx.value >= 0 ? lines.value[idx.value] : null))
const next = computed(() => (idx.value >= 0 ? lines.value[idx.value + 1] : lines.value[0]))

const title = computed(() => player.song?.name || '星河音乐')
const sub = computed(() => player.song?.singer || '')

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
  <div class="lyric-win" :class="{ locked: ui.settings.desktopLyricLock }" @mouseenter="hover = true" @mouseleave="hover = false">
    <div class="bar drag">
      <div class="info">
        <span class="t">{{ title }}</span>
        <span v-if="sub" class="s">— {{ sub }}</span>
      </div>
      <div class="acts no-drag" :class="{ show: hover }">
        <button class="mini" :title="ui.settings.desktopLyricLock ? '解锁（可拖动）' : '锁定（鼠标穿透）'" @click="toggleLock">
          <Icon :name="ui.settings.desktopLyricLock ? 'lock' : 'shrink'" :size="13" />
        </button>
        <button class="mini" title="关闭桌面歌词" @click="closeWin"><Icon name="close" :size="13" /></button>
      </div>
    </div>

    <div class="text drag">
      <div v-if="current" class="cur">
        {{ current.text || '♪' }}
      </div>
      <div v-else class="cur dim">{{ player.song ? `${player.song.name} · 纯音乐` : '星河音乐 · 等待播放' }}</div>
      <div v-if="current?.trans" class="trans">{{ current.trans }}</div>
      <div v-else-if="next && !current?.trans" class="next">{{ next.text }}</div>
    </div>
  </div>
</template>

<style scoped>
.lyric-win {
  height: 100vh;
  display: flex;
  flex-direction: column;
  justify-content: center;
  padding: 10px 22px;
  background: linear-gradient(180deg, rgba(12, 12, 20, 0.55), rgba(12, 12, 20, 0.35));
  border-radius: 14px;
  border: 1px solid rgba(255, 255, 255, 0.1);
  backdrop-filter: blur(18px);
  color: #fff;
  overflow: hidden;
  box-sizing: border-box;
}
.lyric-win.locked {
  background: transparent;
  border-color: transparent;
  backdrop-filter: none;
}
.bar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  opacity: 0.7;
}
.info {
  display: flex;
  align-items: baseline;
  gap: 6px;
  min-width: 0;
}
.t {
  font-size: 11px;
  color: rgba(255, 255, 255, 0.75);
}
.s {
  font-size: 10px;
  color: rgba(255, 255, 255, 0.42);
}
.acts {
  display: flex;
  gap: 4px;
  opacity: 0;
  transition: opacity 0.18s;
}
.acts.show {
  opacity: 1;
}
.mini {
  width: 22px;
  height: 22px;
  border-radius: 6px;
  display: flex;
  align-items: center;
  justify-content: center;
  color: rgba(255, 255, 255, 0.75);
  background: rgba(255, 255, 255, 0.1);
}
.mini:hover {
  background: rgba(255, 255, 255, 0.22);
  color: #fff;
}
.text {
  margin-top: 6px;
  text-align: center;
}
.cur {
  font-size: 30px;
  font-weight: 700;
  line-height: 1.35;
  letter-spacing: 0.5px;
  text-shadow: 0 2px 10px rgba(0, 0, 0, 0.75), 0 0 26px rgba(0, 0, 0, 0.5);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.cur.dim {
  color: rgba(255, 255, 255, 0.5);
  font-weight: 500;
  font-size: 22px;
}
.trans {
  margin-top: 2px;
  font-size: 15px;
  color: rgba(255, 255, 255, 0.66);
  text-shadow: 0 2px 8px rgba(0, 0, 0, 0.7);
}
.next {
  margin-top: 2px;
  font-size: 13px;
  color: rgba(255, 255, 255, 0.34);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
</style>
