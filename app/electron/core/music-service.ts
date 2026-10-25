import type { LyricResult, MvItem, PlaylistMeta, PlaylistTagGroup, Song, ToplistTree } from '../../shared/types'
import { parseLyric } from '../../shared/lrc'
import fs from 'node:fs'
import { createLogger } from './log'
import { lxHost } from './lx-host'
import { backfillCovers } from './recommend'
import { broadcast } from '../windows'
import { coverProtocolUrl } from './cover'
import {
  searchMvAggregated,
  searchMvBySource,
  wyMvBySong,
  wyMvDetail,
  wyMvUrl,
  qqMvBySong,
  qqMvDetail,
  qqMvUrl,
} from './mv-sources'
import {
  biliAudioUrl,
  biliParts,
  biliPlayUrl,
  biliVideoInfo,
  importPlaylistByLink,
  itunesCover,
  kugouPlaylistDetail,
  kugouPlaylists,
  kugouSearchPlaylists,
  kuwoSearchPlaylists,
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
  searchPlaylists,
  searchQQ,
  toplistSongs,
  toplistTree,
} from './providers'
import { getJson, qs, request, UA } from './http'

/**
 * 取链结果有效性校验（对齐 lx-music-mobile/MusicFree 实践）
 * 部分直链对失效/下架/付费曲目返回 HTML 错误页（HTTP 200），
 * <audio> 加载到 code 4「音频地址或格式错误」。返回前先探一次格式：
 * content-type 为 audio/* 或 octet-stream（且非 HTML）才算可用；探测网络异常不拦截（保守放行）。
 */
async function isPlayableAudioUrl(url: string): Promise<boolean> {
  if (!/^https?:\/\//i.test(url)) return true // 本地路径/代理路径不拦截
  if (url.startsWith('swmedia:') || url.startsWith('/swmedia')) return true
  try {
    const res = await request(url, { method: 'GET', headers: { Range: 'bytes=0-63', 'User-Agent': UA }, timeout: 6000, retry: 0, binary: true })
    const ct = String(res.headers['content-type'] || '')
    if (ct.includes('text/html') || ct.includes('application/json') || ct.includes('text/plain')) return false
    if (ct.includes('audio') || ct.includes('mpeg') || ct.includes('octet-stream') || ct.includes('video/mp2t') || ct === '') return true
    // 未知 content-type：看 magic（ID3/MP3 sync/FLAC/Ogg/M4A）
    const raw = res.bytes || res.raw || ''
    const head = typeof raw === 'string' ? raw.slice(0, 8) : Buffer.from(raw as any).toString('latin1').slice(0, 8)
    return /^(ID3|\xff\xfb|\xff\xf3|fLaC|OggS)/.test(head) || head.includes('ftyp')
  } catch {
    return true
  }
}
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
    const merged = mergeSongs(rankByQuery([...native, ...plugin], kw), limit)
    patchCoversAsync(merged)
    return merged
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
 // 搜索耗时治理：插件源是长尾，不能拖住首屏。
  // 原生三源先并行拿；插件只给 1200ms 预算，且原生已够 12 条时直接不等插件。
  const nativeP = Promise.all([
    timed('wy', searchNetease(kw, page, 30)),
    timed('qq', searchQQ(kw, page, 20)),
    timed('kg', searchKugou(kw, page, 20)),
  ])
  const pluginP = timed('plugin', lxHost.search(kw, page, limit, { perSourceCap: 6, waitMs: 1200 }))
  const [wy, qq, kg] = await nativeP
  const nativeCount = wy.length + qq.length + kg.length
  const plugin = nativeCount >= 12 ? [] : await Promise.race([
    pluginP,
    new Promise<Song[]>(r => setTimeout(() => r([]), 1200)),
  ])
  const merged = mergeSongs(rankByQuery([...wy, ...qq, ...kg, ...plugin], kw), limit)
 // 实时补封面：wy 搜索只给 picId、kg 公开接口不给封面、QQ smartbox 无专辑图。
  // 关键点：**不阻塞搜索返回** —— 列表先出来，封面回填完成后用 cover:patched 事件
  // 把 URL 补进界面（渲染层按 song.id 打补丁）。这样「封面实时」与「搜索不卡」兼得。
  patchCoversAsync(merged)
  return merged
}

/**
 * 异步补封面：回填完成后广播增量，渲染层就地打补丁。
 * 不 await，避免把搜索延迟从 ~2s 拖到 ~7s。
 */
