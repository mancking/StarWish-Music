/** 全局共享类型（主进程 / 渲染进程共用，禁止引入任何运行时依赖） */

export interface Song {
  /** 全局唯一 id：`${source}:${songId}` */
  id: string
  /** 音源平台：wy / qq / kg / kw / mg / bili / local / webdav ... */
  source: string
  songId: string
  name: string
  singer: string
  album?: string
  /** 秒 */
  duration: number
  pic?: string
  qualitys?: string[]
  /** 本地文件绝对路径 */
  localPath?: string
  /** 平台原始字段（songmid / hash / cid / albummid 等），取链必需 */
  extra?: Record<string, string | number | undefined>
}

export interface PlaylistMeta {
  id: string
  name: string
  pic?: string
  description?: string
  author?: string
  count?: number
  played?: number
  tags?: string[]
  source?: string
  /** 创建时间戳（ms）；用于「最新」排序，上游缺失时为 0 */
  created?: number
  /** 本地歌单为 local */
  kind?: 'local' | 'remote'
}

export interface SourcePlatform {
  platform: string
  name: string
  actions: string[]
  qualitys: string[]
}

export interface SourceInfo {
  file: string
  name: string
  version?: string
  author?: string
  description?: string
  loadError: string | null
  enabled: boolean
  builtin: boolean
  platforms: SourcePlatform[]
}

/** MusicFree 协议插件（歌词/音源），与 lx-music 音源协议不同 */
export interface PluginInfo {
  file: string
  name: string
  version?: string
  author?: string
  platform?: string
  description?: string
  /** 支持的搜索类型：music / lyric / album / artist / sheet / comment */
  searchTypes: string[]
  /** 导入来源：local=本地文件 / url=网址 / subscribe=订阅 */
  origin: 'local' | 'url' | 'subscribe'
  /** 原始导入地址（url/subscribe 时有值），订阅更新用 */
  sourceUrl?: string
  loadError: string | null
  enabled: boolean
  /** 是否随包内置（内置插件删除需恢复，不写用户目录） */
  builtin?: boolean
}

/** 插件订阅源：一个返回插件清单的地址 */
export interface PluginSubscription {
  name: string
  url: string
  /** 上次更新时间戳 */
  updatedAt?: number
  count?: number
}

export interface PlayerState {
  status: 'idle' | 'loading' | 'playing' | 'paused' | 'stopped' | 'error'
  song: Song | null
  index: number
  position: number
  duration: number
  buffered: number
  volume: number
  muted: boolean
  mode: PlayMode
  quality: string
  rate: number
  error: string | null
  queue: Song[]
}

export type PlayMode = 'order' | 'repeat-all' | 'repeat-one' | 'shuffle'

export interface LyricLine {
  time: number
  text: string
  trans?: string
  /** 逐字时间（毫秒），用于卡拉 OK 高亮 */
  words?: { t: number; d: number; w: string }[]
}

export interface LyricResult {
  lines: LyricLine[]
  raw: string
  source?: string
  /** 本次查询实际尝试并返回候选的来源列表（动态） */
  sources?: string[]
  offset: number
  hasTrans: boolean
  hasWordByWord: boolean
}

export interface AppSettings {
  theme: 'dark' | 'light' | 'auto'
  accent: string
  accentMode: 'auto' | 'custom'
  quality: '128k' | '320k' | 'flac' | 'flac24bit'
  volume: number
  playMode: PlayMode
  crossfade: boolean
  crossfadeMs: number
  fadeMs: number
  autoSwitchSource: boolean
  lyricOffset: number
  lyricFontSize: number
  showDesktopLyric: boolean
  desktopLyricLock: boolean
  localDirs: string[]
  scanOnStart: boolean
  cacheLimitMB: number
  /** 自定义缓存目录，空字符串表示使用默认目录 */
  cacheDir: string
  /** 封面缓存目录，空字符串表示跟随缓存目录 */
  coverDir: string
  /** 媒体缓存目录，空字符串表示跟随缓存目录 */
  mediaDir: string
  /** 日志目录，空字符串表示默认 userDataDir\logs */
  logDir: string
  /** 自定义数据目录（数据库/设置/音源），空字符串表示默认 %APPDATA%\StarWish，重启生效 */
  dataDir: string
  closeToTray: boolean
  minimizeToTray: boolean
  autoPlay: boolean
  rememberPosition: boolean
  animations: boolean
  particle: boolean
  skipOnError: boolean
  /** 播放页背景：模糊专辑封面 / 动态渐变 / 自定义壁纸 / 纯色 */
  playerBg: 'cover' | 'gradient' | 'wallpaper' | 'solid'
  /** 壁纸图片路径（playerBg === 'wallpaper' 时生效；旧字段，启动时自动迁移到壁纸库） */
  playerWallpaper: string
  /** MV 播放器音量（独立记忆，0-1） */
  mvVolume: number

