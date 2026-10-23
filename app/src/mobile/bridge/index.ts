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
import type { DanmakuItem, Song } from '@shared/types'
import axios from 'axios'
import { emit, subscribe } from '../bus'
import { fail, ok } from './envelope'
import { player } from '../player'
import * as vfs from '../shims/vfs'
import { seedSources } from '../seed'
import { registerBufferGlobal, patchFetch, patchNativeFetch, isNativeWebView } from '../shims/util'
import { initDb, setSqlJsLoader } from '../../../electron/core/db'
import { lxHost } from '../../../electron/core/lx-host'
import * as mfHost from '../../../electron/core/mf-host'
import { loadSettings, saveSettings, getSettings } from '../../../electron/core/settings'
import { userDataDir } from '../../../electron/core/paths'
import { dbStats, playStats, favoriteIds, favoriteSongs, toggleFavorite, historySongs, addHistory, clearHistory, listPlaylists, createPlaylist, updatePlaylist, deletePlaylist, playlistSongs, addSongsToPlaylist, removeSongFromPlaylist, reorderPlaylist, getSongs, saveSongs, localSongs, localCount, removeLocalSongs, dbGetSetting, dbSetSetting, isFavorite } from '../../../electron/core/db'
import {
  searchAll, getLyric, getCover, getPlaylists, getPlaylistTags, getPlaylistDetail, getToplist, getToplistTree,
  getNewSongs, importPlaylist, searchMv, getMvInfo, getMvParts, getMvUrl, getPodcastEpisodes,
} from '../../../electron/core/music-service'
import { buildHomeFeed } from '../../../electron/core/recommend'
import { buildRadio } from '../../../electron/core/radio'
// 注意：必须走 shims 版（localStorage 登录态）。providers/music-service 通过 vite
// 别名 './bili' 也解析到同一份 shim——若这里直连 electron/core/bili 会出现两份
// 各自独立的登录态（设置页显示已登录、实际取流却未登录）。
import {
  initBiliLogin, biliStatus, biliQrGenerate, biliQrPoll, biliLogout,
  biliCookieLogin, biliPasswordLogin,
} from '../shims/bili-bridge'

let started = false

async function boot(): Promise<void> {
  if (started) return
  started = true

  // 0) 全局 Buffer + fetch 代理：electron/core/lx-host.ts 的音源沙箱直接注入
  //    全局 Buffer，electron/core/http.ts 用裸 fetch——两者在浏览器里都不可用。
  //    顺序：先 patchFetch（冒烟环境改走同源 /__cors 代理），再 registerBufferGlobal。
  patchFetch()
  registerBufferGlobal()
  // 真机：跨域 fetch 走 Capacitor 原生 HTTP（无 CORS）——二维码/推荐/歌单等全靠它
  await patchNativeFetch()
  // 插件沙箱里的 axios 默认用 XHR（同样受 CORS 限制），真机切到 fetch adapter
  //（已被上面的原生 fetch 兜住）
  if (isNativeWebView()) (axios as any).defaults.adapter = 'fetch'

  // 1) 虚拟文件系统：先本地恢复，再用内置音源种子播种
  await vfs.initFs()
  seedSources()
  // 插件不再内置：用户从「插件市场」/订阅/本地导入安装后落进用户插件目录
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

  // 3) 设置与数据库、音源沙箱：两者互不依赖（lx-host 只依赖上面的 vfs 种子），
  //    v2.3.1 起并行初始化，缩短真机冷启动白屏时间
  loadSettings()
  const dbReady = initDb().then(() => initBiliLogin())
  const lxReady = (async () => {
    try {
      await lxHost.load()
    } catch { /* 音源加载失败不阻断启动 */ }
  })()
  await Promise.all([dbReady, lxReady])

  // 4) 播放器
  player.init()

  // 5) 升级包下载进度：原生 SwBridgePlugin 的 notifyListeners 事件
  //    → 转成渲染层 update:progress，前端才能显示下载百分比
  try {
    const cap: any = (globalThis as any).Capacitor
    if (cap && typeof cap.addListener === 'function' && cap.isNativePlatform?.()) {
      await cap.addListener('SwBridge', 'swUpdateProgress', (p: any) => {
        emit('update:progress', {
          received: Number(p?.received || 0),
          total: Number(p?.total || 0),
          percent: Number(p?.percent || 0),
          phase: String(p?.phase || 'downloading'),
        })
      })
    }
  } catch { /* 真机外环境无原生事件，忽略 */ }

  // 6) 睡眠关机轮询（桌面由 player-service 内部定时器做）
  window.setInterval(() => player.checkSleep(), 20000)
}

