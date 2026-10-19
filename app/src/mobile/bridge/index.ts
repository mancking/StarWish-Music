/**
 * `window.sw` 的移动端实现。
 *
 * 桌面由 `electron/preload.ts` 注入，WebView 里没有 preload，所以这里装一个
 * 契约逐字段一致的替身：`invoke(channel, payload)` 返回同一个
 * `{ok:true,data} | {ok:false,error}` 信封，`on(channel, cb)` 走同一份
 * 事件白名单。renderer（`src/api.ts`）因此**零改动**即可在 WebView 里跑。
 *
 * 业务实现复用 electron/core 原模块（只通过 vite 别名换掉 node 内置依赖）：
 *   - 虚拟 fs + sql.js + IndexedDB  → db
 *   - shims/vm + 内置音源种子       → lx-host
 *   - providers / music-service / recommend 原样
 *   - 播放器换成 src/mobile/player.ts（<audio>）
 */
import type { Song } from '@shared/types'
import { emit, subscribe } from '../bus'
import { fail, ok } from './envelope'
import { player } from '../player'
import * as vfs from '../shims/vfs'
import { seedSources, seedPlugins } from '../seed'
import { registerBufferGlobal, patchFetch } from '../shims/util'
import { initDb, setSqlJsLoader } from '../../../electron/core/db'
import { lxHost } from '../../../electron/core/lx-host'
import * as mfHost from '../../../electron/core/mf-host'
import { initBiliLogin } from '../../../electron/core/bili'
import { loadSettings, saveSettings, getSettings } from '../../../electron/core/settings'
import { userDataDir } from '../../../electron/core/paths'
import { dbStats, playStats, favoriteIds, favoriteSongs, toggleFavorite, historySongs, addHistory, clearHistory, listPlaylists, createPlaylist, updatePlaylist, deletePlaylist, playlistSongs, addSongsToPlaylist, removeSongFromPlaylist, reorderPlaylist, getSongs, localSongs, localCount, removeLocalSongs, dbGetSetting, dbSetSetting, isFavorite } from '../../../electron/core/db'
import {
  searchAll, getLyric, getCover, getPlaylists, getPlaylistTags, getPlaylistDetail, getToplist, getToplistTree,
  getNewSongs, importPlaylist, searchMv, getMvInfo, getMvParts, getMvUrl, getPodcastEpisodes,
} from '../../../electron/core/music-service'
import { buildHomeFeed } from '../../../electron/core/recommend'
import { biliStatus, biliQrGenerate, biliQrPoll, biliLogout } from '../../../electron/core/bili'

let started = false

async function boot(): Promise<void> {
  if (started) return
  started = true

  // 0) 全局 Buffer + fetch 代理：electron/core/lx-host.ts 的音源沙箱直接注入
  //    全局 Buffer，electron/core/http.ts 用裸 fetch——两者在浏览器里都不可用。
  //    顺序：先 patchFetch（让 http.ts 的 fetch 走同源代理），再 registerBufferGlobal。
  patchFetch()
  registerBufferGlobal()

  // 1) 虚拟文件系统：先本地恢复，再用内置音源/插件种子播种
  await vfs.initFs()
  seedSources()
  seedPlugins()
  // 内置 MusicFree 插件预热（init 是同步 void；逐个插件失败不会抛）
  try { mfHost.init() } catch { /* 预热失败不阻断启动 */ }

  // 2) sql.js：浏览器用 wasm 的 ESM 入口。vite 会把 UMD 的 sql-wasm.js
  // 打成 lazy chunk，其默认导出是"已初始化的模块"（db.ts 直接取 Database）。
  // locateFile 用 new URL(..., import.meta.url) 让 wasm 与 chunk 同目录，
  // 这样 file:// 与 http:// 两种加载方式都能找到（acp 冒烟走 http://）。
  setSqlJsLoader(async () => {
    const mod: any = await import('sql.js')
    const SQL = mod.default || mod
    if (SQL && typeof SQL.Database === 'function') return SQL
    // 万一拿到的是工厂（旧版本 UMD 行为），这里兼容调用一次
    const init: any = SQL
    return init({
      locateFile: (f: string) => new URL('./' + f, import.meta.url).href,
    })
  })

  // 3) 设置与数据库
  loadSettings()
  await initDb()
  initBiliLogin()

  // 4) 音源沙箱（vm shim + 种子文件）
  await lxHost.load()

  // 5) 播放器
  player.init()

  // 6) 睡眠关机轮询（桌面由 player-service 内部定时器做）
  window.setInterval(() => player.checkSleep(), 20000)
}

