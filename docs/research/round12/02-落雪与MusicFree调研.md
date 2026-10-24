# 02 - 落雪音乐（lx-music-desktop）与 MusicFree 音源协议调研

> 调研目的：为「星河音乐」的「视频 + MV 聚合」特色模块、MV 音源协议扩展提供可借鉴设计。
> 调研方式：源码精读（证据级别标注）。
> 证据标注约定：
> - 【已查证】= 亲自读过源码/官方文档，附文件:行号；
> - 【一方称】= 推测或网络摘要，未在本地源码中直接印证。
>
> 调研时间：2026-10-24

---

## 0. 调研对象清单

| 项目 | 本地路径 | 形态 |
|---|---|---|
| 落雪音乐 Desktop | `D:\music\lx-music-desktop-master\lx-music-desktop-master` | Electron + Vue3，内置音源 SDK + 自定义音源（user_api 协议） |
| 落雪音源仓库（pdone/lx-music-source） | 解压至 `D:\music\docs\research\round12\_tmp\lx-source\lx-music-source-main` | 10 个第三方音源脚本合集 |
| 落雪音源制作文档 | `D:\music\音源制作.txt` | 官方自定义源脚本编写说明（约 230 行） |
| MusicFree 主程序 | 解压至 `D:\music\docs\research\round12\_tmp\musicfree\MusicFree-master` | React Native（android/ios），插件化音源 |
| MusicFree 插件仓库 | `D:\music\MusicFreePlugins-master\MusicFreePlugins-master` | 13 个插件源码 + plugins.json 插件市场清单 |

---

## ① 音源协议规范对照表

### 1.1 落雪音乐：双层音源体系（内置 SDK + 自定义音源）

#### A. 内置音源 SDK（硬编码，不可由用户扩展）【已查证】

- 音源列表定义：`src/renderer/utils/musicSdk/index.js:12-50` —— `kw`(酷我) / `kg`(酷狗) / `tx`(QQ音乐) / `wy`(网易云) / `mg`(咪咕) / `xm`(虾米，已废) / `bd`(百度，注释停用)。
- 每个内置音源暴露统一接口（以网易云为例）`src/renderer/utils/musicSdk/wy/index.js:11-33`：

| 方法 | 签名 | 返回 | 说明 |
|---|---|---|---|
| `musicSearch.search(keyword, page, limit)` | 关键词/页码/数量 | `{ list: MusicInfo[], isEnd? }` | 单曲搜索 |
| `leaderboard` | 各源自有签名 | 榜单分组列表 | `wy/leaderboard.js` |
| `songList` | 歌单分类/详情/列表 | 歌单数据 | `wy/songList.js` |
| `hotSearch()` | 无参 | 热搜词 | `wy/hotSearch.js` |
| `getMusicUrl(songInfo, quality)` | MusicInfo + 音质 | `{ canceleFn, promise }`，promise resolve `{type, url}` | **播放链接，按音质** |
| `getLyric(songInfo)` | MusicInfo | `{ canceleFn, promise }`，promise resolve 歌词 | `wy/lyric.js` |
| `getPic(songInfo)` | MusicInfo | Promise<封面URL> | 内部走 getMusicInfo |
| `getMusicDetailPageUrl(songInfo)` | MusicInfo | 歌曲页 URL | 外部跳转用 |

- 音质档位：`128k / 320k / flac / flac24bit`（`api-source-info.ts:1` 注释）。
- 音乐数据模型：`src/common/types/music.d.ts:21-46` —— `MusicInfoBase {id, name, singer, source, interval, meta}`；`MusicInfoMetaBase {songId, albumName, picUrl?, toggleMusicInfo?}`。**无任何 mv 字段**【已查证】。
- 播放侧封装：`src/renderer/core/music/online.ts:41-103` —— `getMusicUrl/getPicUrl/getLyricInfo` 统一先走本地缓存（electron-store / music_url 表），未命中才调音源；支持 `allowToggleSource`（源切换回退）。

#### B. 自定义音源（user_api 协议 v2.0.0）【已查证】

类型定义：`src/common/types/user_api.d.ts:1-61`；执行环境：`src/main/modules/userApi/`。

