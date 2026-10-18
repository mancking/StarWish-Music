/**
 * 内置音源种子：把 `sources/` 的 11 个 .js 原文按打包期写入虚拟 fs。
 *
 * `lxHost.load()` 从 `sourcesDir()` 读目录，桌面读 resourcesPath/sources；
 * 移动端的 shim `sourcesDir()` 解析到 `/starwish/sources`，所以这里把
 * 11 个原文塞进去 —— 用 `?raw` 让 vite 在打包时直接内联成字符串，
 * 不依赖运行时文件系统，也不增大工程体积（只在移动包里）。
 */
import * as vfs from './shims/vfs'

import src1 from '../../sources/starwish-bilibili.js?raw'
import src2 from '../../sources/starwish-unified.js?raw'
import src3 from '../../sources/xinghai-music-sourcev2.3.15.js?raw'
import src4 from '../../sources/星海音乐源 v2.3.11.js?raw'
import src5 from '../../sources/星愿内置音源.js?raw'
import src6 from '../../sources/野草音源.js?raw'
import src7 from '../../sources/野花音源.js?raw'
import src8 from '../../sources/长青SVIP音源(二改修复版) v1.2.0.js?raw'
import src9 from '../../sources/K×H测试 v1.7.17.js?raw'
import src10 from '../../sources/墨澜聚合音源 v2.2.0.js?raw'
import src11 from '../../sources/聚合音源 特供版.js?raw'

export const SOURCE_FILES: Record<string, string> = {
  'starwish-bilibili.js': src1,
  'starwish-unified.js': src2,
  'xinghai-music-sourcev2.3.15.js': src3,
  '星海音乐源 v2.3.11.js': src4,
  '星愿内置音源.js': src5,
  '野草音源.js': src6,
  '野花音源.js': src7,
  '长青SVIP音源(二改修复版) v1.2.0.js': src8,
  'K×H测试 v1.7.17.js': src9,
  '墨澜聚合音源 v2.2.0.js': src10,
  '聚合音源 特供版.js': src11,
}

export function seedSources(): void {
  vfs.seed(SOURCE_FILES)
}
