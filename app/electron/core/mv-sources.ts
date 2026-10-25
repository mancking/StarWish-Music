import type { MvItem } from '../../shared/types'
import { getJson, qs, request } from './http'
import { createLogger } from './log'

/**
 * MV 多音源
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

/** 歌曲相关 MV ：网易云歌曲 cloudsearch 返回 mv 字段 */
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

/**
 * QQ GetMvUrls（gosrf.Stream.MvUrlProxy）：返回各档 mp4
 *
 * 请求体必须是 `vids: [...]` + `request_typet: '10001'`（单 vid 的 `vid` 字段
 * 会返回 code 10000 / data null）。响应形如 data[vid].mp4[]，
 * 每档的地址在 freeflow_url / url 数组里；匿名态可能全为空数组
 * （平台要求登录 Q音 账号才下发直链），此时抛可读错误由渲染层提示。
 */
async function qqMvUrls(vid: string): Promise<QqMvUrls> {
  const payload = {
    comm: { ct: 11, cv: '1003006', v: '1003006', tmeAppID: 'qqmusic', uin: '0', format: 'json' },
    req: {
      module: 'gosrf.Stream.MvUrlProxy',
      method: 'GetMvUrls',
      param: { vids: [vid], request_typet: '10001' },
    },
  }
  const res = await request('https://u.y.qq.com/cgi-bin/musicu.fcg', {
    method: 'POST',
    headers: { ...QQ_HEADERS, 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
    timeout: 8000,
  })
  const node = res.body?.req?.data?.[vid] || {}
  const list: any[] = node.mp4 || []
  const byQn: { qn: number; label: string; url: string }[] = []
  for (const item of list) {
    const url = String(item?.freeflow_url?.[0] || item?.url?.[0] || item?.comm_url?.[0] || '')
    if (!url) continue
    // filetype: 10/20/30/40 对应 480/720/1080/... 档位（与 cn 字段一致）
    const ft = Number(item?.filetype || item?.newFileType || 0)
    const qn = ft >= 40 ? 1080 : ft >= 30 ? 1080 : ft >= 20 ? 720 : 480
    if (byQn.some(x => x.qn === qn)) continue
    byQn.push({ qn, label: `${qn}P`, url })
  }
  byQn.sort((a, b) => a.qn - b.qn)
  if (!byQn.length) {
    throw new Error('Q音 MV 直链需要登录 Q音 账号才能获取；可先在「设置 → 账号」绑定，或改用 B站/云村 源播放')
  }
  return { url: byQn[byQn.length - 1]!.url, qn: byQn[byQn.length - 1]!.qn, qualities: byQn.map(x => ({ qn: x.qn, label: x.label })) }
}

/**
 * QQ MV 搜索
 *
 * 旧实现走 musicu.fcg 的 music.search.SearchCgi + search_type=4，
 * 实测恒返回 code 500003（subcode 860100001），条目永远为空 —— 这是
 * 「QQ 没有找到相关视频」的直接原因。
 * 现改用 web 搜索老接口 client_search_cp + t=12（MV 频道），实测可用：
 *   返回 data.mv.list[]，字段 mv_id / v_id / mv_name / mv_pic_url / singer_name / duration / play_count
 * 其中 **v_id 才是 GetMvUrls 需要的 vid**（mv_id 是数字稿件 id，不能取链）。
 */
export async function searchQQMv(keyword: string, page = 1, limit = 20): Promise<MvItem[]> {
  // 关键：参数必须精简。实测带上 new_json/aggr/catZhida/remoteplace 等
  // web 页面参数后接口会静默返回 totalnum=0（不是报错，是空结果），
  // 只保留 p/n/w/t/format 才稳定出结果。
  const url =
    'https://c.y.qq.com/soso/fcgi-bin/client_search_cp?' +
    qs({ p: Math.max(1, page), n: limit, w: keyword, t: 12, format: 'json' })
  try {
    const res = await request(url, { headers: QQ_HEADERS, timeout: 8000 })
    const raw = String(res.raw || '').trim()
    // 兼容 JSONP 包装（callback({...})）
    const json = raw.startsWith('callback(') ? raw.slice(9, raw.lastIndexOf(')')) : raw
    const body = JSON.parse(json)
    const list: any[] = body?.data?.mv?.list || []
    return list
      .map((m: any) => {
        // v_id 是取链 vid（GetMvUrls 用它）；mv_id 只是数字稿件 id
        const vid = String(m.v_id || m.vid || '')
        const mvId = String(m.mv_id || m.watchid || vid)
        if (!vid && !mvId) return null
        return {
          source: 'qq',
          sourceId: vid || mvId,
          title: String(m.mv_name || m.mvname || m.title || ''),
          author: String(
            m.singer_name || m.singerName || (m.singer_list || []).map((x: any) => x.name).join('/') || ''
          ),
          pic: String(m.mv_pic_url || m.mvpic || '').replace(/^\/\//, 'https://'),
          duration: fmtDur((Number(m.duration) || 0) * 1000),
          durationSec: Number(m.duration) || 0,
          play: Number(m.play_count || 0) || 0,
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

/** 歌曲 → 相关 MV ：QQ smartbox 返回 vid 条目 */
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

/**
 * 酷狗 MV 搜索
 *
 * 旧接口 m3ws.kugou.com/v3/mv/search 返回纯文本 "No Action Found!"（接口已下线），
 * 导致酷狗恒为空。现改用移动端检索接口 mobiles.kugou.com/api/v3/search/mv（实测可用）：
 *   data.info[] → hash（MV hash，取链/详情用）/ filename / singername / imgurl / duration / historyheat
 * imgurl 形如 http://imge.kugou.com/mvhdpic/{size}/xxx.jpg，需把 {size} 换成像素档（480）。
 */
export async function searchKgMv(keyword: string, page = 1, limit = 20): Promise<MvItem[]> {
  const endpoints = [
    `https://mobiles.kugou.com/api/v3/search/mv?${qs({ keyword, page, pagesize: limit, showtype: 1 })}`,
    `https://msearchcdn.kugou.com/api/v3/search/mv?${qs({ keyword, page, pagesize: limit, showtype: 1 })}`,
  ]
  for (const url of endpoints) {
    try {
      const body = await getJson<any>(url, { 'User-Agent': 'Mozilla/5.0' }, 6000)
      const list: any[] = body?.data?.info || body?.data?.lists || []
      if (!list.length) continue
      return list.map((m: any) => ({
        source: 'kg',
        sourceId: String(m.hash || m.mvhash || m.video_id || ''),
        title: String(m.filename || m.mvname || m.songname || ''),
        author: String(m.singername || ''),
        pic: String(m.imgurl || m.img || '')
          .replace(/^\/\//, 'https://')
          .replace('{size}', '480'),
        duration: fmtDur((Number(m.duration) || 0) * 1000),
        durationSec: Number(m.duration) || 0,
        play: Number(m.historyheat || m.playcount || m.count) || 0,
        danmaku: 0,
        qualities: [],
      })) as MvItem[]
    } catch (e: any) {
      logger.warn('酷狗 MV 搜索失败', e?.message)
    }
  }
  return []
}

/**
 * 酷我 MV 搜索（平台侧接口下线后的兜底）
 *
 * 现状（2026-10-25 实测）：酷我官方 MV 检索链路已不可用 ——
 *   · search.kuwo.cn/r.s?ft=mv 恒返回 TOTAL=0（含 stype=mvlist / artistid 变体）
 *   · www.kuwo.cn/api/www/search/searchMvBykeyWord 需 kw_token + JS 反爬指纹，服务端 403「illegal」
 *   · mv.kuwo.cn 302 到 www.kuwo.cn/mvs
 * 唯一仍可取的是 MV 页 SSR 里内嵌的 mvList（热门 MV），因此这里退化为
 * 「官方 MV 列表 + 关键词相关度过滤」：命中标题/歌手才返回，未命中返回空。
 * 不伪造数据、不跨平台顶替。
 */
export async function searchKwMv(keyword: string, page = 1, limit = 20): Promise<MvItem[]> {
  if (page > 1) return []
  try {
    const res = await request(`https://www.kuwo.cn/mvs?${qs({ key: keyword })}`, {
      headers: {
        'User-Agent':
          'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36',
        Referer: 'https://www.kuwo.cn/',
      },
      timeout: 9000,
    })
    const html = String(res.raw || '')
    const list = parseKuwoMvList(html)
    if (!list.length) return []
    const kw = String(keyword || '').trim().toLowerCase()
    const hits = kw
      ? list.filter(m => `${m.name} ${m.artist}`.toLowerCase().includes(kw))
      : list
    return hits.slice(0, limit).map(m => ({
      source: 'kw',
      sourceId: String(m.id),
      title: String(m.name || ''),
      author: String(m.artist || ''),
      pic: String(m.pic || '').replace(/^\/\//, 'https://'),
      duration: fmtDur((Number(m.duration) || 0) * 1000),
      durationSec: Number(m.duration) || 0,
      play: Number(m.mvPlayCnt) || 0,
      danmaku: 0,
      qualities: [],
    })) as MvItem[]
  } catch (e: any) {
    logger.warn('酷我 MV 搜索失败', e?.message)
    return []
  }
}

interface KuwoMvRow {
  id: number | string
  name: string
  artist: string
  pic: string
  duration: number
  mvPlayCnt: number
}

/**
 * 从酷我 MV 页 SSR 的 window.__NUXT__ 里抠出 mvList。
 * 该 payload 是 JS 函数体（含变量别名），不是合法 JSON，
 * 因此按对象字面量逐条正则提取，只取 id/name/artist/pic/duration/mvPlayCnt。
 */
function parseKuwoMvList(html: string): KuwoMvRow[] {
  const i = html.indexOf('mvList:[')
  if (i < 0) return []
  // mvList 之后到下一个顶层 key（大约 40KB）足够覆盖整段
  const seg = html.slice(i, i + 40000)
  const out: KuwoMvRow[] = []
  const re =
    /\{duration:(\d+),artist:(?:"([^"]*)"|([a-z]),?){0,1}[^}]*?name:"([^"]*)"[^}]*?id:(\d+),pic:"([^"]*)"/g
  let m: RegExpExecArray | null
  while ((m = re.exec(seg))) {
    const pic = String(m[6] || '').replace(/\\u002F/g, '/')
    out.push({
      id: m[5]!,
      name: m[4]!,
      artist: m[2] || '',
      pic,
      duration: Number(m[1]) || 0,
      mvPlayCnt: 0,
    })
  }
  return out
}

/** 统一入口：MV 关键词搜索（source 决定平台；不支持的平台返回空） */
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

/* ============================ 四平台聚合（~172） ============================ */

/** 参与聚合的 MV 平台顺序：可播源优先（B站 > 云村 > Q音 > 酷狗 > 酷我） */
export const MV_AGG_SOURCES = ['bili', 'wy', 'qq', 'kg', 'kw'] as const

/** 去重用的标题归一：去括号注释、MV/官方/高清等噪声、标点与空格 */
function normKey(title: string, author: string): string {
  const t = String(title || '')
    .toLowerCase()
    .replace(/[（(\[【].*?[)）\]】]/g, ' ')
    .replace(/\b(mv|m\/v|official|video|hd|hq|4k|8k|1080p|720p|live|ver\.?|remix|cover)\b/g, ' ')
    .replace(/[\s\p{P}\p{S}]+/gu, '')
  const a = String(author || '')
    .toLowerCase()
    .replace(/[\s\p{P}\p{S}]+/gu, '')
  return `${t}|${a}`
}

/**
 * 聚合去重 + 轮转交织。
 * 轮转（round-robin）保证首屏各平台都有露出，而不是被单一平台刷满；
 * 去重按「归一标题 + 归一歌手」，同一首歌的多平台版本只留优先级最高的那个。
 */
export function mergeMvLists(buckets: { source: string; list: MvItem[] }[]): MvItem[] {
  const seen = new Set<string>()
  const out: MvItem[] = []
  const queues = buckets.map(b => ({ source: b.source, items: [...b.list] }))
  let guard = 0
  while (queues.some(q => q.items.length) && guard < 5000) {
    guard++
    for (const q of queues) {
      const item = q.items.shift()
      if (!item) continue
      const key = normKey(item.title, item.author)
      if (seen.has(key)) continue
      seen.add(key)
      out.push({ ...item, source: item.source || q.source })
    }
  }
  return out
}

/** 单源检索预算：超时即视为无结果，绝不让某一平台拖死整页 */
const PER_SOURCE_MS = 5000
/** 聚合整体预算：真机上原生 HTTP 偶发不返回，必须有硬上限 */
const AGG_TOTAL_MS = 7000

function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  return Promise.race([
    p,
    new Promise<T>((_, rej) => setTimeout(() => rej(new Error(`MV 源检索超时(${ms}ms)`)), ms)),
  ])
}

/** 四平台并发聚合搜索（单源失败/超时不影响整体） */
export async function searchMvAggregated(
  keyword: string,
  page = 1,
  biliSearch: (kw: string, page: number) => Promise<MvItem[]>
): Promise<MvItem[]> {
  const tasks = MV_AGG_SOURCES.map(async src => {
    try {
      const list =
        src === 'bili'
          ? await withTimeout(biliSearch(keyword, page), PER_SOURCE_MS)
          : await withTimeout(searchMvBySource(src, keyword, page), PER_SOURCE_MS)
      return { source: src, list }
    } catch {
      return { source: src, list: [] as MvItem[] }
    }
  })
  // 整体再包一层：任一台词/网络异常都不能让 IPC 永不返回（真机曾整页挂死）
  const buckets = await withTimeout(Promise.all(tasks), AGG_TOTAL_MS).catch(() =>
    MV_AGG_SOURCES.map(src => ({ source: src, list: [] as MvItem[] }))
  )
  return mergeMvLists(buckets)
}
