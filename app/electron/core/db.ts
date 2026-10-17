import fs from 'node:fs'
import path from 'node:path'
import type { PlaylistMeta, Song } from '../../shared/types'
import { dbFile, ensureDir } from './paths'
import { createLogger } from './log'

const logger = createLogger('db')

// sql.js 是 SQLite 的 WebAssembly 编译版本：零原生依赖、跨平台一致，数据仍落在标准 .db 文件
// eslint-disable-next-line @typescript-eslint/no-var-requires
let SQL: any = null
let db: any = null
let flushTimer: NodeJS.Timeout | null = null
let dirty = false
let closed = false

const SCHEMA = `
CREATE TABLE IF NOT EXISTS songs (
  id TEXT PRIMARY KEY,
  source TEXT NOT NULL,
  song_id TEXT NOT NULL,
  name TEXT NOT NULL,
  singer TEXT NOT NULL,
  album TEXT,
  duration INTEGER DEFAULT 0,
  pic TEXT,
  local_path TEXT,
  qualitys TEXT,
  extra TEXT,
  created_at INTEGER
);
CREATE TABLE IF NOT EXISTS playlists (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  pic TEXT,
  description TEXT,
  source TEXT,
  remote_id TEXT,
  kind TEXT DEFAULT 'local',
  created_at INTEGER,
  updated_at INTEGER
);
CREATE TABLE IF NOT EXISTS playlist_song (
  playlist_id TEXT NOT NULL,
  song_id TEXT NOT NULL,
  pos INTEGER DEFAULT 0,
  added_at INTEGER,
  PRIMARY KEY (playlist_id, song_id)
);
CREATE TABLE IF NOT EXISTS favorites (
  song_id TEXT PRIMARY KEY,
  added_at INTEGER
);
CREATE TABLE IF NOT EXISTS play_history (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  song_id TEXT NOT NULL,
  played_at INTEGER NOT NULL,
  ms INTEGER DEFAULT 0
);
CREATE TABLE IF NOT EXISTS play_count (
  song_id TEXT PRIMARY KEY,
  count INTEGER DEFAULT 0,
  last_at INTEGER
);
CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY,
  value TEXT
);
CREATE INDEX IF NOT EXISTS idx_history_at ON play_history(played_at DESC);
CREATE INDEX IF NOT EXISTS idx_plsong ON playlist_song(playlist_id, pos);
CREATE INDEX IF NOT EXISTS idx_songs_name ON songs(name);
`

export async function initDb(): Promise<void> {
  const initSqlJs = require('sql.js')
  SQL = await initSqlJs({
    locateFile: (f: string) => {
      const candidates = [
        path.join(__dirname, f),
        path.join(process.cwd(), 'node_modules', 'sql.js', 'dist', f),
        path.join(process.resourcesPath || '', 'app.asar.unpacked', 'node_modules', 'sql.js', 'dist', f),
      ]
      for (const c of candidates) {
        try {
          if (fs.existsSync(c)) return c
        } catch {
          /* ignore */
        }
      }
      return f
    },
  })
  ensureDir(path.dirname(dbFile()))
  let data: Buffer | undefined
  try {
    if (fs.existsSync(dbFile())) data = fs.readFileSync(dbFile())
  } catch (e: any) {
    logger.warn('数据库读取失败，将重建', e?.message)
  }
  try {
    db = data && data.length ? new SQL.Database(new Uint8Array(data)) : new SQL.Database()
    db.run(SCHEMA)
    const v = db.exec('PRAGMA user_version')[0]?.values?.[0]?.[0] ?? 0
    if (v < 1) db.run('PRAGMA user_version = 1')
    logger.info('数据库就绪', dbFile())
    flush()
  } catch (e: any) {
    logger.error('数据库初始化失败，使用内存库', e?.message)
    db = new SQL.Database()
    db.run(SCHEMA)
  }
}

function bind(params: any[] = []): any[] {
  return params.map(p => {
    if (p === undefined) return null
    if (typeof p === 'boolean') return p ? 1 : 0
    if (p && typeof p === 'object') return JSON.stringify(p)
    return p
  })
}

