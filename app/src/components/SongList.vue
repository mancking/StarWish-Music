<script setup lang="ts">
import { computed, ref } from 'vue'
import type { Song } from '@shared/types'
import { formatTime } from '@shared/lrc'
import Icon from './Icon.vue'
import Cover from './Cover.vue'
import Menu from './Menu.vue'
import type { MenuItem } from './menu-types'
import { usePlayerStore } from '@/stores/player'
import { useLibraryStore } from '@/stores/library'
import { useUiStore } from '@/stores/ui'
import { platformLabel } from '@/utils/labels'

const props = withDefaults(
  defineProps<{
    songs: Song[]
    loading?: boolean
    showAlbum?: boolean
    showCover?: boolean
    showIndex?: boolean
    playlistId?: string
    emptyText?: string
    emptyDesc?: string
    compact?: boolean
  }>(),
  {
    loading: false,
    showAlbum: true,
    showCover: true,
    showIndex: true,
    playlistId: '',
    emptyText: '暂无歌曲',
    emptyDesc: '',
    compact: false,
  }
)

const emit = defineEmits<{ (e: 'remove', index: number): void }>()

const player = usePlayerStore()
const library = useLibraryStore()
const ui = useUiStore()

const menu = ref<{ x: number; y: number; index: number } | null>(null)

const currentId = computed(() => player.state.song?.id || '')

function play(index: number): void {
  void player.playSongs(props.songs, index)
}

function openMenu(e: MouseEvent, index: number): void {
  e.stopPropagation()
  menu.value = { x: e.clientX, y: e.clientY, index }
}

function menuItems(index: number): MenuItem[] {
  const s = props.songs[index]
  if (!s) return []
  const fav = library.isFavorite(s.id)
  return [
    { label: '立即播放', icon: 'play' },
    { label: '下一首播放', icon: 'arrow-down' },
    { label: '添加到歌单', icon: 'plus' },
    { label: fav ? '取消喜欢' : '喜欢', icon: fav ? 'heart-filled' : 'heart' },
    ...(props.playlistId ? [{ divider: true, label: '' }, { label: '从歌单移除', icon: 'trash', danger: true }] : []),
  ]
}

async function onMenuSelect(i: number): Promise<void> {
  const m = menu.value
  if (!m) return
  const s = props.songs[m.index]
  menu.value = null
  if (!s) return
  if (i === 0) play(m.index)
  else if (i === 1) await player.addNext(s)
  else if (i === 2) ui.playlistPickerSong = s
  else if (i === 3) await library.toggleFavorite(s)
  else if (i === 4 && props.playlistId) {
    await library.removeSong(props.playlistId, s.id)
    emit('remove', m.index)
  }
}

function qualityTag(s: Song): string {
  const q = s.qualitys || []
  if (q.includes('flac24bit')) return '24bit'
  if (q.includes('flac')) return 'SQ'
  if (q.includes('320k')) return 'HQ'
  return ''
}

function platformTag(s: Song): string {
  if (!s.source) return ''
  if (s.source === 'local') return '本地'
  if (s.source === 'bili') return '视频'
  return platformLabel(s.source)
}

function albumOf(s: Song): string {
  return s.album || (s.localPath ? '本地文件' : '')
}
</script>

<template>
  <div class="song-list" :class="{ compact }">
    <div v-if="loading" class="loading-list">
      <div v-for="i in 8" :key="i" class="sk-row">
        <div class="sk" style="width: 38px; height: 38px; border-radius: 9px" />
        <div class="sk" style="height: 11px; width: 26%" />
        <div class="sk" style="height: 10px; width: 16%" />
      </div>
    </div>

    <div v-else-if="!songs.length" class="empty">
      <Icon name="music" :size="34" :stroke="1.3" />
      <div class="empty-title">{{ emptyText }}</div>
      <div v-if="emptyDesc" class="empty-desc">{{ emptyDesc }}</div>
    </div>

    <div v-else class="rows">
      <div class="list-head" :class="{ 'no-cover': !showCover }">
        <span v-if="showIndex" class="col-idx">#</span>
        <span class="col-name">歌曲</span>
        <span v-if="showAlbum" class="col-album">专辑</span>
        <span class="col-dur"><Icon name="clock" :size="13" /></span>
        <span class="col-actions" />
      </div>

      <div
        v-for="(s, i) in songs"
        :key="`${s.id}-${i}`"
        class="row row-hover"
        :class="{ active: s.id === currentId }"
        @click="play(i)"
      >
        <span v-if="showIndex" class="col-idx">
          <span class="idx-num">{{ i + 1 }}</span>
          <span class="idx-play"><Icon name="play" :size="12" /></span>
          <span v-if="s.id === currentId && player.playing" class="eq"><i /><i /><i /></span>
        </span>

        <span class="col-name">
          <Cover
            v-if="showCover"
            :src="s.pic"
            :alt="s.name"
            :size="compact ? 34 : 40"
            :radius="8"
            cover="1"
          />
          <span class="name-text">
            <span class="title-line">
              <span class="title ellipsis">{{ s.name }}</span>
              <span v-if="platformTag(s)" class="tag src-tag">{{ platformTag(s) }}</span>
              <span v-if="qualityTag(s)" class="tag" :class="{ quality: qualityTag(s) === '24bit' }">{{ qualityTag(s) }}</span>
            </span>
            <span class="sub ellipsis">{{ s.singer }}</span>
          </span>
        </span>

        <span v-if="showAlbum" class="col-album ellipsis">{{ albumOf(s) }}</span>
        <span class="col-dur mono">{{ formatTime(s.duration) }}</span>

        <span class="col-actions">
          <button
            class="icon-btn tiny"
            :class="{ liked: library.isFavorite(s.id) }"
            :title="library.isFavorite(s.id) ? '取消喜欢' : '喜欢'"
            @click.stop="library.toggleFavorite(s)"
          >
            <Icon :name="library.isFavorite(s.id) ? 'heart-filled' : 'heart'" :size="15" />
          </button>
          <button class="icon-btn tiny" title="更多" @click.stop="openMenu($event, i)">
            <Icon name="more" :size="15" />
          </button>
        </span>
      </div>
    </div>

    <Menu v-if="menu" :x="menu.x" :y="menu.y" :items="menuItems(menu.index)" @select="onMenuSelect" @close="menu = null" />
  </div>
