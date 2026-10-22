<script setup lang="ts">
import { computed } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import Icon from '@/components/Icon.vue'

/**
 * 移动端底部导航（4 个一级入口）。
 * 桌面端不用这个组件——桌面是左侧栏，信息密度与操作习惯完全不同。
 */

const route = useRoute()
const router = useRouter()

const tabs = [
  { path: '/', label: '推荐', icon: 'home' },
  { path: '/discover', label: '发现', icon: 'compass' },
  { path: '/mv', label: '视频', icon: 'video' },
  { path: '/mine', label: '我的', icon: 'user' },
]

const active = computed(() => {
  const p = route.path
  if (p === '/') return '/'
  const hit = tabs.find(t => t.path !== '/' && p.startsWith(t.path))
  return hit?.path || '/'
})

function go(path: string): void {
  if (active.value === path) return
  router.push(path)
}
</script>

<template>
  <nav class="tabbar">
    <button
      v-for="t in tabs"
      :key="t.path"
      class="tab"
      :class="{ on: active === t.path }"
      @click="go(t.path)"
    >
      <Icon :name="t.icon" :size="22" :stroke="active === t.path ? 2.1 : 1.7" />
      <span>{{ t.label }}</span>
    </button>
  </nav>
</template>

<style scoped>
.tabbar {
  flex: none;
  display: grid;
  grid-template-columns: repeat(4, 1fr);
  height: calc(56px + env(safe-area-inset-bottom, 0px));
  padding-bottom: env(safe-area-inset-bottom, 0px);
  background: color-mix(in srgb, var(--bg) 88%, transparent);
  backdrop-filter: blur(18px);
  border-top: 1px solid var(--line);
  z-index: 20;
}
.tab {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 3px;
  border: 0;
  background: transparent;
  color: var(--text-3);
  font-size: 11px;
  cursor: pointer;
  -webkit-tap-highlight-color: transparent;
  transition: color 0.18s;
}
.tab.on {
  color: var(--accent);
}
</style>