/* ---------------- handlers ---------------- */

type Handler = (payload: any) => Promise<any> | any

const NOP_OK = () => true
const UNSUPPORTED = (what: string) => () => { throw new Error(`移动端暂不支持${what}`) }

  /* ---- MusicFree 插件市场：移动端自带实现 ---- */
/**
 * 拉取插件市场目录。
 * 移动端不能用 mf-host 的 request（依赖 Electron net，WebView 内会挂住），
 * 这里直接用 WebView 的 fetch，并在 GitHub raw 失败时回退 jsDelivr 镜像。
 */
/** 移动端 HTTP 取文本：优先原生 CapacitorHttp（系统网络栈），失败回落 WebView fetch */
async function httpGetText(url: string, timeoutMs = 8000): Promise<string> {
  try {
    const r: any = await nativeCall('CapacitorHttp', 'request', {
      url,
      method: 'GET',
      responseType: 'text',
      connectTimeout: timeoutMs,
      readTimeout: timeoutMs,
    })
    const status = Number(r?.status ?? 0)
    const data = typeof r?.data === 'string' ? r.data : JSON.stringify(r?.data ?? '')
    if (status >= 200 && status < 300 && data) return data
    throw new Error(`HTTP ${status || 'ERR'}`)
  } catch (e) {
    const ac = new AbortController()
    const timer = setTimeout(() => ac.abort(), timeoutMs)
    try {
      const res = await fetch(url, { headers: { Accept: 'application/json' }, signal: ac.signal })
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      return await res.text()
    } finally {
      clearTimeout(timer)
    }
  }
}

/** 带自定义请求头的取文本：必须走原生网络栈，浏览器 fetch 不允许设置 Referer/UA */
async function httpGetWithHeaders(
  url: string,
  headers: Record<string, string>,
  timeoutMs = 10000
): Promise<string> {
  const r: any = await nativeCall('CapacitorHttp', 'request', {
    url,
    method: 'GET',
    headers,
    responseType: 'text',
    connectTimeout: timeoutMs,
    readTimeout: timeoutMs,
  })
  const status = Number(r?.status ?? 0)
  const data = typeof r?.data === 'string' ? r.data : JSON.stringify(r?.data ?? '')
  if (status >= 200 && status < 300 && data) return data
  throw new Error(`HTTP ${status || 'ERR'}`)
}

/** 把 raw.githubusercontent 的插件地址改写成当前可用的镜像地址 */
function mirrorOf(raw: string, base: string): string {
  const m = /^https:\/\/raw\.githubusercontent\.com\/([^/]+)\/([^/]+)\/([^/]+)\/(.+)$/.exec(raw)
  if (!m) return raw
  const [, owner, repo, branch, path] = m
  if (base === 'fastly') return `https://fastly.jsdelivr.net/gh/${owner}/${repo}@${branch}/${path}`
  if (base === 'ghproxy') return `https://ghproxy.net/https://raw.githubusercontent.com/${owner}/${repo}/${branch}/${path}`
  if (base === 'gh-proxy') return `https://gh-proxy.com/https://raw.githubusercontent.com/${owner}/${repo}/${branch}/${path}`
  return raw
}