**协议元信息（脚本头部 JSDoc 注释解析）** —— `src/main/modules/userApi/utils.ts:53-89`：
- 正则 `/^\s?\*\s?@(\w+)\s(.+)$/` 解析 `@name(≤24字符) / @description(≤36) / @author(≤56) / @homepage(≤1024) / @version(≤36)`。
- 脚本本体以 deflate+base64 压缩（`gz_` 前缀）存于 electron-store（`utils.ts:90-109`）。

**音源声明（inited 事件）** —— 官方文档 `D:\music\音源制作.txt:100-117`；接收端校验 `src/main/modules/userApi/renderer/preload.js:142-162`：

```
lx.send(EVENT_NAMES.inited, {
  openDevTools: false,
  sources: {
    kw: { name, type: 'music', actions: ['musicUrl'], qualitys: ['128k','320k','flac','flac24bit'] },
    local: { name, type: 'music', actions: ['musicUrl','lyric','pic'], qualitys: [] },
  }
})
```

| 字段 | 约束 | 证据 |
|---|---|---|
| `type` | 目前固定只能 `'music'` | user_api.d.ts:3；preload.js:148 |
| `actions` | 仅 3 种：`musicUrl / lyric / pic`；非 local 源只允许 `musicUrl` | user_api.d.ts:4；preload.js:37-45；音源制作.txt:165 |
| `source key` | **白名单固定**：`kw / kg / tx / wy / mg / local`，不能自定义新平台 | preload.js:28；音源制作.txt:103 |
| `qualitys` | `128k / 320k / flac / flac24bit` | preload.js:29-36 |

**请求事件（on('request')）** —— 音源脚本必须返回 Promise：

| action | 入参 info | 返回（经 preload 强制校验） | 证据 |
|---|---|---|---|
| `musicUrl` | `{type: 音质, musicInfo}` | **字符串 URL**，必须 `^https?:/`，≤2048 字符，否则 throw | preload.js:77-87 |
| `lyric` | `{musicInfo}` | `{lyric(≤51200字符), tlyric?(≤5120), rlyric?, lxlyric?}`，lyric 缺省即抛错 | preload.js:57-66, 88-94 |
| `pic` | `{musicInfo}` | **字符串 URL**，≤2048 https | preload.js:95-102 |

**暴露给脚本的沙箱 API** —— `preload.js:192-347`：

| API | 说明 |
|---|---|
| `lx.request(url, {method, headers, body, form, formData, timeout}, callback)` | 主进程 needle HTTP，**无跨域限制**，支持代理；超时上限 60s；返回 abort 函数（preload.js:211） |
| `lx.send(event, data)` | 脚本→应用：`inited` / `updateAlert({log, updateUrl})`（每脚本一生只可一次） |
| `lx.on(event, handler)` | 应用→脚本：仅 `request` 事件 |
| `lx.utils.crypto.{aesEncrypt, rsaEncrypt, md5, randomBytes}` / `lx.utils.buffer` / `lx.utils.zlib.{inflate, deflate}` | 加密/压缩工具 |
| `lx.currentScriptInfo` | 头部解析出的脚本信息 + `rawScript` |
| `lx.version='2.0.0'` / `lx.env='desktop'` | 协议版本与环境标识 |

**执行与加载机制** —— 【已查证】：
1. **隐藏 BrowserWindow 沙箱**（非 vm、非 worker）：`src/main/modules/userApi/main.ts:74-100` —— `show:false, contextIsolation:true, nodeIntegration:false, webgl:false, images:false`，禁用导航/弹窗/权限请求（main.ts:102-117）。
2. 脚本在沙箱内执行：preload 里 `webFrame.executeJavaScript(userApi.script)`（preload.js:366），并注入全局 error/unhandledrejection 捕获（preload.js:355-364）。
3. 请求链路：渲染进程 `sendUserApiRequest`（`useInitUserApi.ts:41-66`）→ 主进程 IPC → 沙箱 preload `handleRequest` → 脚本 handler → 校验 → 原路返回。主进程侧请求超时 20s（`rendererEvent/rendererEvent.ts:137-139`），支持按 `requestKey` 取消。
4. URL 缓存：主进程 dbService `music_other_source` 表（`src/main/worker/dbService/modules/music_other_source/`），按 source+quality 缓存解析结果。
5. 源切换回退：播放失败时自动尝试其他音源（`online.ts:41` 的 `allowToggleSource` / `onToggleSource`）。

