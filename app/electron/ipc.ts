import { app, dialog, ipcMain, nativeTheme, shell } from 'electron'
import fs from 'node:fs'
import path from 'node:path'
import type { AppSettings, Song } from '../shared/types'
import { createLogger } from './core/log'
import { lxHost } from './core/lx-host'
import {
  getCover,
  getLyric,
  getMvInfo,
  getMvParts,
  getMvUrl,
  getNewSongs,
  getPlaylistDetail,
  getPlaylists,
  getToplist,
  getToplistTree,
  importPlaylist,
  searchAll,
  searchMv,
} from './core/music-service'
import { buildHomeFeed, invalidateFeed } from './core/recommend'
import { player } from './core/player-service'
import { getSettings, saveSettings } from './core/settings'
import { applyTitleBarTheme, broadcast, sendToMain, setLyricLock, showLyricWindow, wins } from './windows'
import {
  addHistory,
  addSongsToPlaylist,
  clearHistory,
  createPlaylist,
  dbGetSetting,
  dbSetSetting,
  dbStats,
  deletePlaylist,
  favoriteIds,
  favoriteSongs,
  getSongs,
  historySongs,
  isFavorite,
  listPlaylists,
  localCount,
  localSongs,
  playlistSongs,
  removeSongFromPlaylist,
  reorderPlaylist,
  toggleFavorite,
  updatePlaylist,
} from './core/db'
import { biliLogout, biliQrGenerate, biliQrPoll, biliStatus } from './core/bili'
import { cancelScan, getScanProgress, scanLibrary } from './core/library'
import { coverCacheSize, clearCoverCache, coverProtocolUrl } from './core/cover'
import { cacheRootDir, ensureDir, mediaCacheDir, userDataDir } from './core/paths'

const logger = createLogger('ipc')

