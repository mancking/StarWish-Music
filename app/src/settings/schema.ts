import type { AppSettings } from '@shared/types'

/**
 * 设置项单一数据源。
 *
 * 用途：
 *   1. 跨分区搜索（按 label/desc/keywords 匹配）
 *   2. 「恢复本区默认」按分区取默认值
 *   3. 旧配置迁移时校验键名与取值范围
 *
 * 为什么渲染仍保留手写：壁纸库网格、音源列表、插件市场、WebDAV 表单、
 * 缓存目录迁移这些区块不是「一行一个控件」能表达的，强行 schema 化会把
 * 交互压平成表单，反而更难用。简单项（开关/下拉/分段/滑杆/输入）才走 schema。
 */

export type SettingCat =
  | 'appearance'
  | 'wallpaper'
  | 'playback'
  | 'lyric'
  | 'video'
  | 'download'
  | 'sources'
  | 'local'
  | 'cache'
  | 'shortcuts'
  | 'about'

export interface SettingDef {
  key: keyof AppSettings
  cat: SettingCat
  label: string
  desc?: string
  /** 搜索关键词（含英文与别名） */
  kw?: string
  type: 'toggle' | 'select' | 'seg' | 'slider' | 'text' | 'textarea'
  options?: { value: string | number; label: string }[]
  min?: number
  max?: number
  step?: number
  /** 显示值 = 存储值 × scale（如 0.85 → 85） */
  scale?: number
  unit?: string
  /** 仅在某平台显示 */
  platform?: 'desktop' | 'mobile'
}

