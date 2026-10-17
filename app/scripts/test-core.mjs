/**
 * 核心契约冒烟检查（最小可运行，无框架无夹具）。
 *
 * 覆盖 2026-10 修复榜单「歌单暂时无法加载：code 200」所依赖的三个真实接口契约：
 *   1. 网易云 v1 端点把歌单放在 body.result（v6/v3 放在 body.playlist）——只认 playlist 会把成功响应误判为失败
 *   2. QQ 榜单索引新端点 fcg_myqq_toplist.fcg（旧 fcg_v8_toplist_opt.fcg 已失效）
 *   3. 酷狗榜单详情必须带 version/ranktype/area_code——缺参数时 total 由 500 退化为 2
 *
 * 离线时打印 SKIP 并以 0 退出（不把网络抖动当成回归）。
 */
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36'
const WY = { 'User-Agent': UA, Referer: 'https://music.163.com/', Cookie: 'os=pc; appver=2.9.7' }
const QQ = { 'User-Agent': UA, Referer: 'https://y.qq.com/' }
const KG = { 'User-Agent': UA, Referer: 'https://www.kugou.com/' }

const checks = []
const fail = (name, detail) => checks.push({ ok: false, name, detail })
const pass = (name, detail) => checks.push({ ok: true, name, detail })

async function json(url, headers) {
  const res = await fetch(url, { headers })
  return { status: res.status, body: await res.json() }
}

const netSkip = (e) => e instanceof TypeError || (e?.cause && /ECONN|ENOTFOUND|ETIMEDOUT|EAI_AGAIN/i.test(String(e.cause)))

async function main() {
  // 1) 网易云 v1 端点：歌单在 result 而非 playlist
  {
    const { status, body } = await json('https://music.163.com/api/playlist/detail?id=19723756', WY)
    const got = body?.playlist || body?.result
    const tracks = (got?.tracks || []).length
    if (status === 200 && got && tracks > 0) {
      pass('wy v1 playlist/result 兼容', `code=${body?.code} tracks=${tracks} name=${got.name}`)
    } else {
      fail('wy v1 playlist/result 兼容', `status=${status} code=${body?.code} playlist=${!!body?.playlist} result=${!!body?.result} tracks=${tracks}`)
    }
    // v6 仍在 playlist，用于确认两种形状都要认
    const v6 = await json('https://music.163.com/api/v6/playlist/detail?id=19723756&n=1000&s=8', WY)
    const v6tracks = (v6.body?.playlist?.tracks || []).length
    if (v6tracks > 0 || /验证|风控|-462/.test(String(v6.body?.message))) {
      pass('wy v6 端点形状', `code=${v6.body?.code} playlist.tracks=${v6tracks}${v6tracks ? '' : '（风控，可自愈）'}`)
    } else {
      fail('wy v6 端点形状', `code=${v6.body?.code} tracks=${v6tracks}`)
    }
  }

  // 2) QQ 榜单索引：新端点可用、旧端点已失效
  {
    const url = 'https://c.y.qq.com/v8/fcg-bin/fcg_myqq_toplist.fcg?g_tk=1928093487&inCharset=utf-8&outCharset=utf-8&notice=0&format=json&uin=0&needNewCode=1&platform=h5'
    const { body } = await json(url, QQ)
    const items = body?.data?.topList || body?.topList || []
    if (body?.code === 0 && items.length > 0) {
      pass('qq 索引 fcg_myqq_toplist', `topList=${items.length} 首项=${items[0]?.topTitle}(${items[0]?.id})`)
    } else {
      fail('qq 索引 fcg_myqq_toplist', `code=${body?.code} topList=${items.length}`)
    }
  }

  // 3) 酷狗榜单详情：带参数才有完整曲目
  {
    const base = 'http://mobilecdn.kugou.com/api/v3/rank/song'
    const full = await json(`${base}?format=json&rankid=8888&page=1&pagesize=100&plat=0&version=9108&ranktype=1&area_code=1`, KG)
    const total = full.body?.data?.total ?? 0
    const info = (full.body?.data?.info || []).length
    if (total >= 100 && info > 0) {
      pass('kg 详情带 version/ranktype/area_code', `total=${total} info=${info}`)
    } else {
      fail('kg 详情带 version/ranktype/area_code', `total=${total} info=${info}（缺参数时 total 会退化为 2）`)
    }
    const bare = await json(`${base}?format=json&rankid=8888&page=1&pagesize=100&plat=0`, KG)
    const bareTotal = bare.body?.data?.total ?? 0
    pass('kg 缺参数对照（仅记录，不断言）', `total=${bareTotal}`)
  }
}

try {
  await main()
} catch (e) {
  if (netSkip(e)) {
    console.log(`SKIP 网络不可用：${e.message}`)
    process.exit(0)
  }
  fail('执行异常', e?.stack || String(e))
}

for (const c of checks) console.log(`${c.ok ? 'PASS' : 'FAIL'}  ${c.name} — ${c.detail}`)
const bad = checks.filter((c) => !c.ok)
console.log(`\n${checks.length - bad.length}/${checks.length} 通过`)
process.exit(bad.length ? 1 : 0)
