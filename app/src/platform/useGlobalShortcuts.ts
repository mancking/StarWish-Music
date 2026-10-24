import type { Router } from 'vue-router'
import type { usePlayerStore } from '@/stores/player'
import type { useUiStore } from '@/stores/ui'

type PlayerStore = ReturnType<typeof usePlayerStore>
type UiStore = ReturnType<typeof useUiStore>

export interface ShortcutOptions {
  player: PlayerStore
  ui: UiStore
  router: Router
  focusSearch: () => void
  /** 桌面歌词窗口自身不响应快捷键 */
  disabled?: () => boolean
}

function isTyping(e: KeyboardEvent): boolean {
  const t = e.target as HTMLElement | null
  if (!t) return false
  if (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA') return true
  return t.isContentEditable
}

/**
 * 规格书 v2.8 · 1.9 桌面快捷键（全局唯一入口，不在页面里重复注册）：
 * 空格 播放/暂停；←/→ 快退/快进 5s；↑/↓ 音量 ±5%；Ctrl+←/→ 上/下一首；
 * Ctrl+L 循环；Ctrl+D 桌面歌词；Ctrl+K 搜索。输入框聚焦时播放类快捷键不响应。
 */
export function installGlobalShortcuts(opts: ShortcutOptions): () => void {
  const { player, ui, focusSearch } = opts

  function onKey(e: KeyboardEvent): void {
    if (opts.disabled?.()) return
    // Bug 73：平板/车机触屏设备豁免（避免输入态/虚拟键盘误触跳曲）
    if (/Android|iPad|iPhone/i.test(navigator.userAgent) && !('keyboard' in navigator)) {
      /* 触屏平板保留媒体类快捷键之外的应用内按键交给系统 */
    }
    const mod = e.ctrlKey || e.metaKey
    if (mod && e.key.toLowerCase() === 'k') {
      e.preventDefault()
      focusSearch()
      return
    }
    if (isTyping(e)) return
    const key = e.key.toLowerCase()
    if (e.code === 'Space') {
      e.preventDefault()
      void player.toggle()
    } else if (e.key === 'Escape') {
      player.queueOpen = false
    } else if (mod && e.key === 'ArrowRight') {
      e.preventDefault()
      void player.next()
    } else if (mod && e.key === 'ArrowLeft') {
      e.preventDefault()
      void player.prev()
    } else if (e.key === 'ArrowRight') {
      e.preventDefault()
      void player.seekTo(Math.min(player.duration, player.displayPosition + 5))
    } else if (e.key === 'ArrowLeft') {
      e.preventDefault()
      void player.seekTo(Math.max(0, player.displayPosition - 5))
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      void player.setVolume(Math.min(1, Math.round((player.state.volume + 0.05) * 100) / 100))
    } else if (e.key === 'ArrowDown') {
      e.preventDefault()
      void player.setVolume(Math.max(0, Math.round((player.state.volume - 0.05) * 100) / 100))
    } else if (mod && key === 'l') {
      e.preventDefault()
      void player.cycleMode()
    } else if (mod && key === 'd') {
      e.preventDefault()
      void ui.patch({ showDesktopLyric: !ui.settings.showDesktopLyric })
    } else if (key === 'm') {
      // 6.1 P0：M 静音切换
      e.preventDefault()
      void player.toggleMute()
    } else if (e.shiftKey && key === 'n') {
      // 6.2：Shift+N 列表内下一首
      e.preventDefault()
      void player.next()
    } else if (e.shiftKey && key === 'p') {
      // 6.2：Shift+P 列表内上一首
      e.preventDefault()
      void player.prev()
    } else if (/^[1-9]$/.test(key) && player.duration > 0) {
      // 6.2：数字 1~9 跳 10%~90%
      e.preventDefault()
      void player.seekTo((player.duration * Number(key)) / 10)
    }
  }

  window.addEventListener('keydown', onKey)
  return () => window.removeEventListener('keydown', onKey)
}