export const SETTING_SCHEMA: SettingDef[] = [
  /* ---------------- 外观 ---------------- */
  {
    key: 'theme',
    cat: 'appearance',
    label: '主题模式',
    desc: '深色适合夜间长时间听歌',
    kw: 'theme dark light auto 深色 浅色 跟随系统 夜间',
    type: 'seg',
    options: [
      { value: 'dark', label: '深色' },
      { value: 'light', label: '浅色' },
      { value: 'auto', label: '跟随系统' },
    ],
  },
  {
    key: 'accentMode',
    cat: 'appearance',
    label: '强调色模式',
    desc: '自动模式会跟随当前封面主色变化',
    kw: 'accent 主色 取色 封面',
    type: 'seg',
    options: [
      { value: 'auto', label: '自动取色' },
      { value: 'custom', label: '自定义' },
    ],
  },
  {
    key: 'accent',
    cat: 'appearance',
    label: '强调色',
    desc: '自定义模式下的主色',
    kw: 'accent color 颜色 主色',
    type: 'text',
  },
  {
    key: 'listDensity',
    cat: 'appearance',
    label: '列表密度',
    desc: '影响歌曲列表行高与一屏可见数量',
    kw: 'density row 行高 紧凑 宽松 列表',
    type: 'seg',
    options: [
      { value: 'compact', label: '紧凑' },
      { value: 'standard', label: '标准' },
      { value: 'relaxed', label: '宽松' },
    ],
  },
  {
    key: 'animations',
    cat: 'appearance',
    label: '界面动画',
    desc: '关闭后减少过渡与动效，降低 GPU 占用',
    kw: 'animation 动效 过渡 性能',
    type: 'toggle',
  },
  {
    key: 'particle',
    cat: 'appearance',
    label: '粒子舞台',
    desc: '播放页粒子特效，低配设备建议关闭',
    kw: 'particle 粒子 特效 低配',
    type: 'toggle',
  },
  {
    key: 'playerBg',
    cat: 'appearance',
    label: '播放页背景',
    desc: '封面模糊、动态渐变、自定义壁纸或纯色',
    kw: 'background 背景 封面 渐变 壁纸 纯色',
    type: 'seg',
    options: [
      { value: 'cover', label: '封面模糊' },
      { value: 'gradient', label: '动态渐变' },
      { value: 'wallpaper', label: '壁纸' },
      { value: 'solid', label: '纯色' },
    ],
  },

  /* ---------------- 壁纸 ---------------- */
  {
    key: 'wallpaperEnabled',
    cat: 'wallpaper',
    label: '启用壁纸',
    desc: '关闭后播放页回到封面模糊背景',
    kw: 'wallpaper 壁纸 背景 开关',
    type: 'toggle',
  },
  {
    key: 'wallpaperRotation',
    cat: 'wallpaper',
    label: '轮播方式',
    desc: '按歌切换 / 定时轮播 / 随机',
    kw: 'rotation 轮播 按歌 定时 随机',
    type: 'select',
    options: [
      { value: 'off', label: '关闭' },
      { value: 'song', label: '按歌切换' },
      { value: 'timer', label: '定时轮播' },
      { value: 'random', label: '随机' },
    ],
  },
  {
    key: 'wallpaperIntervalMin',
    cat: 'wallpaper',
    label: '轮播间隔',
    desc: '定时轮播时的切换间隔',
    kw: 'interval 间隔 分钟',
    type: 'select',
    options: [
      { value: 1, label: '1 分钟' },
      { value: 5, label: '5 分钟' },
      { value: 15, label: '15 分钟' },
      { value: 30, label: '30 分钟' },
    ],
  },
  {
    key: 'wallpaperBlur',
    cat: 'wallpaper',
    label: '模糊',
    desc: '让壁纸退到背景层，减少与前景文字抢注意力',
    kw: 'blur 模糊',
    type: 'slider',
    min: 0,
    max: 40,
    step: 1,
    unit: 'px',
  },
  {
    key: 'wallpaperMask',
    cat: 'wallpaper',
    label: '遮罩浓度',
    desc: '越高文字越清晰，浅色壁纸建议调高',
    kw: 'mask 遮罩 压暗 可读性',
    type: 'slider',
    min: 0,
    max: 100,
    step: 1,
    scale: 100,
    unit: '%',
  },
  {
    key: 'wallpaperBrightness',
    cat: 'wallpaper',
    label: '亮度',
    desc: '浅色壁纸建议调低',
    kw: 'brightness 亮度',
    type: 'select',
    options: [
      { value: 0.7, label: '70%' },
      { value: 0.85, label: '85%' },
      { value: 1, label: '100%' },
      { value: 1.15, label: '115%' },
      { value: 1.3, label: '130%' },
    ],
  },
  {
    key: 'wallpaperFit',
    cat: 'wallpaper',
    label: '填充方式',
    desc: '图片比例与屏幕不一致时如何处理',
    kw: 'fit cover contain fill 填充 适应 拉伸',
    type: 'seg',
    options: [
      { value: 'cover', label: '填充' },
      { value: 'contain', label: '适应' },
      { value: 'fill', label: '拉伸' },
    ],
  },
  {
    key: 'wallpaperScale',
    cat: 'wallpaper',
    label: '缩放',
    desc: '轻微放大可避免边缘模糊',
    kw: 'scale 缩放',
    type: 'select',
    options: [
      { value: 1, label: '100%' },
      { value: 1.06, label: '106%' },
      { value: 1.15, label: '115%' },
      { value: 1.3, label: '130%' },
    ],
  },

  /* ---------------- 播放 ---------------- */
  {
    key: 'playbackRate',
    cat: 'playback',
    label: '播放倍速',
    desc: '变速时默认保留音调',
    kw: 'rate speed 倍速 变速',
    type: 'select',
    options: [
      { value: 0.5, label: '0.5×' },
      { value: 0.75, label: '0.75×' },
      { value: 1, label: '1.0×' },
      { value: 1.25, label: '1.25×' },
      { value: 1.5, label: '1.5×' },
      { value: 2, label: '2.0×' },
    ],
  },
  {
    key: 'preservePitch',
    cat: 'playback',
    label: '变速保留音调',
    desc: '关闭后变速会像磁带一样改变音高',
    kw: 'pitch 音调 变调',
    type: 'toggle',
  },
  {
    key: 'sleepTimerMin',
    cat: 'playback',
    label: '睡眠定时',
    desc: '到点自动暂停，适合睡前听歌',
    kw: 'sleep timer 定时 关闭 睡眠',
    type: 'select',
    options: [
      { value: 0, label: '关闭' },
      { value: 15, label: '15 分钟' },
      { value: 30, label: '30 分钟' },
      { value: 45, label: '45 分钟' },
      { value: 60, label: '60 分钟' },
      { value: 90, label: '90 分钟' },
    ],
  },
  {
    key: 'quality',
    cat: 'playback',
    label: '默认音质',
    desc: '优先请求高音质，取链失败自动降级',
    kw: 'quality 音质 128 320 无损 flac',
    type: 'select',
    options: [
      { value: '128k', label: '标准 128k' },
      { value: '320k', label: '较高 320k' },
      { value: 'flac', label: '无损 FLAC' },
      { value: 'flac24bit', label: 'Hi-Res 24bit' },
    ],
  },
  {
    key: 'playMode',
    cat: 'playback',
    label: '播放模式',
    desc: '启动时的默认循环方式',
    kw: 'mode 顺序 单曲 随机 循环',
    type: 'seg',
    options: [
      { value: 'order', label: '顺序' },
      { value: 'repeat-all', label: '列表循环' },
      { value: 'repeat-one', label: '单曲循环' },
      { value: 'shuffle', label: '随机' },
    ],
  },
  { key: 'autoPlay', cat: 'playback', label: '启动时自动播放', desc: '打开应用后自动续播上次的歌曲', kw: 'autoplay 自动播放 启动', type: 'toggle' },
  { key: 'rememberPosition', cat: 'playback', label: '记忆播放位置', desc: '下次启动从上次的位置继续', kw: 'position 位置 续播', type: 'toggle' },
  { key: 'crossfade', cat: 'playback', label: '交叉淡入', desc: '切歌时淡出旧曲、淡入新曲', kw: 'crossfade 淡入 淡出 无缝', type: 'toggle' },
  { key: 'autoSwitchSource', cat: 'playback', label: '自动切换音源', desc: '当前音源失败时尝试其它音源', kw: 'source 换源 失败 自动', type: 'toggle' },
  { key: 'skipOnError', cat: 'playback', label: '失败自动跳过', desc: '播放出错时直接跳到下一首', kw: 'skip 跳过 错误', type: 'toggle' },
  { key: 'mvVolume', cat: 'playback', label: '视频音量', desc: 'MV 播放器独立音量，与音乐音量分开记忆', kw: 'mv video volume 视频 音量', type: 'slider', min: 0, max: 100, step: 1, scale: 100, unit: '%' },

  /* ---------------- 歌词 ---------------- */
  { key: 'lyricFontSize', cat: 'lyric', label: '歌词字号', desc: '播放页歌词的基础字号', kw: 'lyric font 歌词 字号 大小', type: 'slider', min: 20, max: 44, step: 1, unit: 'px' },
  { key: 'lyricOffset', cat: 'lyric', label: '歌词偏移', desc: '正值延后、负值提前，单位毫秒', kw: 'offset 偏移 校准 延迟 同步', type: 'slider', min: -3000, max: 3000, step: 50, unit: 'ms' },
  { key: 'showDesktopLyric', cat: 'lyric', label: '桌面歌词', desc: '在桌面显示悬浮歌词窗口', kw: 'desktop lyric 桌面歌词 悬浮', type: 'toggle', platform: 'desktop' },
  { key: 'desktopLyricLock', cat: 'lyric', label: '歌词锁定', desc: '锁定后鼠标穿透，不影响其它操作', kw: 'lock 锁定 穿透', type: 'toggle', platform: 'desktop' },

  /* ---------------- 视频与弹幕 ---------------- */
  {
    key: 'mvQuality',
    cat: 'video',
    label: '默认画质',
    desc: '自动会按网络情况选择',
    kw: 'mv quality 画质 1080 720 480',
    type: 'select',
    options: [
      { value: 0, label: '自动' },
      { value: 80, label: '1080P' },
      { value: 64, label: '720P' },
      { value: 32, label: '480P' },
    ],
  },
  { key: 'mvRememberProgress', cat: 'video', label: '记忆播放进度', desc: '下次进入同一视频时提示继续播放', kw: 'progress 进度 续播 断点', type: 'toggle' },
  { key: 'mvAutoNext', cat: 'video', label: '自动连播下一集', desc: '多分 P 视频播完自动切换', kw: 'next 连播 下一集', type: 'toggle' },
  { key: 'danmakuEnabled', cat: 'video', label: '启用弹幕', desc: '在视频上叠加弹幕层', kw: 'danmaku 弹幕', type: 'toggle' },
  { key: 'danmakuOpacity', cat: 'video', label: '弹幕透明度', desc: '越低越不挡画面', kw: 'opacity 透明度', type: 'slider', min: 15, max: 100, step: 1, scale: 100, unit: '%' },
  {
    key: 'danmakuFontSize',
    cat: 'video',
    label: '弹幕字号',
    desc: '影响弹幕密度',
    kw: 'font 字号',
    type: 'seg',
    options: [
      { value: 'small', label: '小' },
      { value: 'medium', label: '中' },
      { value: 'large', label: '大' },
    ],
  },
  {
    key: 'danmakuSpeed',
    cat: 'video',
    label: '弹幕速度',
    desc: '滚动弹幕的快慢',
    kw: 'speed 速度',
    type: 'seg',
    options: [
      { value: 'slow', label: '慢' },
      { value: 'normal', label: '中' },
      { value: 'fast', label: '快' },
    ],
  },
  {
    key: 'danmakuArea',
    cat: 'video',
    label: '显示区域',
    desc: '弹幕占画面的高度',
    kw: 'area 区域 半屏',
    type: 'seg',
    options: [
      { value: 'quarter', label: '1/4' },
      { value: 'half', label: '半屏' },
      { value: 'full', label: '全屏' },
    ],
  },
  { key: 'danmakuAntiSubtitle', cat: 'video', label: '防挡字幕', desc: '底部区域不投放滚动弹幕', kw: 'subtitle 字幕 遮挡', type: 'toggle' },
  { key: 'danmakuBlockWords', cat: 'video', label: '屏蔽词', desc: '每行一个，包含该词的弹幕不显示', kw: 'block 屏蔽 过滤 关键词', type: 'textarea' },

  /* ---------------- 下载 ---------------- */
  { key: 'downloadQuality', cat: 'download', label: '下载音质', desc: '跟随音质则与播放音质一致', kw: 'download quality 音质 下载 无损 flac 320', type: 'select', options: [
    { value: '', label: '跟随全局音质' },
    { value: '128k', label: '标准 128K' },
    { value: '320k', label: '高品质 320K' },
    { value: 'flac', label: '无损 FLAC' },
    { value: 'flac24bit', label: 'Hi-Res 24bit' },
  ] },
  { key: 'downloadLrc', cat: 'download', label: '同时下载歌词', desc: '保存与歌曲同名的 .lrc 文件', kw: 'lrc lyric 歌词 下载', type: 'toggle' },
  { key: 'downloadConcurrency', cat: 'download', label: '同时下载任务数', desc: '音源多为第三方，并发过高可能被限流', kw: 'concurrent 并发 任务 下载', type: 'slider', min: 1, max: 4, step: 1 },

  /* ---------------- 本地音乐 ---------------- */
  { key: 'scanOnStart', cat: 'local', label: '启动时扫描', desc: '每次启动自动扫描本地音乐目录', kw: 'scan 扫描 启动 本地', type: 'toggle' },

  /* ---------------- 网络与缓存 ---------------- */
  { key: 'cacheLimitMB', cat: 'cache', label: '缓存上限', desc: '超过后自动清理最旧的缓存', kw: 'cache 缓存 大小 限制', type: 'select', options: [
    { value: 256, label: '256 MB' },
    { value: 512, label: '512 MB' },
    { value: 1024, label: '1 GB' },
    { value: 2048, label: '2 GB' },
    { value: 4096, label: '4 GB' },
  ] },
  { key: 'proxyEnabled', cat: 'cache', label: '使用代理', desc: '作用于音源、封面、弹幕与备份的全部请求', kw: 'proxy 代理 socks5', type: 'toggle' },
  { key: 'proxyUrl', cat: 'cache', label: '代理地址', desc: 'host:port 或 socks5://host:port', kw: 'proxy 代理 地址 端口', type: 'text' },
  { key: 'webdavEnabled', cat: 'cache', label: 'WebDAV 备份', desc: '把歌单与收藏单向备份到 WebDAV 服务器', kw: 'webdav 备份 同步 坚果云 nextcloud', type: 'toggle' },
  { key: 'webdavUrl', cat: 'cache', label: 'WebDAV 地址', desc: '例如 https://dav.jianguoyun.com/dav', kw: 'webdav 地址 url', type: 'text' },
  { key: 'webdavUser', cat: 'cache', label: 'WebDAV 用户名', desc: '多数服务使用邮箱或账号名', kw: 'webdav 用户名 账号', type: 'text' },
  { key: 'webdavPath', cat: 'cache', label: 'WebDAV 子目录', desc: '留空则上传到根目录', kw: 'webdav 子目录 path', type: 'text' },

  /* ---------------- 系统 ---------------- */
  { key: 'showTaskbarLyric', cat: 'shortcuts', label: '任务栏歌词', desc: '在任务栏上方显示当前一句歌词（macOS 为菜单栏）', kw: 'taskbar 任务栏 菜单栏 歌词', type: 'toggle', platform: 'desktop' },
  { key: 'autoLaunch', cat: 'shortcuts', label: '开机自启动', desc: '登录系统后自动启动星河音乐', kw: 'launch 开机 启动 自启', type: 'toggle' },
  { key: 'closeToTray', cat: 'shortcuts', label: '关闭时最小化到托盘', desc: '关闭窗口不退出，继续后台播放', kw: 'tray 托盘 最小化 后台', type: 'toggle', platform: 'desktop' },
  { key: 'minimizeToTray', cat: 'shortcuts', label: '最小化到托盘', desc: '最小化窗口时隐藏到托盘', kw: 'minimize 最小化 托盘', type: 'toggle', platform: 'desktop' },
]

/** 按分区取设置项 */
export function defsOf(cat: SettingCat, isMobile = false): SettingDef[] {
  return SETTING_SCHEMA.filter(d => d.cat === cat && !(isMobile && d.platform === 'desktop'))
}

/** 跨分区搜索 */
export function searchSettings(query: string, isMobile = false): SettingDef[] {
  const q = query.trim().toLowerCase()
  if (!q) return []
  return SETTING_SCHEMA.filter(d => {
    if (isMobile && d.platform === 'desktop') return false
    const hay = `${d.label} ${d.desc || ''} ${d.kw || ''} ${String(d.key)}`.toLowerCase()
    return hay.includes(q)
  })
}
