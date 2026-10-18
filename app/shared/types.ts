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
  /** 自定义数据目录（数据库/设置/音源），空字符串表示默认 %APPDATA%\StarWish，重启生效 */
  dataDir: string
  closeToTray: boolean
  minimizeToTray: boolean
  autoPlay: boolean
  rememberPosition: boolean
  animations: boolean
  particle: boolean
  skipOnError: boolean
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