### 1.2 MusicFree 插件协议（v0.1）【已查证】

类型定义：`D:\music\MusicFreePlugins-master\MusicFreePlugins-master\types\plugin.d.ts`、`types\mediaType.d.ts`；运行时：`MusicFree-master\src\core\pluginManager\plugin.ts`。

**插件对象（module.exports）字段** —— plugin.d.ts:95-148：

| 字段 | 类型 | 说明 |
|---|---|---|
| `platform` | string | **插件名 = 新平台标识**（如 `"bilibili"`、`"音悦台"`），插件的唯一身份 |
| `appVersion` | semver range | 兼容的宿主版本，`satisfies()` 校验（plugin.ts:1021-1030） |
| `version` | string | 插件版本（市场更新比对用） |
| `srcUrl` | string | 远程更新地址（pluginManager/index.ts:429-430 按它拉新） |
| `primaryKey` | string[] | 歌曲主键（如 bilibili: `["id","aid","bvid","cid"]`），用于去重/缓存键 |
| `defaultSearchType` / `supportedSearchType` | 数组 | 支持的搜索类型 |
| `cacheControl` | `'cache'\|'no-cache'\|'no-store'` | 解析结果缓存策略（plugin.ts:228-236） |
| `userVariables` | `[{key, name}]` | 用户可配置变量（如 cookie） |
| `search(query, page, type)` | type ∈ `"music"\|"album"\|"artist"\|"sheet"` | 统一搜索，返回 `{isEnd?, data: []}` |
| `getMediaSource(musicItem, quality)` | quality ∈ `"low"\|"standard"\|"high"\|"super"` | **返回播放链接**，见下 |
| `getMusicInfo(mediaBase)` | | 按主键补全歌曲信息 |
| `getLyric(musicItem)` | | 返回 `{rawLrc?, translation?}` |
| `getAlbumInfo` / `getArtistWorks` / `getTopLists` / `getTopListDetail` / `importMusicSheet` / `importMusicItem` | | 专辑/歌手作品/榜单/榜单详情/导入歌单/导入单曲 |

**getMediaSource 返回结构（关键差异点）** —— plugin.d.ts:77-85：
```ts
interface IMediaSourceResult {
  headers?: Record<string, string>  // 自定义请求头（referer/user-agent 等）
  url?: string                        // 播放地址
  userAgent?: string
  quality?: IMusic.IQualityKey
}
```
【已查证】这是与落雪最大的协议差异：**MusicFree 允许随 URL 一并下发请求头**（bilibili CDN 必须带 referer，见 bilibili/index.ts:409-426），落雪只允许裸 URL 字符串（preload.js:78）。

**IMusicItem 数据模型** —— mediaType.d.ts:3-28：
`{platform, id, artist, title, duration(秒), album, artwork, url?, lrc?, rawLrc?, qualities?, [k:string]: any}` —— 开放索引签名，插件可任意挂自定义字段（bilibili 就挂了 `aid/bvid/cid`，yinyuetai 挂了 `urls[]`）。

**执行与加载机制** —— 【已查证】plugin.ts:905-1017：
1. **Function 构造器 eval**（非 vm、非独立窗口）：plugin.ts:935-949：
   ```ts
   _instance = Function(`'use strict';
     return function(require, __musicfree_require, module, exports, console, env, URL, process) { ${funcCode} }
   `)()(_require, _require, _module, _module.exports, _console, env, URL, _process)
   ```
