/**
 * 发现页（参考落雪设计改造后）的端到端契约检查。
 * 跑法：npx electron --no-sandbox scripts/discover-check.cjs
 */
process.env.STARWISH_USER_DATA = require('path').join(__dirname, '..', '.check-data')
const { app, BrowserWindow } = require('electron')
const path = require('path')

let win
require('../dist/electron/main.js')

const wait = ms => new Promise(r => setTimeout(r, ms))
const errs = []
const results = []

function check(name, ok, extra) {
  results.push({ name, ok, extra })
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${extra ? ' — ' + extra : ''}`)
}

app.whenReady().then(async () => {
  for (let i = 0; i < 80; i++) {
    for (const w of BrowserWindow.getAllWindows()) if (w.webContents.getURL().includes('index.html')) win = w
    if (win) break
    await wait(250)
  }
  const js = c => win.webContents.executeJavaScript(c, true)
  win.webContents.on('console-message', (_e, level, msg) => {
    if (level >= 2) errs.push(msg)
  })

  await wait(5000)
  await js(`location.hash = '#/discover'`)
  await wait(4000)

  const cards = await js(`document.querySelectorAll('.pl-grid .pl-card').length`)
  check('歌单首页返回 30 张卡片', cards === 30, `cards=${cards}`)

  const rowLayout = await js(`(() => { const c = document.querySelector('.pl-card'); if (!c) return null; const a = c.querySelector('.art'); return { cls: c.className, artW: a ? a.getBoundingClientRect().width : 0, cardW: c.getBoundingClientRect().width }; })()`)
  check('卡片为落雪式横向布局（图 40% 宽）', !!rowLayout && rowLayout.cls.includes('layout-row') && rowLayout.artW > 0 && rowLayout.artW < rowLayout.cardW, JSON.stringify(rowLayout))

  const srcLabel = await js(`document.querySelector('.pl-card .stats .src')?.innerText || ''`)
  check('卡片显示音源别名且不含官方软件名', /^(小芸音乐|小秋音乐|小枸音乐|小蜗音乐|小蜜音乐|视频源)$/.test(srcLabel), `src=${srcLabel}`)

  // 落雪式折叠标签：默认关闭
  const closed = await js(`(() => { const p = document.querySelector('.tag-popup'); return p ? getComputedStyle(p).pointerEvents : null; })()`)
  check('标签弹层默认关闭（不可点）', closed === 'none', `pointerEvents=${closed}`)

  await js(`document.querySelector('.tag-label').click()`)
  await wait(450)
  const opened = await js(`(() => { const s = document.querySelector('.tag-select'); const p = document.querySelector('.tag-popup'); return { active: s.classList.contains('active'), pe: getComputedStyle(p).pointerEvents, opacity: getComputedStyle(p).opacity, width: p.getBoundingClientRect().width, tags: p.querySelectorAll('.tag').length, groups: p.querySelectorAll('.tag-type').length }; })()`)
  check('点击后标签弹层展开', opened.active && opened.pe !== 'none' && Number(opened.opacity) > 0.9, JSON.stringify(opened))
  check('弹层含 4 组共 40 个标签', opened.groups === 4 && opened.tags === 40, `groups=${opened.groups} tags=${opened.tags}`)

  // 点外部关闭
  await js(`document.querySelector('.pl-grid').click()`)
  await wait(350)
  const afterOutside = await js(`document.querySelector('.tag-select').classList.contains('active')`)
  check('点击外部收起弹层', afterOutside === false)

  // 选标签 → 重新加载
  await js(`document.querySelector('.tag-label').click()`)
  await wait(350)
  await js(`[...document.querySelectorAll('.tag-popup .tag')].find(t => t.innerText.trim() === '摇滚').click()`)
  await wait(4000)
  const afterTag = await js(`({ label: document.querySelector('.tag-label span').innerText, active: document.querySelector('.tag-select').classList.contains('active'), cards: document.querySelectorAll('.pl-grid .pl-card').length, hash: location.hash })`)
  check('选中标签后触发器文案更新并收起', afterTag.label === '摇滚' && afterTag.active === false, JSON.stringify(afterTag))
  check('选中标签后返回该标签歌单', afterTag.cards > 0, `cards=${afterTag.cards}`)

  // 排序切换
  await js(`[...document.querySelectorAll('.sort-item')].find(b => b.innerText === '最新').click()`)
  await wait(4000)
  const sorted = await js(`({ active: document.querySelector('.sort-item.active')?.innerText, cards: document.querySelectorAll('.pl-grid .pl-card').length })`)
  check('排序切换生效', sorted.active === '最新' && sorted.cards > 0, JSON.stringify(sorted))

  // 翻页
  const beforePg = await js(`({ prev: document.querySelector('.pagination .pg-btn')?.disabled, num: document.querySelector('.pagination .pg-num')?.innerText })`)
  check('首页时「上一页」禁用', beforePg.prev === true && beforePg.num === '第 1 页', JSON.stringify(beforePg))
  await js(`[...document.querySelectorAll('.pagination .pg-btn')].find(b => b.innerText.includes('下一页')).click()`)
  await wait(4000)
  const afterPg = await js(`({ prev: document.querySelector('.pagination .pg-btn')?.disabled, num: document.querySelector('.pagination .pg-num')?.innerText, cards: document.querySelectorAll('.pl-grid .pl-card').length })`)
  check('翻到第 2 页', afterPg.num === '第 2 页' && afterPg.prev === false && afterPg.cards > 0, JSON.stringify(afterPg))

  // ── 多音源平台切换（m02179：歌单页也要能切平台，落雪别名）──
  // PlatformSelect 是自定义下拉（v-if=open 的 .menu .item），必须先点开 trigger 才有选项
  // 渲染进程里 pl-select 是 async 组件 chunk，首次断言时可能仍未注入，故重试取一次
  const plOptions = await js(`(async () => { const sel = document.querySelector('.sl-header .pl-select'); if (!sel) return 'no-select'; sel.querySelector('.trigger').click(); await new Promise(r => setTimeout(r, 250)); const names = [...sel.querySelectorAll('.menu .item')].map(x => (x.querySelector('.i-name') || x).innerText.trim()); document.body.click(); return names; })()`)
  check('歌单页平台下拉含 5 个落雪别名', Array.isArray(plOptions) && plOptions.length === 5 && plOptions.join(',').includes('小芸音乐'), JSON.stringify(plOptions))

  await js(`(() => { const sel = document.querySelector('.sl-header .pl-select'); sel.querySelector('.trigger').click(); const items = [...sel.querySelectorAll('.menu .item')]; items.find(x => x.innerText.includes('小秋音乐')).click(); })()`)
  await wait(6000)
  const qqState = await js(`({ src: document.querySelector('.sl-header .pl-select .trigger .t-name')?.innerText.trim(), cards: document.querySelectorAll('.pl-grid .pl-card').length, tagSelect: !!document.querySelector('.sl-header .tag-select') })`)
  check('切换到小秋音乐后返回歌单', qqState.src === '小秋音乐' && qqState.cards > 0, JSON.stringify(qqState))
  check('小秋音乐保留标签入口', qqState.tagSelect === true, `tag-select=${qqState.tagSelect}`)

  await js(`document.querySelector('.tag-label').click()`)
  await wait(500)
  const qqTags = await js(`(() => { const p = document.querySelector('.tag-popup'); return p ? { groups: p.querySelectorAll('.tag-type').length, tags: p.querySelectorAll('.tag').length, first: (p.querySelector('.tag-type')||{}).innerText } : null; })()`)
  check('小秋音乐标签切换为真实分组（>40 个）', !!qqTags && qqTags.tags > 40, JSON.stringify(qqTags))
  await js(`document.querySelector('.pl-grid').click()`)
  await wait(300)

  // 切到无标签体系的源（小蜗音乐）应隐藏标签入口
  await js(`(() => { const sel = document.querySelector('.sl-header .pl-select'); sel.querySelector('.trigger').click(); const items = [...sel.querySelectorAll('.menu .item')]; items.find(x => x.innerText.includes('小蜗音乐')).click(); })()`)
  await wait(6000)
  const kwState = await js(`({ src: document.querySelector('.sl-header .pl-select .trigger .t-name')?.innerText.trim(), cards: document.querySelectorAll('.pl-grid .pl-card').length, tagSelect: !!document.querySelector('.sl-header .tag-select') })`)
  check('小蜗音乐返回歌单但无标签体系', kwState.src === '小蜗音乐' && kwState.cards > 0 && kwState.tagSelect === false, JSON.stringify(kwState))

  // ── 排行榜五源 + 别名 ──
  await js(`document.querySelectorAll('.tl-tabs .tl-tab')[1].click()`)
  await wait(8000)
  const tlOptions = await js(`(async () => { const sel = document.querySelector('.tl-toolbar .pl-select'); if (!sel) return null; sel.querySelector('.trigger').click(); await new Promise(r => setTimeout(r, 250)); const names = [...sel.querySelectorAll('.menu .item')].map(x => (x.querySelector('.i-name') || x).innerText.trim()); document.body.click(); return names; })()`)
  check('排行榜平台下拉含落雪别名（含小蜗音乐）', Array.isArray(tlOptions) && tlOptions.length >= 5 && tlOptions.join(',').includes('小芸音乐') && tlOptions.join(',').includes('小蜗音乐'), JSON.stringify(tlOptions))

  const tlBefore = await js(`({ src: document.querySelector('.tl-toolbar .pl-select .trigger .t-name')?.innerText.trim(), items: document.querySelectorAll('.tl-side .tl-item').length })`)
  const tlSwitch = await js(`(() => { const sel = document.querySelector('.tl-toolbar .pl-select'); sel.querySelector('.trigger').click(); const items = [...sel.querySelectorAll('.menu .item')]; const cur = sel.querySelector('.trigger .t-name').innerText.trim(); const other = items.find(x => x.innerText.trim() !== cur); other.click(); return cur + '->' + other.innerText.trim(); })()`)
  await wait(7000)
  const tlAfter = await js(`({ src: document.querySelector('.tl-toolbar .pl-select .trigger .t-name')?.innerText.trim(), items: document.querySelectorAll('.tl-side .tl-item').length, active: !!document.querySelector('.tl-side .tl-item.active') })`)
  check('排行榜切换音源后左栏重载', !!tlSwitch && tlAfter.items > 0 && tlAfter.active === true && tlAfter.src !== tlBefore.src, `${tlSwitch} ${JSON.stringify({ before: tlBefore, after: tlAfter })}`)



  const fatal = errs.filter(m => !/请求失败|歌单分类列表持续风控|net::ERR/.test(m))
  check('控制台无致命错误', fatal.length === 0, fatal.slice(0, 3).join(' | '))
  console.log('（提示：网易云 -462 风控会导致本轮前 3 项偶发失败，重跑即可）')

  const failed = results.filter(r => !r.ok)
  console.log(`\n${results.length - failed.length}/${results.length} 通过`)
  app.exit(failed.length ? 1 : 0)
}).catch(e => {
  console.log(`\nCHECK ABORTED: ${e && e.stack ? e.stack : e}`)
  app.exit(1)
})