export function run(sql: string, params: any[] = []): void {
  if (!db) return
  try {
    db.run(sql, bind(params))
    markDirty()
  } catch (e: any) {
    logger.error('SQL 执行失败', sql.slice(0, 120), e?.message)
  }
}

export function all<T = any>(sql: string, params: any[] = []): T[] {
  if (!db) return []
  try {
    const stmt = db.prepare(sql)
    stmt.bind(bind(params))
    const rows: T[] = []
    while (stmt.step()) rows.push(stmt.getAsObject() as T)
    stmt.free()
    return rows
  } catch (e: any) {
    logger.error('SQL 查询失败', sql.slice(0, 120), e?.message)
    return []
  }
}

export function get<T = any>(sql: string, params: any[] = []): T | null {
  const rows = all<T>(sql, params)
  return rows[0] ?? null
}

function markDirty(): void {
  dirty = true
  if (flushTimer) return
  flushTimer = setTimeout(() => {
    flushTimer = null
    flush()
  }, 600)
}

export function flush(): void {
  if (!db || closed || !dirty) return
  try {
    const data = Buffer.from(db.export())
    const tmp = dbFile() + '.tmp'
    fs.writeFileSync(tmp, data)
    fs.renameSync(tmp, dbFile())
    dirty = false
  } catch (e: any) {
    logger.error('数据库落盘失败', e?.message)
  }
}

export function closeDb(): void {
  flush()
  closed = true
  try {
    db?.close()
  } catch {
    /* ignore */
  }
  db = null
}

/* ============================ 歌曲 ============================ */

export function saveSongs(songs: Song[]): void {
  if (!songs.length) return
  for (const s of songs) {
    run(
      `INSERT INTO songs (id, source, song_id, name, singer, album, duration, pic, local_path, qualitys, extra, created_at)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?)
       ON CONFLICT(id) DO UPDATE SET
         name=excluded.name, singer=excluded.singer, album=excluded.album, duration=excluded.duration,
         pic=excluded.pic, local_path=excluded.local_path, qualitys=excluded.qualitys, extra=excluded.extra`,
      [
        s.id,
        s.source,
        s.songId,
        s.name,
        s.singer,
        s.album || '',
        Math.round(s.duration || 0),
        s.pic || '',
        s.localPath || '',
        JSON.stringify(s.qualitys || []),
        JSON.stringify(s.extra || {}),
        Date.now(),
      ]
    )
  }
}

function rowToSong(r: any): Song {
  let qualitys: string[] = []
  let extra: Record<string, any> = {}
  try {
    qualitys = JSON.parse(r.qualitys || '[]')
  } catch {
    qualitys = []
  }
  try {
    extra = JSON.parse(r.extra || '{}')
  } catch {
    extra = {}
  }
  return {
    id: r.id,
    source: r.source,
    songId: r.song_id,
    name: r.name,
    singer: r.singer,
    album: r.album || '',
    duration: Number(r.duration) || 0,
    pic: r.pic || '',
    localPath: r.local_path || undefined,
    qualitys,
    extra,
  }
}

export function getSong(id: string): Song | null {
  const r = get('SELECT * FROM songs WHERE id = ?', [id])
  return r ? rowToSong(r) : null
}

export function getSongs(ids: string[]): Song[] {
  if (!ids.length) return []
  const map = new Map<string, Song>()
  const chunk = 200
  for (let i = 0; i < ids.length; i += chunk) {
    const part = ids.slice(i, i + chunk)
    const ph = part.map(() => '?').join(',')
    for (const r of all(`SELECT * FROM songs WHERE id IN (${ph})`, part)) {
      map.set(r.id, rowToSong(r))
    }
  }
  return ids.map(id => map.get(id)).filter((s): s is Song => !!s)
}

/* ============================ 收藏 ============================ */

export function toggleFavorite(song: Song): boolean {
  saveSongs([song])
  const exists = get('SELECT 1 AS x FROM favorites WHERE song_id = ?', [song.id])
  if (exists) {
    run('DELETE FROM favorites WHERE song_id = ?', [song.id])
    return false
  }
  run('INSERT INTO favorites (song_id, added_at) VALUES (?,?)', [song.id, Date.now()])
  return true
}

