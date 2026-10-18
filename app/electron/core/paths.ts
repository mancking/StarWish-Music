import path from 'node:path'
import fs from 'node:fs'
import os from 'node:os'

/**
 * 统一路径解析。
 * 开发态：源码目录；打包态：app.asar 之外的 resources 目录（音源脚本必须可读写）。
 */

let cachedUserData = ''

export function setUserDataDir(dir: string): void {
  cachedUserData = dir
}

export function userDataDir(): string {
  if (cachedUserData) return cachedUserData
  if (process.env.STARWISH_USER_DATA) return process.env.STARWISH_USER_DATA
  const base =
    process.env.APPDATA ||
    (process.platform === 'darwin'
      ? path.join(os.homedir(), 'Library', 'Application Support')
      : path.join(os.homedir(), '.config'))
  return path.join(base, 'StarWish')
}

export function ensureDir(dir: string): string {
  try {
    fs.mkdirSync(dir, { recursive: true })
  } catch {
    /* 目录已存在或无权限 */
  }
  return dir
}

let cacheRoot = ''
let coverRoot = ''
let mediaRoot = ''

export function setCacheRoot(dir: string): void {
  cacheRoot = dir && dir.trim() ? dir : ''
}

/** 封面 / 媒体缓存可各自指向独立目录，留空则跟随缓存目录 */
export function setCoverRoot(dir: string): void {
  coverRoot = dir && dir.trim() ? dir : ''
}

export function setMediaRoot(dir: string): void {
  mediaRoot = dir && dir.trim() ? dir : ''
}

export function cacheRootDir(): string {
  return cacheRoot || path.join(userDataDir(), 'cache')
}

export function cacheDir(): string {
  return ensureDir(cacheRootDir())
}

export function coverCacheDir(): string {
  return ensureDir(coverRoot || path.join(cacheDir(), 'covers'))
}

export function mediaCacheDir(): string {
  return ensureDir(mediaRoot || path.join(cacheDir(), 'media'))
}

/** 数据目录指针文件：改过数据目录后写在默认位置，下次启动据此定位 */
export function dataDirPointerFile(): string {
  const base =
    process.env.APPDATA ||
    (process.platform === 'darwin'
      ? path.join(os.homedir(), 'Library', 'Application Support')
      : path.join(os.homedir(), '.config'))
  return path.join(base, 'StarWish', '.datadir')
}

export function logDir(): string {
  return ensureDir(path.join(userDataDir(), 'logs'))
}

export function dbFile(): string {
  return path.join(userDataDir(), 'starwish.db')
}

export function settingsFile(): string {
  return path.join(userDataDir(), 'settings.json')
}

export function biliLoginFile(): string {
  return path.join(userDataDir(), 'bili-login.json')
}

/** 内置音源目录：开发态在工程根 sources/，打包态在 resources/sources */
export function sourcesDir(): string {
  const envDir = process.env.STARWISH_SOURCES_DIR
  if (envDir && fs.existsSync(envDir)) return envDir
  const candidates = [
    path.join(process.resourcesPath || '', 'sources'),
    path.join(__dirname, '..', '..', 'sources'),
    path.join(process.cwd(), 'sources'),
  ]
  for (const c of candidates) {
    try {
      if (c && fs.existsSync(c)) return c
    } catch {
      /* ignore */
    }
  }
  return ensureDir(path.join(userDataDir(), 'sources'))
}

/** 用户导入的音源目录（可写） */
export function userSourcesDir(): string {
  return ensureDir(path.join(userDataDir(), 'sources'))
}

export function resourcesDir(): string {
  const p = path.join(process.resourcesPath || '', 'resources')
  if (fs.existsSync(p)) return p
  return path.join(__dirname, '..', '..', 'resources')
}

export function rendererDir(): string {
  return path.join(__dirname, '..', 'renderer')
}
