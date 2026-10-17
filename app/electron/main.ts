import { app, globalShortcut, Menu, nativeImage, nativeTheme, protocol, Tray, dialog } from 'electron'
import path from 'node:path'
import fs from 'node:fs'
import { createLogger, getErrorCount } from './core/log'
import { setUserDataDir, resourcesDir, userDataDir, ensureDir } from './core/paths'
import { initDb, closeDb, dbGetSetting, dbSetSetting, getSong } from './core/db'
import { loadSettings, getSettings, saveSettings } from './core/settings'
import { initBiliLogin, biliCookie } from './core/bili'
import { lxHost } from './core/lx-host'
import { registerCoverProtocol } from './core/cover'
import { registerMediaProtocol } from './core/media'
import { player } from './core/player-service'
import { registerIpc, navigateMain } from './ipc'
import {
  applyTitleBarTheme,
  broadcast,
  createAudioHost,
  createMainWindow,
  setLyricLock,
  showLyricWindow,
  wins,
} from './windows'

const logger = createLogger('main')

// 用户数据统一放在 %APPDATA%/StarWish，卸载时默认保留；不可写时自动降级到临时目录
function resolveDataDir(): string {
  const envDir = process.env.STARWISH_USER_DATA
  if (envDir) return envDir
  const candidates = [path.join(app.getPath('appData'), 'StarWish'), path.join(app.getPath('temp'), 'StarWish')]
  for (const dir of candidates) {
    try {
      fs.mkdirSync(dir, { recursive: true })
      const probe = path.join(dir, '.write-test')
      fs.writeFileSync(probe, 'ok')
      fs.unlinkSync(probe)
      return dir
    } catch {
      /* 尝试下一个候选目录 */
    }
  }
  return app.getPath('userData')
}

const dataDir = resolveDataDir()
setUserDataDir(dataDir)
ensureDir(dataDir)

// 关键修复：显式设置 Electron 内部临时目录为我们已知可写的子目录
// 解决 "Error writing temporary file. Make sure your temp folder is valid." 错误
// （系统 %TEMP% 在某些环境下不可写或被占用）
const tempDir = ensureDir(path.join(dataDir, 'temp'))
try {
  app.setPath('temp', tempDir)
  // 同时设置环境变量，Chromium 子进程（GPU、Renderer）也会使用
  process.env.TEMP = tempDir
  process.env.TMP = tempDir
} catch (e: any) {
  logger.warn('设置临时目录失败', e?.message)
}

app.setPath('userData', dataDir)
app.setAppUserModelId('com.starwish.music')
app.commandLine.appendSwitch('autoplay-policy', 'no-user-gesture-required')
app.commandLine.appendSwitch('disable-features', 'HardwareMediaKeyHandling')

protocol.registerSchemesAsPrivileged([
  {
    scheme: 'swcover',
    privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true, stream: true, bypassCSP: true },
  },
  {
    scheme: 'swmedia',
    privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true, stream: true, bypassCSP: true },
  },
])

let tray: Tray | null = null
let quitting = false
let trayTip = ''
let lastTrayAt = 0

const gotLock = app.requestSingleInstanceLock()
if (!gotLock) {
  app.quit()
} else {
  app.on('second-instance', () => {
    const w = wins.main
    if (w) {
      if (w.isMinimized()) w.restore()
      if (!w.isVisible()) w.show()
      w.focus()
    }
  })
}

process.on('uncaughtException', e => {
  logger.error('未捕获异常', e?.message || e, e?.stack || '')
})
process.on('unhandledRejection', e => {
  const err = e as any
  logger.error('未处理 Promise 拒绝', err?.message || err, err?.stack || '')
})

function iconPath(name: string): string {
  return path.join(resourcesDir(), name)
}

function createTray(): void {
  let img: Electron.NativeImage | null = null
  try {
    const p = iconPath('tray.png')
    if (fs.existsSync(p)) img = nativeImage.createFromPath(p).resize({ width: 16, height: 16 })
    if (!img || img.isEmpty()) {
      const ip = iconPath('icon.png')
      if (fs.existsSync(ip)) img = nativeImage.createFromPath(ip).resize({ width: 16, height: 16 })
    }
  } catch (e: any) {
    logger.warn('托盘图标加载失败', e?.message)
  }
  if (!img || img.isEmpty()) return
  tray = new Tray(img)
  tray.setToolTip('星河音乐')
  rebuildTrayMenu()
  tray.on('double-click', () => showMain())
  tray.on('click', () => showMain())
}

function rebuildTrayMenu(): void {
  if (!tray) return
  const st = player.getState()
  const cur = st.song
  const menu = Menu.buildFromTemplate([
    { label: cur ? `${cur.name} - ${cur.singer}` : '星河音乐 · 未在播放', enabled: false },
    { type: 'separator' },
    {
      label: st.status === 'playing' ? '暂停' : '播放',
      click: () => player.toggle(),
    },
    { label: '上一首', click: () => player.prev() },
    { label: '下一首', click: () => player.next(false) },
    { type: 'separator' },
    { label: '显示主界面', click: () => showMain() },
    {
      label: '桌面歌词',
      type: 'checkbox',
      checked: !!getSettings().showDesktopLyric,
      click: item => {
        saveSettings({ showDesktopLyric: item.checked })
        showLyricWindow(item.checked)
        broadcast('settings:changed', getSettings())
      },
    },
    { type: 'separator' },
    {
      label: '退出星河音乐',
      click: () => {
        quitting = true
        app.quit()
      },
    },
  ])
  tray.setContextMenu(menu)
  const tip = cur ? `${cur.name} - ${cur.singer}` : '星河音乐'
  if (tip !== trayTip) {
    trayTip = tip
    tray.setToolTip(tip)
  }
}

