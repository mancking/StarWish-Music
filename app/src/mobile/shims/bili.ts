/**
 * 浏览器版 B 站 cookie 存取（替代 `core/bili.ts` 里的文件版）。
 *
 * `bili.ts` 只用到两个函数：`biliCookie()`（拼 Cookie 串）与
 * `biliHeaders()`（带 UA/Referer/Cookie 的请求头）。桌面版从
 * `<userData>/bili-login.json` 读；移动端没有 userData 目录，
 * 存 localStorage（不追求隐蔽，登录态本来就只是本机缓存）。
 */
const KEY = 'xinyuan_bili_login'
const BUV_KEY = 'xinyuan_bili_buvid'

type Login = { sessdata: string; mid?: string; uname?: string; avatar?: string; at?: number; buvid: string }

function read(): Login {
  let raw: any = null
  try { raw = JSON.parse(localStorage.getItem(KEY) || 'null') } catch { raw = null }
  let buvid = raw?.buvid
  if (!buvid) {
    buvid = localStorage.getItem(BUV_KEY) || ''
    if (!buvid) {
      const b = new Uint8Array(8)
      crypto.getRandomValues(b)
      buvid = 'BUV3' + Array.from(b).map(x => x.toString(16).padStart(2, '0')).join('')
      localStorage.setItem(BUV_KEY, buvid)
    }
  }
  return { buvid, sessdata: raw?.sessdata || '', mid: raw?.mid, uname: raw?.uname, avatar: raw?.avatar, at: raw?.at }
}

function write(state: Partial<Login>): void {
  try {
    const cur = read()
    const next = { ...cur, ...state }
    localStorage.setItem(KEY, JSON.stringify(next))
    if (next.buvid) localStorage.setItem(BUV_KEY, next.buvid)
  } catch { /* 隐私模式：忽略 */ }
}

export function biliCookie(): string {
  const s = read()
  const parts = [`buvid3=${s.buvid}`]
  if (s.sessdata) parts.push(`SESSDATA=${s.sessdata}`)
  return parts.join('; ')
}

export function biliHeaders(): Record<string, string> {
  return {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
    'Referer': 'https://www.bilibili.com/',
    'Origin': 'https://www.bilibili.com/',
    'Cookie': biliCookie(),
  }
}

export function biliStatus(): Login {
  const s = read()
  return { ...s, logged: !!s.sessdata } as any
}

/** 扫码成功回调：把 SESSDATA 落盘 */
export function biliSaveLogin(sessdata: string, extra?: { mid?: string; uname?: string; avatar?: string }): void {
  write({ sessdata, ...extra, at: Date.now() })
}

export function biliLogout(): void {
  try {
    localStorage.removeItem(KEY)
    localStorage.removeItem(BUV_KEY)
  } catch { /* ignore */ }
}

export default { biliCookie, biliHeaders, biliStatus, biliSaveLogin, biliLogout }
