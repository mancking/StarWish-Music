/**
 * 导入歌单链接解析检查：直接打 providers.ts，验证各平台链接 → 平台 + 歌单 ID → 能拉到歌。
 * 跑法：node scripts/pl-import-check.mjs
 */
import { build } from 'esbuild'
import path from 'node:path'
import url from 'node:url'
import fs from 'node:fs'

const outfile = path.join(process.cwd(), '.pl-import-check.mjs')
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
  results.push({ name, ok })
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${extra ? ' — ' + extra : ''}`)
}

// 1) 链接 → 平台 + ID（不联网，纯解析）
const parseCases = [
  ['wy', 'https://music.163.com/#/playlist?id=1234567890', '1234567890'],
  ['wy', 'https://music.163.com/playlist/1234567890/1234567890/', '1234567890'],
  ['wy', '1234567890', '1234567890'],
  ['qq', 'https://i.y.qq.com/n2/m/share/details/taoge.html?id=7217720898', '7217720898'],
  ['qq', 'https://y.qq.com/n/yqq/playlist/7217720898.html', '7217720898'],
  ['qq', '7217720898', '7217720898'],
  // QQ 官方分享短链：短码是服务端映射，只能跟 302 的 Location 取 id
  ['qq', 'https://c6.y.qq.com/base/fcgi-bin/u?__=hPDPc82OHph3', '9737282083'],
  ['kg', 'https://www.kugou.com/yy/special/single/1067062.html', '1067062'],
  ['kg', '1067062', '1067062'],
  ['kw', 'http://www.kuwo.cn/playlist_detail/2849349915', '2849349915'],
  ['kw', '2849349915', '2849349915'],
  ['mg', 'https://h5.nf.migu.cn/app/v4/p/share/playlist/index.html?id=161044573', '161044573'],
  ['mg', '161044573', '161044573'],
  ['bili', 'https://space.bilibili.com/123/collections/456?sid=456', '456'],
]
for (const [p, input, want] of parseCases) {
  try {
    const t = await mod.resolvePlaylistTarget(input, p)
    check(`解析 ${p} ${input.slice(0, 46)}`, t.platform === p && t.id === want, `${t.platform}:${t.id}`)
  } catch (e) {
    check(`解析 ${p} ${input.slice(0, 46)}`, false, e.message)
  }
}

// 2) 平台不匹配要给出可操作提示
try {
  await mod.resolvePlaylistTarget('https://music.163.com/playlist?id=123', 'qq')
  check('平台不匹配时报错', false, '没有抛错')
} catch (e) {
  check('平台不匹配时报错', /小芸音乐/.test(e.message), e.message)
}

// 3) QQ 官方短链：短码已过期时要给出明确提示（不是笼统报错）
try {
  await mod.resolvePlaylistTarget('https://c6.y.qq.com/base/fcgi-bin/u?__=D1tyuGhqK', 'qq')
  check('QQ 失效短码给出明确提示', false, '没有抛错')
} catch (e) {
  check('QQ 失效短码给出明确提示', /短链接|过期|失效/.test(e.message), e.message)
}

// 4) 真链接导入：每个平台拉一次歌单
const importCases = [
  ['wy', 'https://music.163.com/#/playlist?id=3778678'],
  ['qq', 'https://i.y.qq.com/n2/m/share/details/taoge.html?id=7217720898'],
  ['kg', 'https://www.kugou.com/yy/special/single/1067062.html'],
  ['kw', 'http://www.kuwo.cn/playlist_detail/2849349915'],
  ['mg', 'https://h5.nf.migu.cn/app/v4/p/share/playlist/index.html?id=161044573'],
]
for (const [p, input] of importCases) {
  try {
    const r = await mod.importPlaylistByLink(input, p)
    check(`${p} 导入歌单拿到歌曲`, r.songs.length > 0, `${r.songs.length} 首 / ${r.name}`)
  } catch (e) {
    check(`${p} 导入歌单拿到歌曲`, false, e.message)
  }
}

const failed = results.filter(r => !r.ok)
console.log(`\n${results.length - failed.length}/${results.length} 通过`)
process.exit(failed.length ? 1 : 0)
