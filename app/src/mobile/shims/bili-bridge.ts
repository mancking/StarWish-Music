/**
 * 移动端的 `bili.ts` 替身（桌面原实现从虚拟 fs 读 json，这里改 localStorage）。
 *
 * 与 `electron/core/bili.ts` 的导出面**逐函数一致**：initBiliLogin /
 * biliCookie / biliHeaders / biliStatus / biliQrGenerate / biliQrPoll /
 * biliLogout / importBiliSeason —— 这样 providers.ts 与 bridge 都不用改。
 *
 * 扫码轮询走的仍是共享 `../http.ts`（含 B 站 SESSDATA 的 getSetCookie 修复）。
 */
import type { Song } from '../../../shared/types'
import { request, qs, UA } from '../../../electron/core/http'

const KEY = 'starwish.bili-login'
const BUV_KEY = 'starwish.buvid'

interface LoginState {
  sessdata: string
  mid: string
  uname: string
  avatar: string
  at: number
  buvid: string
}

let state: LoginState = { sessdata: '', mid: '', uname: '', avatar: '', at: 0, buvid: '' }

function load(): void {
  let raw: any = null
  try { raw = JSON.parse(localStorage.getItem(KEY) || 'null') } catch { raw = null }
  state = {
    sessdata: String(raw?.sessdata || ''),
    mid: String(raw?.mid || ''),
    uname: String(raw?.uname || ''),
    avatar: String(raw?.avatar || ''),
    at: Number(raw?.at || 0),
    buvid: String(raw?.buvid || localStorage.getItem(BUV_KEY) || ''),
  }
}

function save(): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(state))
    if (state.buvid) localStorage.setItem(BUV_KEY, state.buvid)
  } catch { /* 隐私模式：忽略 */ }
}

export function initBiliLogin(): void {
  load()
  if (!state.buvid) {
    const b = new Uint8Array(8)
    crypto.getRandomValues(b)
    state.buvid = 'BUV3' + Array.from(b).map(x => x.toString(16).padStart(2, '0')).join('').toUpperCase()
    save()
  }
}

export function biliCookie(): string {
  const base = `buvid3=${state.buvid}`
  return state.sessdata ? `${base}; SESSDATA=${state.sessdata}` : base
}

export function biliHeaders(): Record<string, string> {
  return {
    'User-Agent': UA,
    Referer: 'https://www.bilibili.com/',
    Origin: 'https://www.bilibili.com',
    Cookie: biliCookie(),
  }
}

export function biliStatus() {
  return {
    loggedIn: !!(state.sessdata && state.mid),
    mid: state.mid,
    uname: state.uname,
    avatar: state.avatar,
    at: state.at,
  }
}

export async function biliQrGenerate(): Promise<{ url: string; key: string }> {
  const res = await request(
    `https://passport.bilibili.com/x/passport-login/web/qrcode/generate?${qs({ source: 'main-fe-header' })}`,
    { headers: { 'User-Agent': UA, Referer: 'https://www.bilibili.com/' }, timeout: 15000 }
  )
  const d = res.body?.data
  if (!d?.qrcode_key) throw new Error('二维码获取失败，请检查网络')
  return { url: d.url || '', key: d.qrcode_key }
}

