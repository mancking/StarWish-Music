/**
 * 歌单分页契约检查：打 providers.ts 后直调四个音源的歌单通道。
 * 跑法：node scripts/pl-source-check.mjs
 */
import { build } from 'esbuild'
import path from 'node:path'
import url from 'node:url'
import fs from 'node:fs'

const outfile = path.join(process.cwd(), '.pl-source-check.mjs')
const result = await build({
  entryPoints: [path.join(process.cwd(), 'electron/core/providers.ts')],
  outfile,
  bundle: true,
  format: 'esm',
  platform: 'node',
  target: 'node20',
  packages: 'external',
  logLevel: 'error',
})

if (result.errors.length) {
  console.error('esbuild 失败', result.errors)
  process.exit(1)
}

const mod = await import(url.pathToFileURL(outfile).href)
fs.rmSync(outfile, { force: true })

const results = []
function check(name, ok, extra) {
  results.push({ name, ok, extra })
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${extra ? ' — ' + extra : ''}`)
}

const fns = {
  qq: mod.qqPlaylists,
  kg: mod.kugouPlaylists,
  kw: mod.kuwoPlaylists,
  mg: mod.miguPlaylists,
}

for (const [src, fn] of Object.entries(fns)) {
  if (typeof fn !== 'function') {
    check(`${src} 歌单函数存在`, false, 'missing export')
    continue
  }
  try {
    const list = await fn('全部', 'hot', 1)
    const first = list[0]
    check(
      `${src} 歌单返回非空`,
      Array.isArray(list) && list.length > 0,
      `n=${list.length}`
    )
    check(
      `${src} 字段完整（id/name/pic/source）`,
      !!first && !!first.id && !!first.name && !!first.source && first.source === src,
      first ? JSON.stringify({ id: first.id, name: String(first.name).slice(0, 14), pic: (first.pic || '').slice(0, 40) }) : 'null'
    )
  } catch (e) {
    check(`${src} 歌单返回非空`, false, String(e.message).slice(0, 90))
  }
}

// QQ 标签：唯一有分类标签体系的音源
try {
  const groups = await mod.qqPlaylistTags()
  const total = groups.reduce((s, g) => s + g.tags.length, 0)
  check('QQ 歌单标签返回多组非空', groups.length >= 3 && total >= 10, `groups=${groups.length} tags=${total}`)
} catch (e) {
  check('QQ 歌单标签返回多组非空', false, String(e.message).slice(0, 90))
}

// 榜单索引：五个音源都要有分组
try {
  const tree = await mod.toplistTree(true)
  const keys = Object.keys(tree.tree || {})
  check('榜单索引覆盖五音源', keys.length >= 5, `keys=${keys.join('|')}`)
  const firstIds = {}
  for (const k of ['wy', 'qq', 'kg', 'kw', 'mg']) {
    const groups = tree.tree?.[k]?.groups || []
    const n = groups.reduce((s, g) => s + (g.items || []).length, 0)
    check(`${k} 榜单索引非空`, n > 0, `groups=${groups.length} items=${n}`)
    firstIds[k] = groups[0]?.items?.[0]?.id || ''
  }
  // 榜单歌曲：五个音源各取首个榜单，验证能拿到歌曲
  for (const k of ['wy', 'qq', 'kg', 'kw', 'mg']) {
    try {
      const r = await mod.toplistSongs(k, firstIds[k])
      const n = (r?.songs || []).length
      check(`${k} 榜单歌曲返回非空`, n > 0, `${firstIds[k]} → ${n} 首`)
    } catch (e) {
      check(`${k} 榜单歌曲返回非空`, false, String(e.message).slice(0, 90))
    }
  }
} catch (e) {
  check('榜单索引覆盖五音源', false, String(e.message).slice(0, 90))
}

// 「最新」排序在 QQ 端是本地按 created 重排，验证不会把列表打空
try {
  const list = await mod.qqPlaylists('全部', 'new', 1)
  check('QQ「最新」排序返回非空', list.length > 0, `n=${list.length}`)
} catch (e) {
  check('QQ「最新」排序返回非空', false, String(e.message).slice(0, 90))
}

const failed = results.filter(r => !r.ok)
console.log(`\n${results.length - failed.length}/${results.length} 通过`)
process.exit(failed.length ? 1 : 0)