</template>

<style scoped>
.song-list {
  width: 100%;
}
.list-head {
  display: grid;
  grid-template-columns: 42px minmax(180px, 2.4fr) minmax(120px, 1.4fr) 62px 74px;
  gap: 12px;
  align-items: center;
  padding: 0 10px 8px;
  font-size: 11.5px;
  color: var(--text-3);
  border-bottom: 1px solid var(--line);
  margin-bottom: 4px;
}
.list-head.no-cover {
  grid-template-columns: 42px minmax(180px, 2.4fr) minmax(120px, 1.4fr) 62px 74px;
}
.row {
  display: grid;
  grid-template-columns: 42px minmax(180px, 2.4fr) minmax(120px, 1.4fr) 62px 74px;
  gap: 12px;
  align-items: center;
  padding: 6px 10px;
  min-height: var(--row-h, 52px);
  border-radius: 9px;
  cursor: default;
  content-visibility: auto;
  contain-intrinsic-size: var(--row-h, 52px);
}
.row.active .title {
  color: var(--accent);
}
.col-idx {
  position: relative;
  display: flex;
  align-items: center;
  justify-content: center;
  color: var(--text-3);
  font-size: 12px;
  height: 20px;
}
.row:hover .idx-num,
.row:hover .idx-play {
  display: none;
}
.idx-play {
  display: none;
  color: var(--text);
}
.row:hover .idx-play {
  display: block;
}
.row:hover .eq {
  display: none;
}
.eq {
  display: flex;
  align-items: flex-end;
  gap: 2px;
  height: 13px;
}
.eq i {
  width: 2px;
  background: var(--accent);
  border-radius: 2px;
  animation: eq 0.9s ease-in-out infinite;
}
.eq i:nth-child(1) {
  height: 60%;
  animation-delay: -0.2s;
}
.eq i:nth-child(2) {
  height: 100%;
  animation-delay: -0.5s;
}
.eq i:nth-child(3) {
  height: 40%;
}
@keyframes eq {
  0%,
  100% {
    transform: scaleY(0.4);
  }
  50% {
    transform: scaleY(1);
  }
}
.col-name {
  display: flex;
  align-items: center;
  gap: 11px;
  min-width: 0;
}
.name-text {
  display: flex;
  flex-direction: column;
  gap: 2px;
  min-width: 0;
}
.title-line {
  display: flex;
  align-items: center;
  gap: 7px;
  min-width: 0;
}
.title {
  font-size: 13.5px;
  font-weight: 500;
}
.sub {
  font-size: 11.5px;
  color: var(--text-3);
}
.tag {
  display: inline-flex;
  align-items: center;
  /* 用 padding 撑高而非固定 height：固定 15px-边框后内容区仅 13px，字体基线会偏出方框 */
  padding: 1px 5px;
  line-height: 1.3;
  border-radius: 3px;
  font-size: 10px;
  font-weight: 500;
  letter-spacing: 0.3px;
  background: transparent;
  color: var(--accent);
  border: 1px solid var(--accent-soft);
  flex: none;
}
.tag.quality {
  color: #f0b429;
  border-color: rgba(240, 180, 41, 0.32);
}
.src-tag {
  color: var(--text-2);
  border-color: var(--line-2);
  background: var(--bg-2);
}
.col-album {
  font-size: 12px;
  color: var(--text-2);
}
.col-dur {
  font-size: 11.5px;
  color: var(--text-3);
  text-align: right;
  display: flex;
  justify-content: flex-end;
}
.col-actions {
  display: flex;
  justify-content: flex-end;
  gap: 2px;
  opacity: 0;
  transition: opacity 0.15s;
}
.row:hover .col-actions {
  opacity: 1;
}
.icon-btn.tiny {
  width: 26px;
  height: 26px;
  border-radius: 7px;
}
.icon-btn.tiny.liked {
  color: var(--accent);
}
.compact .row {
  padding: 4px 8px;
}
.sk-row {
  display: flex;
  align-items: center;
  gap: 14px;
  padding: 9px 10px;
}
.loading-list {
  padding-top: 6px;
}
@media (max-width: 1180px) {
  .list-head,
  .row {
    grid-template-columns: 38px minmax(160px, 2.6fr) 56px 68px;
  }
  .col-album {
    display: none;
  }
}
</style>
