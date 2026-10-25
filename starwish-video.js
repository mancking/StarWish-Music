/* ============================================================
 * 星河 B站视频源 v1.0.0（starwish-video.js）
 * 协议：规格书 0.9.8 第三方源格式兼容矩阵 · videoHost 四函数
 *   videoSearch(keyword,page) → {isEnd, videos[]}
 *   videoInfo(video)          → {video}
 *   videoParts(video)         → {parts[]}
 *   videoUrl(video, part)     → {url, headers}
 * 自研，不依赖第三方脚本。实测时间：2026-10-25
 *   - 未签名接口 + buvid Cookie 全链路 code=0（search/type · view · pagelist · playurl html5 durl）
 *   - 防盗链：宿主 swmedia 代理注入 UA/Referer（headers 字段照常返回，双保险）
 *   - 登录态：宿主沙箱对 bilibili.com 域自动附加 SESSDATA（C-29），大会员画质随登录态提升
 * ============================================================ */
const videoSource = {
  name: '星河 B站视频源',
  version: '1.0.0',
  author: 'StarWish Team',
  description: 'B站视频/MV 视频源（videoHost 四函数契约）：搜索 / 详情 / 分P / 取链',
  sources: {
    bili: {
      name: 'B站视频',
      type: 'video-source',
      actions: ['videoSearch', 'videoInfo', 'videoParts', 'videoUrl'],
      qualitys: ['360p', '480p', '720p', '1080p'],
    },
  },
}

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36'
const BASE_HEADERS = {
  'User-Agent': UA,
  Referer: 'https://www.bilibili.com/',
  Origin: 'https://www.bilibili.com',
  Cookie: 'buvid3=SWV' + Math.random().toString(36).slice(2, 10).toUpperCase(),
}

/** lx.request 回调式 → Promise（body 已由宿主解析为 JSON） */
function getJson(url) {
  return new Promise((resolve, reject) => {
    lx.request(
      url,
      { method: 'GET', headers: BASE_HEADERS, timeout: 15000 },
      (err, res, body) => {
        if (err) return reject(new Error(String(err.message || err)))
        const b = typeof body === 'string' ? safeParse(body) : body
        if (!b) return reject(new Error('响应解析失败'))
        if (b.code !== 0) return reject(new Error('B站接口 ' + b.code + (b.message ? '：' + b.message : '')))
        resolve(b.data || {})
      }
    )
  })
}
function safeParse(s) {
  try { return JSON.parse(s) } catch { return null }
}
function httpsUrl(u) {
  const s = String(u || '')
  return s.startsWith('//') ? 'https:' + s : s
}
function fmtDur(sec) {
  const t = Math.max(0, Number(sec) || 0)
  const h = Math.floor(t / 3600)
  const m = Math.floor((t % 3600) / 60)
  const s = t % 60
  return h > 0 ? h + ':' + String(m).padStart(2, '0') + ':' + String(s).padStart(2, '0') : m + ':' + String(s).padStart(2, '0')
}

/* ---------------- videoSearch：关键词 → 视频列表 ---------------- */
async function videoSearch(keyword, page) {
  const p = Math.max(1, Number(page) || 1)
  const data = await getJson(
    'https://api.bilibili.com/x/web-interface/search/type?search_type=video&keyword=' +
      encodeURIComponent(String(keyword || '')) + '&page=' + p + '&page_size=20'
  )
  const result = data.result || []
  const videos = result
    .filter(v => v.bvid)
    .map(v => ({
      id: String(v.bvid),
      title: String(v.title || '').replace(/<[^>]+>/g, ''),
      author: String(v.author || ''),
      pic: httpsUrl(v.pic),
      durationLabel: String(v.duration || ''),
      durationSec: (String(v.duration || '')).includes(':')
        ? String(v.duration).split(':').reduce((acc, x) => acc * 60 + (Number(x) || 0), 0)
        : 0,
      play: Number(v.play) || 0,
      danmaku: Number(v.video_review) || 0,
      pubdate: Number(v.pubdate) || 0,
    }))
  return { isEnd: videos.length < 20, videos }
}

