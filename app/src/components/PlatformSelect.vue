<script setup lang="ts">
/**
 * 音源 / 平台下拉选择器
 *
 * 模仿洛雪音乐桌面端的右侧下拉菜单样式：
 *   - 触发器：浅色 chip + 下拉箭头，显示当前选项
 *   - 面板：固定宽度，hover 高亮，选中项使用主题色背景
 *   - 通过点击外部 / Esc 自动关闭
 */
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import Icon from './Icon.vue'

export interface PlatformOption {
  key: string
  name: string
  /** 选中后展示在触发器内的副标题，可选 */
  hint?: string
}

const props = withDefaults(
  defineProps<{
    modelValue: string
    options: PlatformOption[]
    label?: string
    width?: number
    align?: 'left' | 'right'
  }>(),
  { label: '', width: 200, align: 'right' }
)
const emit = defineEmits<{ (e: 'update:modelValue', v: string): void }>()

const open = ref(false)
const triggerRef = ref<HTMLElement | null>(null)
const menuRef = ref<HTMLElement | null>(null)

const current = computed(() => props.options.find(o => o.key === props.modelValue) || props.options[0] || null)
const currentName = computed(() => current.value?.name || '选择音源')

function toggle(): void {
  open.value = !open.value
  if (open.value) {
    void nextTick(() => {
      const el = menuRef.value
      if (el) {
        // 滚动到选中项
        const item = el.querySelector('.active') as HTMLElement | null
        if (item) item.scrollIntoView({ block: 'nearest' })
      }
    })
  }
}

function pick(opt: PlatformOption): void {
  emit('update:modelValue', opt.key)
  open.value = false
}

function onDocClick(e: MouseEvent): void {
  if (!open.value) return
  const t = e.target as Node | null
  if (triggerRef.value?.contains(t)) return
  if (menuRef.value?.contains(t)) return
  open.value = false
}

function onKey(e: KeyboardEvent): void {
  if (e.key === 'Escape' && open.value) {
    open.value = false
    triggerRef.value?.focus()
  }
}

onMounted(() => {
  document.addEventListener('mousedown', onDocClick)
  document.addEventListener('keydown', onKey)
})
onBeforeUnmount(() => {
  document.removeEventListener('mousedown', onDocClick)
  document.removeEventListener('keydown', onKey)
})

// 选中项变化时若菜单开着就跟着滚到可视区
watch(
  () => props.modelValue,
  () => {
    if (!open.value) return
    void nextTick(() => {
      const el = menuRef.value
      if (!el) return
      const item = el.querySelector('.active') as HTMLElement | null
      if (item) item.scrollIntoView({ block: 'nearest' })
    })
  }
)
</script>

<template>
  <div class="pl-select" :class="{ open }">
    <button
      ref="triggerRef"
      class="trigger"
      :title="label || currentName"
      :aria-expanded="open"
      @click="toggle"
    >
      <span class="t-name">{{ label || currentName }}</span>
      <Icon name="chevron-down" :size="12" class="caret" />
    </button>

    <Transition name="fade-down">
      <div
        v-if="open"
        ref="menuRef"
        class="menu"
        :class="[align]"
        :style="{ minWidth: width + 'px' }"
        role="listbox"
      >
        <button
          v-for="opt in options"
          :key="opt.key"
          class="item"
          :class="{ active: opt.key === modelValue }"
          role="option"
          :aria-selected="opt.key === modelValue"
          @click="pick(opt)"
        >
          <span class="i-name">{{ opt.name }}</span>
          <span v-if="opt.hint" class="i-hint">{{ opt.hint }}</span>
          <Icon v-if="opt.key === modelValue" name="check" :size="13" class="i-check" />
        </button>
      </div>
    </Transition>
  </div>
</template>

<style scoped>
.pl-select {
  position: relative;
  display: inline-flex;
}
.trigger {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  height: 30px;
  padding: 0 10px 0 12px;
  border-radius: 8px;
  background: var(--panel);
  color: var(--text-2);
  font-size: 12.5px;
  font-weight: 500;
  transition: background 0.15s, color 0.15s;
}
.trigger:hover {
  background: var(--panel-2);
  color: var(--text);
}
.open .trigger {
  background: var(--panel-2);
  color: var(--text);
}
.caret {
  color: var(--text-3);
  transition: transform 0.18s var(--ease);
}
.open .caret {
  transform: rotate(180deg);
}
.menu {
  position: absolute;
  top: calc(100% + 6px);
  z-index: 30;
  background: var(--bg-2);
  border: 1px solid var(--line-2);
  border-radius: 10px;
  box-shadow: 0 18px 38px -10px rgba(0, 0, 0, 0.5);
  padding: 5px;
  max-height: 280px;
  overflow-y: auto;
}
.menu.right {
  right: 0;
}
.menu.left {
  left: 0;
}
.item {
  display: flex;
  align-items: center;
  width: 100%;
  height: 32px;
  padding: 0 10px;
  border-radius: 7px;
  font-size: 12.5px;
  color: var(--text-2);
  text-align: left;
  gap: 8px;
  transition: background 0.12s, color 0.12s;
}
.item:hover {
  background: var(--hover);
  color: var(--text);
}
.item.active {
  background: var(--accent-soft);
  color: var(--accent);
  font-weight: 500;
}
.i-name {
  flex: 1;
  min-width: 0;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.i-hint {
  font-size: 10.5px;
  color: var(--text-3);
  flex: none;
}
.i-check {
  flex: none;
  color: var(--accent);
}
.fade-down-enter-active,
.fade-down-leave-active {
  transition: opacity 0.16s var(--ease), transform 0.16s var(--ease);
}
.fade-down-enter-from,
.fade-down-leave-to {
  opacity: 0;
  transform: translateY(-4px);
}
</style>
