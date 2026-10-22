<script setup lang="ts">
import { computed, ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import Icon from './Icon.vue'
import { useLibraryStore } from '@/stores/library'
import { useUiStore } from '@/stores/ui'
import { useDownloadStore } from '@/stores/download'
import brand from '@/assets/brand-icon.png'

const route = useRoute()
const router = useRouter()
const library = useLibraryStore()
const ui = useUiStore()
const download = useDownloadStore()

const creating = ref(false)
const newName = ref('')

/** 侧栏折叠：只留图标，给宽屏下的列表腾空间；状态存 localStorage */
const collapsed = ref(localStorage.getItem('sw.sidebar.collapsed') === '1')
function toggleCollapse(): void {
  collapsed.value = !collapsed.value
  localStorage.setItem('sw.sidebar.collapsed', collapsed.value ? '1' : '0')
}

const online = [
  { path: '/', icon: 'home', label: '个性推荐' },
  { path: '/discover', icon: 'compass', label: '发现音乐' },
  { path: '/mv', icon: 'video', label: '视频 / MV' },
]
const mine = [
  { path: '/favorites', icon: 'heart', label: '我喜欢的音乐' },
  { path: '/downloads', icon: 'download', label: '下载' },
  { path: '/local', icon: 'folder', label: '本地音乐' },
  { path: '/history', icon: 'clock', label: '最近播放' },
]

// 移动端底栏只留 4 个顶级 tab（借鉴 Material/QQ 音乐：屏幕有限不平铺），
// 歌单/历史/本地/MV/设置等二级入口收进「我的」页多级跳转。
// __MOBILE__ 是构建期 define，桌面死分支摇掉。
const isMobile = __MOBILE__
const mobileTabs = __MOBILE__
  ? [
      { path: '/', icon: 'home', label: '首页' },
      { path: '/discover', icon: 'compass', label: '发现' },
      { path: '/search', icon: 'search', label: '搜索' },
      { path: '/mine', icon: 'user', label: '我的' },
    ]
  : []

const activePath = computed(() => route.path)

function go(path: string): void {
  if (route.path !== path) router.push(path)
}

async function submitCreate(): Promise<void> {
  const name = newName.value.trim()
  if (!name) {
    creating.value = false
    return
  }
  const pl = await library.createPlaylist(name)
  creating.value = false
  newName.value = ''
  if (pl) router.push(`/playlist/${pl.id}`)
}
</script>

<template>
  <aside class="sidebar" :class="{ collapsed }">
    <!-- 移动端：4 个顶级 tab 底栏，不平铺（__MOBILE__ 构建期常量，桌面死分支摇掉） -->
    <div v-if="isMobile" class="scroll mobile-tabs">
      <button
        v-for="item in mobileTabs"
        :key="item.path"
        class="nav-item"
        :class="{ active: activePath === item.path }"
        @click="go(item.path)"
      >
        <Icon :name="item.icon" :size="19" />
        <span>{{ item.label }}</span>
      </button>
    </div>

    <template v-else>
    <div class="brand drag">
      <img :src="brand" class="mark" alt="星河音乐" draggable="false" />
      <div class="brand-text">
        <strong>星河</strong>
        <span>STARWISH</span>
      </div>
      <button class="collapse-btn no-drag" :title="collapsed ? '展开侧栏' : '收起侧栏'" @click="toggleCollapse">
        <Icon :name="collapsed ? 'chevron-right' : 'chevron-left'" :size="15" />
      </button>
    </div>

    <div class="scroll">
      <div class="group">
        <div class="group-label">在线音乐</div>
        <button
          v-for="item in online"
          :key="item.path"
          class="nav-item"
          :class="{ active: activePath === item.path }"
          @click="go(item.path)"
        >
          <Icon :name="item.icon" :size="17" />
          <span>{{ item.label }}</span>
          <span v-if="item.path === '/mv'" class="dot-new">NEW</span>
        </button>
      </div>

      <div class="group">
        <div class="group-label">我的音乐</div>
        <button
          v-for="item in mine"
          :key="item.path"
          class="nav-item"
          :class="{ active: activePath === item.path }"
          @click="go(item.path)"
        >
          <Icon :name="item.icon" :size="17" />
          <span>{{ item.label }}</span>
          <span v-if="item.path === '/favorites' && library.favoriteCount" class="count">{{ library.favoriteCount }}</span>
          <span v-if="item.path === '/downloads' && download.runningCount" class="count">{{ download.runningCount }}</span>
          <span v-if="item.path === '/local' && library.localCount" class="count">{{ library.localCount }}</span>
        </button>
      </div>

      <div class="group">
        <div class="group-label">
          <span>我的歌单</span>
          <button class="mini-add" title="新建歌单" @click="creating = true"><Icon name="plus" :size="14" /></button>
        </div>

        <div v-if="creating" class="create-row">
          <input
            v-model="newName"
            class="create-input"
            placeholder="歌单名称"
            maxlength="30"
            autofocus
            @keydown.enter="submitCreate"
            @keydown.esc="creating = false"
            @blur="submitCreate"
          />
        </div>

        <button
          v-for="pl in library.playlists"
          :key="pl.id"
          class="nav-item playlist"
          :class="{ active: activePath === `/playlist/${pl.id}` }"
          @click="go(`/playlist/${pl.id}`)"
        >
          <Icon name="list" :size="16" />
          <span class="ellipsis">{{ pl.name }}</span>
          <span class="count">{{ pl.songCount ?? 0 }}</span>
        </button>

        <div v-if="!library.playlists.length && !creating" class="empty-hint">
          还没有歌单，点击 + 新建，或从「发现音乐」导入平台歌单
        </div>
      </div>
    </div>

    <div class="foot">
      <button class="nav-item" :class="{ active: activePath === '/settings' }" @click="go('/settings')">
        <Icon name="settings" :size="17" />
        <span>设置</span>
      </button>
    </div>
    </template>
  </aside>
</template>

<style scoped>
.sidebar {
  width: var(--sidebar-w);
  flex: none;
  display: flex;
  flex-direction: column;
  background: var(--bg-2);
  border-right: 1px solid var(--line);
  position: relative;
  z-index: 5;
}
.brand {
  height: var(--titlebar-h);
  display: flex;
  align-items: center;
  gap: 9px;
  padding: 0 16px;
  flex: none;
}
.mark {
  width: 24px;
  height: 24px;
  border-radius: 7px;
  box-shadow: 0 4px 12px -4px rgba(168, 85, 247, 0.7);
}
.brand-text {
  display: flex;
  flex-direction: column;
  line-height: 1.1;
}
.brand-text strong {
  font-size: 14px;
  letter-spacing: 1.5px;
  font-weight: 700;
}
.brand-text span {
  font-size: 8px;
  letter-spacing: 2.2px;
  color: var(--text-3);
  margin-top: 2px;
}
.scroll {
  flex: 1;
  overflow-y: auto;
  overflow-x: hidden;
  padding: 6px 10px 12px;
}
.group {
  margin-bottom: 16px;
}
.group-label {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 0 8px;
  margin-bottom: 4px;
  font-size: 10.5px;
  letter-spacing: 1px;
  color: var(--text-3);
  text-transform: uppercase;
  height: 22px;
}
.mini-add {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 20px;
  height: 20px;
  border-radius: 6px;
  color: var(--text-3);
}
.mini-add:hover {
  background: var(--panel-2);
  color: var(--text);
}
.nav-item {
  display: flex;
  align-items: center;
  gap: 10px;
  width: 100%;
  height: 34px;
  padding: 0 9px;
  border-radius: 9px;
  color: var(--text-2);
  font-size: 12.5px;
  text-align: left;
  transition: background 0.15s, color 0.15s;
  position: relative;
}
.nav-item span:not(.count):not(.dot-new) {
  flex: 1;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.nav-item:hover {
  background: var(--hover);
  color: var(--text);
}
.nav-item.active {
  background: var(--accent-soft);
  color: var(--text);
  font-weight: 500;
}
.nav-item.active::before {
  content: '';
  position: absolute;
  left: -10px;
  top: 50%;
  transform: translateY(-50%);
  width: 3px;
  height: 16px;
  border-radius: 0 3px 3px 0;
  background: var(--accent);
}
.nav-item.active :deep(svg) {
  color: var(--accent);
}
.count {
  font-size: 10.5px;
  color: var(--text-3);
  font-variant-numeric: tabular-nums;
}
.dot-new {
  font-size: 8px;
  font-weight: 700;
  letter-spacing: 0.5px;
  color: var(--accent);
  border: 1px solid currentColor;
  border-radius: 3px;
  padding: 0 3px;
  line-height: 11px;
}
.playlist {
  height: 32px;
  font-size: 12px;
}
.create-row {
  padding: 3px 2px 5px;
}
.create-input {
  width: 100%;
  height: 30px;
  padding: 0 9px;
  border-radius: 8px;
  border: 1px solid var(--accent);
  background: var(--panel);
  font-size: 12px;
  outline: none;
}
.empty-hint {
  font-size: 11px;
  line-height: 1.7;
  color: var(--text-3);
  padding: 6px 9px;
}
.foot {
  flex: none;
  padding: 8px 10px 10px;
  border-top: 1px solid var(--line);
  display: flex;
  align-items: center;
  gap: 6px;
}
.foot .nav-item {
  flex: 1;
}

/* ---------------- 侧栏折叠 ---------------- */
.brand {
  position: relative;
}
.collapse-btn {
  flex: none;
  width: 26px;
  height: 26px;
  display: grid;
  place-items: center;
  border: 0;
  border-radius: 8px;
  background: transparent;
  color: var(--text-3);
  cursor: pointer;
  opacity: 0;
  transition: opacity 0.18s, background 0.18s;
}
.brand:hover .collapse-btn {
  opacity: 1;
}
.collapse-btn:hover {
  background: var(--hover);
  color: var(--text);
}

.sidebar.collapsed {
  width: 76px;
}
.sidebar.collapsed .brand {
  justify-content: center;
  padding-left: 0;
  padding-right: 0;
}
.sidebar.collapsed .brand-text,
.sidebar.collapsed .group-label,
.sidebar.collapsed .nav-item span,
.sidebar.collapsed .dot-new {
  display: none;
}
.sidebar.collapsed .collapse-btn {
  opacity: 1;
  position: absolute;
  right: 4px;
  top: 14px;
  width: 20px;
  height: 20px;
}
.sidebar.collapsed .nav-item {
  justify-content: center;
  padding-left: 0;
  padding-right: 0;
  gap: 0;
}
.sidebar.collapsed .group {
  margin-top: 10px;
}
</style>
