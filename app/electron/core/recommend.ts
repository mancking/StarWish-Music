import type { PlaylistMeta, Song, ToplistTree } from '../../shared/types'
import { createLogger } from './log'
import { favoriteSongs, dbGetSetting, dbSetSetting, historySongs, onRepeat, recentHistory } from './db'
import { getSongs } from './db'
import { neteaseNewSongs, neteasePlaylists, searchNetease, searchPodcast, toplistSongs, toplistTree } from './providers'
import { searchAll } from './music-service'
import { sleep } from './http'

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
  if (cached && Array.isArray(cached) && cached.length) return cached

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
    neteaseNewSongs(10).catch(() => [] as Song[]),
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

  const data = {
    daily,
    playlists: playlists.slice(0, 12),
    toplists: topCards,
    newSongs,
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

export function invalidateFeed(): void {
  feedCache = null
}

export const MOOD_LIST = MOODS
