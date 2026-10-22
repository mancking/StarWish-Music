/**
 * vite 以 html 为输入时，产物名跟随源文件名（index.mobile.html），
 * 而 Capacitor 的 webDir 需要 index.html。这里把 index.mobile.html
 * 复制为 index.html（内容一致：script/css 都是相对 ./assets）。
 */
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'
const require = createRequire(import.meta.url)
const path = require('node:path')
const fs = require('node:fs')
const __dirname = path.dirname(fileURLToPath(import.meta.url))

const dir = path.join(__dirname, '..', 'dist', 'mobile')
const target = path.join(dir, 'index.html')
// 兼容两种输出名：vite 默认按 input 文件名（index.mobile.html），
// 某些版本/平台会直接产出 index.html。两者都找不到才失败。
const src = ['index.mobile.html', 'index.html'].map(f => path.join(dir, f)).find(p => fs.existsSync(p))
if (!src) {
  console.error('[rename-mobile-html] dist/mobile 下找不到入口 html，目录内容：')
  try {
    console.error(fs.readdirSync(dir).join(', '))
  } catch {
    console.error('（目录不存在）')
  }
  process.exit(1)
}
if (path.basename(src) !== 'index.html') fs.copyFileSync(src, target)
console.log('[rename-mobile-html] index.html 就绪 ←', path.basename(src))
