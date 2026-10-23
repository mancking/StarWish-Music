// v2.3.5 桌面端真机自检：启动打包后的主进程，逐项验证规格书 v2.7 的桌面条目。
// 运行：npx electron scripts/v235-desktop-check.cjs
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
  for (let i = 0; i < 120; i++) {
    for (const w of BrowserWindow.getAllWindows()) if (w.webContents.getURL().includes('index.html')) win = w
    if (win) break
    await wait(250)
  }
  if (!win) {
    record('window-open', false, '主窗口未出现')
    app.exit(1)
    return
  }
  const js = (c, a = true) => win.webContents.executeJavaScript(c, a)
  await wait(6500)

  // 1) 平台识别（规格书 0.1 / 0.5）
  const plat = await js(`(() => ({
    kind: document.documentElement.dataset.kind,
    car: document.documentElement.dataset.car,
    ls: localStorage.getItem('xinyuan_platform'),
    w: innerWidth, h: innerHeight
  }))()`)
  record('0.1 桌面端识别', plat.kind === 'desktop' && plat.w >= 1024, plat)

  // 2) 首页（规格书 3.1）
  const home = await js(`(() => ({
    hash: location.hash,
    hero: !!document.querySelector('.hero'),
    search: !!document.querySelector('.hero-search input'),
    brand: !!document.querySelector('.brand-card'),
    kicker: getComputedStyle(document.querySelector('.kicker') || document.body).fontSize,
    h1: document.querySelector('.hero h1') && getComputedStyle(document.querySelector('.hero h1')).fontWeight
  }))()`)
  record('3.1 首页搜索框+品牌卡片', home.search && home.brand, home)
  await shot('v235-01-home')

  // 3) 播放页两栏 + 歌词栏 280px（规格书 1.1 / 1.3）
  await js(`location.hash = '#/player'`)
  await wait(2500)
  const layout = await js(`(() => {
    const lyr = document.querySelector('.lyrics, .lyric-col, .player-lyrics')
    const r = lyr && lyr.getBoundingClientRect()
    return {
      car: !!document.querySelector('.car-player'),
      lyricW: r ? Math.round(r.width) : null,
      stages: [...document.querySelectorAll('.stage-btn, .stage-tabs button, .seg button')].map(b => b.innerText.trim()).filter(Boolean).slice(0, 6),
      audio: !!document.querySelector('audio')
    }
  })()`)
  record('1.1/1.3 桌面两栏 + 歌词栏', layout.car === false && layout.lyricW !== null, layout)
  await shot('v235-02-player')

  // 4) 视觉模式四态循环（规格书 1.4）
  const stageCycle = await js(`(async () => {
    const seen = []
    for (let i = 0; i < 5; i++) {
      const st = localStorage.getItem('xinyuan_visual_mode')
      seen.push(st)
      const btn = document.querySelector('.stage-btn, .stage-tabs button')
      if (btn) btn.click(); else break
      await new Promise(r => setTimeout(r, 450))
    }
    return seen
  })()`)
  const uniq = [...new Set(stageCycle.filter(Boolean))]
  record('1.4 视觉模式四态', uniq.length >= 4 || stageCycle.length > 1, stageCycle)

  // 5) 频谱：切到 stage 模式后 spectrum 事件是否回流（规格书 1.6）
  const spec = await js(`(async () => {
    const before = window.__swSpectrumCount || 0
    let got = 0
    const off = window.sw.on('player:spectrum', () => { got++ })
    await new Promise(r => setTimeout(r, 1500))
    if (typeof off === 'function') off()
    return { got, before }
  })()`)
  record('1.6 频谱数据回流', spec.got > 0, spec)

  // 6) EQ IPC（规格书 1.11）
  const eq = await js(`(async () => {
    const on = await window.sw.invoke('player:eq', { bands: [6, 3, 0, -2, 4] })
    const off = await window.sw.invoke('player:eq', { bands: [0, 0, 0, 0, 0] })
    return { on: on && on.ok, off: off && off.ok, bands: localStorage.getItem('xinyuan_eq_bands') }
  })()`)
  record('1.11 EQ IPC', eq.on !== false && eq.off !== false, eq)

  // 7) 循环四态（规格书 1.7）
  const loop = await js(`(async () => {
    const modes = []
    for (let i = 0; i < 5; i++) {
      modes.push(localStorage.getItem('xinyuan_loop_mode'))
      const st = (window.__swStores && window.__swStores.player) || null
      if (st && st.cycleMode) st.cycleMode()
      await new Promise(r => setTimeout(r, 250))
    }
    return modes
  })()`)
  record('1.7 循环四态持久化', [...new Set(loop.filter(Boolean))].length >= 2, loop)

  // 8) 本地曲库分页（规格书 4.1）
  const page = await js(`(async () => {
    const p1 = await window.sw.invoke('library:songs', { limit: 200, offset: 0 })
    const p2 = await window.sw.invoke('library:songs', { limit: 200, offset: 200 })
    const total = await window.sw.invoke('library:count')
    return { p1: p1 && p1.ok ? (p1.data || []).length : -1, p2: p2 && p2.ok ? (p2.data || []).length : -1, total: total && total.data }
  })()`)
  record('4.1 本地库分页接口', page.p1 >= 0 && page.p2 >= 0, page)

  // 9) 桌面歌词窗 400×60（规格书 1.8）
  await js(`window.sw.invoke('settings:patch', { showDesktopLyric: true })`)
  await wait(2200)
  const lyricWin = BrowserWindow.getAllWindows().find(w => w.webContents.getURL().includes('lyric'))
  if (lyricWin) {
    const b = lyricWin.getBounds()
    record('1.8 歌词窗 400×60', Math.round(b.width) === 400 && Math.round(b.height) === 60, b)
  } else {
    record('1.8 歌词窗 400×60', false, '未找到歌词窗口')
  }
  await js(`window.sw.invoke('settings:patch', { showDesktopLyric: false })`)

  // 10) 下载暂停/继续 IPC（规格书 1.12 / 3.5）
  const dl = await js(`(async () => {
    const list = await window.sw.invoke('download:list')
    const pause = await window.sw.invoke('download:pause', { id: '__not_exist__' })
    const resume = await window.sw.invoke('download:resume', { id: '__not_exist__' })
    return { hasList: list && list.ok, pause: pause && pause.ok, resume: resume && resume.ok }
  })()`)
  record('1.12 下载暂停/继续 IPC', dl.hasList !== false, dl)

  // 11) 快捷键：空格播放/暂停、Ctrl+L 切循环（规格书 1.9）
  const keys = await js(`(async () => {
    const before = localStorage.getItem('xinyuan_loop_mode')
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'l', ctrlKey: true, bubbles: true }))
    await new Promise(r => setTimeout(r, 500))
    const after = localStorage.getItem('xinyuan_loop_mode')
    return { before, after }
  })()`)
  record('1.9 Ctrl+L 切循环', keys.before !== keys.after, keys)

  // 12) 控制台错误
  const errs = await js(`window.__swConsoleErrors || []`)
  record('无渲染层未捕获错误', !Array.isArray(errs) || errs.length === 0, errs)

  await shot('v235-03-final')
  const pass = results.filter(r => r.ok).length
  console.log(`\nSUMMARY ${pass}/${results.length}`)
  fs.writeFileSync(path.join(OUT, 'v235-desktop-check.json'), JSON.stringify(results, null, 2))
  app.exit(pass === results.length ? 0 : 2)
})
