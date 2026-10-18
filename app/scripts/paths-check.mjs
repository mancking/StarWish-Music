/**
 * 缓存 / 数据目录解析契约检查（离线，无框架无夹具）。
 *
 * 覆盖 2026-10 新增的「封面缓存、媒体缓存、数据目录各可独立更改」：
 *   封面与媒体目录留空时必须跟随缓存目录；设过自定义目录后必须优先自身的值。
 *   数据目录指针文件必须落在默认位置的固定路径，main.ts 启动时据此定位。
 *
 * 任一条不符即失败退出 1，因为目录解析错位会导致缓存写到意想不到的位置。
 */
import { build } from 'esbuild'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { pathToFileURL } from 'node:url'

const root = process.cwd()
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'sw-paths-'))
// esbuild 的输出文件写在工程内（系统临时目录在本机对子进程不可写）
// mkdtempSync 只建末级目录，父目录不存在会 ENOENT，必须先建
fs.mkdirSync(path.join(root, '.check-cache'), { recursive: true })
const outDir = fs.mkdtempSync(path.join(root, '.check-cache', 'paths-'))
const out = path.join(outDir, 'paths.cjs')

await build({
  entryPoints: [path.join(root, 'electron/core/paths.ts')],
  outfile: out,
  bundle: true,
  platform: 'node',
  target: 'node20',
  format: 'cjs',
  logLevel: 'warning',
})

process.env.STARWISH_USER_DATA = path.join(tmp, 'data')
const p = await import(pathToFileURL(out).href)

const checks = []
const eq = (name, got, want) =>
  checks.push({ ok: path.resolve(got) === path.resolve(want), name, detail: `got=${got} want=${want}` })

// 1) 三者默认都落在数据目录下
const data = p.userDataDir()
eq('默认缓存目录', p.cacheRootDir(), path.join(data, 'cache'))
eq('默认封面目录跟随缓存目录', p.coverCacheDir(), path.join(data, 'cache', 'covers'))
eq('默认媒体目录跟随缓存目录', p.mediaCacheDir(), path.join(data, 'cache', 'media'))

// 2) 只改缓存目录时，未被单独指定的两类仍跟随
p.setCacheRoot(path.join(tmp, 'c'))
eq('改缓存目录后封面跟随', p.coverCacheDir(), path.join(tmp, 'c', 'covers'))
eq('改缓存目录后媒体跟随', p.mediaCacheDir(), path.join(tmp, 'c', 'media'))

// 3) 单独指定后优先自身，且不受后续改缓存目录影响
p.setCoverRoot(path.join(tmp, 'cov'))
p.setMediaRoot(path.join(tmp, 'med'))
eq('封面目录优先自身', p.coverCacheDir(), path.join(tmp, 'cov'))
eq('媒体目录优先自身', p.mediaCacheDir(), path.join(tmp, 'med'))
p.setCacheRoot(path.join(tmp, 'c2'))
eq('再改缓存目录不动封面', p.coverCacheDir(), path.join(tmp, 'cov'))

// 4) 传空串 = 恢复跟随（设置页「恢复默认」走这条路径）
p.setCoverRoot('')
p.setMediaRoot('')
eq('清空封面目录后跟随', p.coverCacheDir(), path.join(tmp, 'c2', 'covers'))
eq('清空媒体目录后跟随', p.mediaCacheDir(), path.join(tmp, 'c2', 'media'))

// 5) 数据目录指针文件：必须在默认应用数据目录下的固定位置（与 STARWISH_USER_DATA 无关）
const ptr = p.dataDirPointerFile()
const ptrOk = /[\\/]StarWish[\\/]\.datadir$/.test(ptr) && !ptr.startsWith(tmp)
checks.push({ ok: ptrOk, name: '数据目录指针文件位置', detail: ptr })

// 6) ensureDir 必须真的建出目录，缓存写盘依赖它
const made = p.coverCacheDir()
checks.push({ ok: fs.existsSync(made), name: 'ensureDir 建出目录', detail: made })

fs.rmSync(tmp, { recursive: true, force: true })
fs.rmSync(outDir, { recursive: true, force: true })

for (const c of checks) console.log(`${c.ok ? 'PASS' : 'FAIL'}  ${c.name} — ${c.detail}`)
const bad = checks.filter((c) => !c.ok)
console.log(`\n${checks.length - bad.length}/${checks.length} 通过`)
process.exit(bad.length ? 1 : 0)