function showMain(): void {
  const w = wins.main
  if (!w || w.isDestroyed()) return
  if (!w.isVisible()) w.show()
  if (w.isMinimized()) w.restore()
  w.focus()
}

function registerShortcuts(): void {
  const bind = (accel: string, fn: () => void) => {
    try {
      globalShortcut.register(accel, fn)
    } catch (e: any) {
      logger.warn('快捷键注册失败', accel, e?.message)
    }
  }
  bind('MediaPlayPause', () => player.toggle())
  bind('MediaNextTrack', () => player.next(false))
  bind('MediaPreviousTrack', () => player.prev())
  bind('MediaStop', () => player.stop())
  bind('CommandOrControl+Alt+P', () => player.toggle())
  bind('CommandOrControl+Alt+Left', () => player.prev())
  bind('CommandOrControl+Alt+Right', () => player.next(false))
  bind('CommandOrControl+Alt+L', () => {
    const s = getSettings()
    saveSettings({ showDesktopLyric: !s.showDesktopLyric })
    showLyricWindow(!s.showDesktopLyric)
    broadcast('settings:changed', getSettings())
  })
}

function restoreWindowState(win: Electron.BrowserWindow): void {
  const bounds = dbGetSetting<{ x?: number; y?: number; width: number; height: number; maximized?: boolean }>(
    'window.bounds'
  )
  if (bounds && bounds.width > 800 && bounds.height > 600) {
    try {
      win.setBounds({ width: bounds.width, height: bounds.height, ...(bounds.x ? { x: bounds.x } : {}), ...(bounds.y ? { y: bounds.y } : {}) })
      if (bounds.maximized) win.maximize()
    } catch {
      /* 屏幕变化时忽略 */
    }
  }
}

function persistWindowState(): void {
  const w = wins.main
  if (!w || w.isDestroyed()) return
  try {
    const b = w.getNormalBounds()
    dbSetSetting('window.bounds', { ...b, maximized: w.isMaximized() })
  } catch {
    /* ignore */
  }
}

async function bootstrap(): Promise<void> {
  try {
    loadSettings()
    await initDb()
    initBiliLogin()
    lxHost.load()
    registerCoverProtocol()
    registerMediaProtocol(biliCookie)
    registerIpc()

    nativeTheme.themeSource = getSettings().theme === 'auto' ? 'system' : (getSettings().theme as 'dark' | 'light')
    applyTitleBarTheme(nativeTheme.shouldUseDarkColors)

    const mainWin = createMainWindow()
    restoreWindowState(mainWin)
    const audio = createAudioHost()

    player.setBroadcast(broadcast)
    player.attachHost(audio)
    player.initFromSettings()
    if (getSettings().rememberPosition) player.restoreSession()

    mainWin.on('maximize', () => mainWin.webContents.send('window:state', { maximized: true }))
    mainWin.on('unmaximize', () => mainWin.webContents.send('window:state', { maximized: false }))
    mainWin.on('resize', () => persistWindowState())
    mainWin.on('move', () => persistWindowState())
    mainWin.on('close', e => {
      if (!quitting && getSettings().closeToTray) {
        e.preventDefault()
        persistWindowState()
        mainWin.hide()
        return
      }
      persistWindowState()
    })
    mainWin.on('show', () => {
      if (getSettings().showDesktopLyric) showLyricWindow(true)
    })

    createTray()
    registerShortcuts()

    // 播放状态变化 → 托盘 + 桌面歌词
    let lastTrayUpdate = 0
    const origBroadcast = broadcast
    player.setBroadcast((channel, payload) => {
      origBroadcast(channel, payload)
      if (channel === 'player:state') {
        const now = Date.now()
        if (now - lastTrayUpdate > 1200) {
          lastTrayUpdate = now
          rebuildTrayMenu()
        }
      }
    })

    if (getSettings().showDesktopLyric) {
      showLyricWindow(true)
      setLyricLock(getSettings().desktopLyricLock)
    }

    logger.info('星河音乐启动完成', `v${app.getVersion()}`, `音源 ${lxHost.list().filter(s => !s.loadError).length}`)
  } catch (e: any) {
    logger.error('启动失败', e?.message, e?.stack)
    dialog.showErrorBox('星河音乐启动失败', `${e?.message || e}\n\n日志目录：${userDataDir()}\\logs`)
  }
}

app.whenReady().then(() => {
  Menu.setApplicationMenu(null)
  void bootstrap()
  app.on('activate', () => {
    if (!wins.main) createMainWindow()
    else showMain()
  })
})

app.on('window-all-closed', () => {
  if (!getSettings().closeToTray) app.quit()
})

app.on('before-quit', () => {
  quitting = true
  try {
    player.dispose()
    persistWindowState()
    closeDb()
  } catch (e: any) {
    logger.warn('退出清理失败', e?.message)
  }
  logger.info('退出', `错误计数 ${getErrorCount()}`)
})

app.on('will-quit', () => {
  globalShortcut.unregisterAll()
})

export { navigateMain }
