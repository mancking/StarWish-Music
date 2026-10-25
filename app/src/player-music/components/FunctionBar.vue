<script setup lang="ts">
/**
 * 功能行
 *
 * 移动端 = 底部四等分：音效 / 倍速 / 背景（playerBg 模式，长按弹面板）/ 定时；
 * 图标 22px + 文字 11px。MV 按钮按 2.18 显示条件渲染为第五项（不破坏四等分时
 * 以紧凑行展示）。桌面 = 紧凑文字按钮。车机不渲染本组件。
 */
import Icon from '@/components/Icon.vue'

withDefaults(
  defineProps<{
    rate: number
    bgLabel: string
    bgIcon: string
    bgActive?: boolean
    eqActive?: boolean
    sleepOn?: boolean
    /** 规格 2.18：当前歌曲存在 MV 时显示 MV 按钮（车机不渲染） */
    mvOn?: boolean
    variant?: 'phone' | 'pad' | 'desktop' | 'car'
  }>(),
  { bgActive: false, eqActive: false, sleepOn: false, mvOn: false, variant: 'phone' }
)

const emit = defineEmits<{
  (e: 'eq'): void
  (e: 'rate'): void
  /** 点按 = 循环切换背景模式；长按 = 弹模式面板（3.14 切换入口） */
  (e: 'bg'): void
  (e: 'bg-panel'): void
  (e: 'sleep'): void
  (e: 'mv'): void
}>()

function onBgPress(): void {
  pressTimer = window.setTimeout(() => {
    longPressed = true
    emit('bg-panel')
  }, 450)
}
function onBgRelease(): void {
  window.clearTimeout(pressTimer)
  if (!longPressed) emit('bg')
  longPressed = false
}
let pressTimer = 0
let longPressed = false
</script>

<template>
  <div v-if="variant !== 'car'" class="func" :class="`is-${variant}`">
    <button class="item" :class="{ on: eqActive }" @click="emit('eq')">
      <Icon name="sliders" :size="variant === 'desktop' ? 15 : 22" />
      <span>音效</span>
    </button>
    <button class="item" @click="emit('rate')">
      <Icon name="gauge" :size="variant === 'desktop' ? 15 : 22" />
      <span>{{ rate }}×</span>
    </button>
    <button
      class="item"
      :class="{ on: bgActive }"
      @pointerdown.prevent="onBgPress"
      @pointerup.prevent="onBgRelease"
      @pointercancel="onBgRelease"
    >
      <Icon :name="bgIcon" :size="variant === 'desktop' ? 15 : 22" />
      <span>{{ bgLabel }}</span>
    </button>
    <button class="item" :class="{ on: sleepOn }" @click="emit('sleep')">
      <Icon name="clock" :size="variant === 'desktop' ? 15 : 22" />
      <span>定时</span>
    </button>
    <button v-if="mvOn" class="item mv" @click="emit('mv')">
      <Icon name="video" :size="variant === 'desktop' ? 15 : 22" />
      <span>MV</span>
    </button>
  </div>
</template>

<style scoped>
.func {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
}
.item {
  flex: 1;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 6px;
  padding: 8px 4px;
  border: 0;
  border-radius: 12px;
  background: transparent;
  color: #9b9ba8;
  font-size: 11px;
  cursor: pointer;
  transition: color 140ms ease, background 140ms ease;
  -webkit-tap-highlight-color: transparent;
  touch-action: manipulation;
}
.item:hover {
  background: rgba(255, 255, 255, 0.06);
}
.item.on {
  color: #a78bfa;
}
.item.mv {
  color: #f472b6;
}
.is-desktop {
  justify-content: center;
  gap: 8px;
}
.is-desktop .item {
  flex: none;
  flex-direction: row;
  gap: 6px;
  padding: 6px 10px;
  font-size: 12px;
}
.is-desktop .item.mv {
  color: #f472b6;
}
</style>
