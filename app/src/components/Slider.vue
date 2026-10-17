<script setup lang="ts">
import { computed, ref } from 'vue'

const props = withDefaults(
  defineProps<{
    modelValue: number
    max?: number
    step?: number
    disabled?: boolean
    buffered?: number
    thin?: boolean
  }>(),
  { max: 100, step: 0.1, disabled: false, buffered: 0, thin: false }
)

const emit = defineEmits<{
  (e: 'update:modelValue', v: number): void
  (e: 'change', v: number): void
  (e: 'dragging', v: boolean): void
}>()

const el = ref<HTMLElement | null>(null)
const dragging = ref(false)
const preview = ref<number | null>(null)

const value = computed(() => (preview.value !== null ? preview.value : props.modelValue))
const pct = computed(() => {
  const m = props.max || 1
  return Math.max(0, Math.min(100, (value.value / m) * 100))
})
const bufPct = computed(() => Math.max(0, Math.min(100, (props.buffered / (props.max || 1)) * 100)))

function posFromEvent(e: PointerEvent): number {
  const node = el.value
  if (!node) return 0
  const rect = node.getBoundingClientRect()
  const ratio = Math.max(0, Math.min(1, (e.clientX - rect.left) / Math.max(1, rect.width)))
  const raw = ratio * props.max
  const step = props.step || 0.1
  return Math.round(raw / step) * step
}

function onDown(e: PointerEvent): void {
  if (props.disabled) return
  e.preventDefault()
  dragging.value = true
  preview.value = posFromEvent(e)
  ;(e.currentTarget as HTMLElement).setPointerCapture(e.pointerId)
  emit('dragging', true)
  emit('update:modelValue', preview.value)
}

function onMove(e: PointerEvent): void {
  if (!dragging.value) return
  preview.value = posFromEvent(e)
  emit('update:modelValue', preview.value)
}

function onUp(e: PointerEvent): void {
  if (!dragging.value) return
  dragging.value = false
  const v = posFromEvent(e)
  preview.value = null
  emit('dragging', false)
  emit('update:modelValue', v)
  emit('change', v)
}

function onKey(e: KeyboardEvent): void {
  if (props.disabled) return
  const step = props.step || 0.1
  let v = props.modelValue
  if (e.key === 'ArrowRight') v += step
  else if (e.key === 'ArrowLeft') v -= step
  else if (e.key === 'Home') v = 0
  else if (e.key === 'End') v = props.max
  else return
  e.preventDefault()
  v = Math.max(0, Math.min(props.max, v))
  emit('update:modelValue', v)
  emit('change', v)
}
</script>

<template>
  <div
    ref="el"
    class="slider"
    :class="{ dragging, thin, disabled }"
    tabindex="0"
    role="slider"
    :aria-valuenow="value"
    :aria-valuemax="max"
    @pointerdown="onDown"
    @pointermove="onMove"
    @pointerup="onUp"
    @pointercancel="onUp"
    @keydown="onKey"
  >
    <div class="slider-track">
      <div v-if="buffered > 0" class="buffered" :style="{ width: bufPct + '%' }" />
      <div class="slider-fill" :style="{ width: pct + '%' }" />
      <div class="slider-thumb" :style="{ left: pct + '%' }" />
    </div>
  </div>
</template>

<style scoped>
.slider {
  outline: none;
}
.slider:focus-visible .slider-track {
  box-shadow: 0 0 0 3px var(--accent-soft);
}
.slider.disabled {
  opacity: 0.5;
  cursor: default;
}
.slider.thin {
  height: 10px;
}
.buffered {
  position: absolute;
  top: 0;
  bottom: 0;
  left: 0;
  border-radius: 4px;
  background: var(--panel-3);
}
</style>
