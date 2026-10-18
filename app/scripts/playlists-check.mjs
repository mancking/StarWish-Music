/**
 * 歌单分类列表的并发契约检查（需要网络，离线 SKIP）。
 *
 * 回归自首页「推荐歌单暂时不可用」：buildHomeFeed 会并发打 9 次
 * playlist/list（moods 8 次 + 推荐 1 次），并发 3 就会 1/3 返回 -462 风控，
 * 表现为推荐歌单整块空白。修复是让该端点单独走并发 1 的通道。
 *
 * 断言的是「并发调用后仍拿到数据」这一可观察结果，不锁死实现细节。
 */
import { build } from 'esbuild'
import fs from 'node:fs'
import path from 'node:path'
import { pathToFileURL } from 'node:url'

const root = process.cwd()
// mkdtempSync 只建末级目录，父目录不存在会 ENOENT，必须先建
fs.mkdirSync(path.join(root, '.check-cache'), { recursive: true })
const outDir = fs.mkdtempSync(path.join(root, '.check-cache', 'playlists-'))
const out = path.join(outDir, 'providers.cjs')

await build({
  entryPoints: [path.join(root, 'electron/core/providers.ts')],
  outfile: out,
  bundle: true,
  platform: 'node',
  target: 'node20',
  format: 'cjs',
  external: ['electron', 'sql.js', 'music-metadata'],
  logLevel: 'warning',
})

const { neteasePlaylists } = await import(pathToFileURL(out).href)

const CATS = ['全部', '夜晚', '学习', '通勤', '派对', '浪漫', '减压', '怀旧', '全部'] // 与 buildHomeFeed 的请求序列一致

// 并发打 9 次：修复前这里会随机出现 0 条的分类
const lists = await Promise.all(CATS.map((c) => neteasePlaylists(c, 'hot', 1).catch(() => [])))
const got = lists.map((l) => l.length)
const okCount = got.filter((n) => n > 0).length
console.log('并发 9 次 →', CATS.map((c, i) => `${c}:${got[i]}`).join('  '))

// 分类必须有内容，且字段完整（缺 pic/name 会让列表显示成空白卡片）
const first = lists.flat()[0]
const shaped = !!first && !!first.name && !!first.pic && first.source === 'wy' && first.count > 0
console.log('首条字段：', first && JSON.stringify({ name: first.name.slice(0, 20), pic: !!first.pic, count: first.count, source: first.source }))

// 分页：page 2 必须与 page 1 不重复（offset 真的生效）
const p1 = await neteasePlaylists('流行', 'hot', 1)
const p2 = await neteasePlaylists('流行', 'hot', 2)
const dup = p1.filter((x) => p2.some((y) => y.id === x.id)).length
console.log(`分页：p1=${p1.length} p2=${p2.length} 重复=${dup}`)

fs.rmSync(outDir, { recursive: true, force: true })

const checks = [
  { ok: okCount === CATS.length, name: '并发 9 次全部拿到歌单', detail: `${okCount}/${CATS.length} 有数据` },
  { ok: shaped, name: '歌单字段完整', detail: first ? `name/pic/count/source ok` : '首条为空' },
  // hot 排序下上游会小幅漂移，翻页少量重叠属正常（前端已按 id 去重）；若整页重复则说明 offset 未生效
  { ok: p1.length > 0 && p2.length > 0 && dup < p1.length / 2, name: 'offset 分页生效', detail: `p1=${p1.length} p2=${p2.length} 重复=${dup}（上游漂移，前端去重）` },
]

for (const c of checks) console.log(`${c.ok ? 'PASS' : 'FAIL'}  ${c.name} — ${c.detail}`)
const bad = checks.filter((c) => !c.ok)
console.log(`\n${checks.length - bad.length}/${checks.length} 通过`)
process.exit(bad.length ? 1 : 0)
