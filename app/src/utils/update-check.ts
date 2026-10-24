/**
 * 检查更新：查 GitHub Releases 最新版，与当前版本比对。
 * 用渲染层 fetch 而非 IPC：GitHub API 带 CORS 头，桌面/移动 WebView 均可直连
 * （移动真机 fetch 已由 CapacitorHttp 原生接管，无 CORS 限制）。
 * ponytail: 只检查提示不静默下载——用户手动下载对应平台产物；升级路径为 electron-updater 自动下载。
 */
const REPO = 'mancking/StarWish-Music'

export interface UpdateInfo {
  hasUpdate: boolean
  version: string // 最新版本号（去 v 前缀）
  current: string
  url: string // Release 页面
  notes: string
  /** 最新 Release 里的 Android APK 直链（无则为空）；移动端应用内下载安装用 */
  apkUrl: string
  /** 桌面端安装包直链（Windows 便携 exe / macOS zip）；桌面端应用内下载更新用 */
  desktopUrl: string
}

/** 语义化版本比较：a > b 返回 1，= 0，< -1（忽略 v 前缀与预发布后缀） */
function cmp(a: string, b: string): number {
  const pa = a.replace(/^v/i, '').split('-')[0].split('.').map(n => parseInt(n, 10) || 0)
  const pb = b.replace(/^v/i, '').split('-')[0].split('.').map(n => parseInt(n, 10) || 0)
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const d = (pa[i] || 0) - (pb[i] || 0)
    if (d !== 0) return d > 0 ? 1 : -1
  }
  return 0
}

export async function checkUpdate(currentVersion: string): Promise<UpdateInfo> {
  const res = await fetch(`https://api.github.com/repos/${REPO}/releases/latest`, {
    headers: { Accept: 'application/vnd.github+json' },
  })
  if (!res.ok) throw new Error(`GitHub 返回 ${res.status}，请稍后重试`)
  const data = await res.json()
  const version = String(data.tag_name || '').replace(/^v/i, '')
  if (!version) throw new Error('未找到最新版本信息')
  // Android 安装包直链：优先 debug APK 之外命名规范的 release 产物
  const assets: Array<{ name?: string; browser_download_url?: string }> = Array.isArray(data.assets) ? data.assets : []
  const apk = assets.find(a => /\.(apk)$/i.test(String(a.name || ''))) || null
  // Bug 12：按运行平台匹配产物 —— Win *.exe / macOS arm64|x64 dmg|zip / Linux AppImage|deb
  const ua = String((navigator as any)?.userAgent || '')
  const plat = String((navigator as any)?.userAgentData?.platform || (navigator as any)?.platform || ua)
  const isMac = /mac/i.test(ua) || /Mac/.test(plat)
  const isLinux = !isMac && (/linux/i.test(ua) || /Linux/.test(plat))
  const isArm = /arm|aarch64/i.test(ua) || /arm/i.test(String((navigator as any)?.platform || ''))
  let desktop: { browser_download_url?: string } | null = null
  if (isMac) {
    const dmgZip = assets.filter(a => /\.(dmg|zip)$/i.test(String(a.name || '')))
    desktop =
      dmgZip.find(a => (isArm ? /arm64/i : /x64|intel/i).test(String(a.name || ''))) ||
      dmgZip.find(a => (isArm ? /x64|intel/i : /arm64/i).test(String(a.name || ''))) ||
      dmgZip[0] ||
      null
  } else if (isLinux) {
    desktop =
      assets.find(a => /\.appimage$/i.test(String(a.name || ''))) ||
      assets.find(a => /\.deb$/i.test(String(a.name || ''))) ||
      null
  } else {
    // Windows：优先 portable，其次 NSIS 安装器
    desktop =
      assets.find(a => /portable/i.test(String(a.name || '')) && /\.exe$/i.test(String(a.name || ''))) ||
      assets.find(a => /\.exe$/i.test(String(a.name || ''))) ||
      null
  }
  return {
    hasUpdate: cmp(version, currentVersion) > 0,
    version,
    current: currentVersion,
    url: data.html_url || `https://github.com/${REPO}/releases/latest`,
    notes: String(data.body || '').slice(0, 2000),
    apkUrl: apk?.browser_download_url || '',
    desktopUrl: desktop?.browser_download_url || '',
  }
}
