import type { LyricResult, MvItem, PlaylistMeta, PlaylistTagGroup, Song, ToplistTree } from '../../shared/types'
import { parseLyric } from '../../shared/lrc'
import { createLogger } from './log'
import { lxHost } from './lx-host'
import {
  biliAudioUrl,
  biliParts,
  biliPlayUrl,
  biliVideoInfo,
  importPlaylistByLink,
  itunesCover,
  kugouPlaylistDetail,
  kugouPlaylists,
  kuwoPlaylists,
  miguPlaylists,
  neteaseNewPlaylists,
  neteaseNewSongs,
  neteasePlaylistDetail,
  neteasePlaylists,
  podcastEpisodes,
  qqPlaylistDetail,
  qqPlaylistTags,
  qqPlaylists,
  searchBiliVideo,
  searchKugou,
  searchNetease,
  searchQQ,
  toplistSongs,
  toplistTree,
} from './providers'
import { getJson, qs, request, UA } from './http'
import { resolveCoverUrl } from './cover'
import { biliHeaders, biliSubtitleLrc } from './bili'

const logger = createLogger('music')

const QUALITY_CHAIN: Record<string, string[]> = {
  flac24bit: ['flac24bit', 'flac', '320k', '128k'],
  flac: ['flac', '320k', '128k'],
  '320k': ['320k', '128k'],
  '128k': ['128k'],
}

function normName(s: string): string {
  return String(s || '')
    .toLowerCase()
    .replace(/[\s\-_·.,，。、'"“”‘’()（）[\]【】!！?？&+]/g, '')
    .replace(/feat\..*$/, '')
}

/** 去掉括号内的版本说明，提升跨平台匹配成功率 */
function baseName(s: string): string {
  return normName(
    String(s || '')
      .replace(/[（(\[【][^)）\]】]*[)）\]】]/g, '')
      .replace(/\s*[-–—]\s*(live|remix|cover|伴奏|翻自|原唱).*$/i, '')
  )
}

function mainSinger(s: string): string {
  return normName(String(s || '').split(/[\/、,;&]/)[0])
}

