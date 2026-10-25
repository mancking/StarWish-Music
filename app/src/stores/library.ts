import { defineStore } from 'pinia'
import { computed, ref } from 'vue'
import type { PlaylistMeta, ScanProgress, Song } from '@shared/types'
import { call, on } from '@/api'
import { useUiStore } from './ui'

interface PlaylistWithCount extends PlaylistMeta {
  songCount?: number
}

export const useLibraryStore = defineStore('library', () => {
  const ui = useUiStore()
  const favorites = ref<Song[]>([])
  const favIds = ref<Set<string>>(new Set())
  const playlists = ref<PlaylistWithCount[]>([])
  const localSongs = ref<Song[]>([])
  const localTotal = ref(0)
  const history = ref<Song[]>([])
  const scanProgress = ref<ScanProgress>({ phase: 'idle', found: 0, parsed: 0, current: '' })
  const loading = ref(false)

 /**本地曲库分页懒加载，首屏只拉一页 */
  const LOCAL_PAGE = 200

  const favoriteCount = computed(() => favorites.value.length)
  const localCount = computed(() => (localTotal.value > localSongs.value.length ? localTotal.value : localSongs.value.length))

  async function init(): Promise<void> {
    loading.value = true
    const [fav, pls, local, total, hist] = await Promise.all([
      call<Song[]>('db:favorites').catch(() => []),
      call<PlaylistWithCount[]>('db:playlists').catch(() => []),
      call<Song[]>('library:songs', { limit: LOCAL_PAGE, offset: 0 }).catch(() => []),
      call<number>('library:count').catch(() => 0),
      call<Song[]>('db:history', { limit: 120 }).catch(() => []),
    ])
    favorites.value = fav
    favIds.value = new Set(fav.map(s => s.id))
    playlists.value = pls
    localSongs.value = local
    localTotal.value = total
    history.value = hist
    loading.value = false

    on('scan:progress', (p: ScanProgress) => {
      scanProgress.value = p
      if (p.phase === 'done') {
        void refreshLocal()
      }
    })
 //sources:changed 真实消费者 —— 音源增删后刷新平台列表与本地状态
    on('sources:changed', async () => {
      try {
        // 平台缓存失效：播放器/搜索层下次直接重取（platformList 变化）
        await call<any>('sources:platforms').catch(() => null)
        // 设置页音源列表等由各自页面监听本事件刷新；这里刷新曲库侧依赖
      } catch {
        /* ignore */
      }
    })
  }

  function isFavorite(id: string): boolean {
    return favIds.value.has(id)
  }

  async function toggleFavorite(song: Song): Promise<void> {
    try {
      const r = await call<{ favorite: boolean; ids: string[] }>('db:favorite:toggle', { song })
      favIds.value = new Set(r.ids)
      if (r.favorite) {
        if (!favorites.value.some(s => s.id === song.id)) favorites.value = [song, ...favorites.value]
      } else {
        favorites.value = favorites.value.filter(s => s.id !== song.id)
      }
    } catch (e: any) {
      ui.toast(e.message, 'error')
    }
  }

  async function refreshFavorites(): Promise<void> {
    favorites.value = await call<Song[]>('db:favorites').catch(() => [])
    favIds.value = new Set(favorites.value.map(s => s.id))
  }

  async function refreshPlaylists(): Promise<void> {
    playlists.value = await call<PlaylistWithCount[]>('db:playlists').catch(() => [])
  }

  async function createPlaylist(name: string): Promise<PlaylistMeta | null> {
    try {
      const r = await call<{ playlist: PlaylistMeta; list: PlaylistWithCount[] }>('db:playlist:create', { name })
      playlists.value = r.list
      ui.toast('歌单已创建', 'success', 1600)
      return r.playlist
    } catch (e: any) {
      ui.toast(e.message, 'error')
      return null
    }
  }

  async function renamePlaylist(id: string, name: string): Promise<void> {
    try {
      playlists.value = await call<PlaylistWithCount[]>('db:playlist:update', { id, patch: { name } })
      ui.toast('已重命名', 'success', 1600)
    } catch (e: any) {
      ui.toast(e.message, 'error')
    }
  }

  async function deletePlaylist(id: string): Promise<void> {
    try {
      playlists.value = await call<PlaylistWithCount[]>('db:playlist:delete', { id })
      ui.toast('歌单已删除', 'success', 1600)
    } catch (e: any) {
      ui.toast(e.message, 'error')
    }
  }

  async function addSongsToPlaylist(playlistId: string, songs: Song[]): Promise<void> {
    try {
      const r = await call<{ added: number; list: PlaylistWithCount[] }>('db:playlist:add', { id: playlistId, songs })
      playlists.value = r.list
    } catch (e: any) {
      ui.toast(e.message, 'error')
    }
  }

  async function removeSong(playlistId: string, songId: string): Promise<void> {
    try {
      await call('db:playlist:remove', { id: playlistId, songId })
      await refreshPlaylists()
    } catch (e: any) {
      ui.toast(e.message, 'error')
    }
  }

  async function refreshLocal(): Promise<void> {
    const [rows, total] = await Promise.all([
      call<Song[]>('library:songs', { limit: LOCAL_PAGE, offset: 0 }).catch(() => [] as Song[]),
      call<number>('library:count').catch(() => 0),
    ])
    localSongs.value = rows
    localTotal.value = total
  }

 /** 追加下一页本地曲目；返回是否还有更多 */
  async function loadMoreLocal(): Promise<boolean> {
    if (localSongs.value.length >= localTotal.value) return false
    const next = await call<Song[]>('library:songs', {
      limit: LOCAL_PAGE,
      offset: localSongs.value.length,
    }).catch(() => [] as Song[])
    if (!next.length) return false
    localSongs.value = localSongs.value.concat(next)
    return localSongs.value.length < localTotal.value
  }

  async function refreshHistory(): Promise<void> {
    history.value = await call<Song[]>('db:history', { limit: 120 }).catch(() => [])
  }

  async function scan(dirs?: string[]): Promise<void> {
    try {
      const r = await call<{ started: boolean; dirs: string[] }>('library:scan', { dirs: dirs || [] })
      if (r.started) ui.toast('已开始扫描本地音乐', 'info', 1800)
    } catch (e: any) {
      ui.toast(e.message, 'error')
    }
  }

  async function pickAndScan(): Promise<void> {
    try {
      const dirs = await call<string[]>('library:pick')
      if (!dirs.length) return
      await scan(dirs)
    } catch (e: any) {
      ui.toast(e.message, 'error')
    }
  }

  async function clearHistory(): Promise<void> {
    try {
      await call('db:history:clear')
      history.value = []
      ui.toast('播放历史已清空', 'success', 1600)
    } catch (e: any) {
      ui.toast(e.message, 'error')
    }
  }

  return {
    favorites,
    favIds,
    playlists,
    localSongs,
    localTotal,
    history,
    scanProgress,
    loading,
    favoriteCount,
    localCount,
    init,
    isFavorite,
    toggleFavorite,
    refreshFavorites,
    refreshPlaylists,
    createPlaylist,
    renamePlaylist,
    deletePlaylist,
    addSongsToPlaylist,
    removeSong,
    refreshLocal,
    loadMoreLocal,
    refreshHistory,
    scan,
    pickAndScan,
    clearHistory,
  }
})
