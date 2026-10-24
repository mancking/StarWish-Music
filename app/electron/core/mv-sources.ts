import type { MvItem } from '../../shared/types'
import { getJson, qs, request } from './http'
import { createLogger } from './log'

/**
 * MV 多音源（规格书 2.17 ~ 2.19 · 独立模块）
 *
 * 实测能力（2026-10-24）：
 *  - 网易云：type=1004 MV 搜索 + /api/mv/detail 返回 brs{240,480,720,1080} 直链（HTTP 206 可播）
 *  - QQ 音乐：smartbox 搜出 vid → musicu.fcg gosrf.Stream.MvUrlProxy/GetMvUrls 3 档 mp4
 *  - 酷狗 / 酷我：元数据可用，播放地址需签名/token（本期只展示元数据、播放置灰，走插件分发二期）
 * 防盗链：直链渲染层统一经 swmedia 代理（refererFor 已覆盖 163/gtimg/qq）。
 */

const logger = createLogger('mv-sources')

const WY_HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
  Referer: 'https://music.163.com/',
  Cookie: 'os=pc; appver=2.9.7',
}

const QQ_HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
  Referer: 'https://y.qq.com/',
}

const WY_QN: { qn: number; label: string }[] = [
  { qn: 240, label: '240P' },
  { qn: 480, label: '480P' },
  { qn: 720, label: '720P' },
  { qn: 1080, label: '1080P' },
]

function secFromLabel(d: string): number {
  const parts = String(d || '').split(':').map(x => parseInt(x, 10) || 0)
  if (parts.length === 3) return parts[0]! * 3600 + parts[1]! * 60 + parts[2]!
  if (parts.length === 2) return parts[0]! * 60 + parts[1]!
  return 0
}

/* ============================ 网易云 MV ============================ */

/** 网易云 MV 搜索（type=1004） */
export async function searchWyMv(keyword: string, page = 1, limit = 20): Promise<MvItem[]> {
  const offset = (Math.max(1, page) - 1) * limit
  const endpoints = [
    `https://music.163.com/api/search/get/web?${qs({ s: keyword, type: 1004, offset, limit, total: 'true' })}`,
    `https://music.163.com/api/cloudsearch/pc?${qs({ s: keyword, type: 1004, offset, limit })}`,
  ]
  for (const url of endpoints) {
    try {
      const body = await getJson<any>(url, WY_HEADERS, 6000)
      const list = body?.result?.mvs || []
      if (!list.length) continue
      return list.map((m: any) => ({
        source: 'wy',
        sourceId: String(m.id || ''),
        bvid: undefined,
        title: String(m.name || ''),
        author: (m.artists || []).map((a: any) => a.name).filter(Boolean).join('/') || '未知歌手',
        pic: String(m.cover || ''),
        duration: fmtDur(m.duration),
        durationSec: Math.round((Number(m.duration) || 0) / 1000),
        play: Number(m.playCount) || 0,
        danmaku: 0,
        qualities: WY_QN,
      })) as MvItem[]
    } catch (e: any) {
      logger.warn('网易云 MV 搜索失败', e?.message)
    }
  }
  return []
}

function fmtDur(ms: number): string {
  const s = Math.round((Number(ms) || 0) / 1000)
  const m = Math.floor(s / 60)
  return `${m}:${String(s % 60).padStart(2, '0')}`
}

export interface MvDetail {
  id: string
  title: string
  author: string
  pic: string
  durationSec: number
  play: number
  desc: string
  qualities: { qn: number; label: string }[]
}

/** 网易云 MV 详情（brs 直链档位表） */
export async function wyMvDetail(id: string): Promise<MvDetail> {
  const body = await getJson<any>(`https://music.163.com/api/mv/detail?${qs({ id })}`, WY_HEADERS, 8000)
  const d = body?.data || {}
  const brs = d.brs || {}
  const qualities = WY_QN.filter(q => brs[String(q.qn)])
  return {
    id: String(d.id || id),
    title: String(d.name || ''),
    author: (d.artists || []).map((a: any) => a.name).join('/') || '未知歌手',
    pic: String(d.cover || ''),
    durationSec: Math.round((Number(d.duration) || 0) / 1000),
    play: Number(d.playCount) || 0,
    desc: String(d.desc || ''),
    qualities,
  }
}

/** 网易云 MV 播放地址：qn 为档位键（240/480/720/1080），缺省取最高 */
export async function wyMvUrl(id: string, qn?: number): Promise<{ url: string; qn: number; qualities: { qn: number; label: string }[] }> {
  const detail = await wyMvDetail(id)
  const brs = (detail as any).brs || {}
  void brs
  const body = await getJson<any>(`https://music.163.com/api/mv/detail?${qs({ id })}`, WY_HEADERS, 8000)
  const brsMap = body?.data?.brs || {}
  const avail = WY_QN.filter(q => brsMap[String(q.qn)])
  if (!avail.length) throw new Error('该 MV 暂无可用档位')
  const want = qn && avail.some(q => q.qn === qn) ? qn : avail[avail.length - 1]!.qn
  const url = String(brsMap[String(want)] || '')
  if (!url) throw new Error('档位地址缺失')
  return { url, qn: want, qualities: avail }
}

