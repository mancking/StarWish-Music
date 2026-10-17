<script setup lang="ts">
import { computed, ref } from 'vue'
import { formatTime } from '@shared/lrc'
import Icon from './Icon.vue'
import Cover from './Cover.vue'
import { usePlayerStore } from '@/stores/player'

withDefaults(defineProps<{ bottom?: number }>(), { bottom: 92 })

const player = usePlayerStore()
const dragFrom = ref(-1)
const dragOver = ref(-1)

const queue = computed(() => player.state.queue)

function playAt(i: number): void {
  void player.playAt(i)
}

function onDragStart(e: DragEvent, i: number): void {
  dragFrom.value = i
  e.dataTransfer?.setData('text/plain', String(i))
  if (e.dataTransfer) e.dataTransfer.effectAllowed = 'move'
}

function onDragOver(e: DragEvent, i: number): void {
  e.preventDefault()
  dragOver.value = i
}

function onDrop(i: number): void {
  if (dragFrom.value >= 0 && dragFrom.value !== i) void player.move(dragFrom.value, i)
  dragFrom.value = -1
  dragOver.value = -1
}
</script>

<template>
  <Transition name="queue">
    <div v-if="player.queueOpen" class="queue-wrap" :style="{ bottom: bottom + 'px' }">
      <div class="mask" @click="player.queueOpen = false" />
      <aside class="queue">
        <header>
          <div>
            <h3>播放队列</h3>
            <span class="count">{{ queue.length }} 首</span>
          </div>
          <div class="head-actions">
            <button class="btn sm ghost" @click="player.clearQueue()">清空</button>
            <button class="icon-btn" @click="player.queueOpen = false"><Icon name="close" :size="17" /></button>
          </div>
        </header>

        <div class="list">
          <div
            v-for="(s, i) in queue"
            :key="s.id + i"
            class="q-row"
            :class="{ active: i === player.state.index, over: dragOver === i }"
            draggable="true"
            @click="playAt(i)"
            @dragstart="onDragStart($event, i)"
            @dragover="onDragOver($event, i)"
            @dragleave="dragOver = -1"
            @drop="onDrop(i)"
          >
            <span class="drag-handle"><Icon name="drag" :size="14" /></span>
            <Cover :src="s.pic" :alt="s.name" :size="34" :radius="7" />
            <div class="q-meta">
              <div class="q-name ellipsis">{{ s.name }}</div>
              <div class="q-sub ellipsis">{{ s.singer }}</div>
            </div>
            <span class="q-dur mono">{{ formatTime(s.duration) }}</span>
            <button class="icon-btn tiny" title="移除" @click.stop="player.removeAt(i)">
              <Icon name="close" :size="14" />
            </button>
          </div>

          <div v-if="!queue.length" class="empty">
            <Icon name="queue" :size="30" :stroke="1.3" />
            <div class="empty-title">队列是空的</div>
            <div class="empty-desc">播放任意歌曲后，队列会显示在这里</div>
          </div>
        </div>

        <footer class="q-foot">
          <Icon name="info" :size="13" />
          <span>拖拽可调整顺序，点击立即播放</span>
        </footer>
      </aside>
    </div>
  </Transition>
</template>

<style scoped>
.queue-wrap {
  position: fixed;
  inset: 0 0 0 0;
  z-index: 40;
  pointer-events: none;
}
.mask {
  position: absolute;
  inset: 0;
  background: rgba(0, 0, 0, 0.28);
  pointer-events: auto;
}
.queue {
  position: absolute;
  top: 0;
  right: 0;
  bottom: 0;
  width: 388px;
  max-width: 46vw;
  background: var(--bg-2);
  border-left: 1px solid var(--line);
  box-shadow: -20px 0 50px rgba(0, 0, 0, 0.28);
  display: flex;
  flex-direction: column;
  pointer-events: auto;
}
header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 18px 18px 12px;
}
header h3 {
  font-size: 15px;
  font-weight: 600;
}
.count {
  font-size: 11px;
  color: var(--text-3);
}
.head-actions {
  display: flex;
  align-items: center;
  gap: 6px;
}
.list {
  flex: 1;
  overflow-y: auto;
  padding: 0 10px 10px;
}
.q-row {
  display: flex;
  align-items: center;
  gap: 9px;
  padding: 6px 8px;
  border-radius: 9px;
  cursor: default;
  border: 1px solid transparent;
}
.q-row:hover {
  background: var(--hover);
}
.q-row.active {
  background: var(--accent-soft);
}
.q-row.active .q-name {
  color: var(--accent);
}
.q-row.over {
  border-color: var(--accent);
}
.drag-handle {
  color: var(--text-3);
  opacity: 0;
  cursor: grab;
  display: flex;
}
.q-row:hover .drag-handle {
  opacity: 1;
}
.q-meta {
  flex: 1;
  min-width: 0;
}
.q-name {
  font-size: 12.5px;
}
.q-sub {
  font-size: 11px;
  color: var(--text-3);
}
.q-dur {
  font-size: 10.5px;
  color: var(--text-3);
}
.icon-btn.tiny {
  width: 24px;
  height: 24px;
  opacity: 0;
}
.q-row:hover .icon-btn.tiny {
  opacity: 1;
}
.q-foot {
  flex: none;
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 10px 18px;
  font-size: 11px;
  color: var(--text-3);
  border-top: 1px solid var(--line);
}
.queue-enter-active,
.queue-leave-active {
  transition: opacity 0.22s var(--ease);
}
.queue-enter-active .queue,
.queue-leave-active .queue {
  transition: transform 0.26s var(--ease);
}
.queue-enter-from,
.queue-leave-to {
  opacity: 0;
}
.queue-enter-from .queue,
.queue-leave-to .queue {
  transform: translateX(30px);
}
</style>
