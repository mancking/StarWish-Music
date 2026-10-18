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
const src = path.join(dir, 'index.mobile.html')
if (!fs.existsSync(src)) {
  console.error('[rename-mobile-html] 找不到', src)
  process.exit(1)
}
fs.copyFileSync(src, path.join(dir, 'index.html'))
console.log('[rename-mobile-html] index.html 就绪')
