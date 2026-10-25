import { reactive } from 'vue'
import { on } from '@/api'
import type { Song } from '@shared/types'

/**
 * 歌曲封面实时补丁
 *
 * 背景：wy 搜索只返回 picId、kg 公开接口完全不返回封面、QQ smartbox 也不带专辑图，
 * 于是列表里长期是渐变占位符。后端在搜索返回后异步回填封面并广播 `cover:patched`，
 * 这里按 song.id 收下增量，列表渲染时用 `coverOf(song)` 取「原始 pic 或补丁」。
 *
 * 这样做的意义：
 *  - 搜索不被封面请求拖慢（列表先出，封面随后补上）；
 *  - 用户不需要「点进播放页再退回来」才能看到封面。
 */
const patch = reactive<Record<string, string>>({})
let bound = false

function bind(): void {
  if (bound) return
  bound = true
  try {
    on('cover:patched', (list: { id: string; pic: string }[]) => {
      if (!Array.isArray(list)) return
      for (const it of list) {
        if (it?.id && it?.pic) patch[it.id] = it.pic
      }
    })
  } catch {
    /* 非桌面端（WebView 无该事件）时静默：移动端封面由后端直接带上 */
  }
}

/** 取歌曲封面：优先歌曲自带 pic，其次实时补丁 */
export function coverOf(song: Song | null | undefined): string {
  if (!song) return ''
  bind()
  return song.pic || patch[song.id] || ''
}

export function useCoverPatch(): { coverOf: typeof coverOf } {
  bind()
  return { coverOf }
}