/** 歌曲相关 MV（规格书 2.18 mvBySong）：网易云歌曲 cloudsearch 返回 mv 字段 */
export async function wyMvBySong(songId: string): Promise<MvItem[]> {
  try {
    const body = await getJson<any>(
      `https://music.163.com/api/song/detail?${qs({ id: songId, ids: `[${songId}]` })}`,
      WY_HEADERS,
      6000
    )
    const song = (body?.songs || [])[0]
    const mvId = Number(song?.mvid || song?.mv || 0)
    if (!mvId) return []
    const d = await wyMvDetail(String(mvId))
    return [
      {
        source: 'wy',
        sourceId: d.id,
        title: d.title,
        author: d.author,
        pic: d.pic,
        duration: fmtDur(d.durationSec * 1000),
        durationSec: d.durationSec,
        play: d.play,
        danmaku: 0,
        qualities: d.qualities,
      } as MvItem,
    ]
  } catch (e: any) {
    logger.warn('网易云 mvBySong 失败', e?.message)
    return []
  }
}

/* ============================ QQ 音乐 MV ============================ */

const QQ_QN: { qn: number; label: string }[] = [
  { qn: 480, label: '480P' },
  { qn: 720, label: '720P' },
  { qn: 1080, label: '1080P' },
]

interface QqMvUrls {
  url: string
  qn: number
  qualities: { qn: number; label: string }[]
}

