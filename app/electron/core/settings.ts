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
  playerBg: 'cover',
  playerSpinSec: 16,
  playerVolume: 80,
  activeTheme: 'default',
  pixabayKey: '',
  pexelsKey: '',
  mvVolume: 0.8,

  wallpaperEnabled: true,
  wallpaperId: '',
  wallpaperRotation: 'off',
  wallpaperIntervalMin: 15,
  wallpaperBlur: 0,
  wallpaperBrightness: 1,
  wallpaperMask: 0.25,
  wallpaperScale: 1.06,
  wallpaperFit: 'cover',
  wallpaperTint: '',

  playbackRate: 1,
  preservePitch: true,
  sleepTimerMin: 0,

  mvQuality: 0,
  mvRememberProgress: true,
  mvAutoNext: true,
  danmakuEnabled: true,
  danmakuOpacity: 0.85,
  danmakuFontSize: 'medium',
  danmakuSpeed: 'normal',
  danmakuArea: 'half',
  danmakuAntiSubtitle: true,
  danmakuBlockWords: '',
 /**音源调试日志开关（logs/sources/<源名>.log） */
  sourceDebug: false,
 /**首次启动引导标记 */
  onboarded: false,
 /**自定义源市场 URL（空 = 官方分支 manifest） */
  marketUrl: '',
 /**git 私有仓库下载令牌 */
  gitToken: '',

  webdavEnabled: false,
  webdavUrl: '',
  webdavUser: '',
  webdavPass: '',
  webdavPath: '',
  webdavLastSync: 0,

  showTaskbarLyric: false,
  autoLaunch: false,
  proxyEnabled: false,
  proxyUrl: '',
  listDensity: 'standard',
  downloadDir: '',
  downloadQuality: '',
  downloadLrc: true,
  downloadConcurrency: 2,
}

/** 3.14/ 背景模式合法值（cover/lyric-wall/particle/spectrum + gradient 降级 + solid 兜底） */
const PLAYER_BG_MODES = ['cover', 'lyric-wall', 'particle', 'spectrum', 'gradient', 'solid', 'wallpaper'] as const

let cache: AppSettings = { ...DEFAULT_SETTINGS }

export function loadSettings(): AppSettings {
  try {
    if (fs.existsSync(settingsFile())) {
      const raw = JSON.parse(fs.readFileSync(settingsFile(), 'utf8'))
      cache = { ...DEFAULT_SETTINGS, ...(raw || {}) }
      // 4.7+ ②（v4.24）：wallpaper 回归为「主题与壁纸」壁纸子项（本地库 + 开源壁纸）
      if (!PLAYER_BG_MODES.includes(cache.playerBg as any)) cache.playerBg = 'cover'
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
