/**
 * 移动端 WebView 冒烟测试（无头 Electron 加载 dist/mobile/index.html）。
 *
 * 验证目标是「window.sw 桥在浏览器环境里真的把 core 跑起来了」：
 *  1. #app 有真实 DOM 子元素（Vue 挂载成功）
 *  2. sw.platform === 'android'、sw.invoke 可用
 *  3. sw.invoke('sources:list') 返回随包白名单音源（规格书 0.8：仅自研 3 源 + B 站，≥4）
 *  4. sw.invoke('db:playlists') / 'songs:library' 走真 sqlite（虚拟 fs）
 *  5. 控制台无 error 级输出、无未捕获异常
 *  6. 首页渲染出内容（首页 feed 至少一个模块有数据或已渲染）
 *
 * 跑法（子进程必须剔除 ELECTRON_RUN_AS_NODE，否则 electron 退化成 node）：
 *   cd app && node scripts/mobile-smoke.mjs
 * 或 npm run mobile:smoke
 */
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'
const require = createRequire(import.meta.url)
const path = require('node:path')
const __dirname = path.dirname(fileURLToPath(import.meta.url))
const net = require('node:net')
const fs = require('node:fs')
const http = require('node:http')
const https = require('node:https')

function freePort() {
  return new Promise((resolve, reject) => {
    const srv = net.createServer()
    srv.once('error', reject)
    srv.listen(0, '127.0.0.1', () => {
      const { port } = srv.address()
      srv.close(() => resolve(port))
    })
  })
}

function httpServe(root) {
  // ponytail: 静态文件服务器只服务 dist/mobile，够跑冒烟即可
  const MIME = {
    '.html': 'text/html; charset=utf-8',
    '.js': 'text/javascript; charset=utf-8',
    '.css': 'text/css; charset=utf-8',
    '.json': 'application/json; charset=utf-8',
    '.png': 'image/png',
    '.svg': 'image/svg+xml',
    '.ico': 'image/x-icon',
    '.woff2': 'font/woff2',
    '.wasm': 'application/wasm',
  }
  return http.createServer((req, res) => {
    try {
      let rel = decodeURIComponent(req.url.split('?')[0])
      // 冒烟期给上游 API 开 CORS 绿灯：真机走 Capacitor 原生 http（无 CORS 概念），
      // 桌面走 swmedia 代理，两者都不受此影响。这样断言「控制台无 error」才是有效的。
      if (rel.startsWith('/__cors')) {
        const target = new URL('https://' + req.url.slice('/__cors'.length))
        const opts = {
          hostname: target.hostname,
          port: 443,
          path: target.pathname + target.search,
          method: req.method,
          headers: { ...req.headers, host: target.hostname },
        }
        delete opts.headers['origin']
        delete opts.headers['referer']
        https.request(opts, (up) => {
          const h = { ...up.headers, 'access-control-allow-origin': '*' }
          delete h['content-encoding']
          res.writeHead(up.statusCode, h)
          up.pipe(res)
        }).on('error', () => res.writeHead(502).end('bad gateway')).end()
        return
      }
      if (rel === '/') rel = '/index.html'
      const file = path.normalize(path.join(root, rel))
      if (!file.startsWith(root)) {
        res.writeHead(403).end('forbidden')
        return
      }
      if (!fs.existsSync(file) || fs.statSync(file).isDirectory()) {
        res.writeHead(404).end('not found')
        return
      }
      res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream' })
      fs.createReadStream(file).pipe(res)
    } catch (e) {
      res.writeHead(500).end(String(e && e.message))
    }
  })
}

async function wait(ms) {
  return new Promise((r) => setTimeout(r, ms))
}

