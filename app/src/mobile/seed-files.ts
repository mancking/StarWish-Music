/**
 * 内置音源种子（dev 通道）：把 dev-sources/ 下的 .js 原文按打包期写入虚拟 fs。
 * 仅在 BUILD_CHANNEL=dev（默认）时构建使用；release 通道使用 seed-files.ts（空种子）。
 */
import * as vfs from './shims/vfs'

const RAW_MODULES = import.meta.glob('../../dev-sources/*.js', {
  query: '?raw',
  import: 'default',
  eager: true,
}) as Record<string, string>

export const SOURCE_FILES: Record<string, string> = {}

for (const [fullPath, content] of Object.entries(RAW_MODULES)) {
  const name = fullPath.split('/').pop()
  if (name) SOURCE_FILES[name] = content
}