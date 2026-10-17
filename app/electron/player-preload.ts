import { contextBridge, ipcRenderer } from 'electron'

/**
 * 播放宿主 preload：只暴露最小指令通道，音频逻辑完全隔离在独立进程内。
 */
contextBridge.exposeInMainWorld('audioHost', {
  onCommand(cb: (cmd: any) => void) {
    const handler = (_e: unknown, cmd: any) => {
      try {
        cb(cmd)
      } catch (err) {
        console.error('[audio-host] 指令处理异常', err)
      }
    }
    ipcRenderer.on('host:cmd', handler)
    return () => ipcRenderer.removeListener('host:cmd', handler)
  },
  report(msg: any) {
    ipcRenderer.send('host:event', msg)
  },
})
