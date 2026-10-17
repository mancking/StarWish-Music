import { spawn, execFileSync } from 'node:child_process'
import path from 'node:path'
import process from 'node:process'

const root = process.cwd()
console.log('[dev] 编译 Electron 主进程…')
execFileSync(process.execPath, [path.join(root, 'scripts', 'build-electron.mjs')], { stdio: 'inherit' })

const { createServer } = await import('vite')
const server = await createServer({ configFile: path.join(root, 'vite.config.ts'), server: { port: 5273 } })
await server.listen()
const url = server.resolvedUrls?.local?.[0] || 'http://localhost:5273'
console.log('[dev] 渲染进程：', url)

const electronPath = (await import('electron')).default
const child = spawn(electronPath, ['.'], {
  stdio: 'inherit',
  env: { ...process.env, VITE_DEV_SERVER_URL: url, STARWISH_DEBUG: '1' },
})

child.on('close', async code => {
  await server.close()
  process.exit(code ?? 0)
})
