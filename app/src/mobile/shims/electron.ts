/** `electron` 模块的浏览器垫片：app/shell/... 一律 no-op，net.fetch 退回全局 fetch。 */
export const app = {
  getPath: (_name: string) => '/home/user/.starwish',
  getVersion: () => '2.0.0',
  getName: () => '星河音乐',
  on: () => undefined,
  whenReady: () => Promise.resolve(),
  quit: () => undefined,
  relaunch: () => undefined,
  setPath: () => undefined,
  setAppUserModelId: () => undefined,
  requestSingleInstanceLock: () => true,
  disableHardwareAcceleration: () => undefined,
}

export const shell = { openPath: (_p: string) => Promise.resolve(''), openExternal: (_u: string) => Promise.resolve() }
export const protocol = {
  handle: () => undefined,
  unhandle: () => undefined,
  registerSchemesAsPrivileged: () => undefined,
  registerFileProtocol: () => undefined,
}
export const net = {
  fetch: (url: string, init?: RequestInit) => {
    let u = String(url)
      .replace(/^swcover:\/\/[^/]+\/r\//, 'https://')
      .replace(/^swcover:\/\/[^/]+\/l\//, 'https://')
      .replace(/^swmedia:\/\/[^/]+\/stream\/\?u=/, '')
    // 冒烟环境（http://127.0.0.1）浏览器没有 CORS 豁免：上游 API 一律不带
    // Access-Control-Allow-Origin。走 /__cors 代理让断言「控制台无 error」有效；
    // 真机（Capacitor file:// + 原生 http）与桌面（swmedia）都不受影响。
    try {
      if (u.startsWith('http://') || u.startsWith('https://')) {
        const t = new URL(u)
        return globalThis.fetch(location.origin + '/__cors/' + t.host + t.pathname + t.search, init)
      }
    } catch { /* fallthrough */ }
    return globalThis.fetch(u, init)
  },
  request: () => undefined,
}
export const ipcRenderer = { invoke: () => Promise.reject(new Error('不支持')), on: () => undefined, send: () => undefined }
export const ipcMain = { handle: () => undefined, on: () => undefined }
export const contextBridge = { exposeInMainWorld: () => undefined }
export const dialog = { showOpenDialog: () => Promise.resolve({ canceled: true, filePaths: [] }), showErrorBox: () => undefined }
export const BrowserWindow = class { static getAllWindows() { return [] } }
export const nativeTheme = { themeSource: 'dark', shouldUseDarkColors: true, on: () => undefined }
export const globalShortcut = { register: () => undefined, unregisterAll: () => undefined }
export const Menu = { setApplicationMenu: () => undefined, buildFromTemplate: () => ({ popup: () => undefined }) }
export const screen = { getDisplayMatching: () => ({ bounds: { x: 0, y: 0, width: 375, height: 812 } }) }
export const clipboard = { writeText: () => undefined, readText: () => '' }

export default {
  app, shell, protocol, net, ipcRenderer, ipcMain, contextBridge, dialog,
  BrowserWindow, nativeTheme, globalShortcut, Menu, screen, clipboard,
}
