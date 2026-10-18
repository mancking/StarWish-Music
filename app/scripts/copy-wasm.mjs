import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'
const require = createRequire(import.meta.url)
const path = require('node:path')
const __dirname = path.dirname(fileURLToPath(import.meta.url))
const net = require('node:net')
const fs = require('node:fs')
const http = require('node:http')

/**
 * 复制 sql-wasm.wasm 到 dist/mobile/assets（与 sql-wasm lazy chunk 同目录）。
 * sql-wasm.js 的 locateFile 默认取脚本所在相对路径；这里直接放旁边最稳。
 */
function copyWasm() {
  const src = path.join(__dirname, '..', 'node_modules', 'sql.js', 'dist', 'sql-wasm.wasm')
  const dstDir = path.join(__dirname, '..', 'dist', 'mobile', 'assets')
  if (!fs.existsSync(src) || !fs.existsSync(dstDir)) return
  fs.copyFileSync(src, path.join(dstDir, 'sql-wasm.wasm'))
  console.log('[copy-wasm] 已复制 sql-wasm.wasm →', dstDir)
}
copyWasm()
