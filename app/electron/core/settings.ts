import fs from 'node:fs'
import type { AppSettings } from '../../shared/types'
import { settingsFile, setCacheRoot, setCoverRoot, setMediaRoot, setLogRoot } from './paths'
import { createLogger } from './log'

const logger = createLogger('settings')

export const DEFAULT_SETTINGS: AppSettings = {
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

let cache: AppSettings = { ...DEFAULT_SETTINGS }

export function loadSettings(): AppSettings {
  try {
    if (fs.existsSync(settingsFile())) {
      const raw = JSON.parse(fs.readFileSync(settingsFile(), 'utf8'))
      cache = { ...DEFAULT_SETTINGS, ...(raw || {}) }
    }
  } catch (e: any) {
    logger.warn('设置读取失败，使用默认值', e?.message)
    cache = { ...DEFAULT_SETTINGS }
  }
  setCacheRoot(cache.cacheDir || '')
  setCoverRoot(cache.coverDir || '')
  setMediaRoot(cache.mediaDir || '')
  setLogRoot(cache.logDir || '')
  return cache
}

export function getSettings(): AppSettings {
  return cache
}

export function saveSettings(patch: Partial<AppSettings>): AppSettings {
  cache = { ...cache, ...(patch || {}) }
  if (patch.cacheDir !== undefined) setCacheRoot(cache.cacheDir || '')
  if (patch.coverDir !== undefined) setCoverRoot(cache.coverDir || '')
  if (patch.mediaDir !== undefined) setMediaRoot(cache.mediaDir || '')
  if (patch.logDir !== undefined) setLogRoot(cache.logDir || '')
  try {
    fs.writeFileSync(settingsFile(), JSON.stringify(cache, null, 2), 'utf8')
  } catch (e: any) {
    logger.error('设置保存失败', e?.message)
  }
  return cache
}
