import { BrowserWindow, screen, nativeImage } from 'electron'
import path from 'node:path'
import fs from 'node:fs'
import { resourcesDir } from './core/paths'
import { createLogger } from './core/log'

const logger = createLogger('windows')

export const wins: {
  main: BrowserWindow | null
  audio: BrowserWindow | null
  lyric: BrowserWindow | null
} = { main: null, audio: null, lyric: null }

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
    backgroundColor: '#0e1014',
    icon: appIcon(),
    autoHideMenuBar: true,
    titleBarStyle: 'hidden',
    titleBarOverlay: {
      color: '#0e1014',
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

  win.once('ready-to-show', () => {
    win.show()
  })

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
  })
  win.on('closed', () => {
    wins.main = null
  })
  wins.main = win
  return win
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

export function createLyricWindow(): BrowserWindow {
  if (wins.lyric && !wins.lyric.isDestroyed()) return wins.lyric
  const display = screen.getPrimaryDisplay()
  const width = Math.min(1000, Math.round(display.workAreaSize.width * 0.7))
  const win = new BrowserWindow({
    width,
    height: 180,
    x: Math.round((display.workAreaSize.width - width) / 2),
    y: display.workAreaSize.height - 240,
    show: false,
    frame: false,
    transparent: true,
    resizable: true,
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
