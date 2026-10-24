<script setup lang="ts">
/**
 * 功能行（规格书 1.4 视觉四态 / 1.11 EQ 入口 / 2.7 倍速 / 定时）
 *
 * 手机与平板是四等分图标按钮；桌面是紧凑文字按钮；车机不渲染本组件。
 */
import Icon from '@/components/Icon.vue'

withDefaults(
  defineProps<{
    rate: number
    stageLabel: string
    stageIcon: string
    stageActive?: boolean
    eqActive?: boolean
    sleepOn?: boolean
    /** 规格 2.18：当前歌曲存在 MV 时显示 MV 按钮（车机不渲染） */
    mvOn?: boolean
    variant?: 'phone' | 'pad' | 'desktop' | 'car'
  }>(),
  { stageActive: false, eqActive: false, sleepOn: false, mvOn: false, variant: 'phone' }
)

const emit = defineEmits<{
  (e: 'eq'): void
  (e: 'rate'): void
  (e: 'visual'): void
  (e: 'sleep'): void
  (e: 'mv'): void
}>()
</script>

<template>
  <div v-if="variant !== 'car'" class="func" :class="`is-${variant}`">
    <button v-if="mvOn" class="item" @click="emit('mv')">
      <Icon name="video" :size="variant === 'desktop' ? 15 : 18" />
      <span>MV</span>
    </button>
    <button class="item" :class="{ on: eqActive }" @click="emit('eq')">
      <Icon name="sliders" :size="variant === 'desktop' ? 15 : 18" />
      <span>音效</span>
    </button>
    <button class="item" @click="emit('rate')">
      <Icon name="gauge" :size="variant === 'desktop' ? 15 : 18" />
      <span>{{ rate }}×</span>
    </button>
    <button class="item" :class="{ on: stageActive }" @click="emit('visual')">
      <Icon :name="stageIcon" :size="variant === 'desktop' ? 15 : 18" />
      <span>{{ stageLabel }}</span>
    </button>
    <button class="item" :class="{ on: sleepOn }" @click="emit('sleep')">
      <Icon name="clock" :size="variant === 'desktop' ? 15 : 18" />
      <span>定时</span>
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
}
.item:hover {
  background: rgba(255, 255, 255, 0.06);
}
.item.on {
  color: #a78bfa;
}
.is-desktop {
  justify-content: flex-start;
  gap: 6px;
}
.is-desktop .item {
  flex: none;
  flex-direction: row;
  gap: 6px;
  padding: 6px 10px;
  font-size: 12px;
}
</style>