export function isFavorite(id: string): boolean {
  return !!get('SELECT 1 AS x FROM favorites WHERE song_id = ?', [id])
}

export function favoriteSongs(): Song[] {
  const rows = all('SELECT song_id FROM favorites ORDER BY added_at DESC')
  return getSongs(rows.map((r: any) => r.song_id))
}

export function favoriteIds(): string[] {
  return all('SELECT song_id FROM favorites').map((r: any) => r.song_id)
}

/* ============================ 历史 ============================ */

export function addHistory(song: Song, ms = 0): void {
  saveSongs([song])
  run('INSERT INTO play_history (song_id, played_at, ms) VALUES (?,?,?)', [song.id, Date.now(), ms])
  run(
    `INSERT INTO play_count (song_id, count, last_at) VALUES (?,1,?)
     ON CONFLICT(song_id) DO UPDATE SET count = count + 1, last_at = excluded.last_at`,
    [song.id, Date.now()]
  )
  // 历史最多保留 2000 条
  run('DELETE FROM play_history WHERE id NOT IN (SELECT id FROM play_history ORDER BY played_at DESC LIMIT 2000)')
}

export function historySongs(limit = 100): Song[] {
  const rows = all(
    `SELECT song_id, MAX(played_at) AS t FROM play_history GROUP BY song_id ORDER BY t DESC LIMIT ?`,
    [limit]
  )
  return getSongs(rows.map((r: any) => r.song_id))
}

export function recentHistory(limit = 6): { id: string; at: number }[] {
  return all(`SELECT song_id AS id, MAX(played_at) AS at FROM play_history GROUP BY song_id ORDER BY at DESC LIMIT ?`, [
    limit,
  ])
}

export function clearHistory(): void {
  run('DELETE FROM play_history')
  run('DELETE FROM play_count')
}

export function onRepeat(limit = 50): Song[] {
  const rows = all('SELECT song_id FROM play_count ORDER BY count DESC LIMIT ?', [limit])
  return getSongs(rows.map((r: any) => r.song_id))
}

export function playStats(): { total: number; days: number; topSingers: { name: string; count: number }[] } {
  const total = Number(get('SELECT COUNT(*) AS c FROM play_history')?.c || 0)
  const days = Number(get('SELECT COUNT(DISTINCT date(played_at/1000, "unixepoch", "localtime")) AS c FROM play_history')?.c || 0)
  const rows = all(
    `SELECT s.singer AS name, COUNT(*) AS count FROM play_history h
     JOIN songs s ON s.id = h.song_id
     GROUP BY s.singer ORDER BY count DESC LIMIT 8`
  )
  return { total, days, topSingers: rows.map((r: any) => ({ name: r.name, count: Number(r.count) })) }
}

/* ============================ 歌单 ============================ */

export function createPlaylist(name: string, pic = '', description = ''): PlaylistMeta {
  const id = `pl_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`
  run(
    'INSERT INTO playlists (id, name, pic, description, source, remote_id, kind, created_at, updated_at) VALUES (?,?,?,?,?,?,?,?,?)',
    [id, name.trim() || '新建歌单', pic, description, 'local', '', 'local', Date.now(), Date.now()]
  )
  return { id, name, pic, description, kind: 'local' }
}

export function listPlaylists(): (PlaylistMeta & { songCount: number })[] {
  const rows = all('SELECT * FROM playlists ORDER BY updated_at DESC')
  return rows.map((r: any) => ({
    id: r.id,
    name: r.name,
    pic: r.pic || '',
    description: r.description || '',
    source: r.source || 'local',
    kind: (r.kind || 'local') as 'local' | 'remote',
    songCount: Number(get('SELECT COUNT(*) AS c FROM playlist_song WHERE playlist_id = ?', [r.id])?.c || 0),
  }))
}

export function updatePlaylist(id: string, patch: { name?: string; pic?: string; description?: string }): void {
  const cur = get('SELECT * FROM playlists WHERE id = ?', [id])
  if (!cur) return
  run('UPDATE playlists SET name = ?, pic = ?, description = ?, updated_at = ? WHERE id = ?', [
    patch.name ?? cur.name,
    patch.pic ?? cur.pic,
    patch.description ?? cur.description,
    Date.now(),
    id,
  ])
}