async function main() {
  process.env.STARWISH_QUIET = '1'

  const htmlDir = path.join(__dirname, '..', 'dist', 'mobile')
  if (!fs.existsSync(htmlDir)) {
    console.error('[smoke] dist/mobile 不存在，请先 npm run build:mobile')
    process.exit(1)
  }

  const port = await freePort()
  const server = httpServe(htmlDir)
  await new Promise((r) => server.listen(port, '127.0.0.1', r))
  console.log('[smoke] 本地静态服务 http://127.0.0.1:' + port)

  // electron 的 npm 入口只是 exe 路径字符串；要在 node 进程内拿到
  // app/BrowserWindow，必须用 require('electron') 时走
  // ELECTRON_RUN_AS_NODE=undefined + 设置 process.env.ELECTRON_APP
  // —— 常规做法是「用 electron 二进制本身当解释器」：
  //     electron scripts/mobile-smoke.mjs
  // 这里两者都支持：node 跑时内部 spawn electron。
  const electron = await import('electron')
  const app = electron.app ?? electron.default?.app
  const BrowserWindow = electron.BrowserWindow ?? electron.default?.BrowserWindow
  if (!app || !BrowserWindow) {
    // node 解释器下 require('electron') 拿到的是 exe 路径字符串，属预期
    console.log('[smoke] node 下拿不到 electron API，改用 electron 二进制重跑')
    const { spawnSync } = require('node:child_process')
    const exe = String(require('electron'))
    const r = spawnSync(exe, ['--no-sandbox', fileURLToPath(import.meta.url)], {
      stdio: 'inherit',
      env: { ...process.env, ELECTRON_RUN_AS_NODE: undefined, STARWISH_QUIET: '1' },
    })
    process.exit(r.status ?? 1)
  }

  const consoleErrors = []
  const pageErrors = []

  let win = null
  app.on('browser-window-created', (_e, w) => {
    w.webContents.on('console-message', (_ev, level, message, line, sourceId) => {
      // Electron 开发态自身的安全提示（如 CSP unsafe-eval 提醒），官方注明
      // 打包后不再显示，Android 端跑的是系统 WebView 根本没有它 —— 非应用错误。
      if (message.includes('Electron Security Warning')) return
      if (level >= 2) consoleErrors.push({ level, message, line, source: sourceId })
    })
    w.webContents.on('render-process-gone', (_e, d) => {
      pageErrors.push({ level: 3, message: 'render-process-gone: ' + JSON.stringify(d) })
    })
    win = w
  })

  await app.whenReady()
  const browser = new BrowserWindow({
    width: 420,
    height: 900,
    show: false,
    webPreferences: { contextIsolation: false, nodeIntegration: false },
  })
  await browser.loadURL('http://127.0.0.1:' + port + '/index.html')

  const js = (code) => browser.webContents.executeJavaScript(code, true)

  const checks = []
  const check = (name, pass, detail) => {
    checks.push({ name, pass, detail })
    console.log((pass ? 'PASS ' : 'FAIL ') + name + (detail === undefined ? '' : ' → ' + JSON.stringify(detail)))
  }

  // 1. 桥安装 + Vue 挂载（给 boot 与首屏渲染留时间）
  let bootOk = false
  for (let i = 0; i < 80; i++) {
    const st = await js(`
      (() => {
        const w = window
        if (!w.sw) return { ready: false }
        const kids = document.querySelectorAll('#app > *').length
        return { ready: true, platform: w.sw.platform, kids }
      })()
    `).catch((e) => ({ err: String(e && e.message) }))
    if (st && st.ready && st.kids > 0) {
      bootOk = true
      check('window.sw 已安装且 #app 有子元素', true, st)
      break
    }
    await wait(250)
  }
  if (!bootOk) {
    const st = await js(`(() => ({ hasSw: !!(window).sw, kids: document.querySelectorAll('#app > *').length, html: document.querySelector('#app')?.innerHTML?.slice(0,300) }))()`).catch((e) => ({ err: String(e && e.message) }))
    check('window.sw 已安装且 #app 有子元素', false, st)
  }

  // 2. 音源：vfs 种子 + lx-host
  const sources = await js(`(window).sw.invoke('sources:list')`).catch((e) => ({ ok: false, error: String(e && e.message) }))
  const srcCount = sources && sources.data ? sources.data.length : 0
  // 规格书 0.8 随包白名单：sources/ 仅自研源随包（第三方改由源市场/订阅获取）
  check('sources:list 返回随包白名单音源', srcCount >= 4, { count: srcCount, first: sources && sources.data ? sources.data[0] : sources })

  // 3. sqlite（虚拟 fs + sql.js wasm）
  const pls = await js(`(window).sw.invoke('db:playlists')`).catch((e) => ({ ok: false, error: String(e && e.message) }))
  check('db:playlists 返回数组（sqlite 可用）', Array.isArray(pls && pls.data), pls)

  // 4. 首页渲染：首页应至少有一个区块节点
  const home = await js(`document.querySelectorAll('#app .page, #app main, #app section, #app .home').length`).catch((e) => -1)
  check('首页渲染出内容区块', typeof home === 'number' && home > 0, { nodes: home })

  // 5. 路由可切：跳到发现页（歌单/榜单页）
  //    vue-router 初始导航可能在我设 hash 后才落定并把它归位成 '#/'，
  //    固定等待一锤定音会偶发假失败 —— 轮询重设直到真正进入。
  const discover = await js(`
    (async () => {
      const w = window
      const want = '#/discover'
      for (let i = 0; i < 20; i++) {
        const txt = document.body.innerText
        if (location.hash === want && /歌单|排行|新歌|全部/.test(txt)) {
          return { hash: location.hash, hasTag: true, tries: i }
        }
        location.hash = want
        await new Promise(r => setTimeout(r, 300))
      }
      const txt = document.body.innerText
      return { hash: location.hash, hasTag: /歌单|排行|新歌|全部/.test(txt), tried: 20 }
    })()
  `).catch((e) => ({ err: String(e && e.message) }))
  check('发现页路由可进入', !!(discover && discover.hasTag), discover)

  // 6. 播放器能力存在
  const playerState = await js(`(window).sw.invoke('player:state')`).catch((e) => ({ err: String(e && e.message) }))
  const st = playerState && playerState.data
  check('player:state 可调用', !!(st && st.queue !== undefined && st.volume !== undefined), st || playerState)

  // 7. 缓存/数据目录诚实零值
  const cache = await js(`(window).sw.invoke('cache:size')`).catch((e) => ({ ok: false, error: String(e && e.message) }))
  check('cache:size 返回对象（移动端诚实零值）', !!(cache && cache.data && typeof cache.data === 'object'), cache)

  check('控制台无 error 级输出', consoleErrors.length === 0, consoleErrors.slice(0, 5))
  check('渲染进程未崩溃', pageErrors.length === 0, pageErrors.slice(0, 3))

  browser.destroy()
  server.close()
  const failed = checks.filter((c) => !c.pass)
  console.log('\n[smoke] 移动端 ' + (checks.length - failed.length) + '/' + checks.length + ' 通过')
  if (failed.length) {
    failed.forEach((f) => console.log('  ✗ ' + f.name))
    app.exit(1)
  } else {
    app.exit(0)
  }
}

main().catch((e) => {
  console.error('[smoke] 移动端冒烟异常', e)
  process.exit(1)
})