function patchCoversAsync(list: Song[]): void {
  if (!list.length) return
  const push = (batch: Song[]): void => {
    // 统一走 swcover 代理：注入 Referer 防 403 + 落盘缓存（与列表其它封面同链路）
    const patch = batch
      .filter(s => s.pic)
      .map(s => {
        const pic = String(s.pic || '')
        return { id: s.id, pic: /^https?:\/\//i.test(pic) ? coverProtocolUrl(pic) : pic }
      })
    if (patch.length) broadcast('cover:patched', patch)
  }
  // 先把手头已有的封面立刻推一次，界面不用等任何网络
  push(list)
  // 再按批增量推（每批补完就发，不等全部完成；单批失败不影响其它批）
  void backfillCovers(list, push).catch(() => undefined)
}

function mergeSongs(list: Song[], limit: number): Song[] {
  const out: Song[] = []
  const seen = new Set<string>()
  for (const s of list) {
    if (!s || !s.name) continue
 // 音源脏数据清洗：歌名尾巴 '.null'/'.undefined'/多余点号（如「大笑江湖主题曲.null」）
    s.name = String(s.name)
      .replace(/\.(null|undefined|NaN)\s*$/i, '')
      .replace(/\s*\.\s*$/, '')
      .trim() || s.name
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

/**
 * 按曲记录的失败源文件（精准换源）。
 *
 * 旧实现的失败记录是**平台级**（failedSources 记 song.source 如 'wy'），重试时
 * skipPrimary 把整个平台的取链（含 lxHost 内部跨源降级）全部跳过，直接进入
 * 网络搜索换源 —— 慢，且同平台歌曲的候选会被全部过滤，表现为「不切换音源」。
 * 现在记录**源文件级**（lxHost 错误对象带回的 triedFiles），重试时传给
 * lxHost.resolveUrl({avoidFiles}) 精准跳过坏源，同平台其他源与跨平台降级照常参与。
 */
const failedFilesBySong = new Map<string, Set<string>>()
const FAILED_FILES_CAP = 400

function songFailKey(song: Song): string {
  return `${song.source}:${song.songId || song.id || song.name}_${song.singer || ''}`.slice(0, 200)
}

function recordFailedFiles(song: Song, files: string[] | undefined): void {
  if (!files?.length) return
  const key = songFailKey(song)
  let set = failedFilesBySong.get(key)
  if (!set) {
    // 简单防膨胀：超过容量时清最旧的一半
    if (failedFilesBySong.size >= FAILED_FILES_CAP) {
      let n = 0
      for (const k of failedFilesBySong.keys()) {
        if (n++ > FAILED_FILES_CAP / 2) break
        failedFilesBySong.delete(k)
      }
    }
    set = new Set()
    failedFilesBySong.set(key, set)
  }
  for (const f of files) if (f && set.size < 32) set.add(f)
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
  const failKey = songFailKey(song)
  /** 历史失败源文件：重试时精准排除，而不是整平台跳过 */
  const avoidFiles = [...(failedFilesBySong.get(failKey) || [])]

  // 播客单集：RSS 里的 enclosure 就是音频直链，直接用，不参与换源
  if (song.source === 'podcast') {
    const direct = String(song.extra?.url || '')
    if (!direct) throw new Error('该单集没有可播放的音频地址')
    return { url: direct, quality: '128k', via: '播客直链' }
  }

  if (song.source === 'bili') {
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
    // 移动端扫描到的是 MediaStore 的 content:// URI，WebView 无法直接播放，
 // 改走原生 SwMediaClient 的 /swlocal/?id=<mediaId> 流式回放。
    const lp = song.localPath
    if (lp.startsWith('content://')) {
      const mediaId = lp.split('/').pop() || ''
      return { url: `/swlocal/?id=${encodeURIComponent(mediaId)}`, quality: 'local', via: '本地文件' }
    }
    return { url: lp, quality: 'local', via: '本地文件' }
  }

  {
    for (const q of chain) {
      try {
        const r = await lxHost.resolveUrl(song, q, { avoidFiles })
        if (await isPlayableAudioUrl(r.url)) {
          if (r.file) {
            // 成功：清掉该曲的失败记录（音源可能已恢复）
            failedFilesBySong.delete(failKey)
          }
          return { url: r.url, quality: q, via: r.from }
        }
        errors.push(`${q}: 地址不可用（返回非音频内容）`)
      } catch (e: any) {
        // 记录本轮实际尝试过的坏源文件，重试时精准排除（平台级粒度太粗）
        recordFailedFiles(song, e?.triedFiles)
        errors.push(`${q}: ${e?.message || e}`)
      }
    }
  }

  if (!autoSwitch) {
    throw new Error(`无法获取播放地址（${errors.slice(0, 2).join('；')}）`)
  }

  // 自动换源：按 歌名+歌手 搜索，取名称高度相似的候选
  // 注意：avoidSources（平台级）只用于排除与原曲完全同平台的候选；
  // 若排除后没有任何候选，则放宽平台排除（换源优先于平台偏好）。
  const target = baseName(song.name)
  const altTarget = normName(song.name)
  let candidates: Song[] = []
  try {
    candidates = await searchAll(`${song.name} ${String(song.singer).split('/')[0]}`, 1, { limit: 24 })
  } catch {
    candidates = []
  }
  const nameMatch = (c: Song): boolean => {
    const b = baseName(c.name)
    return b === target || b === altTarget || (b.length > 1 && target.includes(b)) || (target.length > 1 && b.includes(target))
  }
  let pick = candidates
    .filter(c => c.id !== song.id && !avoidSources.includes(c.source))
    .filter(nameMatch)
    .slice(0, 4)
  if (!pick.length) {
    // 平台排除后无候选：放宽为全平台候选（保证「切换音源」始终有出路）
    pick = candidates.filter(c => c.id !== song.id).filter(nameMatch).slice(0, 4)
  }
  for (const c of pick) {
    for (const q of ['128k', '320k']) {
      try {
        const r = await lxHost.resolveUrl(c, q)
        if (!(await isPlayableAudioUrl(r.url))) continue
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

/**本地歌词编码探测 —— UTF-8 失败回退 GBK/BIG5（车机乱码修复） */
function readLrcSmart(p: string): string {
  const buf = fs.readFileSync(p)
  const utf8 = buf.toString('utf8')
  // UTF-8 解码遇到非法字节会产生 U+FFFD；出现替换符则尝试 GBK
  if (!utf8.includes('�')) return utf8
  try {
    // Node 内置不支持 gbk：用 iconv-lite 不可得时做 BOM/UTF-16 探测，最终退回 utf8
    if (buf[0] === 0xff && buf[1] === 0xfe) return buf.toString('utf16le')
    if (buf[0] === 0xfe && buf[1] === 0xff) {
      const be = Buffer.from(buf)
      be.swap16()
      return be.toString('utf16le')
    }
  } catch {
    /* ignore */
  }
  return utf8
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
        if (fs.existsSync(lrcPath)) push(readLrcSmart(lrcPath), '同目录歌词')
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
 // 酷狗/酷我无可用「标签 → 歌单」通道：分类名改走歌单关键词检索，
  // 这样这两个平台的分类筛选才真的能筛出东西，而不是点完空列表
  if (source === 'kg') return cat && cat !== '全部' ? kugouSearchPlaylists(cat, page) : kugouPlaylists(cat, order, page)
  if (source === 'kw') return cat && cat !== '全部' ? kuwoSearchPlaylists(cat, page) : kuwoPlaylists(cat, order, page)
  if (source === 'mg') return miguPlaylists(cat, order, page)
  // wy：「最新」走精品歌单通道（api/playlist/list 上游已忽略 order，只有
  // highquality/list 能按 createTime 取到较新的列表，见 providers.ts wyPlaylistPage 注释）
  if (order === 'new') return neteaseNewPlaylists(cat, page)
  return neteasePlaylists(cat, order, page)
}

/** 通用分类（无标签体系平台共用）：名称即检索词 */
export const GENERIC_TAG_GROUPS: PlaylistTagGroup[] = [
  { name: '热门', tags: ['全部', '流行', '摇滚', '民谣', '电子', '说唱', '轻音乐', '爵士', '古典', '乡村'].map(n => ({ n, id: n })) },
  { name: '语种', tags: ['全部', '华语', '欧美', '日语', '韩语', '粤语', '小语种'].map(n => ({ n, id: n })) },
  { name: '专区', tags: ['影视原声', 'ACG', '怀旧', '儿童', '校园', '游戏', 'KTV', 'DJ', '器乐'].map(n => ({ n, id: n })) },
  { name: '主题', tags: ['伤感', '治愈', '励志', '甜蜜', '兴奋', '安静', '思念', '翻唱', '现场'].map(n => ({ n, id: n })) },
  { name: '心情', tags: ['运动', '夜晚', '学习', '浪漫', '减压', '通勤', '派对', '咖啡', '驾车', '午后'].map(n => ({ n, id: n })) },
]

/**
 * 歌单分类标签（按音源）
 *
 * 原先只有 Q音 返回标签，云村/酷狗/酷我/咪咕一律空数组，
 * 前端于是「有的平台没有分类」。现在：
 *  · Q音：真实标签（含 id，上游按 id 检索）
 *  · 其余平台：通用分类名（云村按名称检索、酷狗/酷我按关键词检索，均已实测可用）
 */
export async function getPlaylistTags(source = 'wy'): Promise<PlaylistTagGroup[]> {
  if (source === 'qq') {
    const tags = await qqPlaylistTags().catch(() => [])
    if (tags.length) return tags
  }
  return GENERIC_TAG_GROUPS
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

/** 歌单关键词搜索 ：供搜索页歌单 Tab */
export async function searchPlaylistList(keyword: string, page = 1): Promise<PlaylistMeta[]> {
  try {
    return await searchPlaylists(keyword, page, 20)
  } catch {
    return []
  }
}

/**
 * MV 多音源 ：source 决定平台；
 * B 站为默认兜底；外部音源走 lx-host mvSearch/mvUrl 分发。
 */
export async function searchMv(keyword: string, page = 1, source = 'all'): Promise<MvItem[]> {
  const src = source || 'all'
 // 聚合模式（~172 · ：四平台并发搜索 + 去重交织，
  // 一个列表看全部，不再按平台分 Tab。单源失败/空结果不影响其它源。
  if (src === 'all') {
 //整体硬超时。真机上原生 HTTP 偶发不返回时，旧实现会让 IPC 永不
    // 回调，页面骨架卡死；这里到点就返回已有结果（哪怕为空），由渲染层走空态。
    const merged = await Promise.race([
      searchMvAggregated(keyword, page, (kw, pg) => searchBiliVideo(kw, pg)),
      new Promise<MvItem[]>(r => setTimeout(() => r([]), 8000)),
    ])
    if (merged.length) return merged
    // 全平台皆空时才走视频源插件兜底
    if (lxHost.hasVideoSupport('bili', 'videoSearch')) {
      try {
        const r = await lxHost.dispatchVideoSearch('bili', keyword, page)
        return (r.videos || [])
          .map(v => ({
            source: 'bili',
            sourceId: String(v.id || v.bvid || ''),
            bvid: v.id && String(v.id).startsWith('BV') ? String(v.id) : undefined,
            title: String(v.title || ''),
            author: String(v.author || ''),
            pic: String(v.pic || ''),
            duration: String(v.durationLabel || v.duration || ''),
            durationSec: Number(v.durationSec || 0),
            play: Number(v.play || 0),
            danmaku: Number(v.danmaku || 0),
            qualities: [],
          }))
          .filter(v => v.sourceId) as MvItem[]
      } catch {
        return []
      }
    }
    return []
  }
  let list: MvItem[] = []
  if (src === 'bili') list = await searchBiliVideo(keyword, page)
  else if (src === 'wy' || src === 'qq' || src === 'kg' || src === 'kw') list = await searchMvBySource(src, keyword, page)
  else {
    // 外部视频源 / 音源 MV 协议（0.9.6）
    try {
      return await lxHost.dispatchMvSearch(src, keyword, page)
    } catch {
      return []
    }
  }
  // 0.9.8 videoHost：内置源空结果/不可达时由视频源插件接管（starwish-video 等）
  if (!list.length && lxHost.hasVideoSupport(src, 'videoSearch')) {
    try {
      const r = await lxHost.dispatchVideoSearch(src, keyword, page)
      list = (r.videos || [])
        .map(v => ({
          source: src,
          sourceId: String(v.id || v.bvid || ''),
          bvid: v.id && String(v.id).startsWith('BV') ? String(v.id) : undefined,
          title: String(v.title || ''),
          author: String(v.author || ''),
          pic: String(v.pic || ''),
          duration: String(v.durationLabel || v.duration || ''),
          durationSec: Number(v.durationSec || 0),
          play: Number(v.play || 0),
          danmaku: Number(v.danmaku || 0),
          qualities: [],
        }))
        .filter(v => v.sourceId) as MvItem[]
    } catch {
      /* 插件也无结果，走空态 */
    }
  }
  return list
}

/** MV 详情（统一到 {id,title,pic,author,play,danmaku,durationSec,qualities} 形状） */
export async function getMvInfo(source: string, id: string) {
  const src = source || 'bili'
  if (src === 'bili') {
    try {
      return await biliVideoInfo(id)
    } catch (e) {
      // 视频源插件接管（0.9.8 videoHost）
      if (lxHost.hasVideoSupport('bili', 'videoInfo')) {
        const v = await lxHost.dispatchVideoInfo('bili', id)
        return {
          cid: String(v.cid || ''),
          title: String(v.title || ''),
          pic: String(v.pic || ''),
          author: String(v.author || ''),
          play: Number(v.play || 0),
          danmaku: Number(v.danmaku || 0),
          like: 0,
          coin: 0,
          favorite: 0,
          duration: Number(v.durationSec || 0),
          pubdate: Number(v.pubdate || 0),
          desc: String(v.desc || ''),
        }
      }
      throw e
    }
  }
  if (src === 'wy') {
    const d = await wyMvDetail(id)
    return { ...d, cid: '', play: d.play, danmaku: 0, duration: d.durationSec }
  }
  if (src === 'qq') {
    // QQ MV 详情由取链接口顺带返回；这里补一次搜索拿元数据（标题/封面）
    const d = await qqMvDetail(id)
    return { ...d, cid: '', duration: d.durationSec }
  }
  // 外部音源 MV：详情字段可缺省，取链仍可工作
  return { id, title: '', pic: '', author: '', cid: '', play: 0, danmaku: 0, duration: 0, qualities: [] }
}

/** MV 分 P（网易/QQ 无分 P，返回空数组走统一播放器兜底分支；B站内置失败由视频源插件接管） */
export async function getMvParts(source: string, id: string) {
  const src = source || 'bili'
  if (src === 'bili') {
    try {
      return await biliParts(id)
    } catch (e) {
      if (lxHost.hasVideoSupport('bili', 'videoParts')) {
        const ps = await lxHost.dispatchVideoParts('bili', id)
        return ps.map(p => ({
          cid: String(p.cid || ''),
          page: Number(p.page || 1),
          title: String(p.title || `P${p.page || 1}`),
          part: String(p.title || `P${p.page || 1}`),
          duration: Number(p.durationSec || p.duration || 0),
          pic: String((p as any).pic || ''),
        }))
      }
      throw e
    }
  }
  return []
}

/** MV 播放地址（档位收敛 ≤6 档；切档不重头由渲染层记忆进度实现；内置失败由视频源插件接管） */
export async function getMvUrl(source: string, id: string, cid: string, qn?: number) {
  const src = source || 'bili'
  if (src === 'bili') {
    try {
      return await biliPlayUrl(id, cid, qn)
    } catch (e) {
      if (lxHost.hasVideoSupport('bili', 'videoUrl')) {
        const r = await lxHost.dispatchVideoUrl('bili', id, { cid }, qn ? String(qn) : undefined)
        return { url: r.url, qn: qn || 64, qualities: [] }
      }
      throw e
    }
  }
  if (src === 'wy') return wyMvUrl(id, qn)
  if (src === 'qq') {
    const r = await qqMvUrl(id, qn)
    const want = qn && r.qualities.some(x => x.qn === qn) ? qn : r.qn
    const hit = r.qualities.find(x => x.qn === want)
    return { url: (r as any).url, qn: want, qualities: r.qualities }
  }
 // 酷狗/酷我直链需平台签名，内置源不持签名能力
  // → 交给已安装的签名源插件；没有插件时给出可执行的中文指引，而不是笼统报错
  if (!lxHost.hasMvSupport(src, 'mvUrl')) {
    const name = src === 'kg' ? '酷狗' : src === 'kw' ? '酷我' : src
    throw new Error(`${name} MV 播放需要签名源插件：设置 → 音源与插件 → 插件市场安装对应视频源`)
  }
  const r = await lxHost.dispatchMvUrl(src, id)
  return { url: r.url, qn: qn || 0, qualities: r.qualities || [] }
}

/**
 * 歌曲相关 MV
 * 命中返回非空数组即亮起按钮；查询缓存 5 分钟（xinyuan_mv_hint_<songHash>）。
 */
const mvHintCache = new Map<string, { at: number; list: MvItem[] }>()
export async function mvBySong(song: Song): Promise<MvItem[]> {
  if (!song?.id) return []
  const key = `${song.source}:${song.songId || song.id}`
  const hit = mvHintCache.get(key)
  if (hit && Date.now() - hit.at < 5 * 60_000) return hit.list
  let list: MvItem[] = []
  if (song.source === 'wy') list = await wyMvBySong(String(song.songId || '')).catch(() => [])
  else if (song.source === 'qq') list = await qqMvBySong(song.name || '', String(song.singer || '').split('/')[0] || '').catch(() => [])
  if (mvHintCache.size > 120) mvHintCache.clear()
  mvHintCache.set(key, { at: Date.now(), list })
  return list
}

export async function itunesFallbackCover(term: string): Promise<string> {
  return itunesCover(term)
}

/** 播客单集：把 RSS 解析成可播放的 Song[]，交给现有播放器内置播放 */
export async function getPodcastEpisodes(feed: string, limit = 100): Promise<Song[]> {
  return podcastEpisodes(feed, limit)
}
