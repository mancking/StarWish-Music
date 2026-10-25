import { app, globalShortcut, Menu, nativeImage, nativeTheme, protocol, Tray, dialog } from 'electron'
import path from 'node:path'
import fs from 'node:fs'
import os from 'node:os'
import { createLogger, getErrorCount } from './core/log'
import { setUserDataDir, resourcesDir, userDataDir, ensureDir, dataDirPointerFile } from './core/paths'
import { initDb, closeDb, dbGetSetting, dbSetSetting, getSong } from './core/db'
import { loadSettings, getSettings, saveSettings } from './core/settings'
import { initBiliLogin, biliCookie } from './core/bili'
import { lxHost } from './core/lx-host'
import { registerCoverProtocol } from './core/cover'
import { registerMediaProtocol } from './core/media'
import * as mfHost from './core/mf-host'
import { beginWindowInitWatch, clearWindowInitMark, type GpuLevel } from './core/crash-guard'
import { trace, writeBootTrace, isDiagnoseMode } from './core/boot-trace'
import { player } from './core/player-service'
import { registerIpc, navigateMain, applyProxy, markBootReady } from './ipc'
import {
  applyTitleBarTheme,
  broadcast,
  createAudioHost,
  createMainWindow,
  ensureMainWindow,
  setLyricLock,
  showLyricWindow,
  showTaskbarLyric,
  wins,
} from './windows'

const logger = createLogger('main')

