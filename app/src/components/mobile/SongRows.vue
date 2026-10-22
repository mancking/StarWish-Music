<script setup lang="ts">
import { computed, ref } from 'vue'
import Icon from '@/components/Icon.vue'
import Cover from '@/components/Cover.vue'
import { usePlayerStore } from '@/stores/player'
import { useLibraryStore } from '@/stores/library'
import { useUiStore } from '@/stores/ui'
import { useDownloadStore } from '@/stores/download'
import type { Song } from '@shared/types'
import { formatTime } from '@shared/lrc'

/**
 * 移动端歌曲行列表（模板级独立实现）。
 *
 * 桌面 SongList 是表格语义（专辑/时长列 + hover 操作 + 桌面右键菜单），
 * 窄屏下会挤压、菜单用 clientX/Y 定位在触屏上弹不出来——这正是
 * 「榜单/歌单点进去打不开列表」的根因。这里为移动端重写一套：
 *   行 = 序号 + 封面 + 名称/歌手 + 时长 + 「更多」按钮
 *   「更多」用底部抽屉（ActionSheet），不用浮层定位
 */
const props = withDefaults(
  defineProps<{
    songs: Song[]
    showIndex?: boolean
    showCover?: boolean
    showDuration?: boolean
    emptyText?: string
    emptyDesc?: string
  }>(),
  {
    showIndex: false,
    showCover: true,
    showDuration: true,
    emptyText: '这里还没有歌曲',
    emptyDesc: '',
  }
)

const player = usePlayerStore()
const library = useLibraryStore()
const ui = useUiStore()
const download = useDownloadStore()

const currentId = computed(() => player.state.song?.id || '')

/** 正在播放的行高亮 */
function isCurrent(s: Song): boolean {
  return !!s.id && s.id === currentId.value
}

/* ---------------- 底部抽屉（更多操作） ---------------- */
const sheetOpen = ref(false)
const sheetSong = ref<Song | null>(null)

function openSheet(s: Song): void {
  sheetSong.value = s
  sheetOpen.value = true
}

function closeSheet(): void {
  sheetOpen.value = false
  sheetSong.value = null
}

async function likeCurrent(): Promise<void> {
  const s = sheetSong.value
  if (!s) return
  const was = library.isFavorite(s.id)
  await library.toggleFavorite(s)
  ui.toast(was ? '已取消喜欢' : '已加入我喜欢的音乐', was ? 'info' : 'success', 1500)
}

async function playNext(): Promise<void> {
  const s = sheetSong.value
  if (!s) return
  await player.addNext(s)
  ui.toast('已加入下一首播放', 'success', 1500)
}

async function addToPlaylist(): Promise<void> {
  const s = sheetSong.value
  if (!s) return
  closeSheet()
  ui.playlistPickerSong = s
}

async function doDownload(): Promise<void> {
  const s = sheetSong.value
  if (!s) return
  closeSheet()
  const n = await download.add([s])
  ui.toast(n ? '已加入下载队列' : '该歌曲已在下载记录中', n ? 'success' : 'info', 1800)
}
</script>

<template>
  <div class="m-rows">
    <div v-if="!props.songs.length" class="m-rows-empty">
      <Icon name="music" :size="28" :stroke="1.2" />
      <div class="t">{{ props.emptyText }}</div>
      <div v-if="props.emptyDesc" class="d">{{ props.emptyDesc }}</div>
    </div>

    <div
      v-for="(s, i) in props.songs"
      :key="s.id"
      class="m-row"
      :class="{ on: isCurrent(s) }"
      @click="player.playSongs(props.songs, i)"
    >
      <span v-if="props.showIndex" class="idx">{{ i + 1 }}</span>
      <Cover v-if="props.showCover" :src="s.pic || ''" :size="44" radius="9" class="cov" />
      <span class="meta">
        <span class="name">{{ s.name }}</span>
        <span class="sub">{{ s.singer }}</span>
      </span>
      <span v-if="props.showDuration" class="dur">{{ formatTime(s.duration || 0) }}</span>
      <button class="more" aria-label="更多操作" @click.stop="openSheet(s)">
        <Icon name="more" :size="18" />
      </button>
    </div>

    <!-- 底部操作抽屉 -->
    <Transition name="sheet">
      <div v-if="sheetOpen && sheetSong" class="sheet-mask" @click="closeSheet">
        <div class="sheet" @click.stop>
          <div class="sheet-head">
            <Cover :src="sheetSong.pic || ''" :size="48" radius="10" />
            <div class="sh-meta">
              <div class="sh-name">{{ sheetSong.name }}</div>
              <div class="sh-sub">{{ sheetSong.singer }}</div>
            </div>
            <button class="sh-close" aria-label="关闭" @click="closeSheet">
              <Icon name="close" :size="18" />
            </button>
          </div>
          <div class="sheet-items">
            <button @click="likeCurrent">
              <Icon :name="library.isFavorite(sheetSong.id) ? 'heart-filled' : 'heart'" :size="18" />
              {{ library.isFavorite(sheetSong.id) ? '取消喜欢' : '喜欢' }}
            </button>
            <button @click="playNext">
              <Icon name="queue" :size="18" />下一首播放
            </button>
            <button @click="addToPlaylist">
              <Icon name="plus" :size="18" />添加到歌单
            </button>
            <button v-if="sheetSong.source !== 'local' && !sheetSong.localPath" @click="doDownload">
              <Icon name="download" :size="18" />下载到本地
            </button>
          </div>
        </div>
      </div>
    </Transition>
  </div>
