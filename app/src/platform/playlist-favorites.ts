/**
 * 歌单收藏（规格书 3.8 / Bug 13 · 独立模块）
 *
 * xinyuan_fav_playlists：本地收藏歌单（id、名称、封面、来源平台），
 * 仅本地记录不做云同步（规格 0.4）。歌单详情页收藏按钮、
 * 「我的」页/侧栏收藏列表共用本模块。
 */
import { ref, type Ref } from 'vue'
import { lsJson as lsGetJson, lsSetJson } from '@/platform'

export interface FavPlaylist {
  /** 形如 wy:123456 / qq:987654 */
  id: string
  name: string
  pic?: string
  author?: string
  source?: string
  count?: number
  at: number
}

const KEY = 'fav_playlists'
const MAX = 200

const items = ref<FavPlaylist[]>(lsGetJson<FavPlaylist[]>(KEY, []))

function persist(): void {
  lsSetJson(KEY, items.value)
}

export function favPlaylists(): Ref<FavPlaylist[]> {
  return items
}

export function isFavPlaylist(id: string): boolean {
  return items.value.some(x => x.id === id)
}

export function toggleFavPlaylist(meta: Omit<FavPlaylist, 'at'>): boolean {
  const exists = items.value.some(x => x.id === meta.id)
  if (exists) {
    items.value = items.value.filter(x => x.id !== meta.id)
  } else {
    items.value = [{ ...meta, at: Date.now() }, ...items.value].slice(0, MAX)
  }
  persist()
  return !exists
}

export function removeFavPlaylist(id: string): void {
  items.value = items.value.filter(x => x.id !== id)
  persist()
}
