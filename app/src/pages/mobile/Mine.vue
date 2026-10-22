<script setup lang="ts">
import { computed, defineOptions, ref } from 'vue'
import { useRouter } from 'vue-router'
import Icon from '@/components/Icon.vue'
import { useLibraryStore } from '@/stores/library'
import { useDownloadStore } from '@/stores/download'
import { usePlayerStore } from '@/stores/player'

/**
 * 移动端「我的」—— 分模块设计（v2.3.2 重写）。
 *
 * 参照市面主流音乐 App（网易云 / QQ音乐）的「我的」页信息架构：
 * 每个功能域是独立模块，各模块各自成卡、互不掺放——
 *   ① 资料模块（头像 / 称呼 / 状态，右上角独立设置入口）
 *   ② 快捷宫格模块（我喜欢的 / 本地音乐 / 最近播放 / 下载管理，四宫格大图标）
 *   ③ 歌单模块（自带「新建」内联创建，独立成区）
 *   ④ 内容模块（视频 MV，独立成区）
 *   ⑤ 系统模块（设置，独立成区）
 */
defineOptions({ name: 'Mine' })

const router = useRouter()
const library = useLibraryStore()
const download = useDownloadStore()
const player = usePlayerStore()

const creating = ref(false)
const newName = ref('')

const quickEntries = computed(() => [
  { path: '/favorites', icon: 'heart', label: '我喜欢的', meta: library.favoriteCount ? `${library.favoriteCount}` : '' },
  { path: '/local', icon: 'folder', label: '本地音乐', meta: library.localCount ? `${library.localCount}` : '' },
  { path: '/history', icon: 'clock', label: '最近播放', meta: library.history.length ? `${library.history.length}` : '' },
  { path: '/downloads', icon: 'download', label: '下载管理', meta: download.runningCount ? `${download.runningCount}` : '' },
])

const go = (path: string) => {
  if (path) void router.push(path)
}

async function createPlaylist(): Promise<void> {
  const name = newName.value.trim()
  if (!name) {
    creating.value = false
    return
  }
  await library.createPlaylist(name)
  newName.value = ''
  creating.value = false
}
</script>

<template>
  <div class="page mine3">
    <!-- ① 资料模块 -->
    <section class="mod profile">
      <div class="profile-main">
        <div class="avatar"><Icon name="user" :size="24" /></div>
        <div class="who">
          <b>星河听众</b>
          <span>{{ player.playing ? '正在听歌' : '乐享此刻' }}</span>
        </div>
      </div>
      <button class="gear" aria-label="设置" @click="go('/settings')">
        <Icon name="settings" :size="19" />
      </button>
    </section>

    <!-- ② 快捷宫格模块 -->
    <section class="mod grid-mod">
      <button v-for="e in quickEntries" :key="e.path" class="g-item" @click="go(e.path)">
        <span class="g-icon"><Icon :name="e.icon" :size="20" /></span>
        <span class="g-label">{{ e.label }}</span>
        <span v-if="e.meta" class="g-badge">{{ e.meta }}</span>
      </button>
    </section>

    <!-- ③ 歌单模块（独立） -->
    <section class="mod">
      <header class="mod-head">
        <h2>我的歌单</h2>
        <button class="mod-act" @click="creating = !creating">
          <Icon name="plus" :size="14" />新建
        </button>
      </header>
      <div v-if="creating" class="create-row">
        <input v-model="newName" type="text" placeholder="歌单名称" maxlength="30" @keydown.enter="createPlaylist" />
        <button class="create-ok" @click="createPlaylist">创建</button>
      </div>
      <div class="mod-card">
        <button v-for="pl in library.playlists" :key="pl.id" class="row" @click="go(`/playlist/${pl.id}`)">
          <span class="row-icon tint-list"><Icon name="list" :size="16" /></span>
          <span class="row-label ellipsis">{{ pl.name }}</span>
          <span class="row-meta">{{ pl.songCount ?? 0 }} 首</span>
          <Icon name="chevron-right" :size="14" class="row-arrow" />
        </button>
        <div v-if="!library.playlists.length" class="none">
          还没有歌单。去「发现音乐」导入平台歌单，或点右上角「新建」。
        </div>
      </div>
    </section>

    <!-- ④ 内容模块（视频，独立） -->
    <section class="mod">
      <header class="mod-head"><h2>视频内容</h2></header>
      <div class="mod-card">
        <button class="row" @click="go('/mv')">
          <span class="row-icon tint-video"><Icon name="video" :size="16" /></span>
          <span class="row-label">视频 / MV</span>
          <span class="row-meta">B 站曲库</span>
          <Icon name="chevron-right" :size="14" class="row-arrow" />
        </button>
      </div>
    </section>

    <!-- ⑤ 系统模块（设置，独立） -->
    <section class="mod">
      <header class="mod-head"><h2>应用</h2></header>
      <div class="mod-card">
        <button class="row" @click="go('/settings')">
          <span class="row-icon tint-gear"><Icon name="settings" :size="16" /></span>
          <span class="row-label">设置</span>
          <span class="row-meta">音源 / 播放 / 通用</span>
          <Icon name="chevron-right" :size="14" class="row-arrow" />
        </button>
      </div>
    </section>
  </div>
