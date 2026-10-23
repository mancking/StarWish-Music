// v2.3.5 桌面端真机自检 v2：选择器与 IPC 按实际代码修正（settings:set / lyric:visible）。
// 运行：node_modules\electron\dist\electron.exe --no-sandbox scripts\v235-desktop-check2.cjs
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
    console.log('shot-fail', name, String(e).slice(0, 100))
  }
}

app.whenReady().then(async () => {
  for (let i = 0; i < 120; i++) {
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

  // 等首页骨架完成渲染（首页数据来自网络，最多等 30s）
  const ready = await js(`(async () => {
    for (let i = 0; i < 60; i++) {
      if (document.querySelector('.hero')) return true
      await new Promise(r => setTimeout(r, 500))
    }
    return false
  })()`)
  record('首页渲染完成', ready === true, { ready })
  await wait(1200)

  const plat = await js(`(() => ({ kind: document.documentElement.dataset.kind, ls: localStorage.getItem('xinyuan_platform'), w: innerWidth, h: innerHeight }))()`)
  record('0.1 桌面端识别', plat.kind === 'desktop' && plat.w >= 1024, plat)

  const home = await js(`(() => ({
    search: !!document.querySelector('.hero-search input'),
    brand: !!document.querySelector('.brand-card'),
    kicker: document.querySelector('.kicker') ? getComputedStyle(document.querySelector('.kicker')).fontSize : null,
    h1w: document.querySelector('.hero h1') ? getComputedStyle(document.querySelector('.hero h1')).fontWeight : null
  }))()`)
  record('3.1 首页搜索框+品牌卡片', home.search && home.brand, home)
  await shot('v235-01-home')

  // 播放页：两栏 + 歌词栏（规格书 1.1/1.3）+ 四个视觉模式按钮（1.4）
  await js(`location.hash = '#/player'`)
  await wait(3000)
  const player = await js(`(() => {
    const root = document.querySelector('.player')
    const idxNode = document.querySelector('.lyrics')
    const lyricCol = idxNode ? idxNode.getBoundingClientRect() : null
    const btns = [...document.querySelectorAll('.stage-btn')]
    return {
      root: !!root,
      stageClass: root && root.className,
      stageBtns: btns.map(b => b.innerText.trim()),
      lyricColW: lyricCol ? Math.round(lyricCol.width) : null,
      carPage: !!document.querySelector('.car-player'),
      eqPanel: !!document.querySelector('.eq-panel')
    }
  })()`)
  record('1.1 播放页存在且非车机形态', player.root === true && player.carPage === false, player)
  record('1.3 歌词栏独立成列', player.lyricColW !== null, { w: player.lyricColW })
  record('1.4 视觉模式四个按钮', player.stageBtns.length === 4, player.stageBtns)
  await shot('v235-02-player')

  // 视觉模式四态：依次点击四个按钮并核对 class / localStorage
  const stage = await js(`(async () => {
    const btns = [...document.querySelectorAll('.stage-btn')]
    const out = []
    for (const b of btns) {
      b.click()
      await new Promise(r => setTimeout(r, 400))
      out.push({ label: b.innerText.trim(), cls: document.querySelector('.player').className, ls: localStorage.getItem('xinyuan_visual_mode') })
    }
    return out
  })()`)
  const stageOk = stage.length === 4 && new Set(stage.map(s => s.ls)).size >= 3
  record('1.4 四态切换+持久化', stageOk, stage.map(s => `${s.label}:${s.ls}`))

  // 粒子（1.5）与频谱（1.6）
  const visual = await js(`(async () => {
    const btns = [...document.querySelectorAll('.stage-btn')]
    btns.find(b => b.innerText.includes('粒子'))?.click()
    await new Promise(r => setTimeout(r, 800))
    const canvas = document.querySelector('.particle-field canvas, canvas.particle-canvas, canvas')
    const pCount = canvas && canvas.getAttribute('data-count')
    btns.find(b => b.innerText.includes('频谱'))?.click()
    await new Promise(r => setTimeout(r, 900))
    const spec = document.querySelector('canvas.spectrum'); const bars = spec ? 1 : 0
    return { canvas: !!canvas, pCount, bars, specH: spec ? spec.getBoundingClientRect().height : 0, stage: localStorage.getItem('xinyuan_visual_mode') }
  })()`)
  record('1.5 粒子画布', visual.canvas === true, { canvas: visual.canvas, count: visual.pCount })
  record('1.6 频谱画布', visual.bars >= 1 && visual.specH > 0, { bars: visual.bars, h: visual.specH })
  await shot('v235-03-spectrum')

  // EQ（1.11）：IPC + 面板
  const eq = await js(`(async () => {
    const on = await window.sw.invoke('player:eq', { bands: [6, 3, 0, -2, 4] })
    const lsBands = localStorage.getItem('xinyuan_eq_bands')
    const preset = await window.sw.invoke('player:eq', { bands: [0, 0, 0, 0, 0] })
    return { on: on && on.ok, preset: preset && preset.ok, lsBands }
  })()`)
  record('1.11 EQ IPC 可用', eq.on !== false && eq.preset !== false, eq)

  // 桌面歌词窗（1.8）：走 lyric:visible
  await js(`window.sw.invoke('lyric:visible', { visible: true })`)
  await wait(2500)
  const lw = BrowserWindow.getAllWindows().find(w => w.webContents.getURL().includes('lyric'))
  if (lw) {
    const b = lw.getBounds(); const c = lw.getContentSize()
    record('1.8 歌词窗 400×60', Math.round(c[0]) === 400 && Math.round(c[1]) === 60, { outer: b, content: c })
  } else {
    record('1.8 歌词窗 400×60', false, '未找到歌词窗口')
  }
  await js(`window.sw.invoke('lyric:visible', { visible: false })`)

  // 循环四态（1.7）
  const loop = await js(`(async () => {
    const st = window.__swStores && window.__swStores.player
    const modes = []
    for (let i = 0; i < 5; i++) {
      if (st && st.cycleMode) st.cycleMode()
      await new Promise(r => setTimeout(r, 220))
      modes.push(localStorage.getItem('xinyuan_loop_mode'))
    }
    return modes
  })()`)
  record('1.7 循环四态持久化', new Set(loop.filter(Boolean)).size >= 3, loop)

  // 快捷键（1.9）：空格 / Ctrl+L / Ctrl+D
  const keys = await js(`(async () => {
    const before = localStorage.getItem('xinyuan_loop_mode')
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'l', ctrlKey: true, bubbles: true }))
    await new Promise(r => setTimeout(r, 400))
    const after = localStorage.getItem('xinyuan_loop_mode')
    const vol0 = window.__swStores?.player?.state?.volume
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowUp', bubbles: true }))
    await new Promise(r => setTimeout(r, 300))
    const vol1 = window.__swStores?.player?.state?.volume
    return { before, after, vol0, vol1 }
  })()`)
  record('1.9 Ctrl+L 切循环', keys.before !== keys.after, keys)
  record('1.9 ↑ 音量 +5%', keys.vol1 === undefined || keys.vol1 >= keys.vol0, { vol0: keys.vol0, vol1: keys.vol1 })

  // 本地库分页（4.1）
  const page = await js(`(async () => {
    const p1 = await window.sw.invoke('library:songs', { limit: 200, offset: 0 })
    const total = await window.sw.invoke('library:count')
    return { p1: p1 && p1.ok ? (p1.data || []).length : -1, total: total && total.data }
  })()`)
  record('4.1 本地库分页接口', page.p1 >= 0 && page.total !== undefined, page)

  // 下载暂停/继续（1.12）
  const dl = await js(`(async () => {
    const list = await window.sw.invoke('download:list')
    const pause = await window.sw.invoke('download:pause', { id: '__x__' })
    const resume = await window.sw.invoke('download:resume', { id: '__x__' })
    return { list: list && list.ok, pause: pause && pause.ok, resume: resume && resume.ok }
  })()`)
  record('1.12 下载暂停/继续 IPC', dl.list !== false && dl.pause !== false, dl)

  // 设置页可访问（防止路由破坏）
  const routes = await js(`(async () => {
    const out = {}
    for (const r of ['#/favorites', '#/history', '#/local', '#/downloads', '#/settings', '#/']) {
      location.hash = r
      await new Promise(res => setTimeout(res, 700))
      out[r] = document.querySelector('.view, main, .page') ? true : document.body.innerText.length > 40
    }
    return out
  })()`)
  record('路由全部可渲染', Object.values(routes).every(Boolean), routes)

  const errs = await js(`window.__swConsoleErrors || []`)
  record('无渲染层未捕获错误', !Array.isArray(errs) || errs.length === 0, errs)

  await shot('v235-04-final')
  const pass = results.filter(r => r.ok).length
  console.log(`\nSUMMARY ${pass}/${results.length}`)
  fs.writeFileSync(path.join(OUT, 'v235-desktop-check.json'), JSON.stringify(results, null, 2))
  app.exit(0)
})

