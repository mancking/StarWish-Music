<script setup lang="ts">
/**
 * 封面 / 唱片舞台（规格书 1.2 四端形态）
 *
 * - phone：200×200 方形、圆角 12、不旋转、纯渐变背景
 * - pad：160 圆形唱片、6px 黑边、播放时 12s 一圈
 * - desktop：200 圆形唱片、8px 黑边、中心 70px 封面、播放时 12s 一圈
 * - car：不显示封面（由车机页面自己排版，这里直接不渲染）
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

const vinyl = computed(() => props.kind === 'pad' || props.kind === 'desktop')
const size = computed(() => (props.kind === 'pad' ? 160 : 200))
const inner = computed(() => (props.kind === 'pad' ? 96 : 70))
const spinning = computed(() => vinyl.value && props.playing)
</script>

<template>
  <div
    v-if="kind !== 'car'"
    class="cover-stage"
    :class="[`is-${kind}`, { visible }]"
    @click="emit('tap')"
  >
    <div v-if="vinyl" class="vinyl" :class="{ spin: spinning }">
      <div class="vinyl-face">
        <Cover :src="cover" :alt="name" :size="inner" round />
      </div>
      <span class="hole" />
    </div>
    <div v-else class="square">
      <Cover :src="cover" :alt="name" :size="size" :radius="12" />
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
.is-phone .square {
  border-radius: 12px;
  overflow: hidden;
  background: linear-gradient(180deg, #2a1f4d, #0f0d1f);
  box-shadow: 0 18px 40px -22px rgba(0, 0, 0, 0.9);
}
.vinyl {
  position: relative;
  display: grid;
  place-items: center;
  border-radius: 50%;
  background: radial-gradient(circle at 50% 50%, #1b1b22 0 32%, #0c0c10 33% 100%);
  box-shadow: 0 18px 44px -20px rgba(0, 0, 0, 0.95);
}
.is-pad .vinyl {
  width: 160px;
  height: 160px;
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
