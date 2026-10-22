<script setup lang="ts">
import { computed } from 'vue'
import { useRouter } from 'vue-router'
import Icon from '@/components/Icon.vue'
import { useLibraryStore } from '@/stores/library'
import { useDownloadStore } from '@/stores/download'

/** 「我的」二级中枢页（移动端多级跳转）：底栏不平铺，
 *  歌单/历史/本地/MV/设置等二级入口集中在这里，点入后走正常路由栈、返回键回退。 */
const router = useRouter()
const library = useLibraryStore()
const download = useDownloadStore()

const quick = computed(() => [
  { path: '/favorites', icon: 'heart', label: '我喜欢的音乐', meta: library.favoriteCount ? `${library.favoriteCount} 首` : '' },
  { path: '/downloads', icon: 'download', label: '下载管理', meta: download.runningCount ? `${download.runningCount} 个进行中` : download.tasks.length ? `${download.tasks.length} 条记录` : '' },
  { path: '/history', icon: 'clock', label: '最近播放', meta: library.history.length ? `${library.history.length} 首` : '' },
  { path: '/local', icon: 'folder', label: '本地音乐', meta: library.localCount ? `${library.localCount} 首` : '' },
  { path: '/mv', icon: 'video', label: '视频 / MV', meta: '' },
  { path: '/settings', icon: 'settings', label: '设置', meta: '' },
])

const go = (path: string) => void router.push(path)
</script>

<template>
  <div class="page">
    <header class="head">
      <div>
        <h1>我的</h1>
        <p>收藏、下载、歌单与本地内容</p>
      </div>
    </header>

    <section class="sec">
      <button v-for="item in quick" :key="item.path" class="mine-item" @click="go(item.path)">
        <span class="mi-icon"><Icon :name="item.icon" :size="18" /></span>
        <span class="mi-label">{{ item.label }}</span>
        <span v-if="item.meta" class="mi-meta">{{ item.meta }}</span>
        <Icon name="chevron-right" :size="15" class="mi-arrow" />
      </button>
    </section>

    <section class="sec">
      <div class="sec-head">
        <h2>我的歌单</h2>
        <span class="sec-meta">{{ library.playlists.length }} 个</span>
      </div>
      <button
        v-for="pl in library.playlists"
        :key="pl.id"
        class="mine-item"
        @click="go(`/playlist/${pl.id}`)"
      >
        <span class="mi-icon"><Icon name="list" :size="18" /></span>
        <span class="mi-label ellipsis">{{ pl.name }}</span>
        <span class="mi-meta">{{ pl.songCount ?? 0 }} 首</span>
        <Icon name="chevron-right" :size="15" class="mi-arrow" />
      </button>
      <div v-if="!library.playlists.length" class="empty-hint">
        还没有歌单，去「发现音乐」导入平台歌单或点击侧栏 + 新建
      </div>
    </section>
  </div>
</template>

<style scoped>
.head {
  padding: 14px 0 18px;
}
h1 {
  font-size: 27px;
  font-weight: 700;
}
.head p {
  margin-top: 5px;
  font-size: 12px;
  color: var(--text-3);
}
.sec {
  margin-bottom: 22px;
}
.sec-head {
  display: flex;
  align-items: baseline;
  gap: 8px;
  margin-bottom: 6px;
}
.sec-head h2 {
  font-size: 15px;
  font-weight: 600;
}
.sec-meta {
  font-size: 11px;
  color: var(--text-3);
}
.mine-item {
  display: flex;
  align-items: center;
  gap: 12px;
  width: 100%;
  height: 48px;
  padding: 0 12px;
  border-radius: 10px;
  color: var(--text-2);
  font-size: 13.5px;
  text-align: left;
  transition: background 0.15s;
}
.mine-item:hover {
  background: var(--hover);
  color: var(--text);
}
.mi-icon {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 32px;
  height: 32px;
  border-radius: 9px;
  background: var(--accent-soft);
  color: var(--accent);
  flex: none;
}
.mi-label {
  flex: 1;
  min-width: 0;
}
.ellipsis {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.mi-meta {
  font-size: 11.5px;
  color: var(--text-3);
  flex: none;
}
.mi-arrow {
  color: var(--text-3);
  flex: none;
}
.empty-hint {
  font-size: 12px;
  line-height: 1.7;
  color: var(--text-3);
  padding: 8px 12px;
}
</style>
