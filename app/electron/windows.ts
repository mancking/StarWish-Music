import { BrowserWindow, screen, nativeImage, nativeTheme } from 'electron'
import path from 'node:path'
import fs from 'node:fs'
import { resourcesDir, userDataDir } from './core/paths'
import { endWindowInitWatch } from './core/crash-guard'
import { trace } from './core/boot-trace'
import { createLogger } from './core/log'

const logger = createLogger('windows')

export const wins: {
  main: BrowserWindow | null
  audio: BrowserWindow | null
  lyric: BrowserWindow | null
  taskbar: BrowserWindow | null
} = { main: null, audio: null, lyric: null, taskbar: null }

const isDev = !!process.env.VITE_DEV_SERVER_URL
const DEV_URL = process.env.VITE_DEV_SERVER_URL || ''

function preloadPath(name: string): string {
  return path.join(__dirname, name)
}

function appIcon(): Electron.NativeImage | undefined {
  const p = path.join(resourcesDir(), 'icon.png')
  try {
    if (fs.existsSync(p)) return nativeImage.createFromPath(p)
  } catch {
    /* ignore */
  }
  return undefined
}

export function createMainWindow(): BrowserWindow {
  const win = new BrowserWindow({
    width: 1360,
    height: 880,
    minWidth: 1080,
    minHeight: 680,
    show: false,
    title: '星河音乐',
    backgroundColor: '#0b0d12',
    icon: appIcon(),
    autoHideMenuBar: true,
    titleBarStyle: 'hidden',
    titleBarOverlay: {
      color: '#0b0d12',
      symbolColor: '#c9d1e0',
      height: 44,
    },
    webPreferences: {
      preload: preloadPath('preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
      spellcheck: false,
      backgroundThrottling: false,
      webSecurity: true,
    },
  })

  // 窗口以 show:false 构造，等 ready-to-show 再显示；但若渲染进程始终不触发该事件
  // （页面加载失败、GPU 初始化卡住、容器环境无合成器），窗口就永远不会出现——用户
  // 看到的正是「双击后任务管理器有进程、却没有任何窗口」。这里加三重兜底：
  //   1. ready-to-show 正常显示
  //   2. 8 秒超时强制显示
  //   3. 显示后 1.2 秒校验可见性，不可见则重试（最多 4 次），仍失败就 reload 渲染进程
  let showStarted = false
  let shownOk = false

  const forceShow = (attempt = 0): void => {
    if (win.isDestroyed()) return
    try {
      if (win.isMinimized()) win.restore()
      win.show()
      win.focus()
    } catch (e: any) {
      logger.warn('窗口 show 调用失败', attempt, e?.message)
    }
    setTimeout(() => {
      if (win.isDestroyed()) return
      if (win.isVisible()) {
        if (!shownOk) {
          shownOk = true
          trace('window:visible', `attempt=${attempt}`)
          // 延后清除标记：GPU/viz 首帧合成的崩溃发生在 show() 之后极短时间内，
          // 立刻清除会让看门狗在真正崩溃的场景下失效（下次启动不会降级，陷入崩溃循环）。
          setTimeout(endWindowInitWatch, 15000)
        }
        return
      }
      if (attempt < 3) {
        logger.warn('窗口 show 后仍不可见，重试', attempt + 1)
        forceShow(attempt + 1)
        return
      }
      logger.error('窗口连续多次无法显示，尝试重载渲染进程')
      try {
        win.webContents.reload()
      } catch {
        /* ignore */
      }
      setTimeout(() => {
        if (win.isDestroyed()) return
        try {
          if (!win.isVisible()) win.show()
        } catch {
          /* ignore */
        }
      }, 1500)
    }, 1200)
  }

  const showOnce = (): void => {
    if (showStarted || win.isDestroyed()) return
    showStarted = true
    trace('window:show')
    forceShow(0)
  }

  win.once('ready-to-show', showOnce)
  const showTimer = setTimeout(() => {
    if (!showStarted) {
      logger.warn('ready-to-show 超时，强制显示窗口')
      trace('window:show-timeout')
      showOnce()
    }
  }, 8000)

  // 构造完成立刻按当前主题定色。此前只在 main.ts 的 bootstrap 里调 applyTitleBarTheme，
  // 而那发生在 createMainWindow 之前（此时 wins.main 仍为 null，函数直接空转返回），
  // 于是浅色主题下窗口一直保留上面硬编码的深色 #0b0d12 标题栏按钮区。
  wins.main = win
  applyTitleBarTheme(nativeTheme.shouldUseDarkColors)

  if (isDev) {
    win.loadURL(DEV_URL)
  } else {
    win.loadFile(path.join(__dirname, '..', 'renderer', 'index.html'))
  }

  win.webContents.on('render-process-gone', (_e, details) => {
    logger.error('渲染进程崩溃', details.reason, details.exitCode)
    if (details.reason !== 'clean-exit') {
      try {
        win.webContents.reload()
      } catch {
        /* ignore */
      }
    }
  })
  win.webContents.on('did-fail-load', (_e, code, desc, url) => {
    logger.error('页面加载失败', code, desc, url)
    showOnce()
  })
  win.on('closed', () => {
    clearTimeout(showTimer)
    wins.main = null
  })
  return win
}

/**
 * 自愈式唤醒：第二个实例启动时调用。
 *
 * 旧实现只在 second-instance 里 show/focus，但窗口若已崩溃或从未创建成功，
 * show 是无效的——用户再点多少次图标都只会得到「有进程、没窗口」。这里补三种情况：
 * 窗口不存在 → 重建；渲染进程崩溃/无响应 → reload；存在但不可见 → 强制显示。
 */
export function ensureMainWindow(): void {
  let win = wins.main
  if (!win || win.isDestroyed()) {
    logger.warn('唤醒时未找到主窗口，重新创建')
    trace('window:recreate')
    win = createMainWindow()
    return
  }
  try {
    const wc = win.webContents as any
    if (typeof wc.isCrashed === 'function' && wc.isCrashed()) {
      logger.warn('唤醒时渲染进程已崩溃，重新加载')
      win.webContents.reload()
    }
  } catch {
    /* isCrashed 在部分平台不可用 */
  }
  if (win.isMinimized()) win.restore()
  if (!win.isVisible()) {
    win.show()
    trace('window:reawake')
  }
  win.focus()
}

/** 隐藏的音频宿主进程：独立渲染进程，专管解码播放 */
export function createAudioHost(): BrowserWindow {
  const win = new BrowserWindow({
    width: 320,
    height: 240,
    show: false,
    skipTaskbar: true,
    frame: false,
    webPreferences: {
      preload: preloadPath('player-preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
      backgroundThrottling: false,
    },
  })
  win.loadFile(path.join(__dirname, 'player.html'))
  win.webContents.on('render-process-gone', (_e, details) => {
    logger.error('音频宿主崩溃，准备重建', details.reason)
    if (wins.audio && !wins.audio.isDestroyed()) {
      try {
        wins.audio.destroy()
      } catch {
        /* ignore */
      }
    }
    wins.audio = null
    setTimeout(() => {
      if (!wins.audio) createAudioHost()
    }, 800)
  })
  wins.audio = win
  return win
}

/**
 * 桌面歌词悬浮窗的几何常量（规格书 1.8）：固定 400×60，底部居中。
 * 位置在拖动后写入 userData/lyric-win.json，下次启动复原。
 */
const LYRIC_WIN = { width: 400, height: 60, margin: 90 }

function lyricPosFile(): string {
  return path.join(userDataDir(), 'lyric-win.json')
}

function loadLyricPos(): { x: number; y: number } | null {
  try {
    const raw = JSON.parse(fs.readFileSync(lyricPosFile(), 'utf8'))
    if (raw && Number.isFinite(raw.x) && Number.isFinite(raw.y)) return { x: raw.x, y: raw.y }
  } catch {
    /* 首次运行或文件损坏 */
  }
  return null
}

function saveLyricPos(x: number, y: number): void {
  try {
    fs.writeFileSync(lyricPosFile(), JSON.stringify({ x, y }), 'utf8')
  } catch (e: any) {
    logger.warn('桌面歌词位置写入失败', e?.message)
  }
}

export function createLyricWindow(): BrowserWindow {
  if (wins.lyric && !wins.lyric.isDestroyed()) return wins.lyric
  const display = screen.getPrimaryDisplay()
  const { width, height } = LYRIC_WIN
  const saved = loadLyricPos()
  // 显示器变更后旧坐标可能落到屏幕外：只有仍落在某个显示器工作区内才复原
  const inSomeDisplay =
    !!saved &&
    screen
      .getAllDisplays()
      .some(d => saved.x >= d.workArea.x - 20 && saved.y >= d.workArea.y - 20 && saved.x < d.workArea.x + d.workArea.width - 40 && saved.y < d.workArea.y + d.workArea.height - 20)
  const usePos = inSomeDisplay ? saved : null
  const win = new BrowserWindow({
    width,
    height,
    x: usePos ? usePos.x : Math.round(display.workArea.x + (display.workArea.width - width) / 2),
    y: usePos ? usePos.y : display.workArea.y + display.workArea.height - height - LYRIC_WIN.margin,
    show: false,
    frame: false,
    transparent: true,
    resizable: false,
    movable: true,
    minimizable: false,
    maximizable: false,
    fullscreenable: false,
    skipTaskbar: true,
    hasShadow: false,
    alwaysOnTop: true,
    focusable: true,
    webPreferences: {
      preload: preloadPath('preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
      backgroundThrottling: false,
    },
  })
  win.setAlwaysOnTop(true, 'screen-saver')
  // 拖动后记住位置（规格书 1.8「位置写入本地存储」），但坐标要落在可见区域内
  win.on('moved', () => {
    if (win.isDestroyed()) return
    const [x, y] = win.getPosition()
    saveLyricPos(x, y)
  })
  if (isDev) win.loadURL(`${DEV_URL}#/lyric`)
  else win.loadFile(path.join(__dirname, '..', 'renderer', 'index.html'), { hash: '/lyric' })
  win.on('closed', () => {
    wins.lyric = null
  })
  wins.lyric = win
  return win
}

export function showLyricWindow(visible: boolean): void {
  const win = createLyricWindow()
  if (visible) {
    win.showInactive()
  } else {
    win.hide()
  }
}

export function setLyricLock(locked: boolean): void {
  const win = wins.lyric
  if (!win || win.isDestroyed()) return
  win.setIgnoreMouseEvents(locked, { forward: true })
  if (locked) win.setAlwaysOnTop(true, 'screen-saver')
}

/**
 * 任务栏 / 菜单栏歌词：单行、透明、置顶、鼠标穿透。
 * Windows / Linux 贴工作区底部（任务栏上方），macOS 贴顶部（菜单栏下方）。
 */
export function createTaskbarLyric(): BrowserWindow {
  if (wins.taskbar && !wins.taskbar.isDestroyed()) return wins.taskbar
  const display = screen.getPrimaryDisplay()
  const wa = display.workArea
  const width = Math.min(760, Math.round(wa.width * 0.55))
  const height = 30
  const isMac = process.platform === 'darwin'
  const win = new BrowserWindow({
    width,
    height,
    x: Math.round(wa.x + (wa.width - width) / 2),
    y: isMac ? wa.y + 2 : wa.y + wa.height - height - 2,
    show: false,
    frame: false,
    transparent: true,
    resizable: false,
    movable: false,
    minimizable: false,
    maximizable: false,
    fullscreenable: false,
    skipTaskbar: true,
    hasShadow: false,
    focusable: false,
    alwaysOnTop: true,
    webPreferences: {
      preload: preloadPath('preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
      backgroundThrottling: false,
    },
  })
  win.setAlwaysOnTop(true, 'screen-saver')
  win.setIgnoreMouseEvents(true, { forward: true })
  if (isDev) win.loadURL(`${DEV_URL}#/taskbar-lyric`)
  else win.loadFile(path.join(__dirname, '..', 'renderer', 'index.html'), { hash: '/taskbar-lyric' })
  win.on('closed', () => {
    wins.taskbar = null
  })
  wins.taskbar = win
  return win
}

export function showTaskbarLyric(visible: boolean): void {
  if (!visible) {
    if (wins.taskbar && !wins.taskbar.isDestroyed()) wins.taskbar.hide()
    return
  }
  const win = createTaskbarLyric()
  win.showInactive()
}

export function applyTitleBarTheme(dark: boolean): void {
  const win = wins.main
  if (!win || win.isDestroyed()) return
  try {
    win.setTitleBarOverlay({
      color: dark ? '#0e1014' : '#f7f8fb',
      symbolColor: dark ? '#c9d1e0' : '#333a49',
      height: 44,
    })
    win.setBackgroundColor(dark ? '#0e1014' : '#f7f8fb')
  } catch {
    /* 非 Windows 平台可能不支持 */
  }
}

export function broadcast(channel: string, payload: any): void {
  for (const key of ['main', 'lyric'] as const) {
    const w = wins[key]
    if (w && !w.isDestroyed()) {
      try {
        w.webContents.send(channel, payload)
      } catch {
        /* ignore */
      }
    }
  }
}

export function sendToMain(channel: string, payload: any): void {
  const w = wins.main
  if (w && !w.isDestroyed()) {
    try {
      w.webContents.send(channel, payload)
    } catch {
      /* ignore */
    }
  }
}