/** 洗掉 B 站分P标题里的「MV」「官方」「高清」「4K」「1080P」等噪声，只留歌名主体 */
function cleanBiliTitle(s: string): string {
  return String(s || '')
    .replace(/[（(\[【][^)）\]】]*[)）\]】]/g, ' ')
    .replace(/【[^】]*】/g, ' ')
    .replace(/\b(mv|m\/v|official|offical|lyric(s)?|video|hd|hq|4k|8k|1080p|720p|hi-?res|live|ver\.?|remix|cover)\b/gi, ' ')
    .replace(/(高音质|高清|无损|完整版|官方版|官方|原版|超清|付费|纯享版|纯享|字幕版|带歌词|歌词版|动态歌词|一首歌|神仙|宝藏)/g, ' ')
    .replace(/[-–—_~|/·]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

/** 按关键词相关度排序：原名优先、歌手命中优先，翻唱/DJ 版本降权 */
function rankByQuery(list: Song[], keyword: string): Song[] {
  const q = normName(keyword)
  if (!q) return list
  return list
    .map((s, i) => {
      let score = 0
      const n = normName(s.name)
      if (n === q) score += 120
      else if (n.startsWith(q) || q.startsWith(n)) score += 70
      else if (n.includes(q) || q.includes(n)) score += 35
      const singer = mainSinger(s.singer)
      if (singer && q.includes(singer)) score += 80
      if (s.source === 'wy') score += 5
      if (s.duration > 0) score += 3
      if (s.pic) score += 1
      if (/原唱|翻唱|cover|伴奏|dj|remix|片段|铃声|抖音/i.test(s.name)) score -= 10
      return { s, score, i }
    })
    .sort((a, b) => b.score - a.score || a.i - b.i)
    .map(x => x.s)
}

function dedupeKey(s: Song): string {
  return `${normName(s.name)}|${mainSinger(s.singer)}`
}

/** 多平台聚合搜索：原生接口保证可用性，插件补足曲库深度 */
export async function searchAll(
  keyword: string,
  page = 1,
  opts: { platform?: string; limit?: number } = {}
): Promise<Song[]> {
  const kw = String(keyword || '').trim()
  if (!kw) return []
  const limit = opts.limit ?? 60

  if (opts.platform) {
    // 指定平台：优先原生，再插件
    let native: Song[] = []
    try {
      if (opts.platform === 'wy') native = await searchNetease(kw, page, 40)
      else if (opts.platform === 'qq') native = await searchQQ(kw, page, 40)
      else if (opts.platform === 'kg') native = await searchKugou(kw, page, 40)
    } catch (e: any) {
      logger.warn('原生搜索失败', opts.platform, e?.message)
    }
    let plugin: Song[] = []
    try {
      plugin = await lxHost.search(kw, page, limit, { platform: opts.platform, perSourceCap: 30, waitMs: 3500 })
    } catch {
      /* ignore */
    }
    return mergeSongs(rankByQuery([...native, ...plugin], kw), limit)
  }

  const timed = async (name: string, p: Promise<Song[]>): Promise<Song[]> => {
    const t0 = performance.now()
    try {
      const r = await p
      logger.info(`搜索 ${name}`, `${Math.round(performance.now() - t0)}ms`, `${r.length} 条`)
      return r
    } catch (e: any) {
      logger.warn(`搜索 ${name} 失败`, `${Math.round(performance.now() - t0)}ms`, e?.message)
      return []
    }
  }
  const [wy, qq, kg, plugin] = await Promise.all([
    timed('wy', searchNetease(kw, page, 30)),
    timed('qq', searchQQ(kw, page, 20)),
    timed('kg', searchKugou(kw, page, 20)),
    timed('plugin', lxHost.search(kw, page, limit, { perSourceCap: 6, waitMs: 2600 })),
  ])
  return mergeSongs(rankByQuery([...wy, ...qq, ...kg, ...plugin], kw), limit)
}

function mergeSongs(list: Song[], limit: number): Song[] {
  const out: Song[] = []
  const seen = new Set<string>()
  const kw = ''
  for (const s of list) {
    if (!s || !s.name) continue
    const key = dedupeKey(s)
    if (!key || seen.has(key)) continue
    seen.add(key)
    out.push(s)
    if (out.length >= limit) break
  }
  return out
}

export interface ResolvedUrl {
  url: string
  quality: string
  matched?: Song
  via: string
}

/** 取播放地址：质量降级 → 自动换源 */
export async function resolveUrl(
  song: Song,
  quality: string,
  autoSwitch = true,
  avoidSources: string[] = []
): Promise<ResolvedUrl> {
  const chain = QUALITY_CHAIN[quality] || ['128k']
  const errors: string[] = []
  const skipPrimary = avoidSources.includes(song.source)

  // 播客单集：RSS 里的 enclosure 就是音频直链，直接用，不参与换源
  if (song.source === 'podcast') {
    const direct = String(song.extra?.url || '')
    if (!direct) throw new Error('该单集没有可播放的音频地址')
    return { url: direct, quality: '128k', via: '播客直链' }
  }

  if (song.source === 'bili' && !skipPrimary) {
    try {
      const bvid = String(song.extra?.bvid || song.songId.split('-p')[0])
      const cid = String(song.extra?.cid || '')
      if (!cid) throw new Error('缺少分 P 信息')
      return { url: await biliAudioUrl(bvid, cid), quality: '128k', via: 'B站直链' }
    } catch (e: any) {
      errors.push(`B站: ${e?.message || e}`)
    }
  }

  if (song.localPath) {
    return { url: song.localPath, quality: 'local', via: '本地文件' }
  }

  if (!skipPrimary) {
    for (const q of chain) {
      try {
        const r = await lxHost.resolveUrl(song, q)
        return { url: r.url, quality: q, via: r.from }
      } catch (e: any) {
        errors.push(`${q}: ${e?.message || e}`)
      }
    }
  }

  if (!autoSwitch) {
    throw new Error(`无法获取播放地址（${errors.slice(0, 2).join('；')}）`)
  }

  // 自动换源：按 歌名+歌手 搜索，取名称高度相似的候选
  const target = baseName(song.name)
  const altTarget = normName(song.name)
  let candidates: Song[] = []
  try {
    candidates = await searchAll(`${song.name} ${String(song.singer).split('/')[0]}`, 1, { limit: 24 })
  } catch {
    candidates = []
  }
  const pick = candidates
    .filter(c => c.id !== song.id && !avoidSources.includes(c.source))
    .filter(c => {
      const b = baseName(c.name)
      return b === target || b === altTarget || (b.length > 1 && target.includes(b)) || (target.length > 1 && b.includes(target))
    })
    .slice(0, 4)
  for (const c of pick) {
    for (const q of ['128k', '320k']) {
      try {
        const r = await lxHost.resolveUrl(c, q)
        logger.info(`自动换源成功：${song.name} -> ${c.source}/${c.name}`)
        return { url: r.url, quality: q, matched: c, via: `${r.from}（换源）` }
      } catch {
        /* 下一个 */
      }
    }
  }
  throw new Error(
    `该歌曲暂时无法播放：${errors.slice(0, 2).join('；') || '所有音源均取链失败'}。可在设置中更换音源或重试`
  )
}

/** 歌词：插件 → 平台官方 → 同名搜索兜底 */
const lyricCache = new Map<string, LyricResult>()

async function wyLyric(id: string): Promise<string> {
  const res = await getJson<any>(
    `https://music.163.com/api/song/lyric?id=${encodeURIComponent(id)}&lv=-1&kv=-1&tv=-1`,
    { 'User-Agent': UA, Referer: 'https://music.163.com/', Cookie: 'os=pc' },
    10000
  )
  const lrc = res?.lrc?.lyric || ''
  const trans = res?.tlyric?.lyric || ''
  return lrc ? lrc + (trans ? '\n' + trans : '') : ''
}

async function qqLyric(mid: string): Promise<string> {
  const url = `https://c.y.qq.com/lyric/fcgi-bin/fcg_query_lyric_new.fcg?${qs({
    songmid: mid,
    format: 'json',
    nobase64: 1,
    g_tk: 5381,
  })}`
  const res = await request(url, {
    headers: { 'User-Agent': UA, Referer: 'https://y.qq.com/portal/player.html' },
    timeout: 10000,
  })
  let body: any = res.body
  if (typeof body === 'string') {
    const m = body.match(/\{[\s\S]*\}/)
    body = m ? JSON.parse(m[0]) : null
  }
  const lrc = body?.lyric || ''
  return typeof lrc === 'string' ? lrc.replace(/&#(\d+);/g, (_: string, d: string) => String.fromCharCode(Number(d))) : ''
}

/** 酷狗歌词：按 hash 取 krc 候选，再下载 lrc 文本（base64） */
async function kugouLyric(hash: string): Promise<string> {
  if (!hash) return ''
  const headers = { 'User-Agent': UA, Referer: 'https://www.kugou.com/' }
  const search = await getJson<any>(
    `https://krcs.kugou.com/search?${qs({ ver: 1, man: 'yes', client: 'mobi', keyword: '', duration: '', hash })}`,
    headers,
    10000
  )
  const cand = (search?.candidates || [])[0]
  if (!cand?.id || !cand?.accesskey) return ''
  const data = await getJson<any>(
    `https://lyrics.kugou.com/download?${qs({
      ver: 1,
      client: 'pc',
      id: cand.id,
      accesskey: cand.accesskey,
      fmt: 'lrc',
      charset: 'utf8',
    })}`,
    headers,
    10000
  )
  if (!data?.content) return ''
  try {
    return Buffer.from(String(data.content), 'base64').toString('utf8')
  } catch {
    return ''
  }
}

/** 歌词：插件 → 平台官方 → 网易云同名匹配，多路候选取行数最多的一份 */
export async function getLyric(song: Song): Promise<LyricResult> {
  const empty: LyricResult = { lines: [], raw: '', offset: 0, hasTrans: false, hasWordByWord: false }
  if (!song) return empty
  const cached = lyricCache.get(song.id)
  if (cached) return cached

  const cands: { raw: string; source: string }[] = []
  const push = (raw: string, source: string) => {
    if (raw && raw.trim().length > 20) cands.push({ raw, source })
  }

  // 本地音乐：内嵌歌词 / 同名 .lrc 优先
  if (song.source === 'local') {
    const embedded = String(song.extra?.lyrics || '')
    if (embedded.trim()) push(embedded, '内嵌歌词')
    if (song.localPath) {
      try {
        const fs = await import('node:fs')
        const path = await import('node:path')
        const lrcPath = song.localPath.replace(path.extname(song.localPath), '.lrc')
        if (fs.existsSync(lrcPath)) push(fs.readFileSync(lrcPath, 'utf8'), '同目录歌词')
      } catch {
        /* ignore */
      }
    }
    const parsedLocal = cands.map(c => ({ c, p: parseLyric(c.raw) })).find(x => x.p.lines.length)
    if (parsedLocal) {
      const res: LyricResult = {
        lines: parsedLocal.p.lines,
        raw: parsedLocal.c.raw,
        source: parsedLocal.c.source,
        offset: parsedLocal.p.offset,
        hasTrans: parsedLocal.p.lines.some(l => !!l.trans),
        hasWordByWord: parsedLocal.p.hasWordByWord,
      }
      lyricCache.set(song.id, res)
      return res
    }
    // 本地纯音乐不做同名猜测，避免匹配到错误歌词
    return empty
  }

  try {
    push(await lxHost.getLyric(song), '音源插件')
  } catch {
    /* 插件歌词失败继续 */
  }

  if (song.source === 'kg') {
    try {
      push(await kugouLyric(String(song.extra?.hash || song.songId)), '在线音源')
    } catch {
      /* ignore */
    }
  } else if (song.source === 'qq') {
    try {
      push(await qqLyric(String(song.extra?.songmid || song.songId)), '在线音源')
    } catch {
      /* ignore */
    }
  } else if (song.source === 'wy') {
    try {
      push(await wyLyric(song.songId), '在线音源')
    } catch {
      /* ignore */
    }
  } else if (song.source === 'bili') {
    // 视频源：先用 B 站自带字幕（CC 字幕/UP 主上传），未登录或无字幕时退回名字匹配
    try {
      push(await biliSubtitleLrc(String(song.extra?.bvid || ''), String(song.extra?.cid || '')), '视频字幕')
    } catch {
      /* ignore */
    }
  }

  if (song.source !== 'wy' && cands.every(c => c.source === '音源插件' || c.source === '视频字幕')) {
    try {
      // 视频分P标题常带「MV」「官方」「4K」等噪声，先洗一遍再拿去匹配，命中率明显更高
      const key = song.source === 'bili' ? cleanBiliTitle(song.name) : song.name
      const list = await searchNetease(`${key} ${String(song.singer).split('/')[0]}`, 1, 6)
      const cand =
        list.find(x => song.duration > 30 && Math.abs(x.duration - song.duration) < 12) ||
        list.find(
          x => normName(x.name) === normName(key) && normName(x.singer).includes(mainSinger(song.singer))
        )
      if (cand) push(await wyLyric(cand.songId), '在线音源')
    } catch {
      /* ignore */
    }
  }

  let best: LyricResult | null = null
  // 动态来源列表：所有参与过候选的来源（去重、保持顺序）
  const sources: string[] = []
  for (const c of cands) {
    const parsed = parseLyric(c.raw)
    if (!parsed.lines.length) continue
    if (!sources.includes(c.source)) sources.push(c.source)
    const res: LyricResult = {
      lines: parsed.lines,
      raw: c.raw,
      source: c.source,
      offset: parsed.offset,
      hasTrans: parsed.lines.some(l => !!l.trans),
      hasWordByWord: parsed.hasWordByWord,
    }
    if (!best || res.lines.length > best.lines.length) best = res
  }

  if (!best) return empty
  best.sources = sources
  if (lyricCache.size > 300) {
    const first = lyricCache.keys().next().value
    if (first) lyricCache.delete(first)
  }
  lyricCache.set(song.id, best)
  logger.info('歌词匹配成功', song.name, best.source, best.lines.length + ' 行')
  return best
}

export async function getCover(song: Song): Promise<string> {
  return resolveCoverUrl(song)
}

/**
 * 各音源推荐的歌单列表。
 * 目前只有网易云（wy）实现分类标签；其他音源走各自的「推荐/最新」通道。
 * 带进程内缓存：发现页切换标签/音源时命中缓存直接返回，避免每次都打上游（首屏延迟主要来源）。
 */
const PL_TTL = 10 * 60 * 1000
/** 空结果只缓存很短时间：上游可能只是临时风控/限流，过期后重试 */
const PL_EMPTY_TTL = 60 * 1000
const plCache = new Map<string, { at: number; list: PlaylistMeta[] }>()
/** 在飞请求去重：快速来回切标签时同一 key 只打一次上游 */
const plInflight = new Map<string, Promise<PlaylistMeta[]>>()

export async function getPlaylists(
  cat: string,
  order: string,
  page: number,
  source = 'wy'
): Promise<PlaylistMeta[]> {
  const key = `${source}|${cat}|${order}|${page}`
  const hit = plCache.get(key)
  if (hit && Date.now() - hit.at < (hit.list.length ? PL_TTL : PL_EMPTY_TTL)) return hit.list
  const inflight = plInflight.get(key)
  if (inflight) return inflight
  const task = fetchPlaylists(cat, order, page, source)
    .then(list => {
      plCache.set(key, { at: Date.now(), list })
      // 简单的容量保护：条目过多时清掉最早的
      if (plCache.size > 120) {
        const oldest = [...plCache.entries()].sort((a, b) => a[1].at - b[1].at)[0]
        if (oldest) plCache.delete(oldest[0])
      }
      return list
    })
    .finally(() => plInflight.delete(key))
  plInflight.set(key, task)
  return task
}

async function fetchPlaylists(cat: string, order: string, page: number, source: string): Promise<PlaylistMeta[]> {
  if (source === 'qq') return qqPlaylists(cat, order, page)
  if (source === 'kg') return kugouPlaylists(cat, order, page)
  if (source === 'kw') return kuwoPlaylists(cat, order, page)
  if (source === 'mg') return miguPlaylists(cat, order, page)
  // wy：「最新」走精品歌单通道（api/playlist/list 上游已忽略 order，只有
  // highquality/list 能按 createTime 取到较新的列表，见 providers.ts wyPlaylistPage 注释）
  if (order === 'new') return neteaseNewPlaylists(cat, page)
  return neteasePlaylists(cat, order, page)
}

/** 歌单分类标签（按音源）；无标签体系的上游返回空数组，由前端隐藏标签入口 */
export async function getPlaylistTags(source = 'wy'): Promise<PlaylistTagGroup[]> {
  if (source === 'qq') return qqPlaylistTags()
  return []
}

export async function getPlaylistDetail(
  id: string,
  source: string
): Promise<{ name: string; pic: string; description: string; songs: Song[] }> {
  if (source === 'qq') return qqPlaylistDetail(id)
  if (source === 'kg') return kugouPlaylistDetail(id)
  return neteasePlaylistDetail(id)
}

export async function getToplistTree(): Promise<ToplistTree> {
  return toplistTree()
}

export async function getToplist(platform: string, id: string): Promise<{ name: string; songs: Song[] }> {
  return toplistSongs(platform, id)
}

export async function getNewSongs(): Promise<Song[]> {
  return neteaseNewSongs(12)
}

export async function importPlaylist(input: string, platform?: string) {
  return importPlaylistByLink(input, platform)
}

export async function searchMv(keyword: string, page = 1): Promise<MvItem[]> {
  return searchBiliVideo(keyword, page)
}

export async function getMvInfo(bvid: string) {
  return biliVideoInfo(bvid)
}

export async function getMvParts(bvid: string) {
  return biliParts(bvid)
}

export async function getMvUrl(bvid: string, cid: string, qn?: number) {
  return biliPlayUrl(bvid, cid, qn)
}

export async function itunesFallbackCover(term: string): Promise<string> {
  return itunesCover(term)
}

/** 播客单集：把 RSS 解析成可播放的 Song[]，交给现有播放器内置播放 */
export async function getPodcastEpisodes(feed: string, limit = 100): Promise<Song[]> {
  return podcastEpisodes(feed, limit)
}
