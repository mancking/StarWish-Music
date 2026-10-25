<script setup lang="ts">
/**
 * 主控栏
 *
 * 移动端：prev 44 / play 56 / next 44 / 列表 / 更多（循环模式入口收进「更多」菜单）；
 * 桌面：循环 / 上一首 / 播放 / 下一首 / 队列；
 * 车机：三个大按钮（上一首 / 播放 80 / 下一首），隐藏循环与队列。
 */
import Icon from '@/components/Icon.vue'

withDefaults(
  defineProps<{
    playing: boolean
    variant?: 'phone' | 'pad' | 'desktop' | 'car'
    modeLabel?: string
    modeIcon?: string
    /** 移动端「更多」入口移到顶栏时关掉本栏的更多按钮 */
    showMore?: boolean
  }>(),
  { variant: 'phone', modeLabel: '列表循环', modeIcon: 'repeat', showMore: true }
)

const emit = defineEmits<{
  (e: 'prev'): void
  (e: 'next'): void
  (e: 'toggle'): void
  (e: 'cycle-mode'): void
  (e: 'queue'): void
  (e: 'more'): void
}>()
</script>

<template>
  <div class="transport" :class="`is-${variant}`">
    <template v-if="variant === 'desktop'">
      <div class="desktop-side">
        <button class="btn ghost" :title="modeLabel" :aria-label="modeLabel" @click="emit('cycle-mode')">
          <Icon :name="modeIcon" :size="17" />
        </button>
      </div>
      <div class="core-controls">
        <slot name="prepend" />
        <button class="btn" aria-label="上一首" @click="emit('prev')">
          <Icon name="prev" :size="22" />
        </button>
        <button class="btn main" :aria-label="playing ? '暂停' : '播放'" @click="emit('toggle')">
          <Icon :name="playing ? 'pause' : 'play'" :size="26" />
        </button>
        <button class="btn" aria-label="下一首" @click="emit('next')">
          <Icon name="next" :size="22" />
        </button>
      </div>
      <div class="desktop-side">
        <button class="btn ghost" aria-label="播放队列" @click="emit('queue')">
          <Icon name="queue" :size="17" />
        </button>
      </div>
    </template>
    <template v-else-if="variant === 'phone' || variant === 'pad'">
      <div class="core-controls">
        <button class="btn ghost" :title="modeLabel" :aria-label="modeLabel" @click="emit('cycle-mode')">
          <Icon :name="modeIcon" :size="variant === 'pad' ? 22 : 20" />
        </button>
        <button class="btn" aria-label="上一首" @click="emit('prev')">
          <Icon name="prev" :size="variant === 'pad' ? 26 : 22" />
        </button>
        <button class="btn main" :aria-label="playing ? '暂停' : '播放'" @click="emit('toggle')">
          <Icon :name="playing ? 'pause' : 'play'" :size="variant === 'pad' ? 30 : 26" />
        </button>
        <button class="btn" aria-label="下一首" @click="emit('next')">
          <Icon name="next" :size="variant === 'pad' ? 26 : 22" />
        </button>
      </div>
      <div class="mobile-side">
        <button class="btn ghost" aria-label="播放队列" @click="emit('queue')">
          <Icon name="queue" :size="variant === 'pad' ? 22 : 20" />
        </button>
      </div>
    </template>
    <template v-else>
      <!-- car variant: big buttons centered -->
      <div class="car-inner">
        <button class="btn" aria-label="上一首" @click="emit('prev')">
          <Icon name="prev" :size="30" />
        </button>
        <button class="btn main" :aria-label="playing ? '暂停' : '播放'" @click="emit('toggle')">
          <Icon :name="playing ? 'pause' : 'play'" :size="34" />
        </button>
        <button class="btn" aria-label="下一首" @click="emit('next')">
          <Icon name="next" :size="30" />
        </button>
      </div>
    </template>
  </div>
</template>

<style scoped>
.transport {
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto minmax(0, 1fr);
  align-items: center;
  gap: 18px;
}
/* 主键组始终落在整栏的几何中心：
   两侧容器等宽（1fr / 1fr），中间的上一首-播放-下一首因此与整栏中线对齐，
   收藏等 prepend 内容只挤占中心组自身宽度，不把播放键推向一侧。 */
.core-controls {
  grid-column: 2;
  grid-row: 1;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 18px;
}
.desktop-side { grid-row: 1; display: flex; align-items: center; }
.desktop-side:first-child { grid-column: 1; justify-content: flex-start; }
.desktop-side:last-child { grid-column: 3; justify-content: flex-end; }
.mobile-side { grid-column: 3; grid-row: 1; display: flex; align-items: center; justify-content: flex-end; }
.btn {
  display: grid;
  place-items: center;
  border: 0;
  background: transparent;
  color: #ececf1;
  border-radius: 50%;
  width: 44px;
  height: 44px;
  cursor: pointer;
  transition: transform 140ms ease, background 140ms ease, color 140ms ease;
  -webkit-tap-highlight-color: transparent;
}
.btn:hover {
  background: rgba(255, 255, 255, 0.08);
}
.btn:active {
  transform: scale(0.94);
}
.btn.ghost {
  color: #9b9ba8;
}
.btn.main {
  width: 56px;
  height: 56px;
  background: linear-gradient(135deg, #a78bfa, #f472b6);
  color: #0b0b10;
  box-shadow: 0 12px 28px -14px rgba(167, 139, 250, 0.9);
}
.is-phone .core-controls, .is-pad .core-controls { gap: 14px; }
.is-pad .btn {
  width: 48px;
  height: 48px;
}
.is-pad .btn.main {
  width: 62px;
  height: 62px;
}
.is-desktop .btn {
  width: 36px;
  height: 36px;
}
.is-desktop .btn:hover {
  transform: scale(1.08);
}
.is-desktop .btn.main {
  width: 48px;
  height: 48px;
}
/* 车机视图：大按钮横向分布，无左右侧栏 */
.is-car {
  display: flex;
  align-items: center;
  justify-content: center;
}
.car-inner {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 26px;
}
.is-car .btn {
  width: 56px;
  height: 56px;
  color: #fbbf24;
}
.is-car .btn.main {
  width: 80px;
  height: 80px;
  background: #fbbf24;
  color: #0b0b10;
  box-shadow: none;
}
</style>