2. **require 白名单注入**（plugin.ts:57-67）：`cheerio / crypto-js / axios / dayjs / big-integer / qs / he / webdav` + cookie 占位。插件用 `require('axios')` 发 HTTP。
3. 插件 hash = `sha256(funcCode)`（plugin.ts:1007）；支持懒加载（`lazyProps`，首次调用时才 mount，plugin.ts:890-903）。
4. URL 解析结果按 quality + headers 缓存在 MediaCache（plugin.ts:291-311）；支持**替代插件**回退（alternativePlugin，plugin.ts:247-252）；解析失败自动重试 1 次（plugin.ts:313-317）。
5. 插件市场：`plugins.json` 格式 `{"desc":..., "plugins":[{"name","url","version"}]}`（MusicFreePlugins/plugins.json），宿主拉取后按 semver 比较触发更新（pluginManager/index.ts:216-221, 306-311, 429-430）。

### 1.3 星河现有协议

> **以 01 号文档为准**（本轮未读规格书，不展开对比）。

### 1.4 对照表汇总

| 维度 | 落雪内置 SDK | 落雪自定义源(user_api) | MusicFree 插件 | 可借鉴点（给星河） |
|---|---|---|---|---|
| 平台标识 | 固定 5 源硬编码 | **白名单 key**（kw/kg/tx/wy/mg/local），只填 URL | **platform 自由字符串**，每插件一新平台 | 星河 MV 源应允许自由 platform（如 `bilibili-mv`），不能只挂到固定平台下 |
| 能力声明 | 接口硬编码 | inited 事件里 `actions[] + qualitys[]` 自声明 | 插件对象方法存在性即能力（wrapper 自动探测，plugin.ts:993-995） | 借鉴「能力自声明数组」，MV 能力用独立 action 声明 |
| 搜索 | 各源 musicSearch | **不支持**（自定义源只补 URL） | 统一 `search(query,page,type)` | MV 模块需要独立 `searchMV` 接口，落雪自定义源完全没有此层 |
| 播放链接 | getMusicUrl(info, quality) | action=musicUrl 返回裸 URL 字符串 | getMediaSource 返回 `{url, headers, userAgent}` | **必须带 headers**（B站/YouTube CDN 防盗链），落雪裸 URL 是反面教材 |
| 音质档位 | 128k/320k/flac/flac24bit | 同左 | low/standard/high/super（4 档） | MV 场景应是**清晰度档位**（240p/480p/720p/1080p）而非音质 |
| 歌词 | getLyric | action=lyric 返回 {lyric,tlyric,rlyric,lxlyric} | getLyric 返回 {rawLrc, translation} | 落雪的 lxlyric（逐字歌词）字段设计可参考 |
| 封面 | getPic | action=pic 返回 URL | artwork 直接挂在歌曲对象上 | — |
| 沙箱机制 | 主进程直连 | **隐藏 BrowserWindow**（contextIsolation、禁 webgl/images） | Function() eval + require 白名单 | 桌面端用独立进程/隐藏窗口更安全；Function eval 仅适合 RN 单进程 |
| HTTP | 主进程 axios | lx.request（needle，主进程转发，可代理、可取消） | 插件内直接 `require('axios')` | 星河宜统一走宿主代理层（可加代理/风控/取消），不要让插件直连 |
| 取消 | canceleFn | requestKey + 20s 超时 | 未提供取消机制 | 落雪的 requestKey 取消设计值得抄 |
| 缓存键 | source+quality | music_other_source 表 | primaryKey 数组 + quality | MV 缓存键应含清晰度档位 |
| 回退 | 源切换 toggleSource | 同左 | alternativePlugin 替代插件 | 多音源兜底播放是标配 |

---

## ② MV / 视频支持现状

### 2.1 落雪音乐（lx-music-desktop）

| 项目 | 结论 |
|---|---|
| 是否支持 MV | **完全不支持**（无 MV 搜索、无 MV 播放、无视频组件）【已查证】 |
| 证据 | ① 自定义音源 actions 仅 `musicUrl/lyric/pic`（`src/common/types/user_api.d.ts:4`；preload.js:37-45）；② 全 src 目录 grep `<video|VideoPlayer` 零命中（`src/renderer` 下无任何 video 元素）；③ MusicInfo 模型无 mv 字段（`types/music.d.ts:21-46`）；④ MV 字样仅存于残留注释：`wy/musicSearch.js:15`「1004: MV, 1014: 视频」（网易搜索类型码，未使用）、`mg/temp/leaderboard-old.js:20`「MV榜」（已废弃榜单）、`kg/vendors/infSign.min.js` 内 `formatSong.mvhash`（酷狗 SDK 内部字段，未使用） |
| 实现方式 | 无。播放器为纯音频（HTML5 audio），无弹层/独立页 |

