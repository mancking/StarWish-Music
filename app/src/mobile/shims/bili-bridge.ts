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
import { rsaEncryptB64 } from '../../../electron/core/bili-rsa'

const KEY = 'starwish.bili-login'
const BUV_KEY = 'starwish.buvid'

interface LoginState {
  sessdata: string
  mid: string
  uname: string
  avatar: string
  at: number
  buvid: string
  buvid3: string
  buvid4: string
}

let state: LoginState = { sessdata: '', mid: '', uname: '', avatar: '', at: 0, buvid: '', buvid3: '', buvid4: '' }

function load(): void {
  let raw: any = null
  try { raw = JSON.parse(localStorage.getItem(KEY) || 'null') } catch { raw = null }
  state = {
    sessdata: String(raw?.sessdata || ''),
    mid: String(raw?.mid || ''),
    uname: String(raw?.uname || ''),
    avatar: String(raw?.avatar || ''),
    at: Number(raw?.at || 0),
    buvid: String(raw?.buvid || ''),
    buvid3: String(raw?.buvid3 || ''),
    buvid4: String(raw?.buvid4 || ''),
  }
  // 兼容旧版只存 buvid 的登录态
  if (!state.buvid3 && state.buvid) state.buvid3 = state.buvid
}

function save(): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(state))
    if (state.buvid3) localStorage.setItem(BUV_KEY, state.buvid3)
  } catch { /* 隐私模式：忽略 */ }
}

export function initBiliLogin(): void {
  load()
  if (!state.buvid3) {
    const b = new Uint8Array(8)
    crypto.getRandomValues(b)
    state.buvid3 = 'BUV3' + Array.from(b).map(x => x.toString(16).padStart(2, '0')).join('').toUpperCase()
    state.buvid = state.buvid3
    save()
  }
  void ensureBuvid()
}

/**
 * 取真实 buvid3/buvid4（finger/spi）。B 站对假 buvid 的 passport 请求有风控
 * （-352 / 二维码获取失败），generate/poll 前确保带真实 buvid。
 */
async function ensureBuvid(): Promise<void> {
  if (state.buvid3 && state.buvid4) return
  try {
    const res = await request('https://api.bilibili.com/x/frontend/finger/spi', {
      headers: { 'User-Agent': UA, Referer: 'https://www.bilibili.com/' },
      timeout: 12000,
    })
    const d = res.body?.data
    if (d?.b_3 && d?.b_4) {
      state.buvid3 = String(d.b_3)
      state.buvid4 = String(d.b_4)
      state.buvid = state.buvid3
      save()
    }
  } catch { /* 网络不佳时保留本地生成的 buvid3 */ }
}

export function biliCookie(): string {
  const parts: string[] = []
  if (state.buvid3) parts.push(`buvid3=${state.buvid3}`)
  if (state.buvid4) parts.push(`buvid4=${state.buvid4}`)
  if (state.sessdata) parts.push(`SESSDATA=${state.sessdata}`)
  return parts.join('; ') || 'buvid3=none'
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
  await ensureBuvid()
  const res = await request(
    `https://passport.bilibili.com/x/passport-login/web/qrcode/generate?${qs({ source: 'main-fe-header' })}`,
    { headers: biliHeaders(), timeout: 15000 }
  )
  const d = res.body?.data
  if (!d?.qrcode_key) {
    const msg = res.body?.message ? `二维码获取失败：${res.body.message}` : '二维码获取失败，请检查网络'
    throw new Error(msg)
  }
  return { url: d.url || '', key: d.qrcode_key }
}