// 用户数据统一放在 %APPDATA%/StarWish，卸载时默认保留；不可写时自动降级到临时目录
// 若用户在设置里改过数据目录，默认位置留有一行指针文件，下次启动据此定位。
function resolveDataDir(): string {
  const envDir = process.env.STARWISH_USER_DATA
  if (envDir) return envDir
  const candidates: string[] = []
  try {
    const ptr = fs.readFileSync(dataDirPointerFile(), 'utf8').trim()
    if (ptr) candidates.push(ptr)
  } catch {
    /* 没有指针文件，走默认位置 */
  }
  candidates.push(path.join(app.getPath('appData'), 'StarWish'), path.join(app.getPath('temp'), 'StarWish'))
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
// 三级回退：数据目录/temp → 系统临时目录/StarWish → 数据目录本身
function pickWritableDir(candidates: string[]): string {
  for (const dir of candidates) {
    try {
      ensureDir(dir)
      const probe = path.join(dir, '.write-test')
      fs.writeFileSync(probe, 'ok')
      fs.unlinkSync(probe)
      return dir
    } catch {
      /* 试下一个 */
    }
  }
  return candidates[candidates.length - 1]
}

const tempDir = pickWritableDir([
  path.join(dataDir, 'temp'),
  path.join(os.tmpdir(), 'StarWish'),
  dataDir,
])
try {
  app.setPath('temp', tempDir)
  // 同时设置环境变量，Chromium 子进程（GPU、Renderer）也会使用
  process.env.TEMP = tempDir
  process.env.TMP = tempDir
  trace('boot:temp', tempDir)
} catch (e: any) {
  logger.warn('设置临时目录失败', e?.message)
}

app.setPath('userData', dataDir)
app.setAppUserModelId('com.starwish.music')
app.commandLine.appendSwitch('autoplay-policy', 'no-user-gesture-required')
app.commandLine.appendSwitch('disable-features', 'HardwareMediaKeyHandling')

// 崩溃看门狗（三级降级）：窗口创建/首帧合成阶段若因 GPU（D3D11/viz）初始化失败而崩溃，
// 进程会在写入「启动完成」日志后立刻死掉，表现为「任务管理器有进程但永远没有窗口」。
// 标记文件在窗口真正显示后由 windows.ts 清除；若下次启动仍发现它，说明上次死在窗口
// 初始化阶段，按连续失败次数逐级降级，避免陷入永久崩溃循环（虚拟显示器、异常显卡驱动）。
function applyGpuLevel(level: GpuLevel): void {
  if (level <= 0) return
  logger.warn(`启用图形降级 L${level}`)
  app.disableHardwareAcceleration()
  if (level >= 2) {
    app.commandLine.appendSwitch('disable-gpu-compositing')
    app.commandLine.appendSwitch('disable-webgl')
  }
  if (level >= 3) {
    app.commandLine.appendSwitch('disable-gpu')
  }
}

const watch = beginWindowInitWatch()
if (watch.crashedLastRun) {
  logger.warn(`检测到上次启动在窗口初始化阶段崩溃，本次降级到 L${watch.level}`)
}
applyGpuLevel(watch.level)
trace('boot:crash-guard', `level=${watch.level} crashed=${watch.crashedLastRun}`)

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

// 单实例：拿不到锁说明已有实例在跑。旧实现在这里直接 quit()，用户看到的就是
// 「双击没反应，任务管理器里却有进程」。现在改为：先让旧实例收到 second-instance
// 自行唤醒（它会重建窗口 / reload 崩溃的渲染进程），1.5 秒后再退出本进程。
// 逃生门：--force-new 或 STARWISH_FORCE_NEW=1 可跳过锁，用于旧进程彻底卡死的场景。
const forceNew = process.argv.includes('--force-new') || process.env.STARWISH_FORCE_NEW === '1'
const gotLock = forceNew ? true : app.requestSingleInstanceLock()

if (!gotLock) {
  logger.warn('检测到已有实例在运行，已请求唤醒，本进程退出')
  trace('boot:second-instance-blocked')
  setTimeout(() => app.quit(), 1500)
} else if (!forceNew) {
  app.on('second-instance', () => {
    logger.info('收到第二实例唤醒请求')
    trace('boot:reawake')
    ensureMainWindow()
  })
} else {
  logger.warn('强制新实例模式启动（--force-new）')
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
    trace('boot:settings')

    // ---- 窗口先行 --------------------------------------------------------
    // 旧顺序：initDb() → lxHost.load() → registerIpc() → createMainWindow()。
    // initDb（sql.js 读盘 + 建库）与 lxHost.load（同步解析全部音源脚本）都在
    // 主线程上串行执行，耗时可达数秒到十余秒；窗口在这之后才创建，用户看到的是
    // 「双击后桌面空窗很久才出现」。现改为：先把窗口建出来显示骨架，
    // 重活儿挪到后台并行做，界面先可见、数据后到位。
    nativeTheme.themeSource = getSettings().theme === 'auto' ? 'system' : (getSettings().theme as 'dark' | 'light')
    applyTitleBarTheme(nativeTheme.shouldUseDarkColors)

    // IPC 先注册：窗口已先行创建，渲染层的首批调用要能收到（内部会等启动就绪信号）
    registerIpc()
    trace('boot:ipc-registered')

    const mainWin = createMainWindow()
    trace('boot:window-created')
    restoreWindowState(mainWin)

    // ---- 后台重活儿 -------------------------------------------------------
    await initDb()
    trace('boot:db')
    initBiliLogin()
    lxHost.load()
    trace('boot:sources', `音源 ${lxHost.list().length}`)
    mfHost.init()
    registerCoverProtocol()
    registerMediaProtocol(biliCookie)
    // 启动即应用代理设置（若开启），保证音源与封面请求走代理
    applyProxy(getSettings())

    applyTitleBarTheme(nativeTheme.shouldUseDarkColors)

    const audio = createAudioHost()
    trace('boot:audio-host')

    player.setBroadcast(broadcast)
    player.attachHost(audio)
    player.initFromSettings()
    if (getSettings().rememberPosition) player.restoreSession()

    // 数据库与音源均已就绪，放行此前排队的 IPC 调用
    markBootReady()
    trace('boot:ready')

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
    if (getSettings().showTaskbarLyric) showTaskbarLyric(true)

    logger.info('星河音乐启动完成', `v${app.getVersion()}`, `音源 ${lxHost.list().filter(s => !s.loadError).length}`)
    trace('boot:done')
    writeBootTrace({
      dataDir,
      tempDir,
      gpuLevel: watch.level,
      crashedLastRun: watch.crashedLastRun,
      diagnose: isDiagnoseMode(),
    })
  } catch (e: any) {
    logger.error('启动失败', e?.message, e?.stack)
    trace('boot:failed', e?.message)
    writeBootTrace({ dataDir, tempDir, gpuLevel: watch.level, error: String(e?.message || e) })
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
 //macOS 惯例 —— 关窗不退出，保 Dock 常驻
  if (process.platform === 'darwin') return
  if (!getSettings().closeToTray) app.quit()
})

app.on('before-quit', () => {
  quitting = true
  try {
    player.dispose()
    persistWindowState()
    closeDb()
    // 正常退出时清掉崩溃标记，避免「任务管理器结束进程」被下次启动误判为窗口初始化崩溃
    clearWindowInitMark()
  } catch (e: any) {
    logger.warn('退出清理失败', e?.message)
  }
  logger.info('退出', `错误计数 ${getErrorCount()}`)
})

app.on('will-quit', () => {
  globalShortcut.unregisterAll()
})

export { navigateMain }
