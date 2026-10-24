<script setup lang="ts">
/**
 * 主控栏（规格书 1.1 / 3.0 按钮尺寸：手机 44、平板 48、桌面 36、车机 56+）
 *
 * 车机形态只有「上一首 / 播放 / 下一首」三个大按钮，隐藏循环与队列。
 */
import Icon from '@/components/Icon.vue'

withDefaults(
  defineProps<{
    playing: boolean
    variant?: 'phone' | 'pad' | 'desktop' | 'car'
    modeLabel?: string
    modeIcon?: string
  }>(),
  { variant: 'phone', modeLabel: '列表循环', modeIcon: 'repeat' }
)

const emit = defineEmits<{
  (e: 'prev'): void
  (e: 'next'): void
  (e: 'toggle'): void
  (e: 'cycle-mode'): void
  (e: 'queue'): void
}>()
</script>

<template>
  <div class="transport" :class="`is-${variant}`">
    <button
      v-if="variant !== 'car'"
      class="btn ghost"
      :title="modeLabel"
      :aria-label="modeLabel"
      @click="emit('cycle-mode')"
    >
      <Icon :name="modeIcon" :size="variant === 'desktop' ? 17 : 20" />
    </button>
    <button class="btn" aria-label="上一首" @click="emit('prev')">
      <Icon name="prev" :size="variant === 'car' ? 30 : variant === 'pad' ? 26 : 22" />
    </button>
    <button class="btn main" :aria-label="playing ? '暂停' : '播放'" @click="emit('toggle')">
      <Icon :name="playing ? 'pause' : 'play'" :size="variant === 'car' ? 34 : variant === 'pad' ? 30 : 26" />
    </button>
    <button class="btn" aria-label="下一首" @click="emit('next')">
      <Icon name="next" :size="variant === 'car' ? 30 : variant === 'pad' ? 26 : 22" />
    </button>
    <button
      v-if="variant !== 'car'"
      class="btn ghost"
      aria-label="播放队列"
      @click="emit('queue')"
    >
      <Icon name="queue" :size="variant === 'desktop' ? 17 : 20" />
    </button>
  </div>
</template>

<style scoped>
.transport {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 18px;
}
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
.is-car {
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