export async function biliQrPoll(key: string): Promise<{ ok: boolean; status: string; message?: string }> {
  const res = await request(
    `https://passport.bilibili.com/x/passport-login/web/qrcode/poll?${qs({ qrcode_key: key, source: 'main-fe-header' })}`,
    { headers: biliHeaders(), timeout: 15000 }
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

/** 用登录态调 nav 校验并回填用户信息；返回是否有效登录 */
async function verifyAndSave(): Promise<boolean> {
  try {
    const nav = await request('https://api.bilibili.com/x/web-interface/nav', {
      headers: biliHeaders(),
      timeout: 12000,
    })
    const nd = nav.body?.data || {}
    if (nav.body?.code === -101 || !nd.isLogin) return false
    if (nd.uname) state.uname = nd.uname
    if (nd.face) state.avatar = nd.face
    if (nd.mid) state.mid = String(nd.mid)
    state.at = Date.now()
    save()
    return true
  } catch {
    return false
  }
}

/** 从粘贴内容里提取 SESSDATA（支持整串 Cookie / 裸值 / URL 编码值） */
function extractSessdata(input: string): string {
  const text = String(input || '').trim()
  if (!text) return ''
  const m = text.match(/SESSDATA=([^;\s]+)/i)
  if (m) return decodeURIComponent(m[1])
  if (/^[A-Za-z0-9%,*-]+$/.test(text)) return decodeURIComponent(text)
  return ''
}

/** Cookie 登录：粘贴浏览器复制的整串 Cookie 或仅 SESSDATA，nav 校验通过即登录 */
export async function biliCookieLogin(input: string) {
  const sessdata = extractSessdata(input)
  if (!sessdata) throw new Error('未识别到 SESSDATA，请粘贴完整 Cookie 或仅 SESSDATA 值')
  state.sessdata = sessdata
  const ok = await verifyAndSave()
  if (!ok) {
    state.sessdata = ''
    save()
    throw new Error('Cookie 无效或已过期，请重新复制')
  }
  return biliStatus()
}

/** 密码登录错误码 → 友好提示 */
function pwdErrHint(code: number, msg: string): string {
  if (code === -105) return '本次登录触发了风控验证（极验），请改用扫码登录或 Cookie 登录'
  if (code === -629) return '账号或密码错误'
  if (code === -619) return '账号不存在'
  if (code === -610) return '手机号格式不正确'
  if (code === -611 || code === -612) return '验证码错误，请重试'
  return msg || `登录失败（${code}）`
}

/** 账号密码登录：web/key 取公钥 → RSA/PKCS1 加密(hash+password) → web/login */
export async function biliPasswordLogin(username: string, password: string) {
  const user = String(username || '').trim()
  const pwd = String(password || '')
  if (!user || !pwd) throw new Error('请输入账号与密码')
  await ensureBuvid()

  const keyRes = await request('https://passport.bilibili.com/x/passport-login/web/key', {
    headers: biliHeaders(),
    timeout: 15000,
  })
  const kd = keyRes.body?.data
  if (keyRes.body?.code !== 0 || !kd?.key || !kd?.hash) {
    throw new Error(keyRes.body?.message || '获取登录公钥失败，请重试')
  }

  let encrypted: string
  try {
    encrypted = rsaEncryptB64(String(kd.key), `${kd.hash}${pwd}`)
  } catch {
    throw new Error('密码加密失败，请重试')
  }

  const res = await request('https://passport.bilibili.com/x/passport-login/web/login', {
    method: 'POST',
    headers: {
      ...biliHeaders(),
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: qs({
      username: user,
      password: encrypted,
      keep_me: 'true',
      source: 'main-fe-header',
    }),
    timeout: 15000,
  })

  const code = Number(res.body?.code)
  if (code !== 0) {
    throw new Error(pwdErrHint(code, String(res.body?.message || '')))
  }
  const raw = res.headers['set-cookie'] || ''
  const jar = Array.isArray(raw) ? raw.join(';;') : String(raw)
  const sessMatch = jar.match(/SESSDATA=([^;]+)/)
  if (!sessMatch) throw new Error('登录成功但未获取到凭证，请重试')
  state.sessdata = decodeURIComponent(sessMatch[1])
  const ok = await verifyAndSave()
  if (!ok) throw new Error('登录态校验失败，请重试')
  return biliStatus()
}

/** JSON 字幕（B 站 subtitle_url 返回 {body:[{from,to,content}]}）转标准 LRC 文本 */
function jsonToLrc(raw: string): string {
  try {
    const body: any[] = JSON.parse(raw)?.body || []
    const stamp = (s: number): string => {
      const t = Math.max(0, Number(s) || 0)
      const m = Math.floor(t / 60)
      const sec = (t % 60).toFixed(2).padStart(5, '0')
      return `[${String(m).padStart(2, '0')}:${sec}]`
    }
    return body
      .filter(x => String(x?.content || '').trim())
      .map(x => `${stamp(x.from)}${String(x.content).replace(/\r?\n/g, ' ')}`)
      .join('\n')
  } catch {
    return ''
  }
}

/**
 * B 站自带字幕（视频「听音频」后的歌词来源）。
 * 字幕需要登录态；未登录时接口不返回字幕列表，交给名字匹配兜底。
 */
export async function biliSubtitleLrc(bvid: string, cid: string): Promise<string> {
  if (!bvid || !cid) return ''
  const h = biliHeaders()
  const meta = await request(`https://api.bilibili.com/x/player/v2?${qs({ bvid, cid })}`, {
    headers: h,
    timeout: 12000,
  })
  const list: any[] = meta.body?.data?.subtitle?.subtitles || []
  if (!list.length) return ''
  const pick = list.find(s => /^zh|ai-zh/i.test(String(s.lan || ''))) || list[0]
  const url = String(pick?.subtitle_url || '')
  if (!url) return ''
  const res = await request(url.startsWith('//') ? `https:${url}` : url, {
    headers: { 'User-Agent': UA, Referer: 'https://www.bilibili.com/' },
    timeout: 15000,
  })
  return jsonToLrc(res.raw)
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
  biliQrGenerate, biliQrPoll, biliLogout,
  biliCookieLogin, biliPasswordLogin,
  importBiliSeason, biliSubtitleLrc,
}
