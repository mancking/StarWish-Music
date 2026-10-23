import { app, dialog, ipcMain, nativeTheme, session, shell } from 'electron'
import fs from 'node:fs'
import path from 'node:path'
import type { AppSettings, Song } from '../shared/types'
import { createLogger } from './core/log'
import { lxHost } from './core/lx-host'
import * as mfHost from './core/mf-host'
import {
  getCover,
  getLyric,
  getMvInfo,
  getMvParts,
  getMvUrl,
  getNewSongs,
  getPlaylistDetail,
  getPlaylistTags,
  getPlaylists,
  getPodcastEpisodes,
  getToplist,
  getToplistTree,
  importPlaylist,
  searchAll,
  searchMv,
} from './core/music-service'
import { buildHomeFeed, invalidateFeed } from './core/recommend'
import { buildRadio, invalidateRadio } from './core/radio'
import { player } from './core/player-service'
import { listWallpapers, saveWallpaper, removeWallpaper, renameWallpaper, importWallpaperFromPath } from './core/wallpaper'
import { getDanmaku } from './core/danmaku'
import { testConnection, uploadBackup } from './core/webdav'
import {
  addDownloads,
  cancelDownload,
  clearDownloads,
  downloadDir,
  listDownloads,
  pauseDownload,
  removeDownload,
  restoreDownloads,
  resumeDownload,
  setDownloadEmitter,
} from './core/download'
import { getSettings, saveSettings } from './core/settings'
import { downloadDesktopUpdate, relaunchWithUpdate } from './core/updater'
import { applyTitleBarTheme, broadcast, sendToMain, setLyricLock, showLyricWindow, showTaskbarLyric, wins } from './windows'
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
import { biliLogout, biliQrGenerate, biliQrPoll, biliStatus, biliCookieLogin, biliPasswordLogin } from './core/bili'
import { cancelScan, getScanProgress, scanLibrary } from './core/library'
import { coverCacheSize, clearCoverCache, coverProtocolUrl } from './core/cover'
import { downloadMediaTo, releaseMediaCache, saveOfflineVideo, listOfflineVideos, removeOfflineVideos, offlineVideoFile } from './core/media'
import {
  cacheRootDir,
  coverCacheDir,
  dataDirPointerFile,
  ensureDir,
  logDir,
  logRootDir,
  mediaCacheDir,
  userDataDir,
} from './core/paths'

const logger = createLogger('ipc')