/* ---------------- videoInfo：bvid → 视频详情 ---------------- */
async function videoInfo(video) {
  const bvid = String((video && (video.id || video.bvid)) || '')
  if (!bvid) throw new Error('缺少视频 id')
  const d = await getJson('https://api.bilibili.com/x/web-interface/view?bvid=' + encodeURIComponent(bvid))
  const stat = d.stat || {}
  return {
    video: {
      id: String(d.bvid || bvid),
      cid: String(d.cid || ''),
      title: String(d.title || ''),
      author: String((d.owner && d.owner.name) || ''),
      pic: httpsUrl(d.pic),
      desc: String(d.desc || ''),
      durationSec: Number(d.duration) || 0,
      durationLabel: fmtDur(d.duration),
      play: Number(stat.view) || 0,
      danmaku: Number(stat.danmaku) || 0,
      like: Number(stat.like) || 0,
      coin: Number(stat.coin) || 0,
      favorite: Number(stat.favorite) || 0,
      pubdate: Number(d.pubdate) || 0,
    },
  }
}

/* ---------------- videoParts：bvid → 分P列表 ---------------- */
async function videoParts(video) {
  const bvid = String((video && (video.id || video.bvid)) || '')
  if (!bvid) throw new Error('缺少视频 id')
  const list = (await getJson('https://api.bilibili.com/x/player/pagelist?bvid=' + encodeURIComponent(bvid))) || []
  const parts = (Array.isArray(list) ? list : []).map(p => ({
    cid: String(p.cid || ''),
    page: Number(p.page) || 1,
    title: String(p.part || 'P' + (p.page || 1)),
    durationSec: Number(p.duration) || 0,
    durationLabel: fmtDur(p.duration),
  }))
  return { parts }
}

/* ---------------- videoUrl：bvid+cid → 播放直链 ---------------- */
async function videoUrl(video, part, quality) {
  const bvid = String((video && (video.id || video.bvid)) || '')
  const cid = String((part && part.cid) || (video && video.cid) || '')
  if (!bvid || !cid) throw new Error('缺少 bvid/cid')
  const qnMap = { '360p': 16, '480p': 32, '720p': 64, '1080p': 80 }
  const qn = qnMap[String(quality || '')] || 64
  // progressive MP4（音视频合一，<video> 直接可播）；风控/降级时宿主层有兜底
  const data = await getJson(
    'https://api.bilibili.com/x/player/playurl?bvid=' + encodeURIComponent(bvid) +
      '&cid=' + encodeURIComponent(cid) +
      '&qn=' + qn + '&fnval=1&fnver=0&fourk=0&platform=html5'
  )
  const durl = data.durl && data.durl[0]
  const url = httpsUrl(durl && (durl.url || durl.base_url))
  if (!url) throw new Error('取链失败（可能需要登录或该视频受限）')
  const qualities = (data.support_formats || []).map(f => ({
    label: String(f.display_desc || f.new_description || ''),
    quality: String(f.display_desc || '').toLowerCase() || undefined,
  }))
  return {
    url,
    headers: { 'User-Agent': UA, Referer: 'https://www.bilibili.com/' },
    qualities,
  }
}

/* ---------------- lx-music 请求分发 ---------------- */
lx.on(lx.EVENT_NAMES.request, async data => {
  const action = String(data.action || '')
  const info = data.info || {}
  if (action === 'videoSearch') {
    return videoSearch(info.keyword, info.page)
  }
  if (action === 'videoInfo') {
    return videoInfo(info.video || { id: info.videoId })
  }
  if (action === 'videoParts') {
    return videoParts(info.video || { id: info.videoId })
  }
  if (action === 'videoUrl') {
    return videoUrl(info.video || { id: info.videoId }, info.part, info.quality)
  }
  return Promise.reject(new Error('不支持的请求: bili/' + action))
})

lx.send(lx.EVENT_NAMES.inited, videoSource)
