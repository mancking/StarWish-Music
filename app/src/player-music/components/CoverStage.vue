<script setup lang="ts">
/**
 * 封面 / 唱片舞台
 *
 * 所有端封面形态统一为圆形旋转唱片：播放旋转、暂停停转（无惯性滑行），仅尺寸不同：
 * - phone：直径 = 屏宽 62%（下限 240px），边框 6px 黑
 * - pad：240px（横屏左封面区 55% 内自适应），边框 6px 黑
 * - desktop：240px，边框 8px 黑
 * - car：不显示封面（车机页面自己排版，这里直接不渲染）
 *
 * 转速（QQ ISUX 口径）：默认 16s/圈，设置三档 24/16/8（settings.playerSpinSec）；
 * 车机固定 24s 低速档（行驶视觉稳定）。
 * 切歌转场：全端统一 opacity 300ms 淡入淡出。
 */
import { computed } from 'vue'
import Cover from '@/components/Cover.vue'
import { useUiStore } from '@/stores/ui'
import { platform } from '@/platform'

const props = withDefaults(
  defineProps<{
    kind: 'phone' | 'pad' | 'desktop' | 'car'
    cover?: string
    name?: string
    singer?: string
    playing?: boolean
 /** 切歌淡入淡出用 */
    visible?: boolean
  }>(),
  { cover: '', name: '', singer: '', playing: false, visible: true }
)

const emit = defineEmits<{ (e: 'tap'): void }>()

const ui = useUiStore()
/** 转速三档 24/16/8（3.14）；车机固定 24 低速档 */
const spinSec = computed(() => {
  if (props.kind === 'car' || platform.value.car) return 24
  const v = Number((ui.settings as any).playerSpinSec)
  return v === 8 || v === 16 || v === 24 ? v : 16
})
const inner = computed(() => (props.kind === 'desktop' ? 72 : 62))
const spinning = computed(() => props.playing)
const spinStyle = computed(() => ({ animationDuration: `${spinSec.value}s` }))
</script>

<template>
  <div
    v-if="kind !== 'car'"
    class="cover-stage"
    :class="[`is-${kind}`, { visible }]"
    @click="emit('tap')"
  >
    <div class="vinyl" :class="{ spin: spinning }" :style="spinStyle">
      <div class="vinyl-face">
        <Cover :src="cover" :alt="name" :size="inner" round />
      </div>
      <span class="hole" />
    </div>
  </div>
</template>

<style scoped>
.cover-stage {
  display: flex;
  align-items: center;
  justify-content: center;
  transition: opacity 300ms ease;
  user-select: none;
  -webkit-tap-highlight-color: transparent;
}
.cover-stage.visible {
  opacity: 1;
}
.cover-stage:not(.visible) {
  opacity: 0;
}
.vinyl {
  position: relative;
  display: grid;
  place-items: center;
  border-radius: 50%;
  background: radial-gradient(circle at 50% 50%, #1b1b22 0 34%, #0c0c10 35% 100%);
  box-shadow: 0 18px 44px -20px rgba(0, 0, 0, 0.95);
}
/* 3.14：移动唱片直径 = 屏宽 62%（下限 240px） */
.is-phone .vinyl {
  width: max(240px, 62vw);
  height: max(240px, 62vw);
  max-width: 420px;
  max-height: 420px;
  border: 6px solid #000;
}
.is-pad .vinyl {
  width: min(240px, 32vh);
  height: min(240px, 32vh);
  border: 6px solid #000;
}
.is-desktop .vinyl {
  width: 240px;
  height: 240px;
  border: 8px solid #000;
}
.vinyl-face {
  display: grid;
  place-items: center;
}
/* 3.14：默认 16s/圈（inline animationDuration 覆盖），暂停停转无惯性 */
.vinyl.spin {
  animation-name: spin;
  animation-timing-function: linear;
  animation-iteration-count: infinite;
}
.hole {
  position: absolute;
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background: #0b0b10;
  box-shadow: 0 0 0 2px rgba(255, 255, 255, 0.08);
}
@keyframes spin {
  to {
    transform: rotate(360deg);
  }
}
</style>
