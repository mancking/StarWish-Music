import { request } from './http'
import { getSettings, saveSettings } from './settings'
import { favoriteSongs, listPlaylists, playlistSongs } from './db'
import { createLogger } from './log'
import type { Song } from '../../shared/types'

/**
 * WebDAV 备份（首版：单向，本地 → 远端）。
 *
 * 只同步歌单与收藏，不做合并、不做拉取。理由：双向同步的冲突处理需要版本向量，
 * 在没有服务端配合的情况下容易把用户数据覆盖掉；单向上传最坏情况只是远端被刷新。
 *
 * 文件：<url>/<path>/starwish-backup.json
 */

const logger = createLogger('webdav')
const FILE = 'starwish-backup.json'

function authHeaders(): Record<string, string> {
  const s = getSettings()
  if (!s.webdavUser && !s.webdavPass) return {}
  const token = Buffer.from(`${s.webdavUser || ''}:${s.webdavPass || ''}`).toString('base64')
  return { Authorization: `Basic ${token}` }
}

function trimSlash(s: string): string {
  return (s || '').replace(/\/+$/, '')
}

function targetUrl(): string {
  const s = getSettings()
  const base = trimSlash(s.webdavUrl)
  const sub = trimSlash(s.webdavPath).replace(/^\/+/, '')
  if (!base) throw new Error('请先填写 WebDAV 地址')
  return sub ? `${base}/${sub}/${FILE}` : `${base}/${FILE}`
}

function dirUrl(): string {
  const s = getSettings()
  const base = trimSlash(s.webdavUrl)
  const sub = trimSlash(s.webdavPath).replace(/^\/+/, '')
  return sub ? `${base}/${sub}` : base
}

function slim(s: Song): Record<string, unknown> {
  return {
    id: s.id,
    name: s.name,
    singer: s.singer,
    album: s.album,
    duration: s.duration,
    source: s.source,
    songId: s.songId,
    pic: s.pic || '',
  }
}

/** 连接测试：对目录发 PROPFIND（Depth: 0），能拿到 207/200 即视为可用 */
export async function testConnection(): Promise<{ ok: boolean; status: number; message: string }> {
  try {
    const url = dirUrl()
    if (!url) return { ok: false, status: 0, message: '请先填写 WebDAV 地址' }
    const res = await request(url, {
      method: 'PROPFIND',
      headers: { ...authHeaders(), Depth: '0', 'Content-Type': 'application/xml' },
      body: '<?xml version="1.0"?><d:propfind xmlns:d="DAV:"><d:prop><d:resourcetype/></d:prop></d:propfind>',
      timeout: 12000,
      retry: 0,
    })
    const ok = res.status === 207 || res.status === 200 || res.status === 204
    return {
      ok,
      status: res.status,
      message: ok ? '连接正常' : `服务器返回 ${res.status}，请检查地址与账号`,
    }
  } catch (e: any) {
    return { ok: false, status: 0, message: e?.message || '连接失败' }
  }
}

/** 上传备份：歌单 + 收藏，整体覆盖远端文件 */
export async function uploadBackup(): Promise<{ ok: boolean; bytes: number; at: number; playlists: number; favorites: number }> {
  const s = getSettings()
  if (!s.webdavUrl) throw new Error('请先填写 WebDAV 地址')

  const lists = listPlaylists()
  const playlists = lists.map(p => ({
    name: p.name,
    createdAt: p.created,
    songs: playlistSongs(p.id).map(slim),
  }))
  const favorites = favoriteSongs().map(slim)

  const payload = {
    app: 'StarWish Music',
    version: 1,
    exportedAt: new Date().toISOString(),
    playlists,
    favorites,
  }
  const body = JSON.stringify(payload, null, 2)
  const buf = Buffer.from(body, 'utf8')
  const url = targetUrl()

  const put = async (): Promise<Response> =>
    request(url, {
      method: 'PUT',
      headers: { ...authHeaders(), 'Content-Type': 'application/json; charset=utf-8' },
      body: buf,
      timeout: 30000,
      retry: 0,
    }) as any

  let res: any
  try {
    res = await put()
  } catch (e: any) {
    throw new Error(`上传失败：${e?.message || '网络错误'}`)
  }

  // 目录不存在时先 MKCOL 再重试一次
  if (res.status === 409 || res.status === 404) {
    try {
      await request(dirUrl(), {
        method: 'MKCOL',
        headers: authHeaders(),
        timeout: 12000,
        retry: 0,
      })
    } catch {
      /* 目录已存在时会返回 405，忽略 */
    }
    res = await put()
  }

  if (res.status >= 400) {
    throw new Error(`上传失败：服务器返回 ${res.status}`)
  }

  const at = Date.now()
  saveSettings({ webdavLastSync: at })
  logger.info('WebDAV 备份完成', `${playlists.length} 个歌单 / ${favorites.length} 首收藏 / ${buf.length}B`)
  return { ok: true, bytes: buf.length, at, playlists: playlists.length, favorites: favorites.length }
}