/** 把远端封面统一转换为本地协议地址，规避防盗链与跨域问题 */
function dec(song: Song): Song {
  if (!song) return song
  if (song.pic && /^https?:\/\//i.test(song.pic)) return { ...song, pic: coverProtocolUrl(song.pic) }
  return song
}
function decList(list: Song[] | undefined): Song[] {
  return (list || []).map(dec)
}
function decPic(url: string | undefined): string {
  return url && /^https?:\/\//i.test(url) ? coverProtocolUrl(url) : url || ''
}
function decState(s: any): any {
  if (!s) return s
  return { ...s, song: s.song ? dec(s.song) : null, queue: decList(s.queue) }
}
function decFeed(f: any): any {
  if (!f) return f
  return {
    ...f,
    daily: decList(f.daily),
    newSongs: decList(f.newSongs),
    continueListening: decList(f.continueListening),
    onRepeat: decList(f.onRepeat),
    toplists: (f.toplists || []).map((t: any) => ({ ...t, songs: decList(t.songs), pic: decPic(t.pic) })),
    playlists: (f.playlists || []).map((p: any) => ({ ...p, pic: decPic(p.pic) })),
    moods: (f.moods || []).map((m: any) => ({ ...m, cover: decPic(m.cover) })),
    podcasts: (f.podcasts || []).map((p: any) => ({ ...p, pic: decPic(p.pic) })),
  }
}

function friendly(e: any): string {
  const raw = String(e?.message || e || '未知错误')
  if (/ENOTFOUND|EAI_AGAIN|getaddrinfo|ERR_INTERNET_DISCONNECTED/i.test(raw)) return '网络连接失败，请检查网络或代理设置'
  if (/ETIMEDOUT|timed out|超时/i.test(raw)) return '请求超时，请稍后重试'
  if (/ECONNREFUSED|ECONNRESET|socket hang up/i.test(raw)) return '连接被中断，请重试'
  if (/403|Forbidden/i.test(raw)) return '音源拒绝访问，该音源可能已失效'
  if (/429|too many/i.test(raw)) return '请求过于频繁，请稍后再试'
  if (/certificate|SSL|TLS/i.test(raw)) return '证书校验失败，请检查系统时间或代理'
  return raw
}

type Handler = (payload: any, event: Electron.IpcMainInvokeEvent) => Promise<any> | any

const handlers: Record<string, Handler> = {
  /* ---------------- 应用 ---------------- */
  'app:info': () => ({
    version: app.getVersion(),
    name: app.getName(),
    electron: process.versions.electron,
    chrome: process.versions.chrome,
    node: process.versions.node,
    platform: process.platform,
    userData: userDataDir(),
    sources: lxHost.list().length,
    sourcesOk: lxHost.list().filter(s => !s.loadError).length,
    db: dbStats(),
    coverCache: coverCacheSize(),
  }),
  'app:quit': () => {
    app.quit()
    return true
  },
  'app:openExternal': async ({ url }: { url: string }) => {
    if (!/^https?:\/\//i.test(String(url || ''))) throw new Error('仅支持打开 http(s) 链接')
    await shell.openExternal(url)
    return true
  },
  'app:showItemInFolder': ({ path: p }: { path: string }) => {
    shell.showItemInFolder(p)
    return true
  },
  'app:openUserData': async () => {
    await shell.openPath(userDataDir())
    return true
  },

  /* ---------------- 设置 ---------------- */
  'settings:get': () => getSettings(),
  'settings:set': (patch: Partial<AppSettings>) => {
    const s = saveSettings(patch || {})
    if (patch.theme) {
      nativeTheme.themeSource = s.theme === 'auto' ? 'system' : (s.theme as 'dark' | 'light')
      applyTitleBarTheme(nativeTheme.shouldUseDarkColors)
    }
    if (typeof patch.volume === 'number') player.setVolume(patch.volume)
    if (patch.quality) player.setQuality(patch.quality)
    if (patch.playMode) player.setMode(patch.playMode)
    if (typeof patch.showDesktopLyric === 'boolean') showLyricWindow(patch.showDesktopLyric)
    if (typeof patch.desktopLyricLock === 'boolean') setLyricLock(patch.desktopLyricLock)
    if (typeof patch.fadeMs === 'number') {
      // 立即生效
      player.setVolume(s.volume)
    }
    broadcast('settings:changed', s)
    return s
  },

  /* ---------------- 音源 ---------------- */
  'sources:list': () => {
    const disabled = dbGetSetting<string[]>('sources.disabled') || []
    const deleted = dbGetSetting<string[]>('sources.deleted') || []
    lxHost.setDisabledList(disabled)
    lxHost.setDeletedList(deleted)
    return lxHost.list()
  },
  'sources:platforms': () => lxHost.platformList(),
  'sources:toggle': ({ file, enabled }: { file: string; enabled: boolean }) => {
    lxHost.setEnabled(file, enabled)
    dbSetSetting('sources.disabled', lxHost.getDisabledList())
    broadcast('sources:changed', lxHost.list())
    return lxHost.list()
  },
  'sources:import': async ({ url, content }: { url?: string; content?: string }) => {
    const r = await lxHost.importSource({ url, content })
    broadcast('sources:changed', lxHost.list())
    return { file: r.file, sources: lxHost.list() }
  },
  'sources:code': ({ file }: { file: string }) => lxHost.getSourceCode(file),
  'sources:delete': ({ file }: { file: string }) => {
    lxHost.deleteSource(file)
    dbSetSetting('sources.deleted', lxHost.getDeletedList())
    dbSetSetting('sources.disabled', lxHost.getDisabledList())
    broadcast('sources:changed', lxHost.list())
    return lxHost.list()
  },
  'sources:restore': () => {
    lxHost.restoreBuiltin()
    dbSetSetting('sources.deleted', [])
    dbSetSetting('sources.disabled', [])
    broadcast('sources:changed', lxHost.list())
    return lxHost.list()
  },

  /* ---------------- 音乐数据 ---------------- */
  'music:search': async ({ keyword, page, platform }: any) => decList(await searchAll(keyword, page || 1, { platform })),
  'music:url': async ({ song, quality }: { song: Song; quality: string }) => {
    const { resolveUrl } = await import('./core/music-service')
    return resolveUrl(song, quality || getSettings().quality, getSettings().autoSwitchSource)
  },
  'music:lyric': ({ song }: { song: Song }) => getLyric(song),
  'music:resolve': async ({ song, quality }: any) => {
    const { resolveUrl } = await import('./core/music-service')
    return resolveUrl(song, quality || getSettings().quality, getSettings().autoSwitchSource)
  },
  'music:cover': ({ song }: { song: Song }) => getCover(song),
  'music:playlists': async ({ cat, order, page }: any) => {
    const list = await getPlaylists(cat || '全部', order || 'hot', page || 1)
    return list.map(p => ({ ...p, pic: decPic(p.pic) }))
  },
  'music:playlist': async ({ id, source }: any) => {
    const r = await getPlaylistDetail(id, source || 'wy')
    return { ...r, songs: decList(r.songs) }
  },
  'music:toplists': () => getToplistTree(),
  'music:toplist': async ({ platform, id }: any) => {
    const r = await getToplist(platform, id)
    return { ...r, songs: decList(r.songs) }
  },
  'music:new': async () => decList(await getNewSongs()),
  'music:importPlaylist': async ({ input, platform }: any) => {
    const r = await importPlaylist(input, platform)
    return { ...r, songs: decList(r.songs) }
  },
  'music:mv': async ({ keyword, page }: any) => {
    const list = await searchMv(keyword || '音乐', page || 1)
    return list.map(v => ({ ...v, pic: v.pic && /^https?:\/\//i.test(v.pic) ? coverProtocolUrl(v.pic) : v.pic }))
  },
  'music:mvinfo': ({ bvid }: any) => getMvInfo(bvid),
  'music:mvurl': ({ bvid, cid }: any) => getMvUrl(bvid, cid),
  'music:mvparts': ({ bvid }: any) => getMvParts(bvid),
  'home:feed': async ({ force }: any) => decFeed(await buildHomeFeed(!!force)),

  /* ---------------- 播放器 ---------------- */
  'player:state': () => decState(player.getState()),
  'player:playList': ({ songs, index }: { songs: Song[]; index: number }) => {
    player.setQueue(songs || [], index || 0, true)
    return decState(player.getState())
  },
  'player:playNow': ({ song, songs, index }: { song: Song; songs?: Song[]; index?: number }) => {
    if (songs && songs.length) {
      const i = typeof index === 'number' ? index : songs.findIndex(s => s.id === song.id)
      player.setQueue(songs, Math.max(0, i), true)
    } else {
      const cur = player.getState()
      const i = cur.queue.findIndex(s => s.id === song.id)
      if (i >= 0) player.playAt(i, true)
      else {
        player.addToQueue([song])
        const idx = player.getState().queue.findIndex(s => s.id === song.id)
        player.playAt(idx, true)
      }
    }
    return decState(player.getState())
  },
  'player:playAt': ({ index }: any) => {
    player.playAt(Number(index) || 0, true)
    return decState(player.getState())
  },
  'player:toggle': () => {
    player.toggle()
    return decState(player.getState())
  },
  'player:next': () => {
    player.next(false)
    return decState(player.getState())
  },
  'player:prev': () => {
    player.prev()
    return decState(player.getState())
  },
  'player:seek': ({ time }: any) => {
    player.seek(Number(time) || 0)
    return true
  },
  'player:volume': ({ volume }: any) => {
    player.setVolume(Number(volume))
    saveSettings({ volume: Number(volume) })
    return decState(player.getState())
  },
  'player:mute': ({ muted }: any) => {
    player.setMuted(!!muted)
    return decState(player.getState())
  },
  'player:mode': ({ mode }: any) => {
    player.setMode(mode)
    saveSettings({ playMode: mode })
    return decState(player.getState())
  },
  'player:rate': ({ rate }: any) => {
    player.setRate(Number(rate) || 1)
    return decState(player.getState())
  },
  'player:sleep': ({ minutes }: any) => player.setSleepTimer(Number(minutes) || 0),
  'player:sleepInfo': () => ({ until: player.getSleepUntil() }),
  'music:memory': () => {
    const { playStats } = require('./core/db')
    return playStats()
  },
  'player:quality': ({ quality }: any) => {
    player.setQuality(quality)
    saveSettings({ quality })
    return decState(player.getState())
  },
  'player:addNext': ({ song }: any) => {
    player.addNext(song)
    return decState(player.getState())
  },
  'player:addQueue': ({ songs }: any) => {
    player.addToQueue(songs || [])
    return decState(player.getState())
  },
  'player:removeAt': ({ index }: any) => {
    player.removeAt(Number(index))
    return decState(player.getState())
  },
  'player:move': ({ from, to }: any) => {
    player.moveItem(Number(from), Number(to))
    return decState(player.getState())
  },
  'player:clear': () => {
    player.clearQueue()
    return decState(player.getState())
  },

  /* ---------------- 数据库 ---------------- */
  'db:favorites': () => decList(favoriteSongs()),
  'db:favorite:ids': () => favoriteIds(),
  'db:favorite:is': ({ id }: any) => isFavorite(id),
  'db:favorite:toggle': ({ song }: { song: Song }) => {
    const on = toggleFavorite(song)
    broadcast('toast', { type: 'success', message: on ? '已加入我喜欢的音乐' : '已取消喜欢' })
    return { favorite: on, ids: favoriteIds() }
  },
  'db:history': ({ limit }: any) => decList(historySongs(limit || 100)),
  'db:history:add': ({ song, ms }: any) => {
    addHistory(song, ms || 0)
    return true
  },
  'db:history:clear': () => {
    clearHistory()
    return true
  },
  'db:playlists': () => listPlaylists(),
  'db:playlist:create': ({ name }: any) => {
    const pl = createPlaylist(name)
    return { playlist: pl, list: listPlaylists() }
  },
  'db:playlist:update': ({ id, patch }: any) => {
    updatePlaylist(id, patch || {})
    return listPlaylists()
  },
  'db:playlist:delete': ({ id }: any) => {
    deletePlaylist(id)
    return listPlaylists()
  },
  'db:playlist:songs': ({ id }: any) => decList(playlistSongs(id)),
  'db:playlist:add': ({ id, songs }: any) => {
    const n = addSongsToPlaylist(id, songs || [])
    broadcast('toast', { type: n ? 'success' : 'info', message: n ? `已添加 ${n} 首到歌单` : '歌曲已在该歌单中' })
    return { added: n, list: listPlaylists() }
  },
  'db:playlist:remove': ({ id, songId }: any) => {
    removeSongFromPlaylist(id, songId)
    return playlistSongs(id)
  },
  'db:playlist:reorder': ({ id, ids }: any) => {
    reorderPlaylist(id, ids || [])
    return playlistSongs(id)
  },
  'db:songs': ({ ids }: any) => decList(getSongs(ids || [])),
  'db:stats': () => dbStats(),

  /* ---------------- 本地音乐 ---------------- */
  'library:pick': async () => {
    const r = await dialog.showOpenDialog(wins.main!, {
      title: '选择音乐文件夹',
      properties: ['openDirectory', 'multiSelections'],
    })
    if (r.canceled) return []
    return r.filePaths
  },
  'library:scan': async ({ dirs }: { dirs: string[] }) => {
    const settings = getSettings()
    const list = (dirs && dirs.length ? dirs : settings.localDirs).filter(Boolean)
    if (!list.length) throw new Error('请先选择音乐文件夹')
    const merged = [...new Set([...settings.localDirs, ...list])]
    saveSettings({ localDirs: merged })
    void scanLibrary(merged, p => broadcast('scan:progress', p))
      .then(r => {
        broadcast('scan:progress', { ...getScanProgress(), phase: 'done' })
        broadcast('toast', { type: 'success', message: `扫描完成，曲库共 ${r.total} 首` })
      })
      .catch(e => {
        broadcast('scan:progress', { phase: 'error', found: 0, parsed: 0, current: '', error: friendly(e) })
        broadcast('toast', { type: 'error', message: friendly(e) })
      })
    return { started: true, dirs: merged }
  },
  'library:cancel': () => {
    cancelScan()
    return true
  },
  'library:progress': () => getScanProgress(),
  'library:songs': () => decList(localSongs()),
  'library:count': () => localCount(),
  'library:remove': ({ paths }: any) => {
    const { removeLocalSongs } = require('./core/db')
    removeLocalSongs(paths || [])
    return localSongs()
  },

  /* ---------------- B 站 ---------------- */
  'bili:status': () => biliStatus(),
  'bili:qr': () => biliQrGenerate(),
  'bili:poll': ({ key }: any) => biliQrPoll(key),
  'bili:logout': () => biliLogout(),

  /* ---------------- 窗口 ---------------- */
  'win:minimize': () => {
    wins.main?.minimize()
    return true
  },
  'win:toggleMaximize': () => {
    const w = wins.main
    if (!w) return false
    if (w.isMaximized()) w.unmaximize()
    else w.maximize()
    return w.isMaximized()
  },
  'win:close': () => {
    wins.main?.close()
    return true
  },
  'win:state': () => ({ maximized: !!wins.main?.isMaximized() }),
  'lyric:visible': ({ visible }: any) => {
    showLyricWindow(!!visible)
    return true
  },
  'lyric:lock': ({ locked }: any) => {
    setLyricLock(!!locked)
    return true
  },

  /* ---------------- 缓存 ---------------- */
  'cache:size': () => {
    let media = 0
    try {
      media = fs.readdirSync(mediaCacheDir()).reduce((sum, f) => {
        try {
          return sum + fs.statSync(path.join(mediaCacheDir(), f)).size
        } catch {
          return sum
        }
      }, 0)
    } catch {
      media = 0
    }
    return { cover: coverCacheSize(), media, total: coverCacheSize() + media }
  },
  'cache:pickDir': async () => {
    const r = await dialog.showOpenDialog(wins.main!, {
      title: '选择缓存目录',
      properties: ['openDirectory', 'createDirectory'],
    })
    if (r.canceled || !r.filePaths[0]) return ''
    return r.filePaths[0]
  },
  'cache:setDir': ({ dir }: any) => {
    const target = String(dir || '').trim()
    const oldRoot = cacheRootDir()
    const s = saveSettings({ cacheDir: target })
    const newRoot = cacheRootDir()
    if (target && oldRoot !== newRoot) {
      try {
        ensureDir(newRoot)
        for (const sub of ['covers', 'media']) {
          const from = path.join(oldRoot, sub)
          const to = path.join(newRoot, sub)
          ensureDir(to)
          if (!fs.existsSync(from)) continue
          for (const f of fs.readdirSync(from)) {
            const src = path.join(from, f)
            const dst = path.join(to, f)
            if (fs.existsSync(dst)) continue
            try {
              fs.renameSync(src, dst)
            } catch {
              try {
                fs.copyFileSync(src, dst)
                fs.unlinkSync(src)
              } catch {
                /* 单个文件迁移失败忽略 */
              }
            }
          }
        }
      } catch (e: any) {
        logger.warn('缓存迁移失败', e?.message)
      }
    }
    broadcast('settings:changed', s)
    return { settings: s, dir: newRoot, size: coverCacheSize() }
  },
  'cache:openDir': async () => {
    await shell.openPath(cacheRootDir())
    return true
  },
  'cache:clear': () => {
    clearCoverCache()
    try {
      for (const f of fs.readdirSync(mediaCacheDir())) fs.unlinkSync(path.join(mediaCacheDir(), f))
    } catch {
      /* ignore */
    }
    return { cover: 0, media: 0, total: 0 }
  },
}

export function registerIpc(): void {
  ipcMain.handle('sw:invoke', async (event, channel: string, payload: any) => {
    const fn = handlers[channel]
    if (!fn) {
      return { ok: false, error: `未实现的能力：${channel}` }
    }
    try {
      const data = await fn(payload || {}, event)
      return { ok: true, data }
    } catch (e: any) {
      logger.warn('IPC 调用失败', channel, e?.message)
      return { ok: false, error: friendly(e) }
    }
  })

  ipcMain.on('host:event', (_e, msg) => {
    player.onHostMessage(msg)
  })

  ipcMain.on('win:maximized', (_e, v) => {
    sendToMain('window:state', { maximized: !!v })
  })

  ipcMain.on('player:internal-history', (_e, payload) => {
    if (payload?.song) addHistory(payload.song, payload.ms || 0)
  })
}

export function navigateMain(route: string): void {
  sendToMain('app:navigate', { route })
}

export function notifyMain(channel: string, payload: any): void {
  sendToMain(channel, payload)
}

