<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import Sidebar from '@/components/Sidebar.vue'
import TopBar from '@/components/TopBar.vue'
import MiniBar from '@/components/MiniBar.vue'
import TabBar from '@/components/mobile/TabBar.vue'
import MiniPlayer from '@/components/mobile/MiniPlayer.vue'
import QueueDrawer from '@/components/QueueDrawer.vue'
import ToastHost from '@/components/ToastHost.vue'
import AddToPlaylistModal from '@/components/AddToPlaylistModal.vue'
import ImportPlaylistModal from '@/components/ImportPlaylistModal.vue'
import { usePlayerStore } from '@/stores/player'
import { useUiStore } from '@/stores/ui'
import { useDownloadStore } from '@/stores/download'
import { on } from '@/api'

const route = useRoute()
const router = useRouter()
const player = usePlayerStore()
const ui = useUiStore()
const download = useDownloadStore()

/** 下载完成/失败时轻提示一次（按 id 去重，进度事件不会重复弹） */
const dlNotified = new Set<string>()
watch(
  () => download.tasks,
  list => {
    for (const t of list) {
      if (dlNotified.has(t.id)) continue
      if (t.status === 'done') {
        dlNotified.add(t.id)
        ui.toast(`已下载《${t.song?.name || ''}》`, 'success', 2200)
      } else if (t.status === 'error') {
        dlNotified.add(t.id)
        ui.toast(`下载失败：${t.song?.name || ''}`, 'error', 2600)
      }
    }
  },
  { deep: true }
)

const content = ref<HTMLElement | null>(null)
const topbar = ref<InstanceType<typeof TopBar> | null>(null)

const fullscreen = computed(() => !!route.meta.fullscreen)
const isLyric = computed(() => !!route.meta.lyric)
/** 移动端（Android / iOS WebView）使用独立布局：底部 Tab + 迷你播放条 */
const isMobileApp = __MOBILE__

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
  // 下载队列全局初始化：侧栏计数、进度事件从启动就生效，不必等进入下载页
  void download.init()
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
  <div v-if="fullscreen" class="fullscreen-root" :class="{ 'is-lyric': isLyric }">
    <RouterView />
  </div>

  <!-- 移动端：底部 Tab + 全局迷你播放条，无侧栏、无顶栏 -->
  <div v-else-if="isMobileApp" class="m-shell">
    <main ref="content" class="m-content">
      <RouterView v-slot="{ Component, route: r }">
        <KeepAlive :include="['Home', 'Discover', 'Mv']">
          <component :is="Component" :key="r.name === 'playlist' || r.name === 'toplist' ? r.fullPath : undefined" />
        </KeepAlive>
      </RouterView>
    </main>
    <MiniPlayer />
    <TabBar />
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

  <QueueDrawer :bottom="fullscreen ? 0 : isMobileApp ? 108 : 92" />
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
  /* 全屏路由（播放页）必须有不透明底色：transparent 会让下层页面的文字透出来，
     形成「字压字」。歌词窗口是独立 BrowserWindow，用 .is-lyric 单独放开。 */
  background: var(--bg);
}
.fullscreen-root.is-lyric {
  background: transparent;
}

/* 移动端外壳：内容区滚动，底部固定迷你条 + Tab */
.m-shell {
  display: flex;
  flex-direction: column;
  height: 100vh;
  height: 100dvh;
  overflow: hidden;
  background: var(--bg);
}
.m-content {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  overflow-x: hidden;
  -webkit-overflow-scrolling: touch;
}
</style>
