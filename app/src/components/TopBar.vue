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
</script>

<template>
  <header class="topbar drag" :class="{ win: isWin }">
    <div class="nav no-drag">
      <button class="icon-btn" title="后退" @click="router.back()"><Icon name="chevron-left" :size="17" /></button>
      <button class="icon-btn" title="前进" @click="router.forward()"><Icon name="chevron-right" :size="17" /></button>
    </div>

    <div class="search no-drag">
      <Icon name="search" :size="14" class="search-icon" />
      <input
        ref="input"
        v-model="keyword"
        type="text"
        placeholder="搜索歌曲、歌手、专辑（Ctrl + K）"
        spellcheck="false"
        @keydown.enter="submit"
        @keydown.esc="($event.target as HTMLInputElement).blur()"
      />
      <button v-if="keyword" class="clear" title="清空" @click="clear"><Icon name="close" :size="13" /></button>
    </div>

    <div class="spacer no-drag" />

    <div class="actions no-drag">
      <button class="icon-btn" :title="ui.theme === 'dark' ? '切换到浅色' : '切换到深色'" @click="toggleTheme">
        <Icon :name="ui.theme === 'dark' ? 'sun' : 'moon'" :size="16" />
      </button>
      <button
        class="icon-btn"
        :class="{ active: ui.settings.showDesktopLyric }"
        title="桌面歌词（Ctrl+Alt+L）"
        @click="toggleLyric"
      >
        <Icon name="lyric" :size="16" />
      </button>
    </div>

    <!-- Windows 标题栏避让区（titleBarOverlay） -->
    <div v-if="isWin" class="win-ctl-area no-drag" aria-hidden="true" />
  </header>
</template>

<style scoped>
.topbar {
  height: var(--titlebar-h);
  flex: none;
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 0 14px;
  background: var(--bg);
  border-bottom: 1px solid var(--line);
  position: relative;
  z-index: 4;
  -webkit-app-region: drag;
}
.topbar.win {
  /* Windows 上把窗口控制按钮（约 138px）整体让出，避免遮挡 */
  padding-right: 0;
}
.nav,
.search,
.actions,
.icon-btn,
.clear,
.spacer,
.win-ctl-area {
  -webkit-app-region: no-drag;
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
  max-width: 440px;
  height: 30px;
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 0 10px;
  border-radius: 9px;
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
  width: 18px;
  height: 18px;
  align-items: center;
  justify-content: center;
  border-radius: 50%;
}
.clear:hover {
  color: var(--text);
  background: var(--hover);
}
.spacer {
  flex: 1;
  min-width: 0;
}
.actions {
  display: flex;
  align-items: center;
  gap: 2px;
}
.icon-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 30px;
  height: 30px;
  border-radius: 8px;
  color: var(--text-2);
  transition: background 0.15s, color 0.15s;
}
.icon-btn:hover {
  background: var(--hover);
  color: var(--text);
}
.icon-btn.active {
  color: var(--accent);
  background: var(--accent-soft);
}
.win-ctl-area {
  width: 138px;
  height: 100%;
  flex: none;
}
</style>