  /* ---------------- 壁纸引擎（仅图片） ---------------- */
  /** 启用壁纸库（playerBg === 'wallpaper' 时从库中取图） */
  wallpaperEnabled: boolean
  /** 当前壁纸 id，空表示使用库中第一张 */
  wallpaperId: string
  /** 轮播方式：关闭 / 按歌切换 / 定时 / 随机 */
  wallpaperRotation: 'off' | 'song' | 'timer' | 'random'
  /** 定时轮播间隔（分钟） */
  wallpaperIntervalMin: number
  /** 模糊强度 0-40px */
  wallpaperBlur: number
  /** 亮度 0.5-1.3 */
  wallpaperBrightness: number
  /** 遮罩浓度 0-0.8，越大文字越清晰 */
  wallpaperMask: number
  /** 缩放 1.0-1.5 */
  wallpaperScale: number
  /** 填充方式 */
  wallpaperFit: 'cover' | 'contain' | 'fill'
  /** 色调叠加色，空字符串表示不叠加 */
  wallpaperTint: string

  /* ---------------- 播放增强 ---------------- */
  /** 播放倍速 0.5-2.0 */
  playbackRate: number
  /** 变速保留音调 */
  preservePitch: boolean
  /** 睡眠定时（分钟），0 表示关闭 */
  sleepTimerMin: number

  /* ---------------- 视频 / 弹幕 ---------------- */
  /** 默认画质（B 站 qn 值，0 表示自动） */
  mvQuality: number
  /** 记忆视频播放进度 */
  mvRememberProgress: boolean
  /** 播完自动下一集 */
  mvAutoNext: boolean
  /** 启用弹幕 */
  danmakuEnabled: boolean
  /** 弹幕透明度 0-1 */
  danmakuOpacity: number
  /** 弹幕字号 */
  danmakuFontSize: 'small' | 'medium' | 'large'
  /** 弹幕速度 */
  danmakuSpeed: 'slow' | 'normal' | 'fast'
  /** 弹幕显示区域 */
  danmakuArea: 'quarter' | 'half' | 'full'
  /** 防挡字幕（底部 20% 不投放滚动弹幕） */
  danmakuAntiSubtitle: boolean
  /** 屏蔽词，换行分隔 */
  danmakuBlockWords: string

  /* ---------------- WebDAV 备份（单向：本地 → 远端） ---------------- */
  webdavEnabled: boolean
  /** 服务器根地址，如 https://dav.example.com/remote.php/dav/files/user */
  webdavUrl: string
  webdavUser: string
  webdavPass: string
  /** 远端子目录，留空表示根目录 */
  webdavPath: string
  /** 上次同步成功时间戳 */
  webdavLastSync: number

  /* ---------------- 系统集成 ---------------- */
  /** Windows 任务栏 / macOS 菜单栏歌词 */
  showTaskbarLyric: boolean
  /** 开机自启动 */
  autoLaunch: boolean

  /* ---------------- 网络 ---------------- */
  /** 使用代理（作用于所有请求，包括音源与封面） */
  proxyEnabled: boolean
  /** 代理地址，host:port，如 127.0.0.1:7890 */
  proxyUrl: string

  /* ---------------- 列表密度 ---------------- */
  /** 列表行高：紧凑 / 标准 / 宽松 */
  listDensity: 'compact' | 'standard' | 'relaxed'
}

/** 壁纸条目（图片壁纸库） */
export interface WallpaperItem {
  id: string
  name: string
  /** 原图绝对路径 */
  file: string
  /** 缩略图绝对路径 */
  thumb: string
  width: number
  height: number
  size: number
  addedAt: number
}

/** 弹幕条目 */
export interface DanmakuItem {
  /** 出现时间（秒） */
  t: number
  /** 1 滚动 / 4 底部 / 5 顶部 */
  mode: 1 | 4 | 5
  /** 字号 18/25/36 */
  size: number
  /** 十进制 RGB */
  color: number
  text: string
}

export interface ScanProgress {
  phase: 'idle' | 'scanning' | 'parsing' | 'done' | 'error'
  found: number
  parsed: number
  current: string
  error?: string
}

export interface ToplistItem {
  n: string
  id?: string
  /** 榜单封面（来自各平台榜单索引接口，非歌曲封面；无则前端用渐变占位） */
  pic?: string
  /** 更新频率（如「刚刚更新」「每周四更新」） */
  freq?: string
}

export interface ToplistGroup {
  g: string
  items: ToplistItem[]
}

export interface ToplistTree {
  total: number
  tree: Record<string, { name: string; groups: ToplistGroup[] }>
}

/** 歌单分类标签分组 */
export interface PlaylistTagItem {
  n: string
  id: string
}

export interface PlaylistTagGroup {
  name: string
  tags: PlaylistTagItem[]
}

export interface MvItem {
  bvid: string
  title: string
  author: string
  pic: string
  duration: string
  play: number
  danmaku: number
}

export interface ApiResult<T> {
  ok: boolean
  data?: T
  error?: string
  code?: string
}
