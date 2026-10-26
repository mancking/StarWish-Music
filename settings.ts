import fs from 'node:fs'
import type { AppSettings } from '../../shared/types'
import { settingsFile, setCacheRoot, setCoverRoot, setMediaRoot, setLogRoot } from './paths'
import { createLogger } from './log'

const logger = createLogger('settings')

export const DEFAULT_SETTINGS: AppSettings = {
  theme: 'dark',
  accent: '#ff4d6d',
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
  /** 个性主题：播放页配色 token，null 表示跟随主题包默认值 */
  themeColors: null,
  /** 个性主题：全局背景模式 */
  globalBgMode: 'off',
  /** 个性主题：全局背景素材路径 */
  globalBgAsset: '',
  /** 个性主题：GIF 动态背景省电回落 */
  dynamicBgOff: false,
  /** 个性主题：当前选中的素材引用 */
  wallpaperAsset: null,
  /** 个性主题：播放器背景独立管线壁纸 id */
  bgWallpaperId: '',
  /** 个性主题：播放器背景独立管线 GIF 路径 */
  bgGif: '',
  /** 第 4 章 F2：用户头像路径 */
  avatarPath: '',
  /** 第 4 章 F2：用户昵称 */
  nickname: '星河听众',

  pixabayKey: '',
  pexelsKey: '',
  mvVolume: 0.8,

  /* ---------------- 壁纸引擎（旧字段，后台播放页背景不再消费；保留仅向后兼容读取） ---------------- */

  /** 启用壁纸库（旧字段，已不参与播放页背景） */

  wallpaperEnabled: false,

  /** 当前壁纸 id，空表示使用库中第一张 */

  wallpaperId: '',

  /** 轮播方式：关闭 / 按歌切换 / 定时 / 随机 */

  wallpaperRotation: 'off',

  /** 定时轮播间隔（分钟） */

  wallpaperIntervalMin: 30,

  /** 模糊强度 0-40px */

  wallpaperBlur: 0,

  /** 亮度 0.5-1.3 */

  wallpaperBrightness: 1,

  /** 遮罩浓度 0-0.8，越大文字越清晰 */

  wallpaperMask: 0,

  /** 缩放 1.0-1.5 */

  wallpaperScale: 1,

  /** 填充方式 */

  wallpaperFit: 'cover',

  /** 色调叠加色，空字符串表示不叠加 */

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
  /* ---------------- 局域网同步（D3） ---------------- */
  lanSync: { port: 42717, direction: 'bidirectional', syncNowPlaying: true, clientHostIp: '' },
}
/** 3.14/ 背景模式合法值（cover/lyric-wall/particle/spectrum + gradient 降级 + solid 兜底） */
const PLAYER_BG_MODES = ['cover', 'lyric-wall'] as const

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
