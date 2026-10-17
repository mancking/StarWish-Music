<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import Icon from './Icon.vue'
import type { MenuItem } from './menu-types'

const props = defineProps<{ x: number; y: number; items: MenuItem[] }>()
const emit = defineEmits<{ (e: 'select', index: number): void; (e: 'close'): void }>()

const el = ref<HTMLElement | null>(null)
const pos = ref({ x: props.x, y: props.y })

const style = computed(() => ({ left: `${pos.value.x}px`, top: `${pos.value.y}px` }))

function close(): void {
  emit('close')
}

function onSelect(item: MenuItem, i: number): void {
  if (item.disabled || item.divider) return
  emit('select', i)
  close()
}

function onDocDown(e: MouseEvent): void {
  if (el.value && !el.value.contains(e.target as Node)) close()
}

function onKey(e: KeyboardEvent): void {
  if (e.key === 'Escape') close()
}

onMounted(() => {
  document.addEventListener('mousedown', onDocDown)
  window.addEventListener('keydown', onKey)
  window.addEventListener('blur', close)
  requestAnimationFrame(() => {
    const node = el.value
    if (!node) return
    const rect = node.getBoundingClientRect()
    let x = props.x
    let y = props.y
    if (x + rect.width > window.innerWidth - 8) x = Math.max(8, window.innerWidth - rect.width - 8)
    if (y + rect.height > window.innerHeight - 8) y = Math.max(8, window.innerHeight - rect.height - 8)
    pos.value = { x, y }
  })
})

onBeforeUnmount(() => {
  document.removeEventListener('mousedown', onDocDown)
  window.removeEventListener('keydown', onKey)
  window.removeEventListener('blur', close)
})
</script>

<template>
  <Teleport to="body">
    <div ref="el" class="menu" :style="style">
      <template v-for="(item, i) in items" :key="i">
        <div v-if="item.divider" class="divider" />
        <button
          v-else
          class="item"
          :class="{ danger: item.danger, disabled: item.disabled }"
          @click="onSelect(item, i)"
        >
          <Icon v-if="item.icon" :name="item.icon" :size="15" />
          <span>{{ item.label }}</span>
        </button>
      </template>
    </div>
  </Teleport>
</template>

<style scoped>
.menu {
  position: fixed;
  z-index: 9000;
  min-width: 168px;
  padding: 5px;
  border-radius: 11px;
  background: var(--glass);
  backdrop-filter: blur(26px) saturate(1.5);
  border: 1px solid var(--line-2);
  box-shadow: var(--shadow);
  animation: menuIn 0.14s var(--ease);
}
@keyframes menuIn {
  from {
    opacity: 0;
    transform: translateY(-4px) scale(0.98);
  }
}
.item {
  display: flex;
  align-items: center;
  gap: 9px;
  width: 100%;
  padding: 7px 10px;
  border-radius: 7px;
  font-size: 12.5px;
  color: var(--text);
  text-align: left;
  transition: background 0.14s;
}
.item:hover {
  background: var(--panel-2);
}
.item.danger {
  color: #ff6b81;
}
.item.disabled {
  opacity: 0.4;
  pointer-events: none;
}
.divider {
  height: 1px;
  margin: 4px 6px;
  background: var(--line);
}
</style>