### 2.2 落雪音源仓库（lx-music-source）

| 项目 | 结论 |
|---|---|
| 音源样本清单 | SixYin(六音)、Huibq、Flower、LX、ChangQing(长青)、HuanYin(幻音)、ikun、Grass、JuheApi、QDY —— 共 10 个（README.md）【已查证】 |
| 含 MV/视频能力音源 | **无**【已查证】 |
| 证据 | 对全部非混淆脚本 grep `mvurl\|mvinfo\|mv_hash\|mvId\|getMv\|musicMv\|/mv\|bilibili\|videoUrl\|video_url` 零命中（协议本身只暴露 musicUrl/lyric/pic，音源想做也做不了）；脚本多为混淆代码（如 sixyin/latest.js 头部 `@name 六音音源 ... @netease MUSIC_U=; @tencent ...`，正文 obfuscated），均为转发第三方 API 服务器（sixyin.com / lxmusic.cc / keep-alive 等）的代理型音源 |

### 2.3 MusicFree 主程序

| 项目 | 结论 |
|---|---|
| 是否支持 MV/视频播放 | **不支持视频渲染**。主程序为纯音频播放器（react-native-track-player，`src/core/trackPlayer/`），grep `react-native-video\|<Video\|VideoPlayer` 零命中【已查证】 |
| 实现方式 | 无视频弹层/独立页。但「视频类音源」作为**音频收割器**存在（见下） |

### 2.4 MusicFree 插件市场中的视频类插件（重点）

| 插件 | 平台 | 视频能力实现方式 | 证据【已查证】 |
|---|---|---|---|
| **bilibili** | "bilibili" | ① 搜索时把 B 站**视频搜索**结果当音乐返回：`searchBase(keyword, page, "video")`（index.ts:165-172），`search()` 里 type=music/album 都走视频搜索（index.ts:673-680）；② `getMediaSource` 调 `playurl?fnval=16`（DASH），**只取 `dash.audio` 音频流数组**，按 bandwidth 排序映射到 low/standard/high/super 四档（index.ts:380-404），丢弃视频轨；③ 返回 `{url, headers:{user-agent, host, referer}}` 防盗链（index.ts:409-426） | plugins/bilibili/index.ts |
| **音悦台** | "音悦台" | ① 专用 MV 搜索接口 `searchType:"MV"`（index.ts:36），POST 到 search-api.yinyuetai.com；② 结果保留 `fullClip.urls[]` 多清晰度流（index.ts:14）；③ `getMediaSource` 按 `streamType===5`(standard)/`streamType===1`(high) 选流（index.ts:117-128）——**直接拿 MV 视频流当音频播**（track-player 播视频 URL 时只取音轨） | plugins/yinyuetai/index.ts |
| **Youtube / 快手 / Audiomack / 猫耳FM** | 同名 | 同类「视频/音频平台 → 音频流」模式【一方称：未逐个精读，依 plugins.json 清单命名推断】 | plugins.json |
| 插件市场清单 | — | `{"desc":"...","plugins":[{"name","url","version"}]}`，13 个插件（含上述 5 个视频类） | MusicFreePlugins/plugins.json |

**核心结论**：两大项目都没有「真 MV 播放器」；MusicFree 的「视频音源」实际是**视频音源化**——把视频平台内容包装成音乐项，播放器只取音频轨。这对星河「MV 聚合」是关键启示：**协议层要支持视频流，渲染层要真播视频**，这是两者都没做、星河可以差异化的地方。

---

## ③ 对星河「MV 音源协议扩展」的可借鉴设计点

### 3.1 音源如何声明 MV 能力

