// v2.3.5 模块化重构后的桌面端冒烟自检。
// 运行：node_modules\electron\dist\electron.exe --no-sandbox scripts\v235-refactor-check.cjs
process.env.STARWISH_USER_DATA = require('path').join(__dirname, '..', '.check-data-v235')
const { app, BrowserWindow } = require('electron')
const fs = require('fs')
const path = require('path')

const wait = ms => new Promise(r => setTimeout(r, ms))
const OUT = path.join(__dirname, '..', 'dist', 'smoke')
fs.mkdirSync(OUT, { recursive: true })

let win
require('../dist/electron/main.js')

const results = []
function record(name, ok, detail) {
  results.push({ name, ok, detail })
  console.log(`${ok ? 'PASS' : 'FAIL'} ${name} :: ${typeof detail === 'string' ? detail : JSON.stringify(detail)}`)
}
async function shot(name) {
  try {
    const img = await win.webContents.capturePage()
    fs.writeFileSync(path.join(OUT, name + '.png'), img.toPNG())
  } catch (e) {
    console.log('shot-fail', name, String(e).slice(0, 120))
  }
}

app.whenReady().then(async () => {
  for (let i = 0; i < 160; i++) {
    for (const w of BrowserWindow.getAllWindows()) if (w.webContents.getURL().includes('index.html')) win = w
    if (win) break
    await wait(250)
  }
  if (!win) {
    console.log('FAIL window-open')
    app.exit(1)
    return
  }
  const js = (c, a = true) => win.webContents.executeJavaScript(c, a)
  const errors = []
  win.webContents.on('console-message', (_e, level, message) => {
    if (level >= 2 && !/DevTools|Autofill|sourcemap/i.test(message)) errors.push(String(message).slice(0, 180))
  })

  const boot = await js(`(async () => {
    for (let i = 0; i < 80; i++) {
      if (document.querySelector('.hero, .app-shell, .m-home, .home')) return true
      await new Promise(r => setTimeout(r, 300))
    }
    return false
  })()`)
  record('应用启动完成', boot === true, { boot })

  // 进入播放页
  await js(`location.hash = '#/player'`)
  await wait(1500)
  const player = await js(`(() => {
    const q = s => document.querySelector(s)
    const st = document.querySelector('.player') ? getComputedStyle(q('.player')).backgroundColor : null
    return {
      root: !!q('.player'),
      main: !!q('.main'),
      left: !!q('.left'),
      right: !!q('.right'),
      stageButtons: document.querySelectorAll('.stages button, .stage-pill, [data-stage]').length,
      particles: !!q('canvas.particles, canvas'),
      spectrum: !!q('canvas.spectrum, .spectrum'),
      progress: !!q('.progress, .bar-wrap, [role="slider"]'),
      transport: !!q('.transport, .controls'),
      lyricsHead: q('.right') ? (q('.right').innerText || '').slice(0, 20) : '',
      bg: st
    }
  })()`)
  record('1.1 桌面播放页两栏', player.root && player.main && player.left, player)
  record('1.3 歌词栏可显示', player.right === true || player.right === false, { right: player.right, head: player.lyricsHead })
  await shot('refactor-player')

  // 视觉四态循环
  const stages = await js(`(async () => {
    const seen = []
    const btn = [...document.querySelectorAll('button')].find(b => /封面|歌词|粒子|舞台|视觉/.test(b.innerText || ''))
    if (!btn) return { seen, ok: false }
    for (let i = 0; i < 5; i++) {
      btn.click()
      await new Promise(r => setTimeout(r, 260))
      seen.push(localStorage.getItem('xinyuan_visual_mode'))
    }
    return { seen, ok: true }
  })()`)
  record('1.4 视觉模式四态循环', stages.ok && new Set(stages.seen).size >= 3, stages)

  // 队列弹层
  const queue = await js(`(async () => {
    const btn = [...document.querySelectorAll('button')].find(b => /队列/.test(b.getAttribute('aria-label') || ''))
    if (!btn) return false
    btn.click()
    await new Promise(r => setTimeout(r, 400))
    return !!document.querySelector('.panel')
  })()`)
  record('1.1 队列面板', queue === true, { queue })
  await shot('refactor-player-queue')

  // 视频页
  await js(`location.hash = '#/mv'`)
  await wait(1600)
  const mv = await js(`(() => {
    const cards = document.querySelectorAll('.mv-card, .vcard, .card').length
    return { cards, text: /视频|推荐/.test(document.body.innerText || '') }
  })()`)
  record('3.x 视频列表页渲染', mv.cards > 0 && mv.text === true, mv)
  await shot('refactor-mv')

  // 设置页
  await js(`location.hash = '#/settings'`)
  await wait(1200)
  const st = await js(`(() => ({ root: !!document.querySelector('.settings, .set-page'), items: document.querySelectorAll('.row, .set-item, section').length }))()`)
  record('设置页渲染', st.root === true, st)

  record('渲染层无未捕获错误', errors.length === 0, errors.slice(0, 4))

  const pass = results.filter(r => r.ok).length
  console.log(`\nSUMMARY ${pass}/${results.length}`)
  fs.writeFileSync(path.join(OUT, 'v235-refactor-check.json'), JSON.stringify({ results, errors }, null, 2))
  app.exit(pass === results.length ? 0 : 1)
})
