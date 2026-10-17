<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import Icon from './Icon.vue'

const props = withDefaults(
  defineProps<{
    src?: string
    alt?: string
    size?: number | string
    radius?: number | string
    round?: boolean
    cover?: string
  }>(),
  { src: '', alt: '', size: 44, radius: 10, round: false, cover: '' }
)

const failed = ref(false)
const loaded = ref(false)

watch(
  () => props.src,
  () => {
    failed.value = false
    loaded.value = false
  }
)

const px = computed(() => (typeof props.size === 'number' ? `${props.size}px` : props.size))
const br = computed(() => (props.round ? '50%' : typeof props.radius === 'number' ? `${props.radius}px` : props.radius))
const initial = computed(() => {
  const t = String(props.alt || '').trim()
  return t ? t.slice(0, 1) : '♪'
})

const gradient = computed(() => {
  const s = String(props.alt || props.src || 'starwish')
  let h = 0
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) % 360
  const h2 = (h + 46) % 360
  return `linear-gradient(135deg, hsl(${h} 58% 42%), hsl(${h2} 62% 30%))`
})

function onError(): void {
  failed.value = true
  loaded.value = false
}
</script>

<template>
  <div class="cover" :style="{ width: px, height: px, borderRadius: br, background: gradient }">
    <img
      v-if="src && !failed"
      :src="src"
      :alt="alt"
      :class="{ ready: loaded }"
      loading="lazy"
      decoding="async"
      draggable="false"
      @load="loaded = true"
      @error="onError"
    />
    <div v-if="!src || failed" class="ph">
      <span class="ch">{{ initial }}</span>
      <Icon name="music" class="note" :size="'42%'" :stroke="1.4" />
    </div>
    <div v-if="src && !failed && !loaded" class="sk loading" />
    <div v-if="cover" class="shine" />
  </div>
</template>

<style scoped>
.cover {
  position: relative;
  overflow: hidden;
  flex: none;
  isolation: isolate;
  box-shadow: 0 6px 18px -10px rgba(0, 0, 0, 0.6);
}
img {
  width: 100%;
  height: 100%;
  object-fit: cover;
  opacity: 0;
  transition: opacity 0.35s var(--ease);
}
img.ready {
  opacity: 1;
}
.ph {
  position: absolute;
  inset: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  color: rgba(255, 255, 255, 0.9);
  background-image: radial-gradient(circle at 30% 20%, rgba(255, 255, 255, 0.22), transparent 55%);
}
.ch {
  font-size: 42%;
  font-weight: 650;
  text-shadow: 0 2px 8px rgba(0, 0, 0, 0.35);
  position: relative;
  z-index: 1;
}
.note {
  position: absolute;
  right: 8%;
  bottom: 7%;
  opacity: 0.42;
}
.loading {
  position: absolute;
  inset: 0;
  border-radius: inherit;
}
.shine {
  position: absolute;
  inset: 0;
  pointer-events: none;
  background: radial-gradient(circle at 28% 18%, rgba(255, 255, 255, 0.16), transparent 52%);
}
</style>
