<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import Icon from './Icon.vue'
import { useUiStore } from '@/stores/ui'

const router = useRouter()
const route = useRoute()
const ui = useUiStore()

const input = ref<HTMLInputElement | null>(null)
const keyword = ref('')
const isWin = computed(() => window.sw?.platform === 'win32')

onMounted(() => {
  if (typeof route.query.q === 'string') keyword.value = route.query.q
})

function submit(): void {
  const q = keyword.value.trim()
  if (!q) return
  router.push({ path: '/search', query: { q } })
}

function clear(): void {
  keyword.value = ''
  input.value?.focus()
}

function toggleTheme(): void {
  const next = ui.theme === 'dark' ? 'light' : 'dark'
  void ui.patch({ theme: next })
}

function toggleLyric(): void {
  void ui.patch({ showDesktopLyric: !ui.settings.showDesktopLyric })
  ui.toast(ui.settings.showDesktopLyric ? '桌面歌词已开启' : '桌面歌词已关闭', 'info', 1500)
}

function focusSearch(): void {
  input.value?.focus()
  input.value?.select()
}

defineExpose({ focusSearch })

const canBack = computed(() => window.history.length > 1)
</script>

<template>
  <header class="topbar drag" :style="{ paddingRight: isWin ? '148px' : '14px' }">
    <div class="nav no-drag">
      <button class="icon-btn" title="后退" @click="router.back()"><Icon name="chevron-left" :size="18" /></button>
      <button class="icon-btn" title="前进" @click="router.forward()"><Icon name="chevron-right" :size="18" /></button>
    </div>

    <div class="search no-drag">
      <Icon name="search" :size="15" class="search-icon" />
      <input
        ref="input"
        v-model="keyword"
        type="text"
        placeholder="搜索歌曲、歌手、专辑（Ctrl + K）"
        spellcheck="false"
        @keydown.enter="submit"
        @keydown.esc="($event.target as HTMLInputElement).blur()"
      />
      <button v-if="keyword" class="clear" @click="clear"><Icon name="close" :size="13" /></button>
    </div>

    <div class="actions no-drag">
      <button class="icon-btn" :title="ui.theme === 'dark' ? '切换到浅色' : '切换到深色'" @click="toggleTheme">
        <Icon :name="ui.theme === 'dark' ? 'sun' : 'moon'" :size="17" />
      </button>
      <button
        class="icon-btn"
        :class="{ active: ui.settings.showDesktopLyric }"
        title="桌面歌词（Ctrl+Alt+L）"
        @click="toggleLyric"
      >
        <Icon name="lyric" :size="17" />
      </button>
    </div>
  </header>
</template>

<style scoped>
.topbar {
  height: var(--titlebar-h);
  flex: none;
  display: flex;
  align-items: center;
  gap: 14px;
  padding-left: 14px;
  background: var(--bg);
  border-bottom: 1px solid var(--line);
  position: relative;
  z-index: 4;
}
.nav {
  display: flex;
  gap: 2px;
}
.nav .icon-btn {
  width: 28px;
  height: 28px;
  border-radius: 8px;
}
.search {
  flex: 1;
  max-width: 430px;
  height: 32px;
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 0 10px;
  border-radius: 10px;
  background: var(--panel);
  border: 1px solid transparent;
  transition: border-color 0.18s, background 0.18s;
}
.search:focus-within {
  border-color: var(--accent);
  background: var(--panel-2);
}
.search-icon {
  color: var(--text-3);
}
.search input {
  flex: 1;
  min-width: 0;
  border: none;
  background: none;
  outline: none;
  font-size: 12.5px;
  color: var(--text);
}
.search input::placeholder {
  color: var(--text-3);
}
.clear {
  color: var(--text-3);
  display: flex;
}
.clear:hover {
  color: var(--text);
}
.actions {
  margin-left: auto;
  display: flex;
  align-items: center;
  gap: 2px;
}
</style>
