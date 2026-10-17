import type { MvItem, PlaylistMeta, Song, ToplistTree } from '../../shared/types'
import { getJson, hostOf, limited, qs, request, stripHtml, UA } from './http'
import { createLogger } from './log'
import { biliCookie, biliHeaders, biliStatus } from './bili'

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

const KG_HEADERS = { 'User-Agent': UA, Referer: 'https://www.kugou.com/' }

function https(u: string): string {
  return String(u || '').replace(/^http:\/\//i, 'https://').replace(/^\/\//, 'https://')
}

function num(v: any): number {
  const n = Number(v)
  return Number.isFinite(n) ? n : 0
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
      const body = await getJson<any>(url, WY_HEADERS, 6000)
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

export async function neteasePlaylists(cat = '全部', order = 'hot', page = 1): Promise<PlaylistMeta[]> {
  const offset = (Math.max(1, page) - 1) * 30
  const url = `https://music.163.com/api/playlist/list?${qs({ cat, order, offset, limit: 30 })}`
  const body = await limited('music.163.com', 3, () => getJson<any>(url, WY_HEADERS, 12000))
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
      const body = await limited(hostOf(url), 3, () => getJson<any>(url, WY_HEADERS, 12000))
      // /api/v6|v3 把歌单放在 playlist，/api/playlist/detail 放在 result，两者字段结构一致。
      // 只认 playlist 会把 v1 的成功响应判为失败，抛出误导性的「code 200」。
      const got = body?.playlist || body?.result
      if (got) {
        pl = got
        if ((pl.tracks || []).length) break
      } else {
        lastErr = body?.message || body?.msg || `code ${body?.code}`
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
  const body = await limited('music.163.com', 3, () =>
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

/* ============================ 酷我 / 咪咕 ============================ */

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

/* ============================ 榜单 ============================ */

// 榜单索引兜底表：各平台索引接口失败时使用。
// ID 取自落雪（lx-music-desktop）榜单硬编码表，并已联网逐个核验可用。
const FALLBACK_TREE: ToplistTree['tree'] = {
  wy: {
    name: '网易云音乐',
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
    name: 'QQ音乐',
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
    name: '酷狗音乐',
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
}

let treeCache: { at: number; data: ToplistTree } | null = null

export async function toplistTree(force = false): Promise<ToplistTree> {
  if (!force && treeCache && Date.now() - treeCache.at < 30 * 60 * 1000) return treeCache.data
  const tree: ToplistTree['tree'] = {}

  // 网易云：官方榜单索引
  try {
    const body = await limited('music.163.com', 3, () =>
      getJson<any>('https://music.163.com/api/toplist', WY_HEADERS, 12000)
    )
    const list: any[] = body?.list || []
    if (list.length) {
      const core = list.slice(0, 8)
      const rest = list.slice(8)
      tree.wy = {
        name: '网易云音乐',
        groups: [
          { g: '核心榜', items: core.map(x => ({ n: String(x.name || '').replace(/^云音乐/, ''), id: String(x.id) })) },
          ...(rest.length
            ? [
                {
                  g: '更多榜单',
                  items: rest.map(x => ({ n: String(x.name || '').replace(/^云音乐/, ''), id: String(x.id) })),
                },
              ]
            : []),
        ],
      }
    }
  } catch (e: any) {
    logger.warn('网易云榜单索引失败', e?.message)
  }

  // QQ：官方榜单索引
  // 旧端点 fcg_v8_toplist_opt.fcg 已失效（返回空字符串或 code 304），
  // 必须用 fcg_myqq_toplist.fcg，榜单在 body.data.topList，字段为 topTitle / id。
  try {
    const body = await getJson<any>(
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
    const raw = body?.data?.topList || body?.topList || []
    const items = raw
      .map((x: any) => ({
        n: stripHtml(x.topTitle || x.ListName || x.topname || ''),
        id: String(x.id ?? x.topID ?? x.topId ?? ''),
      }))
      .filter((x: any) => x.n && x.id)
    if (items.length) {
      tree.qq = {
        name: 'QQ音乐',
        groups: [
          { g: '热门榜', items: items.slice(0, 10) },
          ...(items.length > 10 ? [{ g: '全部榜单', items: items.slice(10) }] : []),
        ],
      }
    }
  } catch (e: any) {
    logger.warn('QQ榜单索引失败', e?.message)
  }

  // 酷狗
  try {
    const body = await getJson<any>(
      `http://mobilecdn.kugou.com/api/v3/rank/list?${qs({ format: 'json', plat: 0 })}`,
      KG_HEADERS,
      12000
    )
    const info: any[] = body?.data?.info || []
    const items = info.map(x => ({ n: x.rankname || '', id: String(x.rankid || '') })).filter(x => x.n && x.id)
    if (items.length) tree.kg = { name: '酷狗音乐', groups: [{ g: '全部榜单', items }] }
  } catch (e: any) {
    logger.warn('酷狗榜单索引失败', e?.message)
  }

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
    return { name: detail.name || '网易云榜单', songs: detail.songs }
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
    return { name: body?.topinfo?.ListName || 'QQ音乐榜单', songs }
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
    return { name: body?.data?.info?.[0]?.rankname || '酷狗榜单', songs }
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