/** QQ GetMvUrls（gosrf.Stream.MvUrlProxy）：返回各档 mp4 */
async function qqMvUrls(vid: string): Promise<QqMvUrls> {
  const payload = {
    comm: { ct: 24, cv: 4747474 },
    req_0: {
      module: 'gosrf.Stream.MvUrlProxy',
      method: 'GetMvUrls',
      param: { vid, encrypt: 'N', clear: 1 },
    },
  }
  const res = await request('https://u.y.qq.com/cgi-bin/musicu.fcg', {
    method: 'POST',
    headers: { ...QQ_HEADERS, 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
    timeout: 8000,
  })
  const list: any[] = res.body?.req_0?.data?.mp4 || []
  const byQn: { qn: number; label: string; url: string }[] = []
  for (const item of list) {
    const info = item?.freeflow?.name?.match(/^(\d+)/)
    const url = item?.freeflow?.url || item?.wifi?.url
    if (!url) continue
    const h = Number(info?.[1] || 0)
    const qn = h >= 1080 ? 1080 : h >= 720 ? 720 : 480
    if (byQn.some(x => x.qn === qn)) continue
    byQn.push({ qn, label: `${qn}P`, url: String(url) })
  }
  byQn.sort((a, b) => a.qn - b.qn)
  if (!byQn.length) throw new Error('该 MV 暂无可用档位')
  return { url: byQn[byQn.length - 1]!.url, qn: byQn[byQn.length - 1]!.qn, qualities: byQn.map(x => ({ qn: x.qn, label: x.label })) }
}

/** QQ MV 搜索：musicu.fcg Music.Search.SearchCgi（type=mv） */
export async function searchQQMv(keyword: string, page = 1, limit = 20): Promise<MvItem[]> {
  const payload = {
    comm: { ct: 24, cv: 4747474 },
    req_0: {
      module: 'music.search.SearchCgi',
      method: 'DoSearchForQQMusicDesktop',
      param: {
        search_type: 4,
        query: keyword,
        page_num: Math.max(1, page),
        num_per_page: limit,
      },
    },
  }
  try {
    const res = await request('https://u.y.qq.com/cgi-bin/musicu.fcg', {
      method: 'POST',
      headers: { ...QQ_HEADERS, 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
      timeout: 8000,
    })
    const list: any[] = res.body?.req_0?.data?.body?.item?.mv_list || res.body?.req_0?.data?.body?.mv?.list || []
    return list
      .map((m: any) => {
        const vid = String(m.vid || m.mvvid || '')
        if (!vid) return null
        return {
          source: 'qq',
          sourceId: vid,
          title: String(m.mvname || m.name || m.title || ''),
          author: (m.singers || m.singer || []).map?.((a: any) => a.name).join?.('/') || String(m.singers?.[0]?.name || m.singer || '未知歌手'),
          pic: String(m.mvpic || m.pic || ''),
          duration: fmtDur((Number(m.interval) || 0) * 1000),
          durationSec: Number(m.interval) || secFromLabel(m.duration || ''),
          play: Number(m.play_count || m.playCount) || 0,
          danmaku: 0,
          qualities: QQ_QN,
        } as MvItem
      })
      .filter(Boolean) as MvItem[]
  } catch (e: any) {
    logger.warn('QQ MV 搜索失败', e?.message)
    return []
  }
}

/** QQ MV 详情 + 取链（GetMvUrls） */
export async function qqMvDetail(vid: string): Promise<MvDetail & { urls?: QqMvUrls }> {
  const urls = await qqMvUrls(vid)
  return {
    id: vid,
    title: '',
    author: '',
    pic: '',
    durationSec: 0,
    play: 0,
    desc: '',
    qualities: urls.qualities,
    urls,
  }
}

export async function qqMvUrl(vid: string, _qn?: number): Promise<QqMvUrls> {
  return qqMvUrls(vid)
}

/** 歌曲 → 相关 MV（规格书 2.18）：QQ smartbox 返回 vid 条目 */
export async function qqMvBySong(songName: string, singer: string): Promise<MvItem[]> {
  try {
    const payload = {
      comm: { ct: 24, cv: 4747474 },
      req_0: {
        module: 'music.smartbox.SearchCgi',
        method: 'GetSmartboxResult',
        param: { query: `${songName} ${singer}`.trim() },
      },
    }
    const res = await request('https://u.y.qq.com/cgi-bin/musicu.fcg', {
      method: 'POST',
      headers: { ...QQ_HEADERS, 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
      timeout: 6000,
    })
    const hits: any[] = res.body?.req_0?.data?.body?.mv?.hits || []
    const vid = String(hits[0]?.vid || '')
    if (!vid) return []
    const urls = await qqMvUrls(vid).catch(() => null)
    return [
      {
        source: 'qq',
        sourceId: vid,
        title: String(hits[0]?.name || songName),
        author: singer || '未知歌手',
        pic: String(hits[0]?.pic || ''),
        duration: '',
        durationSec: 0,
        play: 0,
        danmaku: 0,
        qualities: urls?.qualities || QQ_QN,
      } as MvItem,
    ]
  } catch {
    return []
  }
}

/* ============================ 酷狗 / 酷我（元数据） ============================ */

/** 酷狗 MV 列表（元数据可用、播放需签名 —— 本期展示为「签名源二期」置灰条目） */
export async function searchKgMv(keyword: string, page = 1, limit = 20): Promise<MvItem[]> {
  try {
    const body = await getJson<any>(
      `https://m3ws.kugou.com/v3/mv/search?${qs({ keyword, page, pagesize: limit, format: 'json' })}`,
      { 'User-Agent': 'Mozilla/5.0' },
      6000
    )
    const list = body?.data?.lists || []
    return list.map((m: any) => ({
      source: 'kg',
      sourceId: String(m.hash || m.mvhash || ''),
      title: String(m.mvname || m.songname || ''),
      author: String(m.singername || ''),
      pic: String(m.img || m.imgurl || ''),
      duration: fmtDur((Number(m.duration) || 0) * 1000),
      durationSec: Number(m.duration) || 0,
      play: Number(m.playcount || m.count) || 0,
      danmaku: 0,
      qualities: [],
    })) as MvItem[]
  } catch {
    return []
  }
}

/** 酷我 MV 搜索（元数据；播放需 token —— 本期置灰） */
export async function searchKwMv(keyword: string, page = 1, limit = 20): Promise<MvItem[]> {
  try {
    const body = await getJson<any>(
      `http://search.kuwo.cn/r.s?${qs({ all: keyword, ft: 'mv', itemid: 1, rformat: 'json', pn: page - 1, rn: limit })}`,
      { 'User-Agent': 'Mozilla/5.0' },
      6000
    )
    const list = body?.abslist || body?.mvlist || []
    return list
      .map((m: any) => {
        const id = String(m.DPID || m.mvId || m.rid || '')
        if (!id) return null
        return {
          source: 'kw',
          sourceId: id,
          title: String(m.SONGNAME || m.name || ''),
          author: String(m.ARTIST || m.artist || ''),
          pic: String(m.hts_MVPIC || m.pic || ''),
          duration: fmtDur((Number(m.DURATION) || 0) * 1000),
          durationSec: Number(m.DURATION) || 0,
          play: 0,
          danmaku: 0,
          qualities: [],
        } as MvItem
      })
      .filter(Boolean) as MvItem[]
  } catch {
    return []
  }
}

/** 统一入口：MV 关键词搜索（source Tab 决定平台，规格书 3.10） */
export async function searchMvBySource(source: string, keyword: string, page = 1): Promise<MvItem[]> {
  switch (source) {
    case 'wy':
      return searchWyMv(keyword, page)
    case 'qq':
      return searchQQMv(keyword, page)
    case 'kg':
      return searchKgMv(keyword, page)
    case 'kw':
      return searchKwMv(keyword, page)
    default:
      return []
  }
}