- **落雪式能力声明**（inited 事件 `actions[] + qualitys[]`）比 MusicFree「探测方法存在性」更显式。建议星河在音源初始化时声明：
  ```ts
  {
    platform: 'bilibili-mv',           // 自由 platform，不学落雪的白名单 key
    version: '0.1.0',
    srcUrl: 'https://.../index.js',     // 远程更新（学 MusicFree）
    capabilities: {
      mvSearch: true,                   // 是否支持 MV 搜索
      mvQualities: ['240p','480p','720p','1080p'],  // MV 清晰度档位
      musicWithMv: true,                // 歌曲是否能关联到 MV（搜索结果带 mvId）
    },
    userVariables: [{key:'cookie', name:'登录Cookie'}] // 用户变量（学 MusicFree）
  }
  ```
- 不要学落雪把 source key 锁死在 kw/kg/tx/wy/mg——MV 源（B站/音悦台/YouTube）天然是新平台。

### 3.2 搜索返回如何带 mv 字段

- 落雪的 MusicInfo 模型无 mv 字段是反面教材；MusicFree 的开放索引签名（`[k:string]:any`）让 bilibili 插件能挂 `aid/bvid/cid`。建议星河歌曲对象上显式挂：
  ```ts
  { ...musicInfo, mv?: { id, platform, title, artist, cover } }
  ```
- 同时提供独立 `searchMV(keyword, page, quality?)` 接口（落雪自定义源完全没有搜索层，MusicFree 的 `search(query,page,type)` 是统一搜索可参考）——返回 `{isEnd, data: [{id, title, artist, cover, duration, mvQualities}]}`。

### 3.3 播放链接接口如何给多档位（+ headers）

- **必须**采用 MusicFree 的 `{url, headers, userAgent}` 返回结构（plugin.d.ts:77-85），不要学落雪的裸 URL 字符串：
  ```ts
  getMvSource(mvInfo, quality /* '720p' */): Promise<{
    url: string;
    headers?: Record<string,string>;   // referer/user-agent 防盗链（B站必须）
    userAgent?: string;
  }>
  ```
- bilibili 插件的做法（`playurl?fnval=16` 取 DASH 音频流、按带宽映射档位、附 referer）（bilibili/index.ts:380-426）可直接复用为星河 B 站 MV 源的实现范本；音悦台插件 `streamType` 多档选择（index.ts:117-128）是「MV 视频流直接播」的范本。

### 3.4 播放器 MV 弹层 / 独立页做法

- 两个参考项目都没有真视频播放器可抄（落雪纯音频、MusicFree 只取音轨）【已查证】。星河需自建：
  - **MV 弹层**：在现有播放页加一个「MV 模式」按钮，弹层内嵌 `<video>`（桌面端 Electron）/ 原生视频组件（车机/移动端）——落雪的隐藏 BrowserWindow 架构（main.ts:74-100）可借鉴用于隔离视频播放进程。
  - **独立 MV 聚合页**：`searchMV` 结果做瀑布流/列表页（封面图 + 标题 + 时长），点击进播放。
  - **音画切换**：同一首歌可在「音频模式（现有 audio 播放器）/ MV 模式（video 播放器）」间切换——对应落雪的 `toggleMusicInfo` 字段（music.d.ts:25，它已为「同一歌曲多源」预留了关联字段，可复用到「同曲 MV 关联」）。

### 3.5 缓存键设计

- 落雪：`source + quality` 缓存 URL（music_other_source 表）【已查证】；MusicFree：`primaryKey 数组 + quality` 缓存（plugin.ts:291-311）。
- 建议星河 MV 缓存键：`platform + mvId + quality(清晰度) + headers指纹`，并允许 `cacheControl: 'cache'|'no-cache'|'no-store'`（学 MusicFree，bilibili 类源通常应 no-cache，因为 CDN URL 带 deadline 时效参数——见 bilibili/index.ts:719 注释里的 `deadline=1685552083`）。

### 3.6 沙箱与 HTTP 层

