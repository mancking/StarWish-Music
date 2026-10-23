import { contextBridge, ipcRenderer } from 'electron'

const EVENT_WHITELIST = new Set([
  'player:state',
  'player:tick',
  'player:error',
  'player:queue',
  'toast',
  'scan:progress',
  'sources:changed',
  'settings:changed',
  'window:state',
  'app:navigate',
  'lyric:payload',
  'player:sleep',
  'player:spectrum',
])

const api = {
  invoke<T = any>(channel: string, payload?: any): Promise<T> {
    return ipcRenderer.invoke('sw:invoke', channel, payload)
  },
  on(channel: string, cb: (payload: any) => void): () => void {
    if (!EVENT_WHITELIST.has(channel)) return () => {}
    const handler = (_e: unknown, data: any) => {
      try {
        cb(data)
      } catch (err) {
        console.error('[preload] 事件回调异常', channel, err)
      }
    }
    ipcRenderer.on(channel, handler)
    return () => ipcRenderer.removeListener(channel, handler)
  },
  platform: process.platform,
  versions: {
    electron: process.versions.electron,
    chrome: process.versions.chrome,
    node: process.versions.node,
  },
}

contextBridge.exposeInMainWorld('sw', api)