export async function biliQrPoll(key: string): Promise<{ ok: boolean; status: string; message?: string }> {
  const res = await request(
    `https://passport.bilibili.com/x/passport-login/web/qrcode/poll?${qs({ qrcode_key: key, source: 'main-fe-header' })}`,
    { headers: { 'User-Agent': UA, Referer: 'https://www.bilibili.com/' }, timeout: 15000 }
  )
  const d = res.body?.data || {}
  const code = Number(d.code)
  if (code === 0) {
    // 关键：取 Set-Cookie 必须走 getSetCookie()，forEach 会丢掉 SESSDATA
    const raw = (res.headers as any)['set-cookie'] || ''
    const jar = Array.isArray(raw) ? raw.join(';;') : String(raw)
    const sessMatch = jar.match(/SESSDATA=([^;]+)/)
    const midMatch = jar.match(/DedeUserID=(\d+)/)
    if (sessMatch) state.sessdata = decodeURIComponent(sessMatch[1])
    if (midMatch) state.mid = midMatch[1]
    if (!state.sessdata) return { ok: false, status: 'error', message: '登录成功但未获取到 SESSDATA，请重试' }
    state.at = Date.now()
    try {
      const nav = await request('https://api.bilibili.com/x/web-interface/nav', { headers: biliHeaders(), timeout: 12000 })
      const nd = nav.body?.data || {}
      if (nd.uname) state.uname = nd.uname
      if (nd.face) state.avatar = nd.face
      if (nd.mid) state.mid = String(nd.mid)
    } catch { /* 用户名获取失败不影响登录态 */ }
    save()
    return { ok: true, status: 'ok', message: '登录成功' }
  }
  if (code === 86101) return { ok: false, status: 'waiting', message: '等待扫码' }
  if (code === 86090) return { ok: false, status: 'scanned', message: '已扫码，请在手机上确认' }
  if (code === 86038) return { ok: false, status: 'expired', message: '二维码已过期' }
  return { ok: false, status: 'unknown', message: d.message || `未知状态 ${code}` }
}

export function biliLogout() {
  state = { ...state, sessdata: '', mid: '', uname: '', avatar: '', at: 0 }
  save()
  return biliStatus()
}

export async function importBiliSeason(sid: string): Promise<{
  name: string; pic: string; description: string; songs: Song[]
}> {
  const h = biliHeaders()
  const first = await request(
    `https://api.bilibili.com/x/polymer/web-space/seasons_archives_list?${qs({ season_id: sid, page_num: 1, page_size: 100 })}`,
    { headers: h, timeout: 15000 }
  )
  const d0 = first.body?.data
  const mid = String(d0?.meta?.mid || d0?.page?.mid || '')
  const res = mid
    ? await request(
      `https://api.bilibili.com/x/polymer/web-space/seasons_archives_list?${qs({ season_id: sid, mid, page_num: 1, page_size: 100 })}`,
      { headers: h, timeout: 15000 }
    )
    : first
  const d = res.body?.data
  const archives: any[] = d?.archives || d?.medias || []
  if (!archives.length) throw new Error('合集为空或 ID 无效（链接需含 sid=）')

  const songs: Song[] = []
  for (const a of archives.slice(0, 50)) {
    if (!a.bvid) continue
    try {
      const pr = await request(`https://api.bilibili.com/x/player/pagelist?${qs({ bvid: a.bvid })}`, { headers: h, timeout: 12000 })
      const pages: any[] = pr.body?.data || []
      for (const pg of pages) {
        songs.push({
          id: `bili:${a.bvid}-p${pg.page}`,
          source: 'bili',
          songId: `${a.bvid}-p${pg.page}`,
          name: pg.part || a.title || '未命名分 P',
          singer: a.author || a.owner?.name || 'B 站 UP 主',
          album: a.title || '',
          duration: Number(pg.duration) || 0,
          pic: String(a.pic || '').replace(/^\/\//, 'https://'),
          qualitys: ['128k'],
          extra: { bvid: a.bvid, cid: String(pg.cid || ''), page: pg.page },
        })
      }
    } catch { /* 单个视频失败跳过 */ }
  }
  return {
    name: d?.meta?.name || `视频合集 ${sid}`,
    pic: String(archives[0]?.pic || '').replace(/^\/\//, 'https://'),
    description: d?.meta?.description || '',
    songs,
  }
}

export default {
  initBiliLogin, biliCookie, biliHeaders, biliStatus,
  biliQrGenerate, biliQrPoll, biliLogout, importBiliSeason,
}
