/**
 * 首页 feed 真实构建检查（联网）。
 *
 * 复现用户截图「推荐歌单暂时不可用，请检查网络或稍后重试」：直接跑 buildHomeFeed，
 * 检查 playlists / moods / podcasts 三类区块是否真的有数据。
 * 只统计与断言关键数量，不打印整包 JSON，避免刷屏。
 */
import { build } from 'esbuild'
import fs from 'node:fs'
import path from 'node:path'
import { pathToFileURL } from 'node:url'

const root = process.cwd()
// mkdtempSync 只建末级目录，父目录不存在会 ENOENT，必须先建
fs.mkdirSync(path.join(root, '.check-cache'), { recursive: true })
const outDir = fs.mkdtempSync(path.join(root, '.check-cache', 'feed-'))
const out = path.join(outDir, 'feed.cjs')

await build({
  entryPoints: [path.join(root, 'electron/core/recommend.ts')],
  outfile: out,
  bundle: true,
  platform: 'node',
  target: 'node20',
  format: 'cjs',
  external: ['electron', 'sql.js', 'music-metadata'],
  logLevel: 'warning',
})

const t0 = Date.now()
const mod = await import(pathToFileURL(out).href)
const feed = await mod.buildHomeFeed(true)

const row = (name, v, ok) => console.log(`${ok ? 'PASS' : 'FAIL'}  ${name} — ${v}`)
console.log(`首页 feed 构建耗时 ${((Date.now() - t0) / 1000).toFixed(1)}s\n`)
row('推荐歌单 playlists', `${feed.playlists.length} 个${feed.playlists[0] ? '，首个=' + feed.playlists[0].name.slice(0, 20) : ''}`, feed.playlists.length > 0)
const withCover = feed.moods.filter((m) => m.cover).length
row('心情与活动 moods', `${feed.moods.length} 个，带封面 ${withCover} 个`, withCover > 0)
row('播客 podcasts', `${feed.podcasts.length} 个${feed.podcasts[0] ? '，首个=' + feed.podcasts[0].name.slice(0, 20) : ''}`, feed.podcasts.length > 0)
row('每日推荐 daily', `${feed.daily.length} 首`, feed.daily.length > 0)
row('热门榜单 toplists', `${feed.toplists.length} 个（总数 ${feed.totalToplists}）`, feed.toplists.length > 0)
row('新歌速递 newSongs', `${feed.newSongs.length} 首`, feed.newSongs.length > 0)

fs.rmSync(outDir, { recursive: true, force: true })
const bad = !feed.playlists.length || withCover === 0
process.exit(bad ? 1 : 0)
