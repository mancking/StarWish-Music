/**
 * `sourcesDir()` 的移动端指向虚拟 fs 的种子目录。
 * `paths.ts` 的候选：resourcesPath/sources → __dirname/../../sources → cwd/sources
 * → 都不存在时落到 `userDataDir()/sources`。为了让种子稳定命中同一路径，
 * 这里直接把 `sourcesDir()` 指向 `/starwish/sources`。
 */
import * as base from '../../../electron/core/paths'

/** 覆盖后的 sourcesDir：移动端固定返回虚拟 fs 种子路径 */
export function sourcesDir(): string {
  return '/starwish/sources'
}

/** 用户导入的音源目录：同样落在虚拟 fs */
export function userSourcesDir(): string {
  return '/starwish/sources'
}

/** 内置插件目录：移动端种子写进虚拟 fs 的 /starwish/plugins */
export function builtinPluginsDir(): string {
  return '/starwish/plugins'
}

/** 用户插件目录：与内置同目录（种子只读，用户导入同名覆盖） */
export function userPluginsDir(): string {
  return '/starwish/plugins'
}

/** 插件订阅清单：落在虚拟 fs 的 userData 下 */
export function pluginsRegistryFile(): string {
  return '/starwish/plugins-registry.json'
}

export const resourcesDir = (): string => '/starwish/resources'
export const rendererDir = (): string => '/starwish'

// 其余函数（userDataDir / cacheDir / dbFile / settingsFile / biliLoginFile …）
// 原样转发给桌面实现：它们在虚拟 fs 上同样成立
export const setUserDataDir = base.setUserDataDir
export const userDataDir = base.userDataDir
export const ensureDir = base.ensureDir
export const setCacheRoot = base.setCacheRoot
export const cacheRootDir = base.cacheRootDir
export const cacheDir = base.cacheDir
export const setCoverRoot = base.setCoverRoot
export const setMediaRoot = base.setMediaRoot
export const coverCacheDir = base.coverCacheDir
export const mediaCacheDir = base.mediaCacheDir
export const dataDirPointerFile = base.dataDirPointerFile
export const setLogRoot = base.setLogRoot
export const logRootDir = base.logRootDir
export const logDir = base.logDir
export const dbFile = base.dbFile
export const settingsFile = base.settingsFile
export const biliLoginFile = base.biliLoginFile

export default {
  sourcesDir, userSourcesDir, resourcesDir, rendererDir,
  builtinPluginsDir, userPluginsDir, pluginsRegistryFile,
  setUserDataDir, userDataDir, ensureDir,
  setCacheRoot, cacheRootDir, cacheDir,
  setCoverRoot, setMediaRoot, coverCacheDir, mediaCacheDir,
  dataDirPointerFile, setLogRoot, logRootDir, logDir, dbFile, settingsFile, biliLoginFile,
}