/* ---------------- handlers ---------------- */

type Handler = (payload: any) => Promise<any> | any

const NOP_OK = () => true
const UNSUPPORTED = (what: string) => () => { throw new Error(`移动端暂不支持${what}`) }

const handlers: Record<string, Handler> = {
  /* ---- 应用 ---- */
  'app:info': () => ({
    version: '2.1.0',
    name: '星河音乐',
    electron: '',
    chrome: '',
    node: '',
    platform: 'android',
    userData: userDataDir(),
    sources: lxHost.list().length,
    sourcesOk: lxHost.list().filter(s => !s.loadError).length,
    db: dbStats(),
    coverCache: 0, // 移动端无磁盘封面缓存
  }),
  'app:quit': NOP_OK,
  'app:relaunch': NOP_OK,
  'app:openExternal': UNSUPPORTED('打开外部浏览器'),
  'app:showItemInFolder': UNSUPPORTED('在文件夹中显示'),

  /* ---- 设置 ---- */
  'settings:get': () => getSettings(),
  'settings:set': (patch: any) => {
    const s = saveSettings(patch || {})
    if (typeof patch?.volume === 'number') player.setVolume(patch.volume)
    if (patch?.quality) player.setQuality(patch.quality)
    if (patch?.playMode) player.setMode(patch.playMode)
    emit('settings:changed', s)
    return s
  },

  /* ---- 音源 ---- */
  'sources:list': () => {
    const disabled = dbGetSetting<string[]>('sources.disabled') || []
    const deleted = dbGetSetting<string[]>('sources.deleted') || []
    lxHost.setDisabledList(disabled)
    lxHost.setDeletedList(deleted)
    return lxHost.list()
  },
  'sources:platforms': () => lxHost.platformList(),
  'sources:toggle': ({ file, enabled }: any) => {
    lxHost.setEnabled(file, enabled)
    dbSetSetting('sources.disabled', lxHost.getDisabledList())
    emit('sources:changed', lxHost.list())
    return lxHost.list()
  },
  'sources:import': async ({ url, content }: any) => {
    const r = await lxHost.importSource({ url, content })
    emit('sources:changed', lxHost.list())
    return { file: r.file, sources: lxHost.list() }
  },
  'sources:code': ({ file }: any) => lxHost.getSourceCode(file),
  'sources:delete': ({ file }: any) => {
    lxHost.deleteSource(file)
    dbSetSetting('sources.deleted', lxHost.getDeletedList())
    dbSetSetting('sources.disabled', lxHost.getDisabledList())
    emit('sources:changed', lxHost.list())
    return lxHost.list()
  },
  'sources:restore': () => {
    lxHost.restoreBuiltin()
    dbSetSetting('sources.deleted', [])
    dbSetSetting('sources.disabled', [])
    emit('sources:changed', lxHost.list())
    return lxHost.list()
  },

  /* ---- MusicFree 插件 ---- */
  'plugins:list': () => mfHost.list(),
  'plugins:code': ({ file }: any) => mfHost.getSourceCode(file),
  'plugins:toggle': async ({ file, enabled }: any) => {
    await mfHost.togglePlugin(file, enabled)
    emit('plugins:changed', mfHost.list())
    return mfHost.list()
  },
  'plugins:delete': async ({ file }: any) => {
    await mfHost.deletePlugin(file)
    emit('plugins:changed', mfHost.list())
    return mfHost.list()
  },
  'plugins:import': async ({ url, content, origin }: any) => {
    if (url) await mfHost.importFromUrl(url)
    else if (content) await mfHost.importFromContent(content, origin || 'local', url)
    emit('plugins:changed', mfHost.list())
    return mfHost.list()
  },
  'plugins:subscribe': async ({ url, name }: any) => {
    const r = await mfHost.importSubscription(url, name)
    emit('plugins:changed', mfHost.list())
    return { ...r, list: mfHost.list(), subs: mfHost.listSubscriptions() }
  },
  'plugins:subs:list': () => mfHost.listSubscriptions(),
  'plugins:subs:remove': async ({ url }: any) => {
    await mfHost.removeSubscription(url)
    return mfHost.listSubscriptions()
  },
  'plugins:search': ({ file, query, page, type }: any) => mfHost.search(file, query, page, type),
  'plugins:lyric': ({ file, musicItem }: any) => mfHost.getLyric(file, musicItem),
  'plugins:url': ({ file, musicItem, quality }: any) => mfHost.getMediaSource(file, musicItem, quality),

  /* ---- 音乐数据 ---- */
  'music:search': async ({ keyword, page, platform }: any) => searchAll(keyword, page || 1, { platform }),
  'music:url': ({ song, quality }: any) => resolveInline(song, quality),
  'music:resolve': ({ song, quality }: any) => resolveInline(song, quality),
  'music:lyric': ({ song }: any) => getLyric(song),
  'music:cover': ({ song }: any) => getCover(song),
  'podcast:episodes': ({ feed, limit }: any) => getPodcastEpisodes(feed, limit || 100),
  'music:playlists': ({ cat, order, page, source }: any) =>
    getPlaylists(cat || '全部', order || 'hot', page || 1, source || 'wy'),
  'music:playlistTags': ({ source }: any) => getPlaylistTags(source || 'wy'),
  'music:playlist': ({ id, source }: any) => getPlaylistDetail(id, source || 'wy'),
  'music:toplists': () => getToplistTree(),
  'music:toplist': ({ platform, id }: any) => getToplist(platform, id),
  'music:new': () => getNewSongs(),
  'music:importPlaylist': ({ input, platform }: any) => importPlaylist(input, platform),
  'music:mv': ({ keyword, page }: any) => searchMv(keyword || '音乐', page || 1),
  'music:mvinfo': ({ bvid }: any) => getMvInfo(bvid),
  'music:mvurl': ({ bvid, cid, qn }: any) => getMvUrl(bvid, cid, qn),
  'music:mvparts': ({ bvid }: any) => getMvParts(bvid),
  'home:feed': async ({ force }: any) => buildHomeFeed(!!force),
  'music:memory': () => playStats(),

  /* ---- 播放器 ---- */
  'player:state': () => player.getState(),
  'player:playList': ({ songs, index }: any) => player.setQueue(songs || [], index || 0, true),
  'player:playNow': ({ song, songs, index }: any) => player.playNow(song, songs, index),
  'player:playAt': ({ index }: any) => player.playAt(Number(index) || 0, true),
  'player:toggle': () => player.toggle(),
  'player:next': () => player.next(false),
  'player:prev': () => player.prev(),
  'player:seek': ({ time }: any) => player.seek(Number(time) || 0),
  'player:volume': ({ volume }: any) => { saveSettings({ volume: Number(volume) }); return player.setVolume(Number(volume)) },
  'player:mute': ({ muted }: any) => player.setMuted(!!muted),
  'player:mode': ({ mode }: any) => player.setMode(mode),
  'player:rate': ({ rate }: any) => player.setRate(Number(rate) || 1),
  'player:sleep': ({ minutes }: any) => player.setSleepTimer(Number(minutes) || 0),
  'player:sleepInfo': () => ({ until: player.getSleepUntil() }),
  'player:quality': ({ quality }: any) => player.setQuality(quality),
  'player:addNext': ({ song }: any) => player.addNext(song),
  'player:addQueue': ({ songs }: any) => player.addToQueue(songs || []),
  'player:removeAt': ({ index }: any) => player.removeAt(Number(index)),
  'player:move': ({ from, to }: any) => player.moveItem(Number(from), Number(to)),
  'player:clear': () => player.clearQueue(),

  /* ---- 数据库 ---- */
  'db:favorites': () => favoriteSongs(),
  'db:favorite:ids': () => favoriteIds(),
  'db:favorite:is': ({ id }: any) => isFavorite(id),
  'db:favorite:toggle': ({ song }: any) => {
    const on = toggleFavorite(song)
    emit('toast', { type: 'success', message: on ? '已加入我喜欢的音乐' : '已取消喜欢' })
    return { favorite: on, ids: favoriteIds() }
  },
  'db:history': ({ limit }: any) => historySongs(limit || 100),
  'db:history:add': ({ song, ms }: any) => { addHistory(song, ms || 0); return true },
  'db:history:clear': () => { clearHistory(); return true },
  'db:playlists': () => listPlaylists(),
  'db:playlist:create': ({ name }: any) => ({ playlist: createPlaylist(name), list: listPlaylists() }),
  'db:playlist:update': ({ id, patch }: any) => { updatePlaylist(id, patch || {}); return listPlaylists() },
  'db:playlist:delete': ({ id }: any) => { deletePlaylist(id); return listPlaylists() },
  'db:playlist:songs': ({ id }: any) => playlistSongs(id),
  'db:playlist:add': ({ id, songs }: any) => {
    const n = addSongsToPlaylist(id, songs || [])
    emit('toast', { type: n ? 'success' : 'info', message: n ? `已添加 ${n} 首到歌单` : '歌曲已在该歌单中' })
    return { added: n, list: listPlaylists() }
  },
  'db:playlist:remove': ({ id, songId }: any) => { removeSongFromPlaylist(id, songId); return playlistSongs(id) },
  'db:playlist:reorder': ({ id, ids }: any) => { reorderPlaylist(id, ids || []); return playlistSongs(id) },
  'db:songs': ({ ids }: any) => getSongs(ids || []),
  'db:stats': () => dbStats(),

  /* ---- 本地音乐：WebView 无文件系统扫描能力，诚实返回 ---- */
  'library:pick': UNSUPPORTED('选择本地音乐文件夹（请使用桌面版扫描本地曲库）'),
  'library:scan': UNSUPPORTED('扫描本地音乐（请使用桌面版）'),
  'library:cancel': NOP_OK,
  'library:progress': () => ({ phase: 'idle', found: 0, parsed: 0, current: '' }),
  'library:songs': () => localSongs(),
  'library:count': () => localCount(),
  'library:remove': ({ paths }: any) => { removeLocalSongs(paths || []); return localSongs() },

  /* ---- B 站 ---- */
  'bili:status': () => biliStatus(),
  'bili:qr': () => biliQrGenerate(),
  'bili:poll': ({ key }: any) => biliQrPoll(key),
  'bili:logout': () => biliLogout(),

  /* ---- 窗口 / 歌词：移动端 no-op ---- */
  'win:minimize': NOP_OK,
  'win:toggleMaximize': NOP_OK,
  'win:close': NOP_OK,
  'win:state': () => ({ maximized: false }),
  'lyric:visible': NOP_OK,
  'lyric:lock': NOP_OK,

  /* ---- 缓存 / 数据目录：移动端无自定义目录能力，返回诚实结果 ---- */
  'cache:size': () => ({ cover: 0, media: 0, total: 0 }),
  'cache:pickDir': async () => '',
  'cache:setDir': ({ dir }: any) => ({ settings: getSettings(), dir: String(dir || ''), size: 0 }),
  'cache:openDir': () => { void 0; return true },
  'cache:clear': () => ({ cover: 0, media: 0, total: 0 }),
  'data:setDir': ({ dir }: any) => ({ dir: String(dir || userDataDir()), restart: !dir }),
  'data:openDir': () => { void 0; return true },
  'data:clear': () => ({ freed: 0 }),
}

async function resolveInline(song: Song, quality?: string) {
  const mod = await import('../../../electron/core/music-service')
  return mod.resolveUrl(song, quality || getSettings().quality, getSettings().autoSwitchSource)
}

/* ---------------- 安装 ---------------- */

export async function installBridge(): Promise<void> {
  await boot()

  const api = {
    async invoke<T = any>(channel: string, payload?: any): Promise<{ ok: true; data: T } | { ok: false; error: string }> {
      const fn = handlers[channel]
      if (!fn) return fail(`未实现的能力：${channel}`)
      try {
        return ok(await fn(payload ?? {}))
      } catch (e: any) {
        return fail(e)
      }
    },
    on(channel: string, cb: (payload: any) => void): () => void {
      return subscribe(channel, cb)
    },
    platform: 'android',
    versions: { electron: '', chrome: '', node: '' },
  }

  ;(window as any).sw = api
  emit('settings:changed', getSettings())
}
