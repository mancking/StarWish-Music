<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import Icon from '@/components/Icon.vue'
import { usePlayerStore } from '@/stores/player'
import { call } from '@/api'

/**
 * MINI 模式悬浮窗
 *
 * 贴边常驻迷你条：封面 44 + 歌名/歌手 + 播放/暂停 + 下一首 + 关闭；
 * 贴近屏幕边缘 5s 无操作由主进程自动缩为高 28px 边条，鼠标悬停 300ms 呼出。
 * 窗口拖动 = 整窗拖拽（-webkit-app-region: drag）。
 */
const player = usePlayerStore()
const hoverTimer = ref(0)

const song = computed(() => player.song)

function hoverPing(): void {
 // 悬停呼出：300ms 后通知主进程恢复展开态
  window.clearTimeout(hoverTimer.value)
  hoverTimer.value = window.setTimeout(() => {
    void call('mini:expand').catch(() => undefined)
  }, 300)
}

function closeWin(): void {
  void call('mini:close').catch(() => undefined)
}

onMounted(() => {
  document.body.classList.add('mini-window')
})
onBeforeUnmount(() => window.clearTimeout(hoverTimer.value))
</script>

<template>
  <div class="miniwin" @mouseenter="hoverPing">
    <img v-if="player.coverUrl" class="cover drag" :src="player.coverUrl" alt="" />
    <div v-else class="cover drag placeholder">♪</div>
    <div class="meta drag">
      <b>{{ song?.name || '星河音乐' }}</b>
      <span>{{ song?.singer || '等待播放' }}</span>
    </div>
    <div class="acts no-drag">
      <button class="btn" :aria-label="player.playing ? '暂停' : '播放'" @click="player.toggle()">
        <Icon :name="player.playing ? 'pause' : 'play'" :size="16" />
      </button>
      <button class="btn" aria-label="下一首" @click="player.next()">
        <Icon name="next" :size="15" />
      </button>
      <button class="btn" aria-label="关闭迷你模式" @click="closeWin">
        <Icon name="close" :size="13" />
      </button>
    </div>
    <!-- 迷你进度线 -->
    <div class="pos" :style="{ width: `${player.duration ? (player.displayPosition / player.duration) * 100 : 0}%` }" />
  </div>
</template>

<style scoped>
.miniwin {
  position: relative;
  width: 100vw;
  height: 100vh;
  box-sizing: border-box;
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 0 12px;
  background: rgba(11, 11, 16, 0.92);
  border: 1px solid rgba(255, 255, 255, 0.1);
  border-radius: 14px;
  overflow: hidden;
  color: #ececf1;
}
.drag {
  -webkit-app-region: drag;
}
.no-drag {
  -webkit-app-region: no-drag;
}
.cover {
  width: 44px;
  height: 44px;
  border-radius: 8px;
  object-fit: cover;
  flex: none;
  background: #13131b;
}
.cover.placeholder {
  display: grid;
  place-items: center;
  color: #a78bfa;
  font-size: 18px;
}
.meta {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 1px;
}
.meta b {
  font-size: 13px;
  font-weight: 600;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.meta span {
  font-size: 11px;
  color: #9b9ba8;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.acts {
  display: flex;
  align-items: center;
  gap: 4px;
  flex: none;
}
.btn {
  width: 30px;
  height: 30px;
  display: grid;
  place-items: center;
  border: 0;
  border-radius: 50%;
  background: transparent;
  color: #ececf1;
  cursor: pointer;
}
.btn:hover {
  background: rgba(255, 255, 255, 0.12);
}
.pos {
  position: absolute;
  left: 0;
  bottom: 0;
  height: 2px;
  background: linear-gradient(90deg, #a78bfa, #f472b6);
  pointer-events: none;
}
</style>
