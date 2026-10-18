import type { MvItem, PlaylistMeta, Song, ToplistItem, ToplistTree } from '../../shared/types'
import { getJson, hostOf, limited, qs, request, sleep, stripHtml, UA } from './http'
import { createLogger } from './log'
import { biliCookie, biliHeaders, biliStatus } from './bili'
import * as nodeCrypto from 'node:crypto'
const crypto = {
  createCipheriv: nodeCrypto.createCipheriv,
  createDecipheriv: nodeCrypto.createDecipheriv,
  createHash: nodeCrypto.createHash,
}

const logger = createLogger('providers')

const WY_HEADERS = {
  'User-Agent': UA,
  Referer: 'https://music.163.com/',
  Cookie: 'os=pc; appver=2.9.7',
}

const QQ_HEADERS = {
  'User-Agent': UA,
  Referer: 'https://y.qq.com/',
}

const KG_HEADERS = { 'User-Agent': UA, Referer: 'http://www.kugou.com/' }
const KW_HEADERS = { 'User-Agent': UA, Referer: 'http://www.kuwo.cn/' }

function https(u: string): string {
  return String(u || '').replace(/^http:\/\//i, 'https://').replace(/^\/\//, 'https://')
}

function num(v: any): number {
  const n = Number(v)
  return Number.isFinite(n) ? n : 0
}

/** 「1714.8万」→ 17148000；纯数字串则原样返回 */
function parseCount(v: any): number {
  const s = String(v ?? '').trim()
  if (!s) return 0
  const m = s.match(/^([\d.]+)\s*([万亿])?/)
  if (!m) return 0
  const n = num(m[1])
  if (m[2] === '万') return Math.round(n * 10000)
  if (m[2] === '亿') return Math.round(n * 100000000)
  return Math.round(n)
}

/** 酷狗的 publish_time 是「2020-12-07」字符串，转 ms 时间戳；不认识的格式返回 0 */
function parseDate(v: any): number {
  const s = String(v ?? '').trim()
  if (!/^\d{4}-\d{2}-\d{2}/.test(s)) return 0
  const t = Date.parse(s.length === 10 ? `${s}T00:00:00Z` : s)
  return Number.isFinite(t) ? t : 0
}

/* ============================ 网易云 ============================ */

export async function searchNetease(keyword: string, page = 1, limit = 30): Promise<Song[]> {
  const offset = (Math.max(1, page) - 1) * limit
  const endpoints = [
    `https://music.163.com/api/search/get/web?${qs({ s: keyword, type: 1, offset, limit, total: 'true' })}`,
    `https://music.163.com/api/search/get?${qs({ s: keyword, type: 1, offset, limit })}`,
    `https://music.163.com/api/cloudsearch/pc?${qs({ s: keyword, type: 1, offset, limit })}`,
  ]
  for (const url of endpoints) {
    try {
      const body = await wyLimited('music.163.com', 3, () => getJson<any>(url, WY_HEADERS, 6000))
      const songs = body?.result?.songs || []
      if (!songs.length) continue
      return songs.map((s: any) => {
        const artists = (s.artists || s.ar || []).map((a: any) => a.name).filter(Boolean).join('/')
        const album = s.album || s.al || {}
        return {
          id: `wy:${s.id}`,
          source: 'wy',
          songId: String(s.id),
          name: String(s.name || ''),
          singer: artists || '未知歌手',
          album: album.name || '',
          duration: Math.round(num(s.duration || s.dt) / 1000),
          pic: https(album.picUrl || album.picUrl_str || ''),
          qualitys: ['128k', '320k'],
          extra: { albumId: album.id },
        } as Song
      })
    } catch (e: any) {
      logger.warn('网易云搜索接口失败', url.slice(0, 60), e?.message)
    }
  }
  return []
}

/**
 * 网易云请求闸门：串行 + 最小间隔，**覆盖全部 music.163.com 请求**。
 *
 * `limited(key, 1)` 只限并发数，队列排空后仍会 0 间隔连发；而首页一次要并发打歌单列表、
 * 新歌速递、榜单树三条不同 key 的请求，心情区再补 8 次——这一片突发就是 -462 的触发器。
 * 故闸门按 host 统一，不按 key 分池。
 */
const WY_MIN_GAP = 400
let wyLastAt = 0
let wyChain: Promise<void> = Promise.resolve()

function wyThrottle(): Promise<void> {
  wyChain = wyChain.then(async () => {
    const wait = WY_MIN_GAP - (Date.now() - wyLastAt)
    if (wait > 0) await sleep(wait)
    wyLastAt = Date.now()
  })
  return wyChain
}

/** 所有 music.163.com 请求都必须经此发出，避免突发连发触发 -462 */
async function wyLimited<T>(key: string, limit: number, fn: () => Promise<T>): Promise<T> {
  await wyThrottle()
  return limited(key, limit, fn)
}

/**
 * 带 -462 退避的网易云串行 GET。
 *
 * -462 是**突发请求触发的分钟级冷静期**，不是 IP 封禁：实测一次性并发 8 个请求有 5 个
 * -462，而同一时刻换 UA / Cookie / host 全部返回 200；闸门串行 + 退避则 8/8 成功。
 * 所以重试间隔必须拉到秒级——原先的 3×400ms（共 1.2s）熬不过冷静期，一次触发就整批失败，
 * 这正是首页「推荐歌单暂时不可用」和发现页歌单为空的根因。
 */
async function wyGetJson(url: string, key: string): Promise<any> {
  for (let attempt = 1; attempt <= 3; attempt++) {
    const body = await wyLimited(key, 1, () => getJson<any>(url, WY_HEADERS, 12000))
    if (num(body?.code) !== -462) return body
    if (attempt < 3) await sleep(600 * attempt * attempt)
  }
  return null
}

/**
 * 网易云歌单分类列表（主通道）。
 *
 * 走并发 1 的独立通道，不与其他 music.163.com 请求共享池子。被风控时**降级到精品歌单
 * 通道**而不是空手而归：highquality/list 几乎不受限流影响，是唯一能立刻救场的通道。
 */
async function wyPlaylistPage(cat: string, order: string, offset: number): Promise<any> {
  // `order=new` 上游是无效枚举：任何分类都返回 code 200 但 playlists 空、total 0。
  // 实测 hot/updateTime/newest/time/latest/recommend/top 与非空 order 返回完全相同
  // （连 createTime 都一致）→ 该端点已忽略 order，只按热度排。故这里统一降级为 hot，
  // 「最新」改由 neteaseNewPlaylists() 用 highquality/list 单独通道实现。
  const url = `https://music.163.com/api/playlist/list?${qs({ cat, order: 'hot', offset, limit: 30 })}`
  const body = await wyGetJson(url, 'music.163.com/playlist-list')
  if (body) return body
  if (offset > 0) return null // 兜底通道只有 lasttime 游标，没有 offset，翻页时只能放弃
  logger.warn('歌单分类列表被风控，改走精品歌单通道', cat)
  return wyHighQualityPage(cat, 0)
}

/**
 * 网易云「精品歌单」通道。
 *
 * `api/playlist/list` 上游已忽略 order（见 wyPlaylistPage 注释），拿不到按时间排的列表；
 * `api/playlist/highquality/list` 是唯一按更新时间筛选的公开端点，同时兼任主通道的风控兜底。
 * 该端点无 offset 概念，翻页键是 `lasttime`、游标取上一页末条的 **updateTime**（实测用
 * `before` 或 createTime 都恒返回第一页——这曾让「最新」翻页与兜底双双失效）；limit 上限 100。
 * 冷门标签只有个位数结果，`total` 可直接当总数用。
 */
async function wyHighQualityPage(cat: string, lasttime: number): Promise<any> {
  const url = `https://music.163.com/api/playlist/highquality/list?${qs({ cat, limit: 30, lasttime })}`
  const body = await wyGetJson(url, 'music.163.com/playlist-hq')
  if (!body) logger.warn('精品歌单列表持续风控', cat)
  return body
}

/**
 * 「最新」排序：取精品歌单（上游按更新时间倒序，这是该端点唯一能提供的排序）。
 * lasttime=0 拿首页；翻页用上一页最后一条的 updateTime 做游标。
 * 不足 30 条即视为到底，返回空数组让 UI 显示空态。
 */
export async function neteaseNewPlaylists(cat = '全部', page = 1): Promise<PlaylistMeta[]> {
  const want = Math.max(1, page)
  let lasttime = 0
  let list: any[] = []
  for (let p = 1; p <= want; p++) {
    const body = await wyHighQualityPage(cat, lasttime)
    list = body?.playlists || []
    if (!list.length) return []
    if (p === want) break
    lasttime = num(list[list.length - 1]?.updateTime)
    if (!lasttime) return []
    await sleep(300)
  }
  return list.map(
    (p2: any): PlaylistMeta => ({
      id: String(p2.id),
      name: p2.name || '',
      pic: https(p2.coverImgUrl || ''),
      author: p2.creator?.nickname || '',
      count: num(p2.trackCount),
      played: num(p2.playCount),
      description: p2.description || '',
      tags: p2.tags || [],
      created: num(p2.createTime),
      source: 'wy',
      kind: 'remote',
    })
  )
}

export async function neteasePlaylists(cat = '全部', order = 'hot', page = 1): Promise<PlaylistMeta[]> {
  const offset = (Math.max(1, page) - 1) * 30
  const body = await wyPlaylistPage(cat, order, offset)
  const list = body?.playlists || []
  return list.map(
    (p: any): PlaylistMeta => ({
      id: String(p.id),
      name: p.name || '',
      pic: https(p.coverImgUrl || ''),
      author: p.creator?.nickname || '',
      count: num(p.trackCount),
      played: num(p.playCount),
      description: p.description || '',
      tags: p.tags || [],
      created: num(p.createTime),
      source: 'wy',
      kind: 'remote',
    })
  )
}

export async function neteasePlaylistDetail(id: string): Promise<{ name: string; pic: string; description: string; songs: Song[] }> {
  const endpoints = [
    `https://music.163.com/api/v6/playlist/detail?id=${encodeURIComponent(id)}&n=1000&s=8`,
    `https://music.163.com/api/v3/playlist/detail?id=${encodeURIComponent(id)}&n=1000`,
    `https://music.163.com/api/playlist/detail?id=${encodeURIComponent(id)}`,
  ]
  let pl: any = null
  let lastErr = ''
  for (const url of endpoints) {
    try {
      const body = await wyLimited(hostOf(url), 3, () => getJson<any>(url, WY_HEADERS, 12000))
      // /api/v6|v3 把歌单放在 playlist，/api/playlist/detail 放在 result，两者字段结构一致。
      // 只认 playlist 会把 v1 的成功响应判为失败，抛出误导性的「code 200」。
      const got = body?.playlist || body?.result
      if (got) {
        pl = got
        if ((pl.tracks || []).length) break
      } else {
        lastErr = body?.message || body?.msg || (body?.code != null ? `code ${body.code}` : '响应格式异常')
      }
    } catch (e: any) {
      lastErr = e?.message || String(e)
    }
  }
  if (!pl) throw new Error(`歌单暂时无法加载${lastErr ? '：' + lastErr : '（可能已下架或触发风控，请稍后重试）'}`)
  const tracks = pl.tracks || []
  return {
    name: pl.name || '',
    pic: https(pl.coverImgUrl || ''),
    description: pl.description || '',
    songs: tracks.map(neteaseTrack),
  }
}

function neteaseTrack(s: any): Song {
  const ar = (s.ar || s.artists || []).map((a: any) => a.name).filter(Boolean).join('/')
  const al = s.al || s.album || {}
  return {
    id: `wy:${s.id}`,
    source: 'wy',
    songId: String(s.id),
    name: s.name || '',
    singer: ar || '未知歌手',
    album: al.name || '',
    duration: Math.round(num(s.dt || s.duration) / 1000),
    pic: https(al.picUrl || ''),
    qualitys: ['128k', '320k'],
  }
}

export async function neteaseNewSongs(limit = 12): Promise<Song[]> {
  const body = await wyLimited('music.163.com', 3, () =>
    getJson<any>(`https://music.163.com/api/personalized/newsong?limit=${limit}`, WY_HEADERS, 12000)
  )
  const arr = body?.result || []
  return arr
    .map((x: any) => x.song || x)
    .filter((s: any) => s && s.id)
    .map(neteaseTrack)
}

/* ============================ QQ 音乐 ============================ */

export async function searchQQ(keyword: string, page = 1, limit = 30): Promise<Song[]> {
  // smartbox：速度快、稳定，适合作为 QQ 音乐的主搜索通道
  try {
    const url = `https://c.y.qq.com/splcloud/fcgi-bin/smartbox_new.fcg?${qs({ key: keyword, format: 'json' })}`
    const body = await getJson<any>(url, QQ_HEADERS, 5000)
    const items: any[] = body?.data?.song?.itemlist || []
    const songs = items.map((s: any): Song => ({
      id: `qq:${s.mid}`,
      source: 'qq',
      songId: String(s.mid || ''),
      name: s.name || '',
      singer: s.singer || '未知歌手',
      album: '',
      duration: 0,
      pic: '',
      qualitys: ['128k', '320k'],
      extra: { songmid: String(s.mid || '') },
    }))
    if (songs.length) return songs.slice(0, limit)
  } catch (e: any) {
    logger.warn('QQ smartbox 搜索失败', e?.message)
  }
  return []
}

export async function qqPlaylistDetail(disstid: string): Promise<{ name: string; pic: string; description: string; songs: Song[] }> {
  const url = `https://c.y.qq.com/qzone/fcg-bin/fcg_ucc_getcdinfo_byids_cp.fcg?${qs({
    type: 1,
    json: 1,
    utf8: 1,
    onlysong: 0,
    disstid,
    format: 'json',
  })}`
  const body = await getJson<any>(url, QQ_HEADERS, 15000)
  const cd = body?.cdlist?.[0]
  if (!cd) throw new Error('歌单解析失败（可能已删除或需要登录）')
  const songs = (cd.songlist || []).map((s: any): Song => {
    const mid = s.songmid || ''
    return {
      id: `qq:${mid}`,
      source: 'qq',
      songId: mid,
      name: s.songname || '',
      singer: (s.singer || []).map((x: any) => x.name).join('/') || '未知歌手',
      album: s.albumname || '',
      duration: num(s.interval),
      pic: s.albummid ? `https://y.gtimg.cn/music/photo_new/T002R300x300M000${s.albummid}.jpg` : '',
      qualitys: ['128k', '320k'],
      extra: { songmid: mid, albummid: s.albummid || '' },
    }
  })
  return { name: cd.dissname || 'QQ 歌单', pic: https(cd.logo || ''), description: cd.desc || '', songs }
}

/* ============================ 酷狗 ============================ */

export async function searchKugou(keyword: string, page = 1, limit = 30): Promise<Song[]> {
  const url = `http://mobilecdn.kugou.com/api/v3/search/song?${qs({
    format: 'json',
    keyword,
    page,
    pagesize: limit,
    showtype: 1,
  })}`
  const body = await getJson<any>(url, KG_HEADERS, 15000)
  const list = body?.data?.info || []
  return list
    .map((s: any): Song => {
      const parts = String(s.filename || '').split(' - ')
      return {
        id: `kg:${s.hash}`,
        source: 'kg',
        songId: String(s.hash || ''),
        name: parts.length > 1 ? parts.slice(1).join(' - ') : s.songname || s.filename || '',
        singer: s.singername || (parts.length > 1 ? parts[0] : '未知歌手'),
        album: s.album_name || '',
        duration: num(s.duration),
        pic: '',
        qualitys: ['128k', '320k'],
        extra: { hash: s.hash || '', album_id: s.album_id || '' },
      }
    })
    .filter(s => s.songId && s.name)
}

export async function kugouPlaylistDetail(specialid: string): Promise<{ name: string; pic: string; description: string; songs: Song[] }> {
  const url = `http://mobilecdn.kugou.com/api/v3/special/song?${qs({
    format: 'json',
    specialid,
    page: 1,
    pagesize: 200,
    plat: 0,
  })}`
  const body = await getJson<any>(url, KG_HEADERS, 15000)
  const info = body?.data?.info || []
  if (!info.length) throw new Error('歌单为空或链接无效')
  const songs = info.map((s: any): Song => {
    const parts = String(s.filename || '').split(' - ')
    return {
      id: `kg:${s.hash}`,
      source: 'kg',
      songId: String(s.hash || ''),
      name: (parts.length > 1 ? parts.slice(1).join(' - ') : s.filename) || s.songname || '未知',
      singer: s.singername || (parts.length > 1 ? parts[0] : '未知歌手'),
      album: s.album_name || '',
      duration: num(s.duration),
      pic: '',
      qualitys: ['128k', '320k'],
      extra: { hash: s.hash || '' },
    }
  })
  return { name: `酷狗歌单 ${specialid}`, pic: '', description: '', songs }
}

const KK_HEADERS = { 'User-Agent': UA, Referer: 'http://www.kuwo.cn/' }

/* ============================ 酷我 / 咪咕 ============================ */

const MG_HEADERS = {
  'User-Agent':
    'Mozilla/5.0 (iPhone; CPU iPhone OS 16_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/16.6 Mobile/15E148 Safari/604.1',
  Referer: 'https://m.music.migu.cn/',
}

// 酷我 wbd 加密榜单通道参数（照搬落雪 kw/util.js 的 wbdCrypto）：
// tree 接口给的是索引节点 id，取歌必须走 bang_info + AES-128-ECB + md5 sign。
// ponytail: 惰性取 key——mobile 桥静态 import 本模块时 registerBufferGlobal() 还没跑，
// 模块顶层碰 Buffer 会 ReferenceError 白屏（mobile:smoke 1/9 根因）。
const kwKey = () => Buffer.from([112, 87, 39, 61, 199, 250, 41, 191, 57, 68, 45, 114, 221, 94, 140, 228])
const KW_APP_ID = 'y67sprxhhpws'
const KW_HEADERS_WBD = { 'User-Agent': UA, Referer: 'http://www.kuwo.cn/' }
// 榜单名 → bangid 映射，取自落雪 musicSdk/kw/leaderboard.js 的 boardList，并已逐个联网核验可取歌
const KW_BANGID: Record<string, string> = {
  '青少年专属飙升榜': '93', '酷我飙升榜': '93', '酷我新歌榜': '17', '酷我热歌榜': '16',
  '抖音热歌榜': '158', '会员畅听榜': '145', 'DJ嗨歌榜': '176', 'ACG新歌榜': '290',
  '华语榜': '104', '欧美榜': '22', '粤语榜': '182', '日语榜': '183', '韩语榜': '184',
  '流行趋势榜': '187', '经典怀旧榜': '26', '影视金曲榜': '64', '网红新歌榜': '153',
  'Billboard榜': '12', 'iTunes音乐榜': '49', 'beatport电音榜': '180', '英国UK榜': '13',
  '百大DJ榜': '164', 'YouTube音乐排行榜': '246', '韩国Genie榜': '265', '韩国M-net榜': '14',
  '香港电台榜': '8', '日本公信榜': '15', '腾讯音乐人原创榜': '151', '铃声榜': '292',
  '热评榜': '284', '台湾KKBOX榜': '286', '冬日暖心榜': '279', '巴士随身听榜': '281',
  'KTV点唱榜': '255', '家务进行曲榜': '280', '熬夜修仙榜': '282', '枕边轻音乐榜': '283',
  '古风音乐榜': '278', 'Vlog音乐榜': '264', '电音榜': '242', '现场音乐榜': '204',
  'ACG神曲榜': '186', '最强翻唱榜': '185', '真声音': '106',
}

export async function kuwoPlaylistDetail(pid: string): Promise<{ name: string; pic: string; description: string; songs: Song[] }> {
  const url = `http://nplserver.kuwo.cn/pl.svc?${qs({
    op: 'getlistinfo',
    pid,
    pn: 0,
    rn: 200,
    encode: 'utf8',
    keyset: 'pl2012',
    identity: 'kuwo',
    pcmp4: 1,
    vipver: 'MUSIC_9.0.5',
  })}`
  const body = await getJson<any>(url, { 'User-Agent': UA, Referer: 'http://www.kuwo.cn/' }, 15000)
  const list = body?.musiclist
  if (!Array.isArray(list)) throw new Error('歌单解析失败（可能不存在或已设为私密）')
  const songs = list
    .map(
      (s: any): Song => ({
        id: `kw:${s.id || s.rid}`,
        source: 'kw',
        songId: String(s.id || s.rid || ''),
        name: s.name || '',
        singer: s.artist || '未知歌手',
        album: s.album || '',
        duration: num(s.duration),
        pic: https(s.albumpic || ''),
        qualitys: ['128k', '320k'],
      })
    )
    .filter(s => s.songId && s.name)
  return { name: body.title || '酷我歌单', pic: '', description: '', songs }
}

export async function miguPlaylistDetail(id: string): Promise<{ name: string; pic: string; description: string; songs: Song[] }> {
  const url = `https://music.migu.cn/v3/api/playlist/song?playlistId=${encodeURIComponent(id)}&pageNo=1&pageSize=200`
  const res = await request(url, {
    headers: { 'User-Agent': UA, Referer: 'https://music.migu.cn/', Accept: 'application/json' },
    timeout: 15000,
  })
  if (typeof res.body === 'string' || !res.body) {
    throw new Error('该音源的歌单接口暂不可用，请改用其他音源的分享链接')
  }
  const list = res.body?.data?.content || res.body?.data?.list || []
  const songs = list
    .map(
      (s: any): Song => ({
        id: `mg:${s.songId || s.contentId}`,
        source: 'mg',
        songId: String(s.songId || s.contentId || ''),
        name: s.songName || s.name || '',
        singer: s.singerName || s.singer || '未知歌手',
        album: s.albumName || s.album || '',
        duration: num(s.duration),
        pic: https(s.albumPic || s.pic || ''),
        qualitys: ['128k'],
      })
    )
    .filter(s => s.name)
  return { name: `咪咕歌单 ${id}`, pic: '', description: '', songs }
}

/**
 * QQ 音乐歌单分类标签。
 * 模块名大小写必须与落雪一致：playlist.PlaylistAllCategoriesServer
 * （写成 PlayList… 会返回 subcode 860100005）。
 */
export async function qqPlaylistTags(): Promise<{ name: string; tags: { n: string; id: string }[] }[]> {
  const data = {
    tags: { method: 'get_all_categories', param: { qq: '' }, module: 'playlist.PlaylistAllCategoriesServer' },
  }
  const url = `https://u.y.qq.com/cgi-bin/musicu.fcg?loginUin=0&hostUin=0&format=json&inCharset=utf-8&outCharset=utf-8&notice=0&platform=wk_v15.json&needNewCode=0&data=${encodeURIComponent(JSON.stringify(data))}`
  const body: any = await limited('u.y.qq.com', 2, () => getJson<any>(url, QQ_HEADERS, 10000))
  const groups: any[] = body?.tags?.data?.v_group || []
  return groups
    .map(g => ({
      name: String(g.group_name || ''),
      tags: (g.v_item || [])
        .map((it: any) => ({ n: String(it.name || ''), id: String(it.id || '') }))
        .filter((t: any) => t.n && t.id),
    }))
    .filter(g => g.tags.length)
}

/* ==================== 多音源歌单列表（落雪接口） ==================== */

/**
 * QQ 音乐歌单列表。
 * 端点与落雪 tx/songList.js 的 get_category_content 一致；dom 端必须带完整
 * loginUin/hostUin/platform=wk_v15.json 参数串，否则 total_cnt 为 0。
 * 该接口不接受排序参数（实测传 sortId 无效，hot/new 返回相同列表），
 * 「最新」改为对当页结果按 create_time 降序重排。
 */
export async function qqPlaylists(cat: string, order: string, page = 1): Promise<PlaylistMeta[]> {
  const titleid = cat === '全部' ? 3317 : cat
  const param = {
    comm: { cv: 1602, ct: 20 },
    playlist: {
      method: 'get_category_content',
      param: { titleid, caller: '0', category_id: titleid, size: 30, page: Math.max(0, page - 1), use_page: 1 },
      module: 'playlist.PlayListCategoryServer',
    },
  }
  const url = `https://u.y.qq.com/cgi-bin/musicu.fcg?loginUin=0&hostUin=0&format=json&inCharset=utf-8&outCharset=utf-8&notice=0&platform=wk_v15.json&needNewCode=0&data=${encodeURIComponent(JSON.stringify(param))}`
  const body: any = await limited('u.y.qq.com', 2, () => getJson<any>(url, QQ_HEADERS, 12000))
  const items: any[] = body?.playlist?.data?.content?.v_item || []
  const list = items
    .map((it): PlaylistMeta => {
      const b = it?.basic || {}
      return {
        id: String(b.tid || ''),
        name: String(b.title || ''),
        pic: https(b.cover?.medium_url || b.cover?.big_url || b.cover?.default_url || ''),
        author: b.creator?.nick || '',
        count: num(b.song_cnt),
        played: num(b.play_cnt),
        description: b.desc || '',
        tags: (b.v_tag || []).map((t: any) => t?.name).filter(Boolean),
        created: num(b.create_time) * 1000,
        source: 'qq',
        kind: 'remote',
      }
    })
    .filter(p => p.id && p.name)
  if (order === 'new') list.sort((a, b) => (b.created || 0) - (a.created || 0))
  return list
}

/**
 * 酷狗歌单列表（落雪 yueku/v9/special/getSpecial）。
 * 必须用 http：该域名的 https 证书与本主机名不匹配（网宿 CDN 默认证书），
 * 会报 ERR_TLS_CERT_ALTNAME_INVALID。order 上游只有热度通道，故忽略。
 */
export async function kugouPlaylists(cat: string, _order: string, page = 1): Promise<PlaylistMeta[]> {
  const url = `http://www2.kugou.kugou.com/yueku/v9/special/getSpecial?${qs({
    is_ajax: 1,
    cdn: 'cdn',
    t: 5,
    c: cat === '全部' ? 0 : cat,
    p: page,
  })}`
  // 首次请求偶发 fetch failed，重试一次即可恢复（实测）
  let body: any = null
  for (let i = 0; i < 3; i++) {
    try {
      body = await getJson<any>(url, KG_HEADERS, 12000)
      if (num(body?.status) === 1) break
    } catch (e: any) {
      if (i === 2) logger.warn('酷狗歌单列表失败', e?.message)
      await sleep(400)
    }
  }
  const list: any[] = body?.special_db || []
  return list
    .map(
      (s: any): PlaylistMeta => ({
        id: String(s.specialid || ''),
        name: String(s.specialname || ''),
        pic: https(s.img || '').replace('{size}', '480'),
        author: s.nickname || s.suid || '',
        // 上游 play_count 恒为 0、真实播放量在 total_play_count（如「1714.8万」）
        played: parseCount(s.total_play_count ?? s.play_count),
        count: num(s.song_count),
        description: s.intro || '',
        created: parseDate(s.publish_time),
        source: 'kg',
        kind: 'remote',
      })
    )
    .filter(p => p.id && p.name)
}

/** 酷我歌单列表（落雪 wapi getRcmPlayList，无标签概念，cat 忽略） */
export async function kuwoPlaylists(cat: string, order: string, page = 1): Promise<PlaylistMeta[]> {
  const url = `http://wapi.kuwo.cn/api/pc/classify/playlist/getRcmPlayList?${qs({
    loginUid: 0,
    loginSid: 0,
    appUid: 76039576,
    pn: Math.max(1, page),
    rn: 30,
    order: order === 'new' ? 'new' : 'hot',
  })}`
  const body: any = await getJson<any>(url, { 'User-Agent': UA, Referer: 'http://www.kuwo.cn/' }, 12000)
  const list: any[] = body?.data?.data || []
  return list
    .map(
      (s: any): PlaylistMeta => ({
        id: String(s.id || ''),
        name: String(s.name || ''),
        pic: https(s.img || ''),
        author: s.uname || '',
        count: num(s.total),
        played: num(s.listencnt),
        description: s.digest || '',
        source: 'kw',
        kind: 'remote',
      })
    )
    .filter(p => p.id && p.name)
}

/**
 * 咪咕歌单列表（落雪 app.c.nf.migu.cn page-data，需 mobile UA + Referer）。
 * 该端点返回的是模板化楼层，真正歌单项在 view=ZJ-SongList-Scroll 的
 * contents[] 里：id 取 logEvent.contentId / resId，文案取 txt。
 */
export async function miguPlaylists(cat: string, _order: string, page = 1): Promise<PlaylistMeta[]> {
  const url = `https://app.c.nf.migu.cn/pc/bmw/page-data/playlist-square-recommend/v1.0?${qs({
    templateVersion: 2,
    pageNo: page,
  })}`
  const body: any = await getJson<any>(url, MG_HEADERS, 15000)
  const cols: any[] = body?.data?.contents || []
  const out: PlaylistMeta[] = []
  const seen = new Set<string>()
  for (const col of cols) {
    const items: any[] = col?.contents || []
    for (const it of items) {
      const id = String(it?.logEvent?.contentId || it?.resId || '')
      if (!id || seen.has(id) || it?.view !== 'ZJ-SongList-Item') continue
      seen.add(id)
      out.push({
        id,
        name: String(it?.txt || it?.logEvent?.contentName || ''),
        pic: https(it?.img || ''),
        description: String(it?.txt2 || ''),
        created: num(it?.publishTime) * 1000,
        source: 'mg',
        kind: 'remote',
      })
    }
  }
  return out
}

/* ============================ 榜单 ============================ */

// 榜单索引兜底表：各平台索引接口失败时使用。
// ID 取自落雪（lx-music-desktop）榜单硬编码表，并已联网逐个核验可用。
const FALLBACK_TREE: ToplistTree['tree'] = {
  wy: {
    name: '小芸音乐',
    groups: [
      {
        g: '核心榜',
        items: [
          { n: '飙升榜', id: '19723756' },
          { n: '新歌榜', id: '3779629' },
          { n: '热歌榜', id: '3778678' },
          { n: '原创榜', id: '2884035' },
          { n: '网络热歌榜', id: '6723173524' },
        ],
      },
      {
        g: '更多榜单',
        items: [
          { n: '中文说唱榜', id: '991319590' },
          { n: '电音榜', id: '1978921795' },
          { n: '古典榜', id: '71384707' },
          { n: 'ACG榜', id: '71385702' },
          { n: '韩语榜', id: '745956260' },
          { n: '日语榜', id: '5059644681' },
          { n: 'ACG动画榜', id: '3001835560' },
          { n: 'ACG游戏榜', id: '3001795926' },
          { n: 'ACG VOCALOID榜', id: '3001890046' },
          { n: '法国NRJ周榜', id: '27135204' },
          { n: '欧美热歌榜', id: '2809513713' },
          { n: '欧美新歌榜', id: '2809577409' },
          { n: '日本Oricon榜', id: '60131' },
          { n: '美国Billboard榜', id: '60198' },
          { n: 'UK排行榜周榜', id: '180106' },
          { n: 'KTV唛榜', id: '21845217' },
          { n: 'Beatport电子舞曲榜', id: '3812895' },
          { n: '民谣榜', id: '5059661515' },
          { n: '摇滚榜', id: '5059633707' },
          { n: '国风榜', id: '5059642708' },
          { n: '听歌识曲榜', id: '6688069460' },
          { n: '潜力爆款榜', id: '5338990334' },
          { n: '黑胶VIP爱听榜', id: '5453912201' },
          { n: '黑胶VIP新歌榜', id: '7785123708' },
          { n: '黑胶VIP热歌榜', id: '7785066739' },
          { n: '黑胶VIP爱搜榜', id: '7785091694' },
          { n: '俄语榜', id: '6732051320' },
          { n: '越南语榜', id: '6732014811' },
          { n: '泰语榜', id: '7095271308' },
          { n: '中文慢摇DJ榜', id: '6886768100' },
          { n: '俄罗斯top hit榜', id: '6939992364' },
          { n: 'BEAT排行榜', id: '7356827205' },
          { n: 'LOOK直播歌曲榜', id: '7603212484' },
          { n: '赏音榜', id: '7775163417' },
        ],
      },
    ],
  },
  qq: {
    name: '小秋音乐',
    groups: [
      {
        g: '热门榜',
        items: [
          { n: '巅峰榜·流行指数', id: '4' },
          { n: '巅峰榜·热歌', id: '26' },
          { n: '巅峰榜·新歌', id: '27' },
          { n: '飙升榜', id: '62' },
          { n: '巅峰榜·网络歌曲', id: '28' },
          { n: '巅峰榜·内地', id: '5' },
          { n: '巅峰榜·欧美', id: '3' },
          { n: '巅峰榜·韩国', id: '16' },
          { n: '巅峰榜·日本', id: '17' },
          { n: '国乐榜', id: '78' },
        ],
      },
      {
        g: '全部榜单',
        items: [
          { n: '说唱榜', id: '58' },
          { n: '电音榜', id: '57' },
          { n: '香港地区榜', id: '59' },
          { n: '抖音热歌榜', id: '60' },
          { n: '巅峰榜·影视金曲', id: '29' },
          { n: '巅峰榜·MV', id: '201' },
          { n: '巅峰榜·K歌金曲', id: '36' },
          { n: '台湾地区榜', id: '61' },
          { n: 'DJ舞曲榜', id: '63' },
          { n: '综艺新歌榜', id: '64' },
          { n: '国风热歌榜', id: '65' },
          { n: '听歌识曲榜', id: '67' },
          { n: '动漫音乐榜', id: '72' },
          { n: '游戏音乐榜', id: '73' },
          { n: '有声榜', id: '75' },
        ],
      },
    ],
  },
  kg: {
    name: '小枸音乐',
    groups: [
      {
        g: '热门榜',
        items: [
          { n: 'TOP500', id: '8888' },
          { n: '国潮音乐榜', id: '85897' },
          { n: '新歌榜', id: '74534' },
          { n: '民谣榜', id: '51341' },
          { n: '电音榜', id: '33160' },
          { n: 'DJ热歌榜', id: '24971' },
          { n: '国乐榜', id: '80025' },
          { n: '短视频收藏人气榜', id: '52767' },
        ],
      },
      {
        g: '全部榜单',
        items: [
          { n: '内地榜', id: '31308' },
          { n: '伤感榜', id: '51340' },
          { n: '日本榜', id: '31312' },
          { n: '80后热歌榜', id: '49225' },
          { n: '00后热歌榜', id: '49224' },
          { n: '台湾地区榜', id: '54848' },
          { n: '说唱先锋榜', id: '44412' },
          { n: 'ACG新歌榜', id: '33162' },
          { n: '欧美金曲榜', id: '33166' },
          { n: '影视金曲榜', id: '33163' },
          { n: '儿歌榜', id: '65234' },
          { n: '闽南语榜', id: '60170' },
          { n: '古典榜', id: '59899' },
          { n: '粤剧榜', id: '108332' },
          { n: '京剧榜', id: '108333' },
          { n: '南音榜', id: '108335' },
          { n: '小语种热歌榜', id: '36107' },
          { n: '越南语榜', id: '60171' },
        ],
      },
    ],
  },
  kw: {
    name: '小蜗音乐',
    groups: [
      {
        g: '热门榜',
        items: [
          { n: '飙升榜', id: '93' },
          { n: '新歌榜', id: '17' },
          { n: '热歌榜', id: '16' },
          { n: '会员畅听榜', id: '145' },
          { n: '抖音热歌榜', id: '158' },
          { n: '流行趋势榜', id: '187' },
          { n: '热评榜', id: '284' },
          { n: 'DJ嗨歌榜', id: '176' },
        ],
      },
      {
        g: '全部榜单',
        items: [
          { n: '华语榜', id: '104' },
          { n: '粤语榜', id: '182' },
          { n: '欧美榜', id: '22' },
          { n: '韩语榜', id: '184' },
          { n: '日语榜', id: '183' },
          { n: '经典怀旧榜', id: '26' },
          { n: '古风音乐榜', id: '278' },
          { n: '电音榜', id: '242' },
          { n: '现场音乐榜', id: '204' },
          { n: '最强翻唱榜', id: '185' },
          { n: 'Vlog音乐榜', id: '264' },
          { n: '网红新歌榜', id: '153' },
          { n: '影视金曲榜', id: '64' },
          { n: 'ACG新歌榜', id: '290' },
          { n: '腾讯音乐人原创榜', id: '151' },
          { n: '真声音', id: '106' },
          { n: 'Billboard榜', id: '12' },
          { n: 'iTunes音乐榜', id: '49' },
          { n: 'beatport电音榜', id: '180' },
          { n: '英国UK榜', id: '13' },
          { n: '百大DJ榜', id: '164' },
          { n: 'YouTube音乐排行榜', id: '246' },
          { n: '韩国Genie榜', id: '265' },
          { n: '韩国M-net榜', id: '14' },
          { n: '香港电台榜', id: '8' },
          { n: '日本公信榜', id: '15' },
          { n: '台湾KKBOX榜', id: '286' },
          { n: '冬日暖心榜', id: '279' },
          { n: '巴士随身听榜', id: '281' },
          { n: 'KTV点唱榜', id: '255' },
          { n: '家务进行曲榜', id: '280' },
          { n: '熬夜修仙榜', id: '282' },
          { n: '枕边轻音乐榜', id: '283' },
          { n: '铃声榜', id: '292' },
        ],
      },
    ],
  },
  mg: {
    name: '小蜜音乐',
    groups: [
      {
        g: '热门榜',
        items: [
          { n: '热歌榜', id: '27186466' },
          { n: '新歌榜', id: '27553319' },
          { n: '原创榜', id: '27553408' },
          { n: '国风金曲榜', id: '83176390' },
          { n: '会员臻爱榜', id: '76557745' },
        ],
      },
      {
        g: '全部榜单',
        items: [
          { n: '音乐风向榜', id: '75959118' },
          { n: '彩铃分贝榜', id: '76557036' },
          { n: '港台榜', id: '23189800' },
          { n: '内地榜', id: '23189399' },
        ],
      },
    ],
  },
}

let treeCache: { at: number; data: ToplistTree } | null = null

export async function toplistTree(force = false): Promise<ToplistTree> {
  if (!force && treeCache && Date.now() - treeCache.at < 30 * 60 * 1000) return treeCache.data
  const tree: ToplistTree['tree'] = {}

  // 网易云：官方榜单索引
  const wyTask = (async () => {
    try {
      const body = await wyLimited('music.163.com', 3, () =>
        getJson<any>('https://music.163.com/api/toplist', WY_HEADERS, 12000)
      )
      const list: any[] = body?.list || []
      if (list.length) {
        tree.wy = {
          name: '小芸音乐',
          groups: [
            {
              g: '核心榜',
              items: list.slice(0, 8).map(x => ({
                n: String(x.name || '').replace(/^云音乐/, ''),
                id: String(x.id),
              })),
            },
            ...(list.length > 8
              ? [
                  {
                    g: '更多榜单',
                    items: list.slice(8).map(x => ({
                      n: String(x.name || '').replace(/^云音乐/, ''),
                      id: String(x.id),
                    })),
                  },
                ]
              : []),
          ],
        }
      }
    } catch (e: any) {
      logger.warn('网易云榜单索引失败', e?.message)
    }
  })()

  // QQ：落雪 tx 端点（fcg_myqq_toplist.fcg）
  const qqTask = (async () => {
    try {
      const body = await limited('c.y.qq.com', 3, () =>
        getJson<any>(
          `https://c.y.qq.com/v8/fcg-bin/fcg_myqq_toplist.fcg?${qs({
            g_tk: '1928093487',
            inCharset: 'utf-8',
            outCharset: 'utf-8',
            notice: 0,
            format: 'json',
            uin: 0,
            needNewCode: 1,
            platform: 'h5',
          })}`,
          QQ_HEADERS,
          12000
        )
      )
      const raw: any[] = body?.data?.topList || body?.topList || []
      const items = raw
        .map((x: any) => ({
          n: stripHtml(x.topTitle || x.ListName || x.topname || ''),
          id: String(x.id ?? x.topID ?? x.topId ?? ''),
        }))
        .filter((x: any) => x.n && x.id)
      if (items.length) {
        tree.qq = {
          name: '小秋音乐',
          groups: [
            { g: '热门榜', items: items.slice(0, 10) },
            ...(items.length > 10 ? [{ g: '全部榜单', items: items.slice(10) }] : []),
          ],
        }
      }
    } catch (e: any) {
      logger.warn('QQ榜单索引失败', e?.message)
    }
  })()

  // 酷狗：落雪 kg 端点（mobilecdnbj v5 rank list，含二级分类）
  const kgTask = (async () => {
    try {
      const body = await limited('kugou.com', 3, () =>
        getJson<any>(
          `http://mobilecdnbj.kugou.com/api/v5/rank/list?${qs({
            version: 9108,
            plat: 0,
            showtype: 2,
            parentid: 0,
            apiver: 6,
            area_code: 1,
          })}`,
          KG_HEADERS,
          12000
        )
      )
      const info: any[] = body?.data?.info || []
      const groups = info
        .map((cat: any) => ({
          g: String(cat.name || ''),
          items: (cat.children || []).map((x: any) => ({
            n: String(x.rankname || ''),
            id: String(x.rankid || ''),
          })),
        }))
        .filter((g: any) => g.g && g.items.length)
      if (groups.length) tree.kg = { name: '小枸音乐', groups }
    } catch (e: any) {
      logger.warn('酷狗榜单索引失败', e?.message)
    }
  })()

  // 酷我：落雪 kw qukudata 树
  const kwTask = (async () => {
    try {
      const body = await limited('kuwo.cn', 3, () =>
        getJson<any>(
          'http://qukudata.kuwo.cn/q.k?op=query&cont=tree&node=2&pn=0&rn=1000&fmt=json&level=2',
          { 'User-Agent': UA, Referer: 'http://www.kuwo.cn/' },
          12000
        )
      )
      // level=2 时顶层 child 本身就是榜单叶子。注意这里的 node id 不是 bangid：
      // 实测直接拿 node id 调 bang_info 全部返回 0 首歌，必须按榜单名回到 KW_BANGID 映射；
      // 未命中的榜单不进列表（否则点开就是空列表），同 bangid 只保留名字最短的那个。
      const leaves: { n: string }[] = []
      const walk = (nodes: any[]): void => {
        for (const n of nodes || []) {
          if (n?.child?.length) walk(n.child)
          else if (n?.name) leaves.push({ n: String(n.name) })
        }
      }
      walk(body?.child || [])
      const items: ToplistItem[] = []
      for (const l of leaves) {
        const bangid = KW_BANGID[l.n] || KW_BANGID[l.n.replace(/^酷我/, '')]
        if (!bangid) continue
        const dup = items.findIndex(x => x.id === bangid)
        if (dup >= 0) {
          if (l.n.length < items[dup].n.length) items[dup].n = l.n
          continue
        }
        items.push({ n: l.n, id: bangid })
      }
      const groups = items.length ? [{ g: '全部榜单', items }] : []
      if (groups.length) tree.kw = { name: '小蜗音乐', groups }
    } catch (e: any) {
      logger.warn('酷我榜单索引失败', e?.message)
    }
  })()

  // 咪咕：落雪 mg rank-index
  const mgTask = (async () => {
    try {
      const body = await limited('migu.cn', 3, () =>
        getJson<any>('https://app.c.nf.migu.cn/pc/bmw/rank/rank-index/v1.0', MG_HEADERS, 12000)
      )
      const cols: any[] = body?.data?.contents || []
      const groups = cols
        .map((c: any) => ({
          g: String(c?.style || ''),
          items: (c?.contents || [])
            .map((x: any) => ({ n: String(x.rankName || ''), id: String(x.rankId || '') }))
            .filter((x: any) => x.n && x.id),
        }))
        .filter((g: any) => g.g && g.items.length)
      if (groups.length) tree.mg = { name: '小蜜音乐', groups }
    } catch (e: any) {
      logger.warn('咪咕榜单索引失败', e?.message)
    }
  })()

  await Promise.allSettled([wyTask, qqTask, kgTask, kwTask, mgTask])

  for (const k of Object.keys(FALLBACK_TREE)) {
    if (!tree[k]) tree[k] = FALLBACK_TREE[k]
  }
  let total = 0
  for (const k of Object.keys(tree)) for (const g of tree[k].groups) total += g.items.length
  const data: ToplistTree = { total, tree }
  treeCache = { at: Date.now(), data }
  return data
}

export async function toplistSongs(platform: string, id: string): Promise<{ name: string; songs: Song[] }> {
  const p = String(platform || '').toLowerCase()
  if (p === 'wy') {
    const detail = await neteasePlaylistDetail(id)
    return { name: detail.name || '小芸音乐榜单', songs: detail.songs }
  }
  if (p === 'qq') {
    const body = await getJson<any>(
      `https://c.y.qq.com/v8/fcg-bin/fcg_v8_toplist_cp.fcg?${qs({
        format: 'json',
        topid: id,
        page: 'detail',
        type: 'top',
        tpl: 3,
        _: Date.now(),
      })}`,
      QQ_HEADERS,
      15000
    )
    const list: any[] = body?.songlist || []
    const songs = list
      .map((x: any): Song => {
        const d = x.data || {}
        const mid = d.songmid || ''
        return {
          id: `qq:${mid}`,
          source: 'qq',
          songId: mid,
          name: d.songname || '',
          singer: (d.singer || []).map((s: any) => s.name).join('/') || '未知歌手',
          album: d.albumname || '',
          duration: num(d.interval),
          pic: d.albummid ? `https://y.gtimg.cn/music/photo_new/T002R300x300M000${d.albummid}.jpg` : '',
          qualitys: ['128k', '320k'],
          extra: { songmid: mid, albummid: d.albummid || '' },
        }
      })
      .filter(s => s.songId && s.name)
    return { name: body?.topinfo?.ListName || '小秋音乐榜单', songs }
  }
  if (p === 'kg') {
    // 必须带 version/ranktype/area_code：缺少时酷狗只返回极少数歌曲
    // （实测 rankid=8888 从 total=500 退化为 total=2），不是权限问题而是参数校验。
    const body = await getJson<any>(
      `http://mobilecdn.kugou.com/api/v3/rank/song?${qs({
        format: 'json',
        version: 9108,
        ranktype: 1,
        area_code: 1,
        rankid: id,
        page: 1,
        pagesize: 100,
        plat: 0,
      })}`,
      KG_HEADERS,
      15000
    )
    const info: any[] = body?.data?.info || []
    const songs = info
      .map((s: any): Song => {
        const fn = String(s.filename || '')
        const parts = fn.split(' - ')
        const singer = (s.authors || []).map((a: any) => a.author_name).filter(Boolean).join('/')
        return {
          id: `kg:${s.hash}`,
          source: 'kg',
          songId: String(s.hash || ''),
          name: s.songname || (parts.length > 1 ? parts.slice(1).join(' - ') : fn),
          singer: singer || s.singername || (parts.length > 1 ? parts[0] : '未知歌手'),
          album: s.album_name || '',
          duration: num(s.duration),
          pic: s.album_cover ? String(s.album_cover).replace('{size}', '480') : '',
          qualitys: ['128k', '320k'],
          extra: { hash: s.hash || '' },
        }
      })
      .filter(s => s.songId && s.name)
    return { name: body?.data?.info?.[0]?.rankname || '小枸音乐榜单', songs }
  }
  if (p === 'kw') {
    // 酷我榜单接口被 AES-128-ECB + zlib 加密（wbd 通道），参数与密钥照搬落雪。
    // 榜单树里存的就是 bangid（兜底表同样存 bangid），只有传入旧名时才再过一次名称表。
    const bangid = KW_BANGID[String(id)] || String(id) || '93'
    const body = { uid: '', devId: '', sFrom: 'kuwo_sdk', user_type: 'AP', carSource: 'kwplayercar_ar_6.0.1.0_apk_keluze.apk', id: bangid, pn: 0, rn: 100 }
    const data = Buffer.from(JSON.stringify(body))
    const time = Date.now()
    const cipher = crypto.createCipheriv('aes-128-ecb', kwKey(), null)
    const enc = Buffer.concat([cipher.update(data), cipher.final()]).toString('base64')
    const sign = crypto
      .createHash('md5')
      .update(KW_APP_ID + enc + time)
      .digest('hex')
      .toUpperCase()
    const url = `https://wbd.kuwo.cn/api/bd/bang/bang_info?${qs({
      data: enc,
      time,
      appId: KW_APP_ID,
      sign,
    })}`
    const res = await request(url, { headers: KW_HEADERS_WBD, timeout: 15000 })
    const raw = Buffer.from(decodeURIComponent(String(res.body)), 'base64')
    const decipher = crypto.createDecipheriv('aes-128-ecb', kwKey(), null)
    const parsed = JSON.parse(Buffer.concat([decipher.update(raw), decipher.final()]).toString())
    const info: any = parsed?.data || {}
    const list: any[] = info.musiclist || []
    const songs = list
      .map((s: any): Song => {
        const minfo = String(s.minfo || '')
        const flac = /format:flac/i.test(minfo)
        return {
          id: `kw:${s.id}`,
          source: 'kw',
          songId: String(s.id || ''),
          name: s.name || s.songName || '',
          singer: s.artist || '未知歌手',
          album: s.album || '',
          duration: num(s.duration),
          pic: https(s.artistPic || s.albumpic || ''),
          qualitys: flac ? ['128k', '320k', 'flac'] : ['128k', '320k'],
          extra: { rid: s.rid || s.id },
        }
      })
      .filter(s => s.songId && s.name)
    return { name: info.name || info.rankname || '小蜗音乐榜单', songs }
  }
  if (p === 'mg') {
    // rankId 是字符串，需带 rankType；返回是模板化楼层，歌曲在 data.contents[]（txt=歌名，txt2=歌手）
    const body = await getJson<any>(
      `https://app.c.nf.migu.cn/pc/bmw/rank/rank-info/v1.0?${qs({ rankId: id, rankType: 1 })}`,
      MG_HEADERS,
      15000
    )
    const list: any[] = body?.data?.contents || []
    const songs: Song[] = list.map(s => {
      // resId 是版权 id，歌曲 id 用 songId；专辑信息藏在 JSON 字符串 songData 里
      let album = ''
      try {
        const d = typeof s.songData === 'string' ? JSON.parse(s.songData) : s.songData
        album = String(d?.album || '')
      } catch {}
      const sid = String(s.songId || s.resId || '')
      const sq: string[] = Array.isArray(s.qualities) ? s.qualities : []
      return {
        id: `mg:${sid}`,
        source: 'mg',
        songId: sid,
        name: String(s.txt || ''),
        singer: String(s.txt2 || '') || '未知歌手',
        album,
        duration: num(s.txt5 || 0),
        pic: https(s.img || ''),
        qualitys: sq.includes('isq') || sq.includes('asq') ? ['128k', 'flac'] : ['128k'],
      }
    }).filter(s => s.songId && s.name)
    return { name: body?.data?.rankInfo?.rankName || body?.data?.rankInfo?.rankTitle || '小蜜音乐榜单', songs }
  }
  throw new Error(`平台 ${p} 的榜单接口暂不可用`)
}

/* ============================ B 站 ============================ */

export async function searchBiliVideo(keyword: string, page = 1): Promise<MvItem[]> {
  const url = `https://api.bilibili.com/x/web-interface/wbi/search/type?${qs({
    search_type: 'video',
    keyword,
    page,
  })}`
  const res = await request(url, { headers: biliHeaders(), timeout: 15000 })
  const items: any[] = res.body?.data?.result || []
  return items
    .map(v => ({
      bvid: v.bvid || '',
      title: stripHtml(v.title || ''),
      author: v.author || '',
      pic: https(v.pic || ''),
      duration: String(v.duration || ''),
      play: num(v.play),
      danmaku: num(v.video_review),
    }))
    .filter(v => v.bvid)
}

export async function biliVideoInfo(
  bvid: string
): Promise<{
  cid: string
  title: string
  pic: string
  author: string
  play: number
  danmaku: number
  like: number
  coin: number
  favorite: number
  duration: number
  pubdate: number
  desc: string
}> {
  const res = await request(`https://api.bilibili.com/x/web-interface/view?${qs({ bvid })}`, {
    headers: biliHeaders(),
    timeout: 15000,
  })
  const d = res.body?.data
  if (!d) throw new Error('视频信息获取失败')
  const stat = d.stat || {}
  return {
    cid: String(d.cid || ''),
    title: d.title || '',
    pic: https(d.pic || ''),
    author: d.owner?.name || '',
    play: num(stat.view),
    danmaku: num(stat.danmaku),
    like: num(stat.like),
    coin: num(stat.coin),
    favorite: num(stat.favorite),
    duration: num(d.duration),
    pubdate: num(d.pubdate),
    desc: String(d.desc || ''),
  }
}

export async function biliParts(bvid: string): Promise<{ cid: string; page: number; part: string; duration: number }[]> {
  const res = await request(`https://api.bilibili.com/x/player/pagelist?${qs({ bvid })}`, {
    headers: biliHeaders(),
    timeout: 12000,
  })
  const list: any[] = res.body?.data || []
  return list.map((p: any) => ({
    cid: String(p.cid || ''),
    page: Number(p.page) || 0,
    part: String(p.part || `P${p.page}`),
    duration: Number(p.duration) || 0,
  }))
}

export async function biliPlayUrl(bvid: string, cid: string): Promise<{ url: string; type: string }> {
  // 优先请求 progressive MP4（音视频合一），否则 <video> 只有画面没有声音
  try {
    const res = await request(
      `https://api.bilibili.com/x/player/playurl?${qs({
        bvid,
        cid,
        qn: 64,
        fnval: 1,
        fnver: 0,
        fourk: 0,
        platform: 'html5',
      })}`,
      { headers: biliHeaders(), timeout: 15000 }
    )
    const durl = res.body?.data?.durl?.[0]?.url
    if (durl) return { url: durl, type: 'durl' }
  } catch {
    /* 回退 DASH */
  }

  const res = await request(
    `https://api.bilibili.com/x/player/playurl?${qs({ bvid, cid, fnval: 16, fourk: 1, platform: 'html5' })}`,
    { headers: biliHeaders(), timeout: 15000 }
  )
  const d = res.body?.data
  const videos: any[] = d?.dash?.video || []
  if (videos.length) {
    const order = [64, 32, 16, 80, 112, 74]
    const v = order.map(id => videos.find(x => x.id === id)).find(Boolean) || videos[0]
    return { url: v.baseUrl || v.base_url, type: 'dash-video' }
  }
  const fm = d?.durl?.[0]?.url
  if (fm) return { url: fm, type: 'durl' }
  throw new Error('视频流解析失败（可能需要登录或该视频受限）')
}

export async function biliAudioUrl(bvid: string, cid: string): Promise<string> {
  const res = await request(
    `https://api.bilibili.com/x/player/playurl?${qs({ bvid, cid, fnval: 16, fourk: 0, platform: 'html5' })}`,
    { headers: biliHeaders(), timeout: 15000 }
  )
  const dash = res.body?.data?.dash
  const audio: any[] = dash?.audio || []
  if (audio.length) {
    const best = audio.sort((a, b) => (b.bandwidth || 0) - (a.bandwidth || 0))[0]
    return best.baseUrl || best.base_url
  }
  const fm = res.body?.data?.durl?.[0]?.url
  if (fm) return fm
  throw new Error('音频流解析失败')
}

/* ============================ 播客 / 封面兜底 ============================ */

export async function searchPodcast(keyword = '音乐', limit = 8): Promise<any[]> {
  const url = `https://itunes.apple.com/search?${qs({ term: keyword, media: 'podcast', limit })}`
  const body = await getJson<any>(url, { 'User-Agent': UA }, 15000)
  return (body?.results || []).map((p: any) => ({
    id: String(p.collectionId || ''),
    name: p.collectionName || '',
    author: p.artistName || '',
    pic: https(p.artworkUrl600 || p.artworkUrl100 || ''),
    count: p.trackCount || 0,
    feed: p.feedUrl || '',
  }))
}

export async function itunesCover(term: string): Promise<string> {
  const url = `https://itunes.apple.com/search?${qs({ term, entity: 'song', limit: 1 })}`
  const body = await getJson<any>(url, { 'User-Agent': UA }, 12000)
  const item = body?.results?.[0]
  const art = item?.artworkUrl100 || item?.artworkUrl60 || ''
  return art ? String(art).replace(/\/\d+x\d+bb\.jpg$/, '/600x600bb.jpg') : ''
}

/* ============================ 播客单集（内置播放） ============================ */

function xmlText(raw: string, tag: string): string {
  const m = raw.match(new RegExp(`<${tag}[^>]*>([\\s\\S]*?)</${tag}>`, 'i'))
  if (!m) return ''
  return stripHtml(m[1].replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')).trim()
}

function xmlAttr(raw: string, tag: string, attr: string): string {
  const m = raw.match(new RegExp(`<${tag}[^>]*\\s${attr}=["']([^"']+)["']`, 'i'))
  return m ? stripHtml(m[1]).trim() : ''
}

/** itunes:duration 可能是 1561 / 18:03 / 1:00:22 三种写法，统一成秒 */
function parseDuration(v: string): number {
  const s = String(v || '').trim()
  if (!s) return 0
  if (/^\d+$/.test(s)) return Number(s)
  const parts = s.split(':').map(x => Number(x) || 0)
  return parts.reduce((acc, n) => acc * 60 + n, 0)
}

/**
 * 拉取播客 RSS，解析出可直接播放的单集列表。
 * 单集用 enclosure 音频直链（mp3/m4a）作为本地路径，走 swmedia 代理播放。
 */
export async function podcastEpisodes(feed: string, limit = 100): Promise<Song[]> {
  const url = String(feed || '').trim()
  if (!/^https?:\/\//i.test(url)) throw new Error('该播客没有提供可订阅的节目源')
  const res = await request(url, { headers: { 'User-Agent': UA }, timeout: 20000 })
  const xml = res.raw || ''
  const items = xml.match(/<item[\s>][\s\S]*?<\/item>/gi) || []
  if (!items.length) throw new Error('节目源解析失败或暂无单集')

  const cover = xmlAttr(xml, 'itunes:image', 'href') || xmlText(xml, 'url')
  const out: Song[] = []
  for (const item of items.slice(0, limit)) {
    const enc = xmlAttr(item, 'enclosure', 'url')
    if (!enc) continue
    const title = xmlText(item, 'title')
    if (!title) continue
    const guid = xmlText(item, 'guid') || enc
    out.push({
      id: `podcast:${guid}`,
      source: 'podcast',
      songId: guid,
      name: title,
      singer: xmlText(item, 'itunes:author') || xmlText(item, 'author') || '播客',
      album: '',
      duration: parseDuration(xmlText(item, 'itunes:duration')),
      pic: xmlAttr(item, 'itunes:image', 'href') || cover,
      extra: { url: enc, feed: url },
    })
  }
  if (!out.length) throw new Error('该播客的单集没有可播放的音频地址')
  return out
}

/* ============================ 歌单链接导入 ============================ */

export function detectPlatform(input: string): string {
  const s = String(input || '')
  if (/bilibili\.com|b23\.tv/i.test(s)) return 'bili'
  if (/y\.qq\.com|qq\.com|c\.y\.qq/i.test(s)) return 'qq'
  if (/kugou\.com/i.test(s)) return 'kg'
  if (/kuwo\.cn/i.test(s)) return 'kw'
  if (/migu\.cn/i.test(s)) return 'mg'
  if (/music\.163\.com|163cn\.tv/i.test(s)) return 'wy'
  return ''
}

export function extractPlaylistId(input: string, platform?: string): { platform: string; id: string } {
  const s = String(input || '').trim()
  if (!s) throw new Error('请输入歌单链接或 ID')
  const p = platform || detectPlatform(s) || 'wy'
  const rules: Record<string, RegExp[]> = {
    wy: [/[?&#]id=(\d+)/, /playlist\/(\d+)/, /^(\d+)$/],
    qq: [/[?&#]id=([A-Za-z0-9]+)/, /taoge\/([A-Za-z0-9]+)/, /playlist\/([A-Za-z0-9]+)/, /^([A-Za-z0-9]+)$/],
    kw: [/[?&#]pid=(\d+)/, /playlist_detail\/(\d+)/, /^(\d+)$/],
    kg: [/[?&#]specialid=(\d+)/, /special\/single\/(\d+)/, /plist\/list_(\d+)/, /^(\d+)$/],
    mg: [/[?&#]id=(\d+)/, /playlist\/(\d+)/, /^(\d+)$/],
    bili: [/[?&#]sid=(\d+)/, /season_id=(\d+)/, /^(\d+)$/],
  }
  for (const re of rules[p] || []) {
    const m = s.match(re)
    if (m) return { platform: p, id: m[1] }
  }
  throw new Error('无法识别该歌单链接，请检查后重试')
}

export async function importPlaylistByLink(
  input: string,
  platform?: string
): Promise<{ name: string; pic: string; description: string; songs: Song[]; platform: string }> {
  const t = extractPlaylistId(input, platform)
  let r: { name: string; pic: string; description: string; songs: Song[] }
  if (t.platform === 'wy') r = await neteasePlaylistDetail(t.id)
  else if (t.platform === 'qq') r = await qqPlaylistDetail(t.id)
  else if (t.platform === 'kg') r = await kugouPlaylistDetail(t.id)
  else if (t.platform === 'kw') r = await kuwoPlaylistDetail(t.id)
  else if (t.platform === 'mg') r = await miguPlaylistDetail(t.id)
  else if (t.platform === 'bili') {
    const { importBiliSeason } = await import('./bili')
    r = await importBiliSeason(t.id)
  } else throw new Error('未知平台')
  return { ...r, platform: t.platform }
}

export { biliStatus }
