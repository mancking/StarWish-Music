import { defineStore } from 'pinia'
import { computed, ref, watch } from 'vue'
import type { AppSettings, Song } from '@shared/types'
import { call, on } from '@/api'

export interface ToastItem {
  id: number
  type: 'info' | 'success' | 'error' | 'warning'
  message: string
}

const DEFAULT: AppSettings = {
  theme: 'dark',
  accent: '#ff4d6d',
  accentMode: 'auto',
  quality: '320k',
  volume: 0.8,
  playMode: 'repeat-all',
  crossfade: true,
  crossfadeMs: 3000,
  fadeMs: 400,
  autoSwitchSource: true,
  lyricOffset: 0,
  lyricFontSize: 30,
  showDesktopLyric: false,
  desktopLyricLock: false,
  localDirs: [],
  scanOnStart: false,
  cacheLimitMB: 1024,
  cacheDir: '',
  coverDir: '',
  mediaDir: '',
  logDir: '',
  dataDir: '',
  closeToTray: true,
  minimizeToTray: false,
  autoPlay: true,
  rememberPosition: true,
  animations: true,
  particle: true,
  skipOnError: true,
}

let toastSeq = 1

export const useUiStore = defineStore('ui', () => {
  const settings = ref<AppSettings>({ ...DEFAULT })
  const toasts = ref<ToastItem[]>([])
  const ready = ref(false)
  const systemDark = ref(true)
  const dynamicAccent = ref('')
  const addToPlaylistTarget = ref<Song | null>(null)
  const importDialog = ref(false)
  const playlistPickerSong = ref<Song | null>(null)
  const pageTitle = ref('')
  const maximized = ref(false)

  const theme = computed(() => {
    if (settings.value.theme === 'auto') return systemDark.value ? 'dark' : 'light'
    return settings.value.theme
  })

  const accent = computed(() => {
    if (settings.value.accentMode === 'custom') return settings.value.accent
    return dynamicAccent.value || settings.value.accent
  })

  function toast(message: string, type: ToastItem['type'] = 'info', duration = 2800): void {
    const id = toastSeq++
    toasts.value = [...toasts.value.slice(-3), { id, type, message }]
    window.setTimeout(() => {
      toasts.value = toasts.value.filter(t => t.id !== id)
    }, duration)
  }

  function dismiss(id: number): void {
    toasts.value = toasts.value.filter(t => t.id !== id)
  }

  async function init(): Promise<void> {
    try {
      settings.value = await call<AppSettings>('settings:get')
    } catch (e: any) {
      toast(`读取设置失败：${e.message}`, 'error')
    }
    const mq = window.matchMedia('(prefers-color-scheme: dark)')
    systemDark.value = mq.matches
    mq.addEventListener('change', ev => {
      systemDark.value = ev.matches
    })
    ready.value = true
    apply()

    on('toast', (t: any) => {
      if (t?.message) toast(t.message, t.type || 'info')
    })
    on('settings:changed', (s: AppSettings) => {
      settings.value = s
    })
    on('window:state', (s: any) => {
      maximized.value = !!s?.maximized
    })
  }

  function apply(): void {
    const root = document.documentElement
    root.dataset.theme = theme.value
    root.style.setProperty('--accent', accent.value)
    root.style.setProperty('--accent-soft', hexToRgba(accent.value, 0.16))
    document.body.classList.toggle('no-anim', !settings.value.animations)
  }

  async function patch(p: Partial<AppSettings>): Promise<void> {
    settings.value = { ...settings.value, ...p }
    apply()
    try {
      settings.value = await call<AppSettings>('settings:set', p)
    } catch (e: any) {
      toast(`保存设置失败：${e.message}`, 'error')
    }
  }

  watch([theme, accent, () => settings.value.animations], apply)

  function setDynamicAccent(color: string): void {
    dynamicAccent.value = color
  }

  return {
    settings,
    toasts,
    ready,
    theme,
    accent,
    dynamicAccent,
    addToPlaylistTarget,
    importDialog,
    playlistPickerSong,
    pageTitle,
    maximized,
    toast,
    dismiss,
    init,
    patch,
    apply,
    setDynamicAccent,
  }
})

export function hexToRgba(hex: string, alpha: number): string {
  const h = String(hex || '').replace('#', '')
  if (h.length !== 6) return `rgba(255,77,109,${alpha})`
  const r = parseInt(h.slice(0, 2), 16)
  const g = parseInt(h.slice(2, 4), 16)
  const b = parseInt(h.slice(4, 6), 16)
  return `rgba(${r},${g},${b},${alpha})`
}
