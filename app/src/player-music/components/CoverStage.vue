<script setup lang="ts">
/**
 * 封面 / 唱片舞台（规格书 v2.8 · 1.2「统一规则」）
 *
 * 所有端封面形态统一为圆形唱片，播放时旋转、暂停停转，仅尺寸不同：
 * - phone：200×200 圆形唱片，边框 6px 黑，中心 60px 封面
 * - pad：180×180 圆形唱片，边框 6px 黑，中心 60px 封面
 * - desktop：200×200 圆形唱片，边框 8px 黑，中心 70px 封面
 * - car：不显示封面（车机页面自己排版，这里直接不渲染）
 *
 * 禁止手机端方形、禁止平板竖屏方形（v2.8 明确不允许）。
 */
import { computed } from 'vue'
import Cover from '@/components/Cover.vue'

const props = withDefaults(
  defineProps<{
    kind: 'phone' | 'pad' | 'desktop' | 'car'
    cover?: string
    name?: string
    singer?: string
    playing?: boolean
    /** 切歌淡入淡出用（规格书 1.2：opacity 300ms） */
    visible?: boolean
  }>(),
  { cover: '', name: '', singer: '', playing: false, visible: true }
)

const emit = defineEmits<{ (e: 'tap'): void }>()

const size = computed(() => (props.kind === 'pad' ? 180 : 200))
const inner = computed(() => (props.kind === 'desktop' ? 70 : 60))
const spinning = computed(() => props.playing)
</script>

<template>
  <div
    v-if="kind !== 'car'"
    class="cover-stage"
    :class="[`is-${kind}`, { visible }]"
    @click="emit('tap')"
  >
    <div class="vinyl" :class="{ spin: spinning }">
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
.is-phone .vinyl {
  width: 200px;
  height: 200px;
  border: 6px solid #000;
}
.is-pad .vinyl {
  width: 180px;
  height: 180px;
  border: 6px solid #000;
}
.is-desktop .vinyl {
  width: 200px;
  height: 200px;
  border: 8px solid #000;
}
.vinyl-face {
  display: grid;
  place-items: center;
}
.vinyl.spin {
  animation: spin 12s linear infinite;
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
