// 「最新」排序通道契约检查（高优先级 neteaseNewPlaylists + hot 降级）
// 用法：node scripts/playlists-check.mjs 的一部分；此处独立跑，直接调 providers.ts
//
// 注：`order` 实参在上游已失效（wyPlaylistPage 一律降级为 'hot'），下面的
// 「order 降级」用例只断言「任何 order 都不返回空」——若上游哪天恢复 order
// 语义，这里的断言依然成立。
import { build } from 'esbuild'
import path from 'node:path'
import fs from 'node:fs'
import url from 'node:url'
import { fileURLToPath } from 'node:url'

const dir = path.dirname(fileURLToPath(import.meta.url))
const out = path.join(dir, '..', '.check-cache', 'pl-order')
fs.mkdirSync(path.dirname(out), { recursive: true })

await build({
  entryPoints: [path.join(dir, '..', 'electron', 'core', 'providers.ts')],
  bundle: true,
  platform: 'node',
  format: 'cjs',
  outfile: `${out}.cjs`,
  external: ['electron'],
  logLevel: 'silent',
})

const { neteaseNewPlaylists, neteasePlaylists } = await import(url.pathToFileURL(`${out}.cjs`).href)

let pass = 0
let fail = 0
function check(name, cond, extra = '') {
  if (cond) { pass++; console.log(`PASS  ${name}${extra ? ' — ' + extra : ''}`) }
  else { fail++; console.log(`FAIL  ${name}${extra ? ' — ' + extra : ''}`) }
}

const sleep = ms => new Promise(r => setTimeout(r, ms))

console.log('— neteaseNewPlaylists（精品歌单通道 = 「最新」）—')
for (const cat of ['全部', '摇滚', '流行']) {
  let list = []
  let tries = 0
  for (tries = 0; tries < 3; tries++) {
    list = await neteaseNewPlaylists(cat, 1)
    if (list.length) break
    await sleep(1500)
  }
  check(`${cat} 最新返回非空`, list.length > 0, `n=${list.length}（第 ${tries + 1} 次尝试）`)
  if (list.length) {
    const f = list[0]
    check(`${cat} 字段完整`, !!(f.name && f.pic && f.id && f.source === 'wy' && typeof f.created === 'number'),
      `${f.name} created=${f.created}`)
  }
  await sleep(900)
}

console.log('— order 参数降级（上游 order 已失效，任何值都必须仍能返回数据）—')
// 该端点对本机 IP 周期性返回 -462（风控），连 hot 也会中招；所以这里把
// 「返回空」当**网络/风控抖动**重试 3 次，只有连续 3 次都空才判失败。
// 这正是 wyPlaylistPage 内部的重试策略，用例必须与实现保持一致。
for (const order of ['new', 'hot', 'updateTime', 'newest', 'time']) {
  let list = []
  let tries = 0
  for (tries = 0; tries < 3; tries++) {
    list = await neteasePlaylists('摇滚', order, 1)
    if (list.length) break
    await sleep(1500)
  }
  check(`order='${order}' 仍有数据`, list.length > 0, `n=${list.length}（第 ${tries + 1} 次尝试）`)
  await sleep(900)
}

console.log(`\nsummary: ${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)
