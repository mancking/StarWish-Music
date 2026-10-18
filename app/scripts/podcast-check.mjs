// 端到端验证：直接调用源码里的 podcastEpisodes，确认能解析出可播放单集
import { build } from 'esbuild'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import fs from 'node:fs'

const root = process.cwd()
const out = path.join(root, 'dist', 'electron', '_podcast-probe.cjs')

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

const mod = await import(pathToFileURL(out).href)
const { searchPodcast, podcastEpisodes } = mod

const list = await searchPodcast('音乐', 3)
console.log('播客搜索返回', list.length, '个：')
for (const p of list) console.log('  -', p.name, '| feed:', p.feed ? 'yes' : 'NO', '|', String(p.feed).slice(0, 60))

let ok = 0
for (const p of list) {
  try {
    const eps = await podcastEpisodes(p.feed, 5)
    const first = eps[0]
    console.log(`\n[${p.name}] 单集 ${eps.length} 条`)
    console.log('   id      :', first.id)
    console.log('   source  :', first.source)
    console.log('   name    :', first.name.slice(0, 50))
    console.log('   singer  :', first.singer)
    console.log('   duration:', first.duration, '秒')
    console.log('   pic     :', String(first.pic).slice(0, 70))
    console.log('   audio   :', String(first.extra.url).slice(0, 90))
    if (first.extra.url && first.source === 'podcast' && first.duration > 0) ok++
  } catch (e) {
    console.log(`\n[${p.name}] 失败：${e.message}`)
  }
}
console.log(`\n可播放播客：${ok}/${list.length}`)

// 再验一次 resolveUrl：播客单集必须走直链，不参与搜歌换源
const ms = await build({
  entryPoints: [path.join(root, 'electron/core/music-service.ts')],
  outfile: path.join(root, 'dist', 'electron', '_ms-probe.cjs'),
  bundle: true,
  platform: 'node',
  target: 'node20',
  format: 'cjs',
  external: ['electron', 'sql.js', 'music-metadata'],
  logLevel: 'warning',
})
void ms
const svc = await import(pathToFileURL(path.join(root, 'dist', 'electron', '_ms-probe.cjs')).href)
const sample = await podcastEpisodes(list[0].feed, 1)
const resolved = await svc.resolveUrl(sample[0], 'flac', true)
console.log('\nresolveUrl via:', resolved.via, '| quality:', resolved.quality, '| url:', String(resolved.url).slice(0, 80))

fs.rmSync(out, { force: true })
fs.rmSync(path.join(root, 'dist', 'electron', '_ms-probe.cjs'), { force: true })
process.exit(ok ? 0 : 1)
