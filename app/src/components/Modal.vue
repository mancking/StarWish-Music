<script setup lang="ts">
import { onBeforeUnmount, onMounted, watch } from 'vue'
import Icon from './Icon.vue'

const props = withDefaults(
  defineProps<{ modelValue: boolean; title?: string; width?: number | string; closable?: boolean; padding?: number | string }>(),
  { title: '', width: 460, closable: true, padding: undefined }
)
const emit = defineEmits<{ (e: 'update:modelValue', v: boolean): void }>()

function close(): void {
  emit('update:modelValue', false)
}

function onKey(e: KeyboardEvent): void {
  if (e.key === 'Escape' && props.modelValue) close()
}

watch(
  () => props.modelValue,
  v => {
    document.body.style.overflow = v ? 'hidden' : ''
  }
)

onMounted(() => window.addEventListener('keydown', onKey))
onBeforeUnmount(() => {
  window.removeEventListener('keydown', onKey)
  document.body.style.overflow = ''
})
</script>

<template>
  <Teleport to="body">
    <Transition name="modal">
      <div v-if="modelValue" class="backdrop" @click.self="close">
        <div class="modal" :style="{ width: typeof width === 'number' ? width + 'px' : width }" role="dialog" aria-modal="true">
          <header class="head">
            <h3>{{ title }}</h3>
            <button v-if="closable" class="icon-btn" @click="close"><Icon name="close" :size="17" /></button>
          </header>
          <div class="body" :style="padding !== undefined ? { padding: typeof padding === 'number' ? padding + 'px' : padding } : undefined"><slot /></div>
          <footer v-if="$slots.footer" class="foot"><slot name="footer" /></footer>
        </div>
      </div>
    </Transition>
  </Teleport>
</template>

<style scoped>
.backdrop {
  position: fixed;
  inset: 0;
  background: rgba(4, 6, 12, 0.55);
  backdrop-filter: blur(6px);
  z-index: 8000;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 24px;
}
.modal {
  max-width: calc(100vw - 48px);
  max-height: calc(100vh - 80px);
  display: flex;
  flex-direction: column;
  background: var(--bg-2);
  border: 1px solid var(--line-2);
  border-radius: var(--radius-lg);
  box-shadow: var(--shadow);
  overflow: hidden;
}
.head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 16px 18px 12px;
}
.head h3 {
  font-size: 15px;
  font-weight: 600;
}
.body {
  padding: 4px 18px 18px;
  overflow-y: auto;
}
.foot {
  display: flex;
  justify-content: flex-end;
  gap: 10px;
  padding: 13px 18px;
  border-top: 1px solid var(--line);
  background: var(--panel);
}
.modal-enter-active,
.modal-leave-active {
  transition: opacity 0.22s var(--ease);
}
.modal-enter-active .modal,
.modal-leave-active .modal {
  transition: transform 0.24s var(--ease);
}
.modal-enter-from,
.modal-leave-to {
  opacity: 0;
}
.modal-enter-from .modal,
.modal-leave-to .modal {
  transform: translateY(12px) scale(0.98);
}
</style>