/** 把 from 里的文件搬进 to（同名跳过），跨盘失败时退化为复制后删除 */
function moveDirContents(from: string, to: string): void {
  if (!fs.existsSync(from)) return
  ensureDir(to)
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

function statSize(p: string): number {
  try {
    const st = fs.statSync(p)
    if (!st.isDirectory()) return st.size
    return fs.readdirSync(p).reduce((sum, f) => sum + statSize(path.join(p, f)), 0)
  } catch {
    return 0
  }
}

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

/**
 * 应用系统代理。作用于 defaultSession 的全部请求（音源、封面、弹幕、WebDAV），
 * 而不是只包一层 fetch —— 后者会漏掉 <img> 与自定义协议的请求。
 */
export function applyProxy(s: AppSettings): void {
  const rules = s.proxyEnabled && (s.proxyUrl || '').trim() ? (s.proxyUrl || '').trim() : 'direct://'
  try {
    void session.defaultSession
      .setProxy({ proxyRules: rules })
      .then(() => session.defaultSession.closeAllConnections())
      .catch((e: any) => logger.warn('设置代理失败', e?.message))
  } catch (e: any) {
    logger.warn('设置代理失败', e?.message)
  }
}

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
  'app:relaunch': () => {
    app.relaunch()
    app.exit(0)
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
  /** 桌面端应用内更新：下载新版安装包到 <userData>/update/，完成后可重启替换 */
  'app:downloadUpdate': async ({ url, version }: { url: string; version: string }) => {
    if (!/^https?:\/\//i.test(String(url || ''))) throw new Error('更新地址无效')
    const r = await downloadDesktopUpdate(url, version, p => broadcast('update:progress', p))
    return r
  },
  'app:relaunchWithUpdate': ({ path: p }: { path: string }) => {
    relaunchWithUpdate(p)
    return true
  },
  'app:showUpdateFile': ({ path: p }: { path: string }) => {
    shell.showItemInFolder(p)
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
    if (typeof patch.showTaskbarLyric === 'boolean') showTaskbarLyric(patch.showTaskbarLyric)
    if (typeof patch.playbackRate === 'number') player.setRate(patch.playbackRate)
    if (typeof patch.proxyEnabled === 'boolean' || patch.proxyUrl !== undefined) applyProxy(s)
    if (typeof patch.autoLaunch === 'boolean') {
      try {
        app.setLoginItemSettings({ openAtLogin: patch.autoLaunch, args: ['--hidden'] })
      } catch (e: any) {
        logger.warn('设置开机启动失败', e?.message)
      }
    }
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
  'sources:import': async ({ url, content, file }: { url?: string; content?: string; file?: string }) => {
    const r = await lxHost.importSource({ url, content, file })
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

  /* ---------------- 插件库（MusicFree 协议） ---------------- */
  'plugins:list': () => mfHost.list(),
  'plugins:code': ({ file }: { file: string }) => mfHost.getSourceCode(file),
  'plugins:toggle': ({ file, enabled }: { file: string; enabled: boolean }) => mfHost.togglePlugin(file, enabled),
  'plugins:delete': ({ file }: { file: string }) => mfHost.deletePlugin(file),
  'plugins:import': async ({ url, content, file }: { url?: string; content?: string; file?: string }) => {
    if (url) return await mfHost.importFromUrl(url, file)
    if (content) return mfHost.importFromContent(content, 'local', undefined, file)
    throw new Error('请提供插件链接或内容')
  },
  'plugins:subscribe': async ({ url, name }: { url: string; name?: string }) =>
    await mfHost.importSubscription(url, name),
  'plugins:subs:list': () => mfHost.listSubscriptions(),
  'plugins:subs:remove': ({ url }: { url: string }) => mfHost.removeSubscription(url),
  'plugins:market': async ({ url }: { url: string }) => await mfHost.fetchMarket(url),
  'plugins:search': async ({ file, query, page, type }: any) => await mfHost.search(file, query, page || 1, type || 'music'),
  'plugins:lyric': async ({ file, musicItem }: any) => await mfHost.getLyric(file, musicItem),
  'plugins:url': async ({ file, musicItem, quality }: any) => await mfHost.getMusicUrl(file, musicItem, quality || 'standard'),

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
  'podcast:episodes': async ({ feed, limit }: { feed: string; limit?: number }) =>
    decList(await getPodcastEpisodes(feed, limit || 100)),
  'music:playlists': async ({ cat, order, page, source }: any) => {
    const list = await getPlaylists(cat || '全部', order || 'hot', page || 1, source || 'wy')
    return list.map(p => ({ ...p, pic: decPic(p.pic) }))
  },
  'music:playlistTags': async ({ source }: any) => {
    return getPlaylistTags(source || 'wy')
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
  'music:mvurl': ({ bvid, cid, qn }: any) => getMvUrl(bvid, cid, qn),
  'music:mvparts': ({ bvid }: any) => getMvParts(bvid),
  'home:feed': async ({ force }: any) => decFeed(await buildHomeFeed(!!force)),
  /** 私人电台：按口味生成可连续播放的新歌队列（换一批时 force=true） */
  'radio:build': async ({ force, size }: any) => {
    const r = await buildRadio(!!force, Number(size) || 60)
    return { songs: r.songs.map(dec), seeds: r.seeds, generatedAt: r.generatedAt }
  },

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
  // 音效与频谱（规格书 v2.7 · 1.11 / 1.6）
  'player:eq': ({ bands }: any) => {
    player.setEq(Array.isArray(bands) ? bands : [])
    return true
  },
  'player:spectrum': ({ on }: any) => {
    player.setSpectrum(!!on)
    return true
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
  /* 视频：保存整片到用户选择的位置（临时缓存不动） */
  'video:save': async ({ url, title }: { url: string; title?: string }) => {
    if (!url) throw new Error('缺少视频地址')
    const r = await dialog.showSaveDialog(wins.main!, {
      title: '保存视频',
      defaultPath: `${(title || '视频').replace(/[\\/:*?"<>|]/g, '_')}.mp4`,
      filters: [{ name: 'MP4 视频', extensions: ['mp4'] }],
    })
    if (r.canceled || !r.filePath) return null
    await downloadMediaTo(url, r.filePath)
    return r.filePath
  },
  /* 视频：释放某个视频的临时缓存（关闭页面/切分P 时调用；不传 url 整体清空） */
  'video:cache:release': async ({ url }: { url?: string }) => {
    await releaseMediaCache(url)
    return true
  },
  /* 视频：离线缓存 —— 检查某 bvid+cid 是否已离线（返回本地路径，供直接播放） */
  'video:offline:file': ({ bvid, cid }: { bvid: string; cid: string }) => offlineVideoFile(bvid, cid),
  /* 视频：离线缓存 —— 整片下载到离线目录 */
  'video:offline:save': async ({ bvid, cid, url, title }: { bvid: string; cid: string; url: string; title?: string }) => {
    if (!url) throw new Error('缺少视频地址')
    return saveOfflineVideo(bvid, cid, url, title)
  },
  /* 视频：离线缓存 —— 管理面板：列出离线视频 + 总占用 */
  'video:offline:list': () => listOfflineVideos(),
  /* 视频：离线缓存 —— 删除单个（传 key）或清空全部（不传） */
  'video:offline:remove': ({ key }: { key?: string }) => removeOfflineVideos(key),
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
  'library:songs': ({ limit, offset }: any) => decList(localSongs(limit || 200, offset || 0)),
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
  'bili:cookieLogin': ({ cookie }: any) => biliCookieLogin(String(cookie || '')),
  'bili:passwordLogin': ({ username, password }: any) => biliPasswordLogin(String(username || ''), String(password || '')),

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
      const dir = mediaCacheDir()
      media = fs.readdirSync(dir).reduce((sum, f) => {
        try {
          return sum + fs.statSync(path.join(dir, f)).size
        } catch {
          return sum
        }
      }, 0)
    } catch {
      media = 0
    }
    const cover = coverCacheSize()
    return { cover, media, total: cover + media }
  },
  'cache:pickDir': async ({ title }: any = {}) => {
    const r = await dialog.showOpenDialog(wins.main!, {
      title: String(title || '选择缓存目录'),
      properties: ['openDirectory', 'createDirectory'],
    })
    if (r.canceled || !r.filePaths[0]) return ''
    return r.filePaths[0]
  },
  'wallpaper:pick': async () => {
    const r = await dialog.showOpenDialog(wins.main!, {
      title: '选择播放页壁纸',
      properties: ['openFile'],
      filters: [{ name: '图片', extensions: ['jpg', 'jpeg', 'png', 'webp', 'bmp', 'gif', 'avif'] }],
    })
    return r.canceled || !r.filePaths[0] ? '' : r.filePaths[0]
  },
  // ---------------- 壁纸引擎（图片） ----------------
  'wallpaper:list': () => listWallpapers(),
  'wallpaper:save': (p: any) => saveWallpaper(p || {}),
  'wallpaper:import': (p: any) => importWallpaperFromPath(String(p?.path || ''), String(p?.name || '')),
  'wallpaper:remove': (p: any) => ({ ok: removeWallpaper(String(p?.id || '')) }),
  'wallpaper:rename': (p: any) => ({ ok: renameWallpaper(String(p?.id || ''), String(p?.name || '')) }),
  // ---------------- 视频弹幕 ----------------
  'mv:danmaku': (p: any) => getDanmaku(String(p?.cid || '')),
  // ---------------- WebDAV 备份（单向） ----------------
  'webdav:test': () => testConnection(),
  'webdav:upload': () => uploadBackup(),

  // ---------------- 下载 ----------------
  'download:add': ({ songs, quality }: any) => addDownloads(songs || [], quality),
  'download:list': () => listDownloads(),
  'download:cancel': ({ id }: any) => ({ ok: cancelDownload(String(id || '')) }),
  'download:pause': ({ id }: any) => ({ ok: pauseDownload(String(id || '')) }),
  'download:resume': ({ id }: any) => ({ ok: resumeDownload(String(id || '')) }),
  'download:remove': ({ id, deleteFile }: any) => ({ ok: removeDownload(String(id || ''), !!deleteFile) }),
  'download:clear': ({ onlyFinished }: any) => ({ count: clearDownloads(onlyFinished !== false) }),
  'download:dir': () => downloadDir(),
  'download:openDir': async () => {
    await shell.openPath(downloadDir())
    return true
  },
  'download:pickDir': async () => {
    const r = await dialog.showOpenDialog(wins.main!, {
      title: '选择下载目录',
      properties: ['openDirectory', 'createDirectory'],
    })
    if (r.canceled || !r.filePaths[0]) return ''
    saveSettings({ downloadDir: r.filePaths[0] })
    broadcast('settings:changed', getSettings())
    return r.filePaths[0]
  },
  // kind: cache | cover | media —— 三类目录各自可改，均把旧内容搬到新位置
  'cache:setDir': ({ dir, kind = 'cache' }: any) => {
    const target = String(dir || '').trim()
    const key = kind === 'cover' ? 'coverDir' : kind === 'media' ? 'mediaDir' : 'cacheDir'
    const resolve = (): string =>
      kind === 'cover' ? coverCacheDir() : kind === 'media' ? mediaCacheDir() : cacheRootDir()
    const oldDir = resolve()
    const s = saveSettings({ [key]: target } as Partial<AppSettings>)
    const newDir = resolve()
    if (target && oldDir !== newDir) {
      try {
        ensureDir(newDir)
        if (kind === 'cache') {
          for (const sub of ['covers', 'media']) moveDirContents(path.join(oldDir, sub), path.join(newDir, sub))
        } else {
          moveDirContents(oldDir, newDir)
        }
      } catch (e: any) {
        logger.warn('缓存迁移失败', e?.message)
      }
    }
    broadcast('settings:changed', s)
    return { settings: s, dir: newDir, size: coverCacheSize() }
  },
  'cache:openDir': async ({ kind }: any = {}) => {
    await shell.openPath(kind === 'cover' ? coverCacheDir() : kind === 'media' ? mediaCacheDir() : cacheRootDir())
    return true
  },
  // 日志目录：改后把旧日志搬到新目录，后续写入新目录（log.ts 每次写都重新解析 logDir）
  'log:setDir': ({ dir }: any) => {
    const target = String(dir || '').trim()
    const oldDir = logRootDir()
    const s = saveSettings({ logDir: target } as Partial<AppSettings>)
    const newDir = logRootDir()
    if (oldDir !== newDir) {
      try {
        moveDirContents(oldDir, newDir)
      } catch (e: any) {
        logger.warn('日志迁移失败', e?.message)
      }
    }
    broadcast('settings:changed', s)
    return { settings: s, dir: newDir }
  },
  // scope: cover | media | all
  'cache:clear': ({ scope = 'all' }: any = {}) => {
    if (scope === 'all' || scope === 'cover') clearCoverCache()
    if (scope === 'all' || scope === 'media') {
      try {
        const dir = mediaCacheDir()
        for (const f of fs.readdirSync(dir)) fs.unlinkSync(path.join(dir, f))
      } catch {
        /* ignore */
      }
    }
    let media = 0
    try {
      const dir = mediaCacheDir()
      media = fs.readdirSync(dir).reduce((sum, f) => {
        try {
          return sum + fs.statSync(path.join(dir, f)).size
        } catch {
          return sum
        }
      }, 0)
    } catch {
      media = 0
    }
    const cover = coverCacheSize()
    return { cover, media, total: cover + media }
  },

  /* ---------------- 数据目录 ---------------- */
  'data:setDir': ({ dir }: any) => {
    const target = String(dir || '').trim()
    const oldDir = userDataDir()
    if (target && path.resolve(target) === path.resolve(oldDir)) {
      return { dir: oldDir, restart: false }
    }
    if (target) {
      ensureDir(target)
      // 只搬走不可再生的用户数据；缓存与日志迁移后自动重建，不搬
      for (const item of ['starwish.db', 'settings.json', 'bili-login.json']) {
        const from = path.join(oldDir, item)
        if (!fs.existsSync(from)) continue
        const to = path.join(target, item)
        try {
          fs.copyFileSync(from, to)
        } catch (e: any) {
          logger.warn('数据目录迁移失败', item, e?.message)
          throw new Error(`数据目录迁移失败：${item} 无法写入，请换一个目录`)
        }
      }
      try {
        fs.cpSync(path.join(oldDir, 'sources'), path.join(target, 'sources'), { recursive: true })
      } catch {
        /* 音源目录缺失时忽略 */
      }
      saveSettings({ dataDir: target } as Partial<AppSettings>)
      try {
        fs.writeFileSync(dataDirPointerFile(), target, 'utf8')
      } catch (e: any) {
        logger.warn('数据目录指针写入失败', e?.message)
        throw new Error('无法记录新的数据目录，请换一个目录重试')
      }
    } else {
      saveSettings({ dataDir: '' } as Partial<AppSettings>)
      try {
        fs.unlinkSync(dataDirPointerFile())
      } catch {
        /* 指针本就不存在 */
      }
    }
    broadcast('settings:changed', getSettings())
    return { dir: target || path.join(app.getPath('appData'), 'StarWish'), restart: true }
  },
  'data:openDir': async () => {
    await shell.openPath(userDataDir())
    return true
  },
  // 清理数据目录中可再生部分：缓存、日志、临时文件；数据库 / 设置 / 登录态 / 音源一律不动
  'data:clear': () => {
    clearCoverCache()
    let freed = 0
    for (const dir of [mediaCacheDir(), logDir(), path.join(userDataDir(), 'temp')]) {
      try {
        for (const f of fs.readdirSync(dir)) {
          const p = path.join(dir, f)
          try {
            freed += statSize(p)
            fs.rmSync(p, { recursive: true, force: true })
          } catch {
            /* 文件被占用时跳过 */
          }
        }
      } catch {
        /* 目录不存在 */
      }
    }
    return { freed }
  },
}

/**
 * 启动就绪门控。
 *
 * 窗口现在先于数据库/音源初始化创建（见 main.ts bootstrap），因此渲染层可能在
 * DB 就绪前就发来 IPC（例如 db:favorites、home:feed）。这些调用不能直接报错，
 * 否则首屏就是一堆「未实现/数据库未就绪」错误。
 *
 * 这里用一个可等待的 Promise 做闸门：IPC 注册即可接收调用，但真正执行前
 * 先 await 启动就绪信号，最多等 bootTimeout 毫秒，超时则放行（走各自的降级分支）。
 */
let bootReadyResolve: (() => void) | null = null
const bootReadyPromise = new Promise<void>(resolve => {
  bootReadyResolve = resolve
})
const BOOT_TIMEOUT = 20000
let bootResolved = false

/** 标记启动就绪：数据库、音源、IPC 依赖均已可用 */
export function markBootReady(): void {
  if (bootResolved) return
  bootResolved = true
  bootReadyResolve?.()
}

/** 启动就绪信号（供其它模块 await） */
export function whenBootReady(): Promise<void> {
  return bootReadyPromise
}

export function registerIpc(): void {
  restoreDownloads()
  setDownloadEmitter(t => broadcast('download:progress', t))
  ipcMain.handle('sw:invoke', async (event, channel: string, payload: any) => {
    const fn = handlers[channel]
    if (!fn) {
      return { ok: false, error: `未实现的能力：${channel}` }
    }
    try {
      // 等待启动就绪（DB / 音源）。已就绪时这段 await 直接返回，不产生额外延迟。
      if (!bootResolved) {
        await Promise.race([
          bootReadyPromise,
          new Promise<void>(resolve => setTimeout(resolve, BOOT_TIMEOUT)),
        ])
      }
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

