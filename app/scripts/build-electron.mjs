import { build } from 'esbuild'
import fs from 'node:fs'
import path from 'node:path'

const root = process.cwd()
const outdir = path.join(root, 'dist', 'electron')

fs.rmSync(outdir, { recursive: true, force: true })
fs.mkdirSync(outdir, { recursive: true })

const common = {
  bundle: true,
  platform: 'node',
  target: 'node20',
  format: 'cjs',
  sourcemap: false,
  minify: true,
  logLevel: 'info',
  external: ['electron', 'sql.js', 'music-metadata'],
  define: { 'process.env.NODE_ENV': '"production"' },
}

const entries = [
  { in: 'electron/main.ts', out: 'main' },
  { in: 'electron/preload.ts', out: 'preload' },
  { in: 'electron/player-preload.ts', out: 'player-preload' },
  { in: 'electron/player-host.ts', out: 'player' },
]

for (const e of entries) {
  await build({
    ...common,
    entryPoints: [path.join(root, e.in)],
    outfile: path.join(outdir, `${e.out}.js`),
  })
}

fs.copyFileSync(path.join(root, 'electron', 'player.html'), path.join(outdir, 'player.html'))

const wasmSrc = path.join(root, 'node_modules', 'sql.js', 'dist', 'sql-wasm.wasm')
if (fs.existsSync(wasmSrc)) {
  fs.copyFileSync(wasmSrc, path.join(outdir, 'sql-wasm.wasm'))
} else {
  console.warn('[build] 警告：未找到 sql.js wasm，数据库可能无法初始化')
}

console.log('[build] electron 主进程产物已输出到 dist/electron')
