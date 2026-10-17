/**
 * 冒烟测试：启动真实 Electron 应用，逐页截图并检查渲染/报错。
 * 运行：npx electron --no-sandbox scripts/smoke.cjs
 */
process.env.STARWISH_SMOKE = '1'
process.env.STARWISH_USER_DATA = require('path').join(__dirname, '..', '.smoke-data')
process.env.STARWISH_QUIET = '0'

const { app, BrowserWindow } = require('electron')
const fs = require('fs')
const path = require('path')

const OUT = path.join(__dirname, '..', 'dist', 'smoke')
fs.mkdirSync(OUT, { recursive: true })

const logs = []
const errors = []
let mainWin = null

function wait(ms) {
  return new Promise(r => setTimeout(r, ms))
}

async function findMain() {
  for (let i = 0; i < 120; i++) {
    const wins = BrowserWindow.getAllWindows()
    for (const w of wins) {
      const url = w.webContents.getURL()
      if (url.includes('index.html') && !w.webContents.getURL().includes('lyric')) {
        mainWin = w
        return w
      }
    }
    await wait(250)
  }
  throw new Error('主窗口未出现')
}

async function shot(name) {
  try {
    const img = await mainWin.webContents.capturePage()
    fs.writeFileSync(path.join(OUT, `${name}.png`), img.toPNG())
    console.log('[smoke] 截图', name)
  } catch (e) {
    console.log('[smoke] 截图失败', name, e.message)
  }
}

async function js(code) {
  try {
    return await mainWin.webContents.executeJavaScript(code, true)
  } catch (e) {
    return { __error: String(e && e.message ? e.message : e) }
  }
}

async function go(hash, waitMs = 1600) {
  await js(`location.hash = ${JSON.stringify(hash)}`)
  await wait(waitMs)
}

async function run() {
  require('../dist/electron/main.js')
  app.on('browser-window-created', (_e, w) => {
    w.webContents.on('console-message', (_ev, level, message, line, sourceId) => {
      const item = { level, message, source: sourceId, line }
      logs.push(item)
      if (level >= 2) errors.push(item)
    })
    w.webContents.on('preload-error', (_ev, p, err) => {
      errors.push({ level: 3, message: `preload error ${p}: ${err && err.message}` })
    })
  })

  await app.whenReady()
  try {
    await findMain()
    await wait(9000)

    const info = await js(`({
      title: document.title,
      hasSw: !!window.sw,
      navItems: document.querySelectorAll('.nav-item').length,
      hero: !!document.querySelector('.hero'),
      songRows: document.querySelectorAll('.row').length,
      bodyText: (document.body.innerText || '').slice(0, 300),
      theme: document.documentElement.dataset.theme,
      accent: getComputedStyle(document.documentElement).getPropertyValue('--accent'),
      imgs: [...document.images].map(i => ({ src: i.src.slice(0, 60), w: i.naturalWidth, h: i.naturalHeight })),
      createInput: !!document.querySelector('.create-input'),
      activeEl: document.activeElement && document.activeElement.className,
      scrollH: document.querySelector('.content') && document.querySelector('.content').scrollHeight,
    })`)
    console.log('[smoke] 首页状态', JSON.stringify(info).slice(0, 1200))
    await shot('01-home')

    const apiCheck = await js(`(async () => {
      try {
        const r = await window.sw.invoke('app:info')
        return { ok: r.ok, data: r.data }
      } catch (e) { return { error: String(e) } }
    })()`)
    console.log('[smoke] app:info', JSON.stringify(apiCheck).slice(0, 600))

    const search = await js(`(async () => {
      const t0 = performance.now();
      const r = await window.sw.invoke('music:search', { keyword: '周杰伦' });
      return { ok: r.ok, error: r.error, count: r.data ? r.data.length : 0, ms: Math.round(performance.now()-t0), first: r.data && r.data[0] };
    })()`)
    console.log('[smoke] 搜索', JSON.stringify(search).slice(0, 700))

    await go('#/discover', 2600)
    await shot('02-discover')

    await go('#/search?q=' + encodeURIComponent('周杰伦'), 3200)
    await shot('03-search')

    await go('#/local', 1200)
    await shot('04-local')

    await go('#/settings', 1400)
    await shot('05-settings')

    // 播放测试：走真实 UI 路径（点击搜索结果第一行）
    await go('#/search?q=' + encodeURIComponent('晴天 周杰伦'), 3500)
    const uiPlay = await js(`(async () => {
      const rows = document.querySelectorAll('.row');
      if (!rows.length) return { error: 'no rows' };
      rows[0].click();
      await new Promise(r => setTimeout(r, 400));
      const p = window.__swStores.player;
      const favBtn = document.querySelector('.row .icon-btn.tiny');
      if (favBtn) favBtn.click();
      await new Promise(r => setTimeout(r, 600));
      return {
        song: p.song && p.song.name,
        status: p.state.status,
        lyricLoading: p.lyricLoading,
        favCount: window.__swStores.library.favorites.length,
        toast: [...document.querySelectorAll('.toast')].map(t => t.innerText),
      };
    })()`)
    console.log('[smoke] UI 点击播放', JSON.stringify(uiPlay))
    await wait(7000)
    const pstate = await js(`(async () => {
      const p = window.__swStores.player;
      return { status: p.state.status, position: p.displayPosition, duration: p.duration, error: p.state.error, song: p.song && p.song.name, lyricLines: p.lyric ? p.lyric.lines.length : 0, cover: p.coverUrl.slice(0, 30) };
    })()`)
    console.log('[smoke] 播放状态', JSON.stringify(pstate))
    await shot('06-playing')

    // 队列抽屉
    await js(`window.__swStores.player.queueOpen = true`)
    await wait(600)
    await shot('06b-queue')
    await js(`window.__swStores.player.queueOpen = false`)
    await wait(400)

    await go('#/player', 2600)
    await shot('07-player')

    const lyricInfo = await js(`({
      lines: document.querySelectorAll('.line').length,
      active: document.querySelector('.line.active') && document.querySelector('.line.active').innerText,
      stageBtns: document.querySelectorAll('.stage-btn').length,
      cover: document.querySelector('.label img') && document.querySelector('.label img').naturalWidth,
      bg: document.querySelector('.bg-img') && document.querySelector('.bg-img').naturalWidth,
    })`)
    console.log('[smoke] 歌词', JSON.stringify(lyricInfo))
    await shot('08-player-lyrics')

    // 粒子舞台
    await js(`window.__swStores.player.setStage('particle')`)
    await wait(1400)
    await shot('08b-particle')
    await js(`window.__swStores.player.setStage('lyrics')`)

    await go('#/discover?tab=toplists', 2600)
    await shot('09-toplists')

    await go('#/mv', 3200)
    await shot('10-mv')

    const summary = {
      errors: errors.slice(0, 40),
      errorCount: errors.length,
      warnCount: logs.filter(l => l.level === 1).length,
    }
    fs.writeFileSync(path.join(OUT, 'result.json'), JSON.stringify({ info, search, uiPlay, pstate, lyricInfo, summary }, null, 2))
    console.log('[smoke] 错误数', errors.length)
    for (const e of errors.slice(0, 20)) console.log('  ERR:', e.message, e.source || '')
  } catch (e) {
    console.error('[smoke] 测试异常', e)
    try {
      await shot('99-error')
    } catch {}
  } finally {
    await wait(500)
    app.exit(0)
  }
}

run()
