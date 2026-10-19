<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import Sidebar from '@/components/Sidebar.vue'
import TopBar from '@/components/TopBar.vue'
import MiniBar from '@/components/MiniBar.vue'
import QueueDrawer from '@/components/QueueDrawer.vue'
import ToastHost from '@/components/ToastHost.vue'
import AddToPlaylistModal from '@/components/AddToPlaylistModal.vue'
import ImportPlaylistModal from '@/components/ImportPlaylistModal.vue'
import { usePlayerStore } from '@/stores/player'
import { useUiStore } from '@/stores/ui'
import { on } from '@/api'

const route = useRoute()
const router = useRouter()
const player = usePlayerStore()
const ui = useUiStore()

const content = ref<HTMLElement | null>(null)
const topbar = ref<InstanceType<typeof TopBar> | null>(null)

const fullscreen = computed(() => !!route.meta.fullscreen)
const isLyric = computed(() => !!route.meta.lyric)

watch(
  () => route.fullPath,
  () => {
    if (content.value) content.value.scrollTop = 0
    document.body.classList.toggle('lyric-window', isLyric.value)
  },
  { immediate: true }
)

function isTyping(e: KeyboardEvent): boolean {
  const t = e.target as HTMLElement | null
  if (!t) return false
  const tag = t.tagName
  return tag === 'INPUT' || tag === 'TEXTAREA' || t.isContentEditable
}

function onKey(e: KeyboardEvent): void {
  if (isLyric.value) return
  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
    e.preventDefault()
    topbar.value?.focusSearch()
    return
  }
  if (isTyping(e)) return
  if (e.code === 'Space') {
    e.preventDefault()
    void player.toggle()
  } else if (e.key === 'Escape') {
    player.queueOpen = false
  } else if (e.key === 'ArrowRight' && e.altKey) {
    void player.next()
  } else if (e.key === 'ArrowLeft' && e.altKey) {
    void player.prev()
  }
}

let offNavigate: (() => void) | null = null

onMounted(() => {
  window.addEventListener('keydown', onKey)
  offNavigate = on('app:navigate', (p: any) => {
    if (p?.route) router.push(p.route)
  })
})

onBeforeUnmount(() => {
  window.removeEventListener('keydown', onKey)
  offNavigate?.()
})
</script>

<template>
  <div v-if="fullscreen" class="fullscreen-root">
    <RouterView />
  </div>

  <div v-else class="shell">
    <Sidebar />
    <div class="main-col">
      <TopBar ref="topbar" />
      <main ref="content" class="content">
        <RouterView v-slot="{ Component, route: r }">
          <KeepAlive :include="['Home', 'Discover', 'Mv']">
            <component :is="Component" :key="r.name === 'playlist' || r.name === 'toplist' ? r.fullPath : undefined" />
          </KeepAlive>
        </RouterView>
      </main>
      <MiniBar />
    </div>
  </div>

  <QueueDrawer :bottom="fullscreen ? 0 : 92" />
  <ToastHost />
  <AddToPlaylistModal />
  <ImportPlaylistModal />
</template>

<style scoped>
.shell {
  display: flex;
  height: 100vh;
  overflow: hidden;
  background: var(--bg);
}
.main-col {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  min-height: 0;
}
.content {
  flex: 1;
  overflow-y: auto;
  overflow-x: hidden;
  min-height: 0;
  scroll-behavior: smooth;
}
.fullscreen-root {
  height: 100vh;
  overflow: hidden;
  background: transparent;
}
</style>
