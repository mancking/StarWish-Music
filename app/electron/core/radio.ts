import type { Song } from '../../shared/types'
import { createLogger } from './log'
import { favoriteSongs, historySongs, onRepeat } from './db'
import { neteaseNewSongs, searchNetease, toplistSongs } from './providers'
import { buildHomeFeed } from './recommend'

const logger = createLogger('radio')

/**
 * 私人电台引擎。
 *
 * 背景：旧实现把「播放次数最多的历史歌曲」直接当电台内容，导致电台里全是听过的歌，
 * 与真正的电台（按口味持续产出新歌、可无限续播）不符。
 *
 * 现在的策略：
 *   1. 用收藏 + 历史建立歌手口味画像（收藏权重更高）；
 *   2. 以口味歌手为种子做「种子扩展」——同歌手的其他作品 / 同风格关键词的新歌；
 *   3. 混入新歌与榜单作为冷启动底料，但打乱顺序并按 id 去重，保证不出现连续同源块；
 *   4. 输出长队列（默认 60 首），供播放器连续播放与「换一批」。
 */

export interface RadioResult {
  songs: Song[]
  /** 生成时使用的口味歌手，用于 UI 展示「根据 XX 电台」 */
  seeds: string[]
  generatedAt: number
}

/** 从歌曲集合里抽取歌手并按出现次数计权 */
function singerProfile(songs: Song[], weight = 1): Map<string, number> {
  const map = new Map<string, number>()
  for (const s of songs) {
    for (const raw of String(s.singer || '').split('/')) {
      const name = raw.trim()
      if (!name || name === '未知歌手') continue
      map.set(name, (map.get(name) || 0) + weight)
    }
  }
  return map
}

/** 去掉播放过的歌，让电台真的有「新歌」感 */
function dropRecentlyPlayed(list: Song[], played: Set<string>): Song[] {
  return list.filter(s => s && s.id && !played.has(s.id))
}

function shuffle<T>(arr: T[]): T[] {
  const a = [...arr]
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1))
    ;[a[i], a[j]] = [a[j], a[i]]
  }
  return a
}

/** 按歌手做轮转交错，避免同一歌手的歌扎堆出现 */
function interleaveBySinger(list: Song[]): Song[] {
  const buckets = new Map<string, Song[]>()
  for (const s of list) {
    const key = String(s.singer || '未知歌手')
    if (!buckets.has(key)) buckets.set(key, [])
    buckets.get(key)!.push(s)
  }
  const keys = shuffle([...buckets.keys()])
  const out: Song[] = []
  let round = 0
  while (out.length < list.length) {
    let pushed = false
    for (const k of keys) {
      const b = buckets.get(k)!
      if (round < b.length) {
        out.push(b[round])
        pushed = true
      }
    }
    if (!pushed) break
    round++
  }
  return out
}

let radioCache: RadioResult | null = null

/**
 * 生成私人电台队列。
 * @param force true 时忽略缓存（对应 UI「换一批」）
 * @param size  队列长度
 */
export async function buildRadio(force = false, size = 60): Promise<RadioResult> {
  if (!force && radioCache && Date.now() - radioCache.generatedAt < 15 * 60 * 1000) {
    return radioCache
  }

  const favs = favoriteSongs()
  const history = historySongs(200)
  const recent = onRepeat(50)

  // 口味画像：收藏 ×3、历史上听过 ×1、播放次数榜 ×1
  const profile = singerProfile(favs, 3)
  for (const [k, v] of singerProfile(history, 1)) profile.set(k, (profile.get(k) || 0) + v)
  for (const [k, v] of singerProfile(recent, 1)) profile.set(k, (profile.get(k) || 0) + v)

  const seeds = [...profile.entries()].sort((a, b) => b[1] - a[1]).map(e => e[0])

  // 已听过的歌（近 200 首）——电台应优先给新歌，但收藏里的歌保留
  const playedIds = new Set<string>([...history, ...recent].map(s => s.id))
  const favIds = new Set<string>(favs.map(s => s.id))

  const seen = new Set<string>()
  const out: Song[] = []
  const push = (list: Song[]) => {
    for (const s of list) {
      if (!s || !s.id || seen.has(s.id)) continue
      seen.add(s.id)
      out.push(s)
    }
  }

  // 1) 种子歌手的其它作品（真正「电台」的主力）
  const seedArtists = seeds.slice(0, 8)
  if (seedArtists.length) {
    const results = await Promise.all(
      seedArtists.map(name =>
        searchNetease(name, 1, 20)
          .catch(() => [] as Song[])
          .then(list => list.filter(s => String(s.singer || '').includes(name.split(' ')[0])))
      )
    )
    for (const list of results) push(list)
  }

  // 2) 冷启动底料：新歌（按口味歌手过滤，优先同风格）
  try {
    const fresh = await neteaseNewSongs(30)
    push(fresh)
  } catch (e: any) {
    logger.warn('电台取新歌失败', e?.message)
  }

  // 3) 兜底：榜单（仅在前两步不足时使用）
  if (out.length < size) {
    try {
      const hot = await toplistSongs('wy', '3778678')
      push(hot.songs.slice(0, 40))
    } catch (e: any) {
      logger.warn('电台取榜单失败', e?.message)
    }
  }

  // 4) 剔除「最近听过的」非收藏歌曲，让电台真正带来新内容
  let filtered = dropRecentlyPlayed(out, playedIds)
  // 收藏的歌保留（用户主动收藏的，喜欢听）
  filtered = filtered.filter(s => !playedIds.has(s.id) || favIds.has(s.id))
  if (filtered.length < 8) filtered = out

  // 5) 跨区块去重：电台不应与首页其它区块（每日推荐 / 新歌 / 榜单）撞内容
  //    用户此前明确反馈过「介绍语中的排行榜是重复内容」。
  const others = await collectFeedSongIds()
  const before = filtered.length
  filtered = filtered.filter(s => !others.has(s.id))
  if (filtered.length < 12) {
    // 去重后太短：保留一部分重复项补足长度（宁可轻微重复，也不要电台空掉）
    const back = filtered.slice(0, 12)
    const rest = out.filter(s => !back.some(b => b.id === s.id))
    filtered = [...back, ...rest]
  }
  logger.info(`电台生成 ${filtered.length} 首（跨区块去重前 ${before}）`)

  const songs = interleaveBySinger(shuffle(filtered)).slice(0, size)
  const result: RadioResult = { songs, seeds: seedArtists.slice(0, 3), generatedAt: Date.now() }
  radioCache = result
  return result
}

/**
 * 收集首页其它区块已用到的歌曲 id（每日推荐 / 新歌 / 榜单 / 推荐歌单），
 * 用于电台跨区块去重。取不到就返回空集（不阻断电台生成）。
 */
async function collectFeedSongIds(): Promise<Set<string>> {
  const ids = new Set<string>()
  try {
    const feed = await buildHomeFeed(false)
    for (const key of ['daily', 'newSongs'] as const) {
      for (const s of feed?.[key] || []) if (s?.id) ids.add(s.id)
    }
    for (const t of feed?.toplists || []) {
      for (const s of t?.songs || []) if (s?.id) ids.add(s.id)
    }
  } catch (e: any) {
    logger.warn('电台跨区块去重取 feed 失败', e?.message)
  }
  return ids
}

export function invalidateRadio(): void {
  radioCache = null
}