function mirrorBaseOf(candidate: string): string {
  if (candidate.startsWith('https://fastly.jsdelivr.net')) return 'fastly'
  if (candidate.startsWith('https://ghproxy.net')) return 'ghproxy'
  if (candidate.startsWith('https://gh-proxy.com')) return 'gh-proxy'
  return ''
}

async function fetchMarketManifest(url: string): Promise<any[]> {
  let lastFail = ''
  // 多镜像兜底：国内网络常连不上 raw.githubusercontent.com / cdn.jsdelivr.net
  const candidates: string[] = []
  if (url) candidates.push(url)
  const m = /^https:\/\/raw\.githubusercontent\.com\/([^/]+)\/([^/]+)\/([^/]+)\/(.+)$/.exec(url)
  if (m) {
    const [, owner, repo, branch, path] = m
    candidates.push(
      `https://fastly.jsdelivr.net/gh/${owner}/${repo}@${branch}/${path}`,
      `https://ghproxy.net/https://raw.githubusercontent.com/${owner}/${repo}/${branch}/${path}`,
      `https://gh-proxy.com/https://raw.githubusercontent.com/${owner}/${repo}/${branch}/${path}`,
      `https://raw.gitmirror.com/${owner}/${repo}/${branch}/${path}`,
      `https://cdn.jsdelivr.net/gh/${owner}/${repo}@${branch}/${path}`
    )
  }
  const uniq = Array.from(new Set(candidates.filter(Boolean)))
  if (!uniq.length) return []
  // 并发竞速：镜像时快时慢，谁先回谁生效，避免串行超时叠加
  // 首个成功即返回：任一镜像先回就用它，不等待其余请求（Promise.all 会等最慢的那个）
  const winner = await new Promise<{ u: string; text: string } | null>(resolve => {
    let settled = false
    let pending = uniq.length
    const done = (v: { u: string; text: string } | null): void => {
      if (settled) return
      settled = true
      resolve(v)
    }
    const failures: string[] = []
    for (const u of uniq) {
      void httpGetText(u)
        .then(text => done({ u, text }))
        .catch((e: any) => {
          failures.push(`${u.split('/')[2]}: ${e?.message || e}`)
          lastFail = failures.join('；')
        })
        .finally(() => {
          pending -= 1
          if (pending <= 0) done(null)
        })
    }
    setTimeout(() => done(null), 9000)
  })
  if (!winner) throw new Error(`插件目录拉取失败：${lastFail || '网络不可用'}`)
  const data: any = JSON.parse(winner.text)
  const arr: any[] = Array.isArray(data) ? data : Array.isArray(data?.plugins) ? data.plugins : []
  const base = mirrorBaseOf(winner.u)
  return arr
    .map((it: any) => (typeof it === 'string' ? { name: it, url: it } : it))
    .filter((it: any) => it && /^https?:\/\//i.test(it.url))
    .map((it: any) => ({ ...it, url: mirrorOf(String(it.url), base) }))
}

const handlers: Record<string, Handler> = {
  /* ---- 应用 ---- */
  'app:info': () => ({
    version: __APP_VERSION__,
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
  /**
   * 打开外部链接（更新页、开源主页等）：Android 走原生 SwBridge 插件
   * （ACTION_VIEW），iOS / 插件缺失退回 window.open；WebView 不支持多窗口时
   * 最后由调用方降级为复制链接。
   */
  'app:openExternal': async ({ url }: any) => {
    const cap: any = (globalThis as any).Capacitor
    if (cap && typeof cap.nativePromise === 'function' && cap.isNativePlatform?.()) {
      try {
        // Android：原生 SwBridge 插件（ACTION_VIEW，market:// 等私有协议也能打开）
        await cap.nativePromise('SwBridge', 'openExternal', { url: String(url) })
        return true
      } catch {
        // iOS 等无 SwBridge 插件的平台：退回 WebView 多窗口（WKWebView 支持）
        window.open(String(url), '_blank')
        return true
      }
    }
    window.open(String(url), '_blank')
    return true
  },
  'app:showItemInFolder': UNSUPPORTED('在文件夹中显示'),
  /**
   * 应用内下载安装包（APK）：原生 SwBridge 插件下载到应用私有目录，
   * 完成后拉起系统安装器——不再跳浏览器手动下载。
   *
   * 注意：v2.3.4 之前这里调的是 'SwUpdate'，而原生只注册了 'SwBridge'
   * （MainActivity.registerPlugin(SwBridgePlugin.class)），插件名不匹配导致
   * 调用必然 reject——这正是「移动端无法应用内更新」的直接根因。
   */
  'app:downloadAndInstall': async ({ url }: any) => {
    const cap: any = (globalThis as any).Capacitor
    if (cap && typeof cap.nativePromise === 'function' && cap.isNativePlatform?.()) {
      await cap.nativePromise('SwBridge', 'downloadAndInstall', { url: String(url) })
      return true
    }
    throw new Error('当前环境不支持应用内安装')
  },
  /** 是否已授权「安装未知应用」（Android 8+ 必需） */
  'app:canInstallPackages': async () => {
    const cap: any = (globalThis as any).Capacitor
    if (cap && typeof cap.nativePromise === 'function' && cap.isNativePlatform?.()) {
      const r: any = await cap.nativePromise('SwBridge', 'canInstallPackages', {})
      return !!r?.allowed
    }
    return false
  },
  /** 拉起系统「允许安装未知应用」设置页 */
  'app:openInstallPermission': async () => {
    const cap: any = (globalThis as any).Capacitor
    if (cap && typeof cap.nativePromise === 'function' && cap.isNativePlatform?.()) {
      await cap.nativePromise('SwBridge', 'openInstallPermissionSettings', {})
      return true
    }
    return false
  },

  /**
   * 桌面端「下载更新包」在移动端不适用（Android 走 APK 安装器、iOS 走 App Store），
   * 这里给出可读提示而不是「移动端暂不支持…」的通用文案。
   */
  'app:downloadUpdate': async () => {
    throw new Error('移动端请在「设置 → 检查更新」中打开下载页，或直接安装新的 APK / 前往 App Store 更新')
  },
  'app:showUpdateFile': async () => {
    throw new Error('移动端无法在文件管理器中定位更新包')
  },
  'app:relaunchWithUpdate': async () => {
    throw new Error('移动端请手动安装下载好的更新包')
  },

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
  'sources:import': async ({ url, content, file }: any) => {
    const r = await lxHost.importSource({ url, content, file })
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
  'plugins:market': async ({ url }: any) => await fetchMarketManifest(String(url || '')),
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
  'plugins:import': async ({ url, content, origin, file }: any) => {
    if (url) {
      // 移动端用原生 HTTP 取插件源码：Electron net 在 WebView 里不可用
      const code = await httpGetText(url, 20000)
      await mfHost.importFromContent(code, 'url', url, file)
    } else if (content) await mfHost.importFromContent(content, origin || 'local', url, file)
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
  /** 私人电台：按口味生成可连续播放的新歌队列（换一批时 force=true） */
  'radio:build': async ({ force, size }: any) => {
    const r = await buildRadio(!!force, Number(size) || 60)
    return { songs: r.songs, seeds: r.seeds, generatedAt: r.generatedAt }
  },
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

  /* ---- 本地音乐：v2.3.5 起走系统媒体库（SwBridge.scanLocal + /swlocal/ 回放） ---- */
  'library:pick': () => scanLocalMusic(),
  'library:scan': () => scanLocalMusic(),
  'library:cancel': NOP_OK,
  'library:progress': () => ({ phase: 'idle', found: 0, parsed: 0, current: '' }),
  'library:songs': ({ limit, offset }: any) => localSongs(limit || 200, offset || 0),
  'library:count': () => localCount(),
  'library:remove': ({ paths }: any) => { removeLocalSongs(paths || []); return localSongs(200, 0) },

  /* ---- 下载：/swmedia/ 流式拉流（原生代理带防盗链头）→ 原生 SwBridge
         写入公共音乐库 Music/星河音乐/。v2.3.0 是诚实降级（不支持），
         v2.3.1 起真机可直接下载歌曲到本地。 ---- */
  'download:list': () => dlTaskList(),
  'download:dir': () => 'Music/星河音乐（系统音乐库）',
  'download:pickDir': async () => 'Music/星河音乐',
  'download:openDir': async () => {
    // 系统文件管理器没有「打开指定目录」的公共入口，提示用户即可
    emit('toast', { type: 'info', message: '下载的歌曲在系统音乐库「星河音乐」目录' })
    return true
  },
  'download:add': async ({ songs, quality }: any) => {
    const list: any[] = []
    for (const song of songs || []) {
      const t: any = {
        id: `m-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`,
        song,
        status: 'queued',
        quality: quality || getSettings().quality,
        progress: 0,
        received: 0,
        total: 0,
        createdAt: Date.now(),
      }
      dlTasks.set(t.id, t)
      list.push(t)
      dlChain = dlChain.then(() => runDownload(t))
    }
    return list.map(t => ({ ...t }))
  },
  'download:cancel': ({ id }: any) => {
    dlAborts.get(String(id))?.abort()
    return true
  },
  /* 暂停/继续（规格书 1.12）：移动端按「取消当前流 + 保留任务」实现，
     不做断点续传；继续时进度归零重新拉流。 */
  'download:pause': ({ id }: any) => {
    const t = dlTasks.get(String(id))
    if (!t) return false
    dlPaused.add(String(id))
    if (t.status === 'running') dlAborts.get(String(id))?.abort()
    t.status = 'paused'
    dlEmit(t)
    return true
  },
  'download:resume': ({ id }: any) => {
    const t = dlTasks.get(String(id))
    if (!t) return false
    dlPaused.delete(String(id))
    t.status = 'queued'
    t.progress = 0
    t.received = 0
    dlEmit(t)
    dlChain = dlChain.then(() => runDownload(t))
    return true
  },
  'download:remove': async ({ id, deleteFile }: any) => {
    const t = dlTasks.get(String(id))
    dlAborts.get(String(id))?.abort()
    if (t && deleteFile && dlUris.get(t.id)) {
      try {
        await nativeCall('SwBridge', 'deleteMedia', { uri: dlUris.get(t.id) })
      } catch { /* 文件可能已被用户删除 */ }
    }
    dlUris.delete(String(id))
    dlTasks.delete(String(id))
    return true
  },
  'download:clear': ({ onlyFinished = true }: any) => {
    for (const [id, t] of dlTasks) {
      if (onlyFinished && (t.status === 'running' || t.status === 'queued')) continue
      dlTasks.delete(id)
      dlUris.delete(id)
    }
    return true
  },

  /* ---- 弹幕（规格书 2.x）：移动端直接拉 B 站 XML 弹幕并解析 ---- */
  'mv:danmaku': async ({ cid }: any) => await fetchDanmaku(String(cid || '')),
  /* 视频离线缓存（规格书 1.12 / 2.x）：移动端把整片保存进系统视频库，并在本地留一份索引 */
  'video:offline:file': () => null,
  'video:offline:save': async ({ url, title }: any) => await saveVideoOffline(String(url || ''), title ? String(title) : ''),
  'video:offline:list': () => {
    const items = videoOfflineList()
    return { items, total: items.reduce((n, v) => n + (v.size || 0), 0) }
  },
  'video:offline:remove': async ({ id }: any) => {
    videoOfflineWrite(videoOfflineList().filter(v => v.id !== String(id)))
    return true
  },
  'video:save': async ({ url, title }: any) => await saveVideoOffline(String(url || ''), title ? String(title) : ''),
  'video:cache:release': () => true,

  /* ---- B 站 ---- */
  'bili:status': () => biliStatus(),
  'bili:qr': () => biliQrGenerate(),
  'bili:poll': ({ key }: any) => biliQrPoll(key),
  'bili:logout': () => biliLogout(),
  'bili:cookieLogin': ({ cookie }: any) => biliCookieLogin(String(cookie || '')),
  'bili:passwordLogin': ({ username, password }: any) => biliPasswordLogin(String(username || ''), String(password || '')),

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
  'log:setDir': ({ dir }: any) => ({ settings: getSettings(), dir: String(dir || userDataDir()) }),
  'data:setDir': ({ dir }: any) => ({ dir: String(dir || userDataDir()), restart: !dir }),
  'data:openDir': () => { void 0; return true },
  'data:clear': () => ({ freed: 0 }),
}

async function resolveInline(song: Song, quality?: string) {
  const mod = await import('../../../electron/core/music-service')
  return mod.resolveUrl(song, quality || getSettings().quality, getSettings().autoSwitchSource)
}

/* ============================ 移动端下载队列 ============================ */

type DlTask = {
  id: string
  song: Song
  status: 'queued' | 'running' | 'paused' | 'done' | 'error' | 'canceled'
  quality: string
  progress: number
  received: number
  total: number
  file?: string
  error?: string | null
  createdAt: number
  finishedAt?: number
}

const dlTasks = new Map<string, DlTask>()
const dlAborts = new Map<string, AbortController>()
const dlUris = new Map<string, string>()
/** 被用户暂停的任务（规格书 1.12：暂停后保留任务，继续时重新拉流） */
const dlPaused = new Set<string>()
let dlChain: Promise<void> = Promise.resolve()

function nativeCall(plugin: string, method: string, opts: any): Promise<any> {
  const cap: any = (globalThis as any).Capacitor
  if (!cap || typeof cap.nativePromise !== 'function') throw new Error('原生通道不可用')
  return cap.nativePromise(plugin, method, opts)
}

/**
 * 扫描系统媒体库（MediaStore）并入库（规格书 3.4 / 4.4）。
 *
 * 真机 WebView 没有文件系统遍历能力，改由原生 SwBridge.scanLocal 返回
 * MediaStore 索引；音频字节由 SwMediaClient 的 /swlocal/?id= 按 Range 回放，
 * 因此这里只落元数据（localPath 保留 content:// URI，取链时再换成 /swlocal/）。
 */
async function scanLocalMusic(): Promise<{ started: boolean; dirs: string[] }> {
  emit('scan:progress', { phase: 'scanning', found: 0, parsed: 0, current: '正在读取系统媒体库…' })
  const res: any = await nativeCall('SwBridge', 'scanLocal', {})
  const rows: any[] = Array.isArray(res?.songs) ? res.songs : []
  const songs: Song[] = []
  for (let i = 0; i < rows.length; i++) {
    const r = rows[i]
    const uri = String(r?.uri || '')
    if (!uri) continue
    songs.push({
      id: `local:${uri}`,
      source: 'local',
      songId: uri,
      name: r?.name || '未知歌曲',
      singer: r?.singer || '未知歌手',
      album: r?.album || '',
      duration: Number(r?.duration) || 0,
      pic: '',
      localPath: uri,
      qualitys: ['local'],
      extra: { mediaId: String(r?.id || '') },
    })
    if (i % 40 === 0) {
      emit('scan:progress', { phase: 'parsing', found: rows.length, parsed: i, current: r?.name || '' })
    }
  }
  saveSongs(songs)
  emit('scan:progress', { phase: 'done', found: rows.length, parsed: songs.length, current: '' })
  emit('toast', {
    type: songs.length ? 'success' : 'info',
    message: songs.length ? `已导入 ${songs.length} 首本地音乐` : '系统媒体库里没有找到音乐',
  })
  return { started: true, dirs: ['系统音乐库'] }
}

function dlEmit(t: DlTask): void {
  emit('download:progress', { ...t, song: t.song })
}

function dlTaskList(): DlTask[] {
  return [...dlTasks.values()].map(t => ({ ...t }))
}

function dlExtOf(url: string, quality: string): string {
  if (quality === 'flac' || quality === 'flac24bit') return 'flac'
  const m = /\.(mp3|flac|m4a|aac|ogg|wav)(\?|$)/i.exec(url)
  return m ? m[1].toLowerCase() : 'mp3'
}

function dlMimeOf(ext: string): string {
  const map: Record<string, string> = {
    mp3: 'audio/mpeg', flac: 'audio/flac', m4a: 'audio/mp4',
    aac: 'audio/aac', ogg: 'audio/ogg', wav: 'audio/wav',
  }
  return map[ext] || 'audio/mpeg'
}

function dlSafeName(s: string): string {
  return s.replace(/[\\/:*?"<>|]/g, '_').slice(0, 120).trim() || '未命名'
}

function bytesToBase64(bytes: Uint8Array): string {
  let bin = ''
  const CH = 0x8000
  for (let i = 0; i < bytes.length; i += CH) {
    bin += String.fromCharCode(...bytes.subarray(i, i + CH))
  }
  return btoa(bin)
}

/* ---------------- 视频离线缓存（移动端：整片写入系统视频库 + 本地索引） ---------------- */
const VIDEO_OFFLINE_KEY = 'xinyuan_video_offline'
/** 移动端离线缓存的索引条目 */
interface VideoOffline {
  id: string
  title: string
  uri: string
  size: number
  at: number
}

function videoOfflineList(): VideoOffline[] {
  try {
    const raw = localStorage.getItem(VIDEO_OFFLINE_KEY)
    return raw ? (JSON.parse(raw) as VideoOffline[]) : []
  } catch {
    return []
  }
}

function videoOfflineWrite(list: VideoOffline[]): void {
  try {
    localStorage.setItem(VIDEO_OFFLINE_KEY, JSON.stringify(list.slice(0, 60)))
  } catch {
    /* 配额不足时忽略：索引丢失不影响已保存的文件 */
  }
}

/** 整片下载并写入系统视频库；超过 300MB 拒绝（避免把整段视频塞进内存） */
async function saveVideoOffline(url: string, title: string): Promise<VideoOffline> {
  if (!url) throw new Error('缺少视频地址')
  const src = url.startsWith('/') ? url : `/swmedia/?u=${encodeURIComponent(url)}`
  const res = await fetch(src)
  if (!res.ok) throw new Error(`下载失败：HTTP ${res.status}`)
  const total = Number(res.headers.get('content-length') || 0)
  if (total > 300 * 1024 * 1024) throw new Error('视频超过 300MB，暂不支持离线缓存')
  const all = new Uint8Array(await res.arrayBuffer())
  const ret = await nativeCall('SwBridge', 'saveToMedia', {
    name: `${dlSafeName(title || '视频')}.mp4`,
    mime: 'video/mp4',
    data: bytesToBase64(all),
  })
  const item: VideoOffline = {
    id: `${Date.now()}`,
    title: title || '视频',
    uri: String(ret?.uri || ''),
    size: all.byteLength,
    at: Date.now(),
  }
  videoOfflineWrite([item, ...videoOfflineList()])
  return item
}

/** 单任务执行：resolveUrl → /swmedia/ 流式拉流（有真实进度）→ 原生写媒体库 */
async function runDownload(t: DlTask): Promise<void> {
  const ctl = new AbortController()
  dlAborts.set(t.id, ctl)
  try {
    t.status = 'running'
    dlEmit(t)
    const r = await resolveInline(t.song, t.quality)
    if (!r?.url) throw new Error('无法获取播放地址')
    const ext = dlExtOf(r.url, r.quality)
    const name = `${dlSafeName(`${t.song.singer || '未知'} - ${t.song.name || '未命名'}`)}.${ext}`
    // 同源 /swmedia/：由原生 SwMediaClient 代理（注入 Referer/UA），流式可读
    const res = await fetch(`/swmedia/?u=${encodeURIComponent(r.url)}`, { signal: ctl.signal })
    if (!res.ok) throw new Error(`音频下载失败（HTTP ${res.status}）`)
    const reader = res.body?.getReader()
    if (!reader) throw new Error('当前环境不支持流式下载')
    const total = Number(res.headers.get('content-length') || 0)
    const chunks: Uint8Array[] = []
    let received = 0
    let lastEmit = 0
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      chunks.push(value)
      received += value.length
      const now = Date.now()
      if (now - lastEmit > 300) {
        lastEmit = now
        t.received = received
        t.total = total
        t.progress = total ? Math.min(99, Math.round((received / total) * 100)) : 0
        dlEmit(t)
      }
    }
    if (ctl.signal.aborted) return
    const all = new Uint8Array(received)
    let off = 0
    for (const c of chunks) {
      all.set(c, off)
      off += c.length
    }
    t.received = received
    t.total = received
    t.progress = 100
    const ret = await nativeCall('SwBridge', 'saveToMedia', {
      name,
      mime: dlMimeOf(ext),
      data: bytesToBase64(all),
    })
    if (ret?.uri) dlUris.set(t.id, String(ret.uri))
    t.status = 'done'
    t.file = String(ret?.path || name)
    t.finishedAt = Date.now()
  } catch (e: any) {
    if (ctl.signal.aborted || e?.name === 'AbortError') {
      // 规格书 1.12：暂停与取消要区分开，暂停保留任务可继续
      if (dlPaused.has(t.id)) {
        t.status = 'paused'
        t.error = null
      } else {
        t.status = 'canceled'
        t.error = '已取消'
      }
    } else {
      t.status = 'error'
      t.error = e?.message || String(e)
    }
    t.finishedAt = Date.now()
  } finally {
    dlAborts.delete(t.id)
    dlEmit(t)
  }
}

/* ---------------- 弹幕 ----------------
 * 桌面端走主进程 electron/core/danmaku.ts（protobuf 分段）；
 * 移动端没有 http shim，这里直接拉 XML 弹幕（dm/list.so）并用 DOMParser 解析，
 * 只取 progress/mode/fontsize/color/content 五个字段，结果缓存 10 分钟。 */
const dmCache = new Map<string, { at: number; items: DanmakuItem[] }>()

async function fetchDanmaku(cid: string): Promise<DanmakuItem[]> {
  if (!cid) return []
  const hit = dmCache.get(cid)
  if (hit && Date.now() - hit.at < 10 * 60_000) return hit.items
  // Referer 属于浏览器禁止脚本设置的请求头（fetch 会静默丢弃），而弹幕接口会校验来源，
  // 所以这里必须走原生网络栈；失败时再退化为普通 fetch（部分源不校验 Referer）。
  let xml = ''
  try {
    xml = await httpGetWithHeaders(
      `https://api.bilibili.com/x/v1/dm/list.so?oid=${encodeURIComponent(cid)}`,
      { Referer: 'https://www.bilibili.com/', 'User-Agent': 'Mozilla/5.0 StarWishMusic' }
    )
  } catch {
    const res = await fetch(`https://api.bilibili.com/x/v1/dm/list.so?oid=${encodeURIComponent(cid)}`)
    if (!res.ok) throw new Error(`弹幕接口返回 ${res.status}`)
    xml = await res.text()
  }
  const doc = new DOMParser().parseFromString(xml, 'text/xml')
  const items: DanmakuItem[] = []
  for (const d of Array.from(doc.getElementsByTagName('d'))) {
    const p = (d.getAttribute('p') || '').split(',')
    if (p.length < 4) continue
    const t = Number(p[0])
    const rawMode = Number(p[1])
    const size = Number(p[2]) || 25
    const color = Number(p[3]) || 0xffffff
    const text = (d.textContent || '').trim()
    if (!text || !Number.isFinite(t)) continue
    const mode: 1 | 4 | 5 = rawMode === 4 ? 4 : rawMode === 5 ? 5 : 1
    items.push({ t, mode, size: size >= 36 ? 36 : size >= 25 ? 25 : 18, color, text })
  }
  dmCache.set(cid, { at: Date.now(), items })
  return items
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