</template>

<style scoped>
.m-rows {
  display: flex;
  flex-direction: column;
  gap: 2px;
}
.m-rows-empty {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 8px;
  padding: 48px 20px;
  color: var(--text-3);
  text-align: center;
}
.m-rows-empty .t {
  font-size: 14px;
  color: var(--text-2);
}
.m-rows-empty .d {
  font-size: 12.5px;
  line-height: 1.6;
}
.m-row {
  display: flex;
  align-items: center;
  gap: 11px;
  min-height: 58px;
  padding: 6px 8px;
  border-radius: 12px;
  -webkit-tap-highlight-color: transparent;
}
.m-row:active {
  background: var(--bg-2);
}
.m-row.on {
  background: var(--accent-soft);
}
.m-row.on .name {
  color: var(--accent);
}
.idx {
  flex: none;
  width: 22px;
  text-align: center;
  font-size: 13px;
  font-weight: 700;
  color: var(--text-3);
}
.cov {
  flex: none;
}
.meta {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 2px;
}
.name {
  font-size: 14.5px;
  font-weight: 600;
  color: var(--text);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.sub {
  font-size: 12px;
  color: var(--text-3);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.dur {
  flex: none;
  font-size: 12px;
  color: var(--text-3);
  font-variant-numeric: tabular-nums;
}
.more {
  flex: none;
  width: 40px;
  height: 40px;
  display: grid;
  place-items: center;
  border: 0;
  border-radius: 10px;
  background: transparent;
  color: var(--text-3);
  -webkit-tap-highlight-color: transparent;
}
.more:active {
  background: var(--hover);
}

/* ---- 底部抽屉 ---- */
.sheet-mask {
  position: fixed;
  inset: 0;
  z-index: 200;
  background: rgba(0, 0, 0, 0.45);
  display: flex;
  align-items: flex-end;
  backdrop-filter: blur(3px);
}
.sheet {
  width: 100%;
  padding: 16px 14px calc(20px + env(safe-area-inset-bottom, 0px));
  border-radius: 20px 20px 0 0;
  background: var(--bg-2);
  border: 1px solid var(--line);
  border-bottom: 0;
}
.sheet-head {
  display: flex;
  align-items: center;
  gap: 12px;
  padding-bottom: 12px;
  border-bottom: 1px solid var(--line);
}
.sh-meta {
  flex: 1;
  min-width: 0;
}
.sh-name {
  font-size: 15px;
  font-weight: 600;
  color: var(--text);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.sh-sub {
  margin-top: 2px;
  font-size: 12px;
  color: var(--text-3);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.sh-close {
  flex: none;
  width: 36px;
  height: 36px;
  display: grid;
  place-items: center;
  border: 0;
  border-radius: 50%;
  background: var(--bg);
  color: var(--text-2);
}
.sheet-items {
  display: flex;
  flex-direction: column;
  padding-top: 8px;
}
.sheet-items button {
  display: flex;
  align-items: center;
  gap: 14px;
  height: 52px;
  padding: 0 6px;
  border: 0;
  border-radius: 12px;
  background: none;
  color: var(--text);
  font-size: 15px;
  text-align: left;
  -webkit-tap-highlight-color: transparent;
}
.sheet-items button:active {
  background: var(--bg);
}
.sheet-enter-active,
.sheet-leave-active {
  transition: opacity 0.2s;
}
.sheet-enter-active .sheet,
.sheet-leave-active .sheet {
  transition: transform 0.22s var(--ease);
}
.sheet-enter-from,
.sheet-leave-to {
  opacity: 0;
}
.sheet-enter-from .sheet,
.sheet-leave-to .sheet {
  transform: translateY(100%);
}
</style>
