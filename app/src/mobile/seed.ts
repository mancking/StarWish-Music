/**
 * 内置音源种子：把 `sources/` 下的 .js 原文按打包期写入虚拟 fs。
 *
 * `lxHost.load()` 从 `sourcesDir()` 读目录，桌面读 resourcesPath/sources；
 * 移动端的 shim `sourcesDir()` 解析到 `/starwish/sources`，所以这里把原文塞进去
 * —— 用 `?raw` 让 vite 在打包时直接内联成字符串，不依赖运行时文件系统。
 *
 * 用 import.meta.glob 而不是逐个 import：仓库只提交自研音源（.gitignore 排除了
 * 第三方脚本），写死文件名会让 CI 在缺文件时直接构建失败。glob 按实际存在的文件
 * 收集，本地有 11 个就内联 11 个，CI 只有 2 个就内联 2 个。
 *
 * 插件不再内置：移动端与桌面一致，插件一律由用户从「插件市场」/订阅/本地导入安装。
 */
import * as vfs from './shims/vfs'

const RAW_MODULES = import.meta.glob('../../sources/*.js', {
  query: '?raw',
  import: 'default',
  eager: true,
}) as Record<string, string>

export const SOURCE_FILES: Record<string, string> = {}

for (const [fullPath, content] of Object.entries(RAW_MODULES)) {
  const name = fullPath.split('/').pop()
  if (name) SOURCE_FILES[name] = content
}

export function seedSources(): void {
  vfs.seed(SOURCE_FILES)
}