</template>

<style scoped>
.mine3 {
  padding-bottom: 30px;
}
.mod {
  margin-top: 18px;
}
.mod:first-child {
  margin-top: 8px;
}

/* ① 资料 */
.profile {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 18px 16px;
  border-radius: 18px;
  background: linear-gradient(135deg, color-mix(in srgb, var(--accent, #ff4d6d) 18%, var(--bg-2)), var(--bg-2));
  border: 1px solid var(--line);
}
.profile-main {
  display: flex;
  align-items: center;
  gap: 12px;
}
.avatar {
  width: 50px;
  height: 50px;
  border-radius: 50%;
  display: flex;
  align-items: center;
  justify-content: center;
  background: var(--accent-soft);
  color: var(--accent);
}
.who {
  display: flex;
  flex-direction: column;
  gap: 2px;
}
.who b {
  font-size: 16.5px;
  color: var(--text);
}
.who span {
  font-size: 12px;
  color: var(--text-3);
}
.gear {
  width: 42px;
  height: 42px;
  border-radius: 50%;
  border: 1px solid var(--line);
  background: var(--bg);
  color: var(--text-2);
  display: inline-flex;
  align-items: center;
  justify-content: center;
  -webkit-tap-highlight-color: transparent;
}

/* ② 四宫格 */
.grid-mod {
  display: grid;
  grid-template-columns: repeat(4, 1fr);
  gap: 8px;
}
.g-item {
  position: relative;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 8px;
  padding: 14px 4px 12px;
  border-radius: 16px;
  border: 1px solid var(--line);
  background: var(--bg-2);
  -webkit-tap-highlight-color: transparent;
}
.g-item:active {
  filter: brightness(1.15);
}
.g-icon {
  width: 42px;
  height: 42px;
  border-radius: 14px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  background: var(--accent-soft);
  color: var(--accent);
}
.g-label {
  font-size: 11.5px;
  color: var(--text-2);
}
.g-badge {
  position: absolute;
  top: 6px;
  right: 8px;
  min-width: 18px;
  height: 18px;
  padding: 0 5px;
  border-radius: 9px;
  background: var(--accent);
  color: #fff;
  font-size: 10px;
  line-height: 18px;
  text-align: center;
}

/* 模块头 */
.mod-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin: 0 2px 8px;
}
.mod-head h2 {
  font-size: 15.5px;
  font-weight: 700;
  color: var(--text);
}
.mod-act {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  height: 32px;
  padding: 0 12px;
  border-radius: 16px;
  border: 1px solid var(--line);
  background: var(--bg-2);
  color: var(--text-2);
  font-size: 12px;
  -webkit-tap-highlight-color: transparent;
}

/* 模块卡 */
.mod-card {
  border-radius: 16px;
  background: var(--bg-2);
  border: 1px solid var(--line);
  overflow: hidden;
}
.create-row {
  display: flex;
  gap: 8px;
  margin-bottom: 8px;
}
.create-row input {
  flex: 1;
  min-width: 0;
  height: 42px;
  padding: 0 13px;
  border-radius: 12px;
  border: 1px solid var(--line);
  background: var(--bg-2);
  color: var(--text);
  font-size: 14px;
  outline: none;
}
.create-ok {
  flex: none;
  height: 42px;
  padding: 0 18px;
  border: 0;
  border-radius: 12px;
  background: var(--accent);
  color: #fff;
  font-size: 13.5px;
  font-weight: 600;
}
.row {
  display: flex;
  align-items: center;
  gap: 12px;
  width: 100%;
  min-height: 54px;
  padding: 0 14px;
  border: 0;
  border-bottom: 1px solid var(--line);
  background: none;
  text-align: left;
  -webkit-tap-highlight-color: transparent;
}
.row:last-child {
  border-bottom: 0;
}
.row:active {
  filter: brightness(1.15);
}
.row-icon {
  width: 32px;
  height: 32px;
  border-radius: 10px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  flex: none;
}
.tint-list {
  background: color-mix(in srgb, #7c9cff 16%, transparent);
  color: #7c9cff;
}
.tint-video {
  background: color-mix(in srgb, #ff4d6d 15%, transparent);
  color: #ff4d6d;
}
.tint-gear {
  background: color-mix(in srgb, #a855f7 15%, transparent);
  color: #a855f7;
}
.row-label {
  flex: 1;
  min-width: 0;
  font-size: 14.5px;
  color: var(--text);
}
.row-meta {
  flex: none;
  font-size: 12px;
  color: var(--text-3);
}
.row-arrow {
  flex: none;
  color: var(--text-3);
  opacity: 0.7;
}
.none {
  padding: 18px 14px;
  font-size: 12.5px;
  color: var(--text-3);
  line-height: 1.6;
}
</style>
