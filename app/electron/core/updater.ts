import fs from 'node:fs'
import path from 'node:path'
import http from 'node:http'
import https from 'node:https'
import { URL } from 'node:url'
import { app } from 'electron'
import { createLogger } from './log'
import { ensureDir, userDataDir } from './paths'

const logger = createLogger('updater')

export interface UpdateDownloadProgress {
  received: number
  total: number
  percent: number
  phase: 'downloading' | 'done' | 'error'
}

/** 更新包暂存目录：<userData>/update */
export function updateDir(): string {
  return ensureDir(path.join(userDataDir(), 'update'))
}

/**
 * 跟随重定向下载文件到磁盘（GitHub Release 会 302 到 CDN）。
 * 用 node http/https 而非 fetch：需要流式落盘 + 精确进度，且要兼容旧版 Electron 的 Node。
 */
export function downloadFile(
  url: string,
  destPath: string,
  onProgress?: (p: UpdateDownloadProgress) => void
): Promise<string> {
  return new Promise<string>((resolve, reject) => {
    let redirects = 0
    const run = (target: string): void => {
      const u = new URL(target)
      const mod = u.protocol === 'http:' ? http : https
      const req = mod.get(
        target,
        {
          headers: {
            'User-Agent': 'StarWish-Music-Updater',
            Accept: 'application/octet-stream,*/*',
          },
        },
        res => {
          const status = res.statusCode || 0
          if (status >= 300 && status < 400 && res.headers.location) {
            res.resume()
            if (++redirects > 8) {
              reject(new Error('下载重定向次数过多'))
              return
            }
            run(new URL(res.headers.location, target).toString())
            return
          }
          if (status !== 200) {
            res.resume()
            reject(new Error(`下载失败：HTTP ${status}`))
            return
          }
          const total = Number(res.headers['content-length'] || 0)
          let received = 0
          let lastTick = 0
          const tmp = `${destPath}.part`
          try {
            fs.mkdirSync(path.dirname(destPath), { recursive: true })
          } catch {
            /* 忽略 */
          }
          const out = fs.createWriteStream(tmp)
          res.on('data', (chunk: Buffer) => {
            received += chunk.length
            const now = Date.now()
            if (onProgress && (now - lastTick > 200 || received === total)) {
              lastTick = now
              onProgress({
                received,
                total,
                percent: total ? Math.min(100, Math.round((received / total) * 100)) : 0,
                phase: 'downloading',
              })
            }
          })
          res.pipe(out)
          out.on('finish', () => {
            try {
              fs.renameSync(tmp, destPath)
            } catch (e: any) {
              logger.warn('重命名下载文件失败', e?.message)
            }
            onProgress?.({ received, total: total || received, percent: 100, phase: 'done' })
            resolve(destPath)
          })
          out.on('error', e => reject(e))
        }
      )
      req.on('error', e => reject(e))
      req.setTimeout(60000, () => {
        req.destroy(new Error('下载超时'))
      })
    }
    run(url)
  })
}

/**
 * 下载桌面端新版安装包（Windows 便携 exe / macOS zip）到暂存目录，
 * 并返回新可执行文件路径，供渲染层提示用户重启替换。
 */
export async function downloadDesktopUpdate(
  url: string,
  version: string,
  onProgress?: (p: UpdateDownloadProgress) => void
): Promise<{ path: string; fileName: string }> {
  const safeVer = String(version || 'new').replace(/[^\w.\-]/g, '')
  const lower = url.toLowerCase()
  const isZip = lower.endsWith('.zip')
  const isMac = lower.includes('mac') || process.platform === 'darwin'
  const fileName = isMac
    ? `StarWish-${safeVer}-mac.zip`
    : isZip
      ? `StarWish-${safeVer}-x64.zip`
      : `StarWish-${safeVer}-setup.exe`
  const dest = path.join(updateDir(), fileName)
  logger.info('开始下载桌面更新', url)
  await downloadFile(url, dest, onProgress)
  return { path: dest, fileName }
}

/** 用下载到的新版可执行文件重启应用（便携版：直接以新 exe 拉起） */
export function relaunchWithUpdate(exePath: string): void {
  try {
    const { spawn } = require('node:child_process') as typeof import('node:child_process')
    const detached = spawn(exePath, [], { detached: true, stdio: 'ignore' })
    detached.unref()
  } catch (e: any) {
    logger.warn('启动新版本失败', e?.message)
  }
  app.relaunch()
  app.exit(0)
}