- 桌面端优先学落雪：**隐藏 BrowserWindow**（contextIsolation、禁 nodeIntegration/webgl/images、禁导航弹窗）跑插件，HTTP 走宿主转发（`lx.request` 主进程 needle、支持代理、60s 超时、requestKey 取消）——比 MusicFree 的 Function() eval 安全得多。
- 保留落雪的加密工具集（aesEncrypt/rsaEncrypt/md5/zlib，preload.js:273-316）——B 站 WBI 签名、酷狗 infSign 都需要（bilibili/index.ts:192-278 自行实现了 WBI mixinKey+HmacSHA256，说明宿主给 md5/hmac 能省事）。
- 20s 请求超时 + 取消机制（rendererEvent.ts:137-139）直接沿用。

---

## ④ 版权与接口失效风险提示

1. **第三方音源本质是灰产代理**【已查证】：落雪音源仓库 10 个源（SixYin/Huibq/LX/ikun 等）全部转发第三方 API 服务器（sixyin.com、lxmusic.cc、keep-alive、MeoProject/lx-music-api-server），README 自述「内容源于网络」，并提供 ghproxy 等 6 个加速镜像——说明这些服务器**经常被墙/被封**，靠换镜像续命。
2. **官方源本身已大量失效**【已查证】：落雪内置源虾米(xm) 已废弃（musicSdk/index.js:36 仍列但服务关闭）、百度(bd) 注释停用（index.js:38-41），API 接口版本频繁变动需持续跟进（wy/tx/kw 各目录下均有 `api-test.js` 测试残留）。
3. **bilibili 防盗链与风控**【已查证】：B 站 CDN 直链带 `deadline` 时效签名（bilibili/index.ts:719），必须带 `referer: https://www.bilibili.com/video/...` 和特定 UA，否则 403；WBI 签名算法（getMixinKey+w_rid）随官方调整会失效（bilibili/index.ts:192-278）。插件作者因此把 bilibili 插件 `cacheControl: 'no-cache'`（index.ts:660）。
4. **cookie/登录态依赖**【已查证】：六音源头部自定义元数据 `@netease MUSIC_U=; @tencent ts_last=...`（sixyin/latest.js 头部）——部分音源靠用户 cookie 维持，cookie 过期即失效。
5. **版权风险**：MV 聚合涉及视频内容（B站/音悦台/YouTube 均为有版权视频平台），星河「MV 音源」应仅做**协议层聚合 + 用户自添加音源**，不自建内容源；界面需标注音源来源，且参考落雪做法（自定义源由用户自行导入 URL/文件，应用本身不内置任何盗版音源）。
6. **法律先例**【一方称】：落雪音乐官方曾因版权问题下架过 GitHub release 与各应用商店上架，其自定义音源功能设计（用户自导入、应用不内置）正是为规避直接版权责任——星河应沿用此「用户自备音源」模式。

---

## 附：关键证据索引

| 结论 | 证据位置 |
|---|---|
| 落雪自定义源仅 3 actions | `src/common/types/user_api.d.ts:3-4`；`userApi/renderer/preload.js:37-45` |
| 落雪原 key 白名单 | `userApi/renderer/preload.js:28` |
| 隐藏 BrowserWindow 沙箱 | `userApi/main.ts:74-100` |
| 脚本 executeJavaScript | `userApi/renderer/preload.js:366` |
| URL/歌词/封面返回校验 | `preload.js:57-111` |
| 官方音源制作文档 | `D:\music\音源制作.txt`（全文 230 行） |
| 落雪无 MV/视频组件 | grep `<video\|VideoPlayer` 于 src 零命中；`types/music.d.ts:21-46` 无 mv 字段 |
| MusicFree 插件协议类型 | `MusicFreePlugins-master/types/plugin.d.ts:95-148`、`mediaType.d.ts:3-28` |
| MusicFree Function() eval 执行 | `MusicFree-master/src/core/pluginManager/plugin.ts:935-949` |
| require 白名单 | `plugin.ts:57-67` |
| bilibili 只取音频流 | `MusicFreePlugins/plugins/bilibili/index.ts:380-426`（fnval=16, dash.audio） |
| 音悦台 MV 搜索 | `plugins/yinyuetai/index.ts:36, 117-128` |
| 插件市场清单 | `MusicFreePlugins/plugins.json` |
| URL 带 headers 返回 | `plugin.d.ts:77-85` |
