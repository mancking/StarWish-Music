import type { PlaylistMeta, Song, ToplistTree } from '../../shared/types'
import { createLogger } from './log'
import { favoriteSongs, dbGetSetting, dbSetSetting, historySongs, onRepeat, recentHistory } from './db'
import { getSongs } from './db'
import { neteaseNewSongs, neteasePlaylists, searchNetease, searchPodcast, toplistSongs, toplistTree } from './providers'
import { searchAll } from './music-service'
import { sleep, getJson, qs, UA } from './http'

/**
 * 批量补封面：wy search/get/web 只给 picId 不给 picUrl，
 * 每日推荐/电台等聚合列表构建后按 50 首/批调 song/detail 回填 album.picUrl。
 * 失败静默（封面缺失不阻断 feed），仅处理缺 pic 的 wy 歌曲。
 */
export async function backfillCovers(
  songs: Song[],
 /** 每批补完就回调一次（用于实时把封面推给渲染层， */
  onPatch?: (batch: Song[]) => void
): Promise<void> {
 // kg 公开接口无封面：先按 歌名+歌手 跨源查 wy 拿 songId，再走 song/detail 批量回填
  const kgNeed = songs.filter(s => s && s.source === 'kg' && !s.pic && s.songId && s.name)
  if (kgNeed.length) {
    await Promise.all(
      kgNeed.slice(0, 12).map(async s => {
        try {
          const hits = await searchNetease(`${s.name} ${String(s.singer || '').split('/')[0]}`, 1, 3)
          const hit = hits.find(x => x.name && s.name && (x.name.includes(s.name.slice(0, 4)) || s.name.includes(x.name.slice(0, 4))))
          if (hit) {
            s.source = 'kg'
            ;(s as any).wyCoverId = hit.songId
          }
        } catch {
          /* 跨源封面失败静默 */
        }
      })
    )
    // 统一回填：kg 借用 wy 封面
    for (const s of kgNeed) {
      const wid = (s as any).wyCoverId
      if (wid) {
        try {
          const body = await getJson<any>(
            `https://music.163.com/api/song/detail?${qs({ id: wid, ids: JSON.stringify([wid]) })}`,
            { 'User-Agent': UA, Referer: 'https://music.163.com/', Cookie: 'os=pc' },
            6000
          )
          const pic = String(body?.songs?.[0]?.album?.picUrl || '').replace(/^http:\/\//i, 'https://')
          if (pic) s.pic = pic
        } catch {
          /* ignore */
        }
      }
    }
    onPatch?.(kgNeed.filter(s => s.pic))
  }
 // QQ：smartbox 搜索不带专辑图→ fcg_play_single_song 支持 songmid 逗号批量，一次拿全
  const qqNeed = songs.filter(s => s && s.source === 'qq' && !s.pic && s.songId)
  if (qqNeed.length) {
    for (let i = 0; i < qqNeed.length; i += 20) {
      const batch = qqNeed.slice(i, i + 20)
      try {
        const body = await getJson<any>(
          `https://c.y.qq.com/v8/fcg-bin/fcg_play_single_song.fcg?${qs({
            songmid: batch.map(s => s.songId).join(','),
            format: 'json',
          })}`,
          { 'User-Agent': UA, Referer: 'https://y.qq.com/' },
          8000
        )
        const arr: any[] = body?.data || []
        for (const s of batch) {
          const hit = arr.find(x => String(x?.mid || x?.songmid || '') === s.songId)
          const albumMid = String(hit?.album?.mid || '')
          if (albumMid) {
            s.pic = `https://y.gtimg.cn/music/photo_new/T002R300x300M000${albumMid}.jpg`
            s.album = String(hit?.album?.name || s.album || '')
          }
        }
      } catch {
        /* 单批失败静默 */
      }
      onPatch?.(batch.filter(s => s.pic))
    }
  }

  const need = songs.filter(s => s && s.source === 'wy' && !s.pic && s.songId)
  if (!need.length) return
  for (let i = 0; i < need.length; i += 50) {
    const batch = need.slice(i, i + 50)
    try {
      // song/detail 的 ids 参数 = 歌曲 id（非专辑 picId）
      const ids = JSON.stringify(batch.map(s => s.songId))
      const body = await getJson<any>(
        `https://music.163.com/api/song/detail?${qs({ id: batch[0]!.songId, ids })}`,
        { 'User-Agent': UA, Referer: 'https://music.163.com/', Cookie: 'os=pc' },
        8000
      )
      const list: any[] = body?.songs || []
      const bySong = new Map<string, string>()
      for (const it of list) {
        const pic = https(it?.album?.picUrl || '')
        if (pic) bySong.set(String(it?.id || ''), pic)
      }
      for (const s of batch) {
        const pic = bySong.get(String(s.songId || ''))
        if (pic) s.pic = pic
      }
      onPatch?.(batch.filter(s => s.pic))
    } catch {
      /* 封面回填失败静默 */
    }
  }
}

function https(u: string): string {
  return String(u || '').replace(/^http:\/\//i, 'https://')
}

const logger = createLogger('recommend')

const MOODS = [
  { key: '运动', name: '运动能量', desc: '跑步 · 健身 · 加速', cat: '运动', icon: 'run' },
  { key: '睡眠', name: '睡前轻音', desc: '放松 · 助眠 · 白噪音', cat: '夜晚', icon: 'moon' },
  { key: '学习', name: '专注学习', desc: '纯音乐 · 低干扰', cat: '学习', icon: 'book' },
  { key: '通勤', name: '通勤路上', desc: '节奏 · 提神', cat: '通勤', icon: 'train' },
  { key: '派对', name: '派对现场', desc: '电音 · 嗨曲', cat: '派对', icon: 'party' },
  { key: '浪漫', name: '浪漫时刻', desc: '情歌 · 甜蜜', cat: '浪漫', icon: 'heart' },
  { key: '减压', name: '解压时刻', desc: '舒缓 · 治愈', cat: '减压', icon: 'leaf' },
  { key: '怀旧', name: '怀旧金曲', desc: '经典 · 回忆', cat: '怀旧', icon: 'clock' },
]

function todayKey(): string {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

let feedCache: { at: number; data: any } | null = null

export async function buildDailyMix(): Promise<Song[]> {
  const key = `home.daily.${todayKey()}`
  const cached = dbGetSetting<Song[]>(key)
  if (cached && Array.isArray(cached) && cached.length) {
 //旧缓存可能缺封面（回填逻辑上线前生成）——补齐后再返回
    if (cached.some(s => s.source === 'wy' && !s.pic)) {
      await backfillCovers(cached).catch(() => undefined)
      try { dbSetSetting(key, cached) } catch { /* ignore */ }
    }
    return cached
  }

  const favs = favoriteSongs()
  const history = historySongs(120)
  const seeds = [...favs, ...history]
  const singers = new Map<string, number>()
  for (const s of seeds) {
    for (const n of String(s.singer).split('/')) {
      const name = n.trim()
      if (name && name !== '未知歌手') singers.set(name, (singers.get(name) || 0) + 1)
    }
  }
  const top = [...singers.entries()].sort((a, b) => b[1] - a[1]).slice(0, 5)

  const out: Song[] = []
  const seen = new Set<string>()
  const push = (list: Song[]) => {
    for (const s of list) {
      if (seen.has(s.id)) continue
      seen.add(s.id)
      out.push(s)
    }
  }

  if (top.length) {
    const results = await Promise.all(
      top.map(([name]) => searchAll(name, 1, { limit: 12 }).catch(() => [] as Song[]))
    )
    for (const list of results) push(list)
  }

  if (out.length < 24) {
    try {
      const hot = await toplistSongs('wy', '3778678')
      push(hot.songs.slice(0, 40))
    } catch (e: any) {
      logger.warn('每日推荐兜底榜单失败', e?.message)
    }
  }
  if (out.length < 12) {
    try {
      push(await neteaseNewSongs(20))
    } catch {
      /* ignore */
    }
  }

  const mix = out.sort(() => Math.random() - 0.5).slice(0, 30)
  if (mix.length) dbSetSetting(key, mix)
  return mix
}

export async function buildHomeFeed(force = false): Promise<any> {
  if (!force && feedCache && Date.now() - feedCache.at < 8 * 60 * 1000) return feedCache.data
  if (!force) {
    const persisted = dbGetSetting<{ at: number; data: any }>('home.feed.cache')
    if (persisted && Date.now() - persisted.at < 30 * 60 * 1000 && persisted.data?.daily?.length) {
      feedCache = { at: persisted.at, data: persisted.data }
      return persisted.data
    }
  }

  const [daily, playlistsRaw, treeRes, newSongs, podcasts, recent, repeat] = await Promise.all([
    buildDailyMix().catch(() => [] as Song[]),
    neteasePlaylists('全部', 'hot', 1).catch(() => [] as PlaylistMeta[]),
    toplistTree().catch(() => ({ total: 0, tree: {} }) as ToplistTree),
    // 多取一些再做跨区块去重，否则去重后新歌区会只剩寥寥几首
    neteaseNewSongs(36).catch(() => [] as Song[]),
    searchPodcast('音乐', 8).catch(() => []),
    Promise.resolve(recentHistory(6)),
    Promise.resolve(onRepeat(20)),
  ])

  // 平台偶发限流时补一次，避免首页出现空区块
  let playlists = playlistsRaw
  if (!playlists.length) {
    await sleep(900)
    playlists = await neteasePlaylists('全部', 'hot', 1).catch(() => [] as PlaylistMeta[])
  }
  const recentSongs = getSongs(recent.map(r => r.id))
  const wyTree = treeRes.tree.wy
  const picks: { name: string; id: string }[] = []
  if (wyTree) {
    for (const g of wyTree.groups) {
      for (const item of g.items) {
        if (item.id) picks.push({ name: item.n, id: item.id })
        if (picks.length >= 3) break
      }
      if (picks.length >= 3) break
    }
  }
  const topCards = (
    await Promise.all(
      picks.map(async item => {
        try {
          const r = await toplistSongs('wy', item.id)
          return { platform: 'wy', id: item.id, name: item.name, pic: r.songs[0]?.pic || '', songs: r.songs.slice(0, 6) }
        } catch {
          return null
        }
      })
    )
  ).filter(Boolean) as { platform: string; id: string; name: string; pic: string; songs: Song[] }[]

  const moodPlaylists = await Promise.all(
    MOODS.map(async m => {
      try {
        const list = await neteasePlaylists(m.cat, 'hot', 1)
        return { ...m, cover: list[0]?.pic || '', playlistId: list[0]?.id || '', count: list.length }
      } catch {
        return { ...m, cover: '', playlistId: '', count: 0 }
      }
    })
  )

  // 跨区块去重：每日推荐 / 新歌 / 榜单 三者内容互斥。
  // 用户反馈过「介绍语中的排行榜是重复内容」——榜单卡片展示的是榜单前几首，
  // 若新歌区也含同一批曲目，用户会看到同一首歌出现两次。
  const topSongs = topCards.flatMap(c => c.songs)
 //每日推荐封面回填（wy picId → song/detail 批量）
  await backfillCovers(daily).catch(() => undefined)
  const data = {
    daily: dedupeAgainst(daily, newSongs, topSongs),
    playlists: playlists.slice(0, 12),
    toplists: topCards,
    // 新歌既排除每日推荐，也排除榜单展示过的曲目
    newSongs: dedupeAgainst(dedupeAgainst(newSongs, daily), topSongs),
    podcasts,
    continueListening: recentSongs,
    onRepeat: repeat,
    moods: moodPlaylists,
    totalToplists: treeRes.total,
    generatedAt: Date.now(),
  }
  feedCache = { at: Date.now(), data }
  try {
    dbSetSetting('home.feed.cache', { at: Date.now(), data })
  } catch {
    /* 缓存写入失败不影响使用 */
  }
  return data
}

/**
 * 从列表里剔除出现在其它区块中的歌曲（按 id 去重）。
 *
 * 首页各分区必须内容互斥，否则「每日推荐」与「热门榜单」「新歌速递」
 * 会展示同一批曲目——用户看到的就是「介绍语里的排行榜是重复内容」。
 */
function dedupeAgainst(main: Song[], ...others: Song[][]): Song[] {
  if (!main.length) return main
  const exclude = new Set<string>()
  for (const list of others) for (const s of list || []) if (s?.id) exclude.add(s.id)
  if (!exclude.size) return main
  return main.filter(s => !exclude.has(s.id))
}

export function invalidateFeed(): void {
  feedCache = null
}
export const MOOD_LIST = MOODS
