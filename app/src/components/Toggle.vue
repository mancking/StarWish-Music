<script setup lang="ts">
defineProps<{ modelValue: boolean; disabled?: boolean }>()
const emit = defineEmits<{ (e: 'update:modelValue', v: boolean): void }>()
</script>

<template>
  <button
    class="toggle"
    :class="{ on: modelValue, disabled }"
    role="switch"
    :aria-checked="modelValue"
    :disabled="disabled"
    @click="emit('update:modelValue', !modelValue)"
  >
    <span class="knob" />
  </button>
</template>

<style scoped>
.toggle {
  width: 38px;
  height: 22px;
  border-radius: 12px;
  background: var(--panel-3);
  position: relative;
  transition: background 0.2s var(--ease);
  flex: none;
}
.toggle.on {
  background: var(--accent);
}
.toggle.disabled {
  opacity: 0.45;
  cursor: not-allowed;
}
.knob {
  position: absolute;
  top: 3px;
  left: 3px;
  width: 16px;
  height: 16px;
  border-radius: 50%;
  background: #fff;
  transition: transform 0.2s var(--ease);
  box-shadow: 0 1px 4px rgba(0, 0, 0, 0.3);
}
.toggle.on .knob {
  transform: translateX(16px);
}
</style>
