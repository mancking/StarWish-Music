/**
 * 内置音源种子：从种子文件导入源码，按打包期写入虚拟 fs。
 * 种子文件（seed-files vs seed-empty）由 vite 别名在构建时按 BUILD_CHANNEL 切换。
 */
import { SOURCE_FILES } from './seed-source'
import * as vfs from './shims/vfs'

export function seedSources(): void {
  vfs.seed(SOURCE_FILES)
}