<script setup lang="ts">
import Icon from './Icon.vue'
import { useUiStore } from '@/stores/ui'

const ui = useUiStore()
</script>

<template>
  <Teleport to="body">
    <div class="toasts">
      <TransitionGroup name="toast">
        <div v-for="t in ui.toasts" :key="t.id" class="toast" :class="t.type" @click="ui.dismiss(t.id)">
          <Icon
            :name="t.type === 'error' ? 'info' : t.type === 'success' ? 'check' : t.type === 'warning' ? 'bell' : 'sparkles'"
            :size="15"
          />
          <span>{{ t.message }}</span>
        </div>
      </TransitionGroup>
    </div>
  </Teleport>
</template>

<style scoped>
.toasts {
  position: fixed;
  top: 54px;
  left: 50%;
  transform: translateX(-50%);
  z-index: 9999;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 8px;
  pointer-events: none;
  width: max-content;
  max-width: 70vw;
}
.toast {
  pointer-events: auto;
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 9px 15px;
  border-radius: 11px;
  background: var(--glass);
  backdrop-filter: blur(22px) saturate(1.4);
  border: 1px solid var(--line-2);
  box-shadow: var(--shadow-sm);
  font-size: 12.5px;
  color: var(--text);
  cursor: pointer;
  max-width: 100%;
}
.toast span {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.toast.error {
  border-color: rgba(255, 77, 109, 0.45);
  color: #ffd7de;
}
.toast.success {
  border-color: rgba(74, 222, 128, 0.4);
}
.toast-enter-active,
.toast-leave-active {
  transition: all 0.26s var(--ease);
}
.toast-enter-from {
  opacity: 0;
  transform: translateY(-10px) scale(0.96);
}
.toast-leave-to {
  opacity: 0;
  transform: translateY(-6px) scale(0.97);
}
</style>