export function deletePlaylist(id: string): void {
  run('DELETE FROM playlists WHERE id = ?', [id])
  run('DELETE FROM playlist_song WHERE playlist_id = ?', [id])
}

export function addSongsToPlaylist(playlistId: string, songs: Song[]): number {
  if (!songs.length) return 0
  saveSongs(songs)
  const max = Number(get('SELECT COALESCE(MAX(pos), 0) AS m FROM playlist_song WHERE playlist_id = ?', [playlistId])?.m || 0)
  let added = 0
  songs.forEach((s, i) => {
    const exists = get('SELECT 1 AS x FROM playlist_song WHERE playlist_id = ? AND song_id = ?', [playlistId, s.id])
    if (exists) return
    run('INSERT INTO playlist_song (playlist_id, song_id, pos, added_at) VALUES (?,?,?,?)', [
      playlistId,
      s.id,
      max + i + 1,
      Date.now(),
    ])
    added++
  })
  run('UPDATE playlists SET updated_at = ? WHERE id = ?', [Date.now(), playlistId])
  return added
}

export function playlistSongs(playlistId: string): Song[] {
  const rows = all('SELECT song_id FROM playlist_song WHERE playlist_id = ? ORDER BY pos ASC', [playlistId])
  return getSongs(rows.map((r: any) => r.song_id))
}

export function removeSongFromPlaylist(playlistId: string, songId: string): void {
  run('DELETE FROM playlist_song WHERE playlist_id = ? AND song_id = ?', [playlistId, songId])
  run('UPDATE playlists SET updated_at = ? WHERE id = ?', [Date.now(), playlistId])
}

export function reorderPlaylist(playlistId: string, ids: string[]): void {
  ids.forEach((id, i) => {
    run('UPDATE playlist_song SET pos = ? WHERE playlist_id = ? AND song_id = ?', [i, playlistId, id])
  })
  run('UPDATE playlists SET updated_at = ? WHERE id = ?', [Date.now(), playlistId])
}

/* ============================ 本地音乐 ============================ */

export function localSongs(limit = 5000): Song[] {
  const rows = all('SELECT * FROM songs WHERE source = ? ORDER BY name COLLATE NOCASE LIMIT ?', ['local', limit])
  return rows.map(rowToSong)
}

export function localCount(): number {
  return Number(get("SELECT COUNT(*) AS c FROM songs WHERE source = 'local'")?.c || 0)
}

export function removeLocalSongs(paths: string[]): void {
  for (const p of paths) {
    const r = get('SELECT id FROM songs WHERE local_path = ?', [p])
    if (r) {
      run('DELETE FROM songs WHERE id = ?', [r.id])
      run('DELETE FROM playlist_song WHERE song_id = ?', [r.id])
      run('DELETE FROM favorites WHERE song_id = ?', [r.id])
    }
  }
}

/* ============================ 设置 ============================ */

export function dbGetSetting<T = any>(key: string): T | null {
  const r = get('SELECT value FROM settings WHERE key = ?', [key])
  if (!r) return null
  try {
    return JSON.parse(r.value) as T
  } catch {
    return null
  }
}

export function dbSetSetting(key: string, value: any): void {
  run('INSERT INTO settings (key, value) VALUES (?,?) ON CONFLICT(key) DO UPDATE SET value = excluded.value', [
    key,
    JSON.stringify(value),
  ])
}

export function dbStats(): { songs: number; playlists: number; history: number; favorites: number; size: number } {
  return {
    songs: Number(get('SELECT COUNT(*) AS c FROM songs')?.c || 0),
    playlists: Number(get('SELECT COUNT(*) AS c FROM playlists')?.c || 0),
    history: Number(get('SELECT COUNT(*) AS c FROM play_history')?.c || 0),
    favorites: Number(get('SELECT COUNT(*) AS c FROM favorites')?.c || 0),
    size: (() => {
      try {
        return fs.statSync(dbFile()).size
      } catch {
        return 0
      }
    })(),
  }
}
