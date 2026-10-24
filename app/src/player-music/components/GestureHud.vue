<script setup lang="ts">
/**
 * 亮度 / 音量弧形指示器（规格书 1.10 / 6.3 P0）
 * 56~64dp 毛玻璃圆形：太阳/喇叭图标 + 300° 弧形容量条 + 百分比数值；
 * 由 usePlaybackGestures 驱动，松手后由父级控制淡出。
 */
import { computed } from 'vue'
import Icon from '@/components/Icon.vue'

const props = defineProps<{
  kind: 'bright' | 'vol'
  percent: number
}>()

const RADIUS = 26
const CIRC = 2 * Math.PI * RADIUS
/** 满弧 300°，起笔在顶部（-90°） */
const ARC = (300 / 360) * CIRC
const dash = computed(() => `${(Math.max(0, Math.min(100, props.percent)) / 100) * ARC} ${CIRC}`)
const rotation = computed(() => `rotate(${-90 - 150}deg)`)
</script>

<template>
  <div class="ghud" role="status">
    <svg class="ring" viewBox="0 0 64 64" :style="{ transform: rotation }">
      <circle class="track" cx="32" cy="32" :r="RADIUS" />
      <circle class="fill" cx="32" cy="32" :r="RADIUS" :stroke-dasharray="dash" />
    </svg>
    <div class="core">
      <Icon :name="kind === 'vol' ? 'volume' : 'sun'" :size="20" />
      <b>{{ Math.round(percent) }}%</b>
    </div>
  </div>
</template>

<style scoped>
.ghud {
  position: absolute;
  left: 50%;
  top: 50%;
  width: 60px;
  height: 60px;
  transform: translate(-50%, -50%);
  border-radius: 50%;
  background: rgba(11, 11, 16, 0.72);
  backdrop-filter: blur(10px);
  z-index: 30;
  pointer-events: none;
  animation: ghud-in 120ms ease-out;
}
@keyframes ghud-in {
  from {
    opacity: 0;
    transform: translate(-50%, -50%) scale(0.92);
  }
  to {
    opacity: 1;
    transform: translate(-50%, -50%) scale(1);
  }
}
.ring {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
}
.ring circle {
  fill: none;
  stroke-width: 3.5;
  stroke-linecap: round;
}
.ring .track {
  stroke: rgba(255, 255, 255, 0.14);
  stroke-dasharray: 4.712 62.83;
}
.ring .fill {
  stroke: #a78bfa;
  transition: stroke-dasharray 60ms linear;
}
.core {
  position: absolute;
  inset: 0;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 1px;
  color: #ececf1;
}
.core b {
  font-size: 11px;
  font-weight: 600;
  font-variant-numeric: tabular-nums;
}
</style>
