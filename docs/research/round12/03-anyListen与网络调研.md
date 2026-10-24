# 第十二轮调研：any-listen 核查 + 音源制作.txt 协议 + GitHub MV 接口与 MV 聚合形式调研

> 调研日期：2026-10-24
> 调研目的：为「星河音乐」视频 + MV 聚合特色模块设计音源协议扩展提供依据
> 证据分级：【已查证】= 本次亲自解压/精读原文或 web_fetch 过文档页；【一方称】= 搜索摘要/二手信息

---

## ① any-listen 核查结果

**来源**：`D:\music\any-listen-main.zip` 解压至 `_tmp/anylisten/any-listen-main/`（【已查证】，本次逐文件核查）。

### 1.1 多音源聚合架构（如何声明/加载音源）

any-listen 定位「跨平台私人音乐播放服务」（README 原文："A cross-platform private music playback service"），pnpm monorepo（desktop / shared / view-main / view-lyric / web-server 五包）。其"音源"不是内置写死的平台，而是**扩展系统（Extension）**：

- **Manifest 声明式注册**（`packages/shared/types/types/extension.d.ts` 【已查证】）：
  ```ts
  interface Manifest {
    id: string; name: string; version: string; main: string;
    publicKey: string;                       // 扩展签名公钥（校验来源）
    grant?: ('internet' | 'player' | 'music_list' | 'isolate_context')[];
    contributes?: {
      resource?: Array<{ id: string; name: string; resource: ResourceAction[] }>;
      listProviders?: ListProvider[];
      settings?: FormItems[];
      commands?: Array<{ command: string; name: string; ... }>;
    }
  }
  ```
  一个扩展可声明多个 resource（音源），每个音源声明自己支持的 ResourceAction 数组——**音源能力是自描述的**。
- **ResourceAction 全集 18 种**（`extension.d.ts` + `shared/app/modules/worker/extensionService/shared/manifest.ts` 的 RESOURCE 数组，【已查证】两处一致）：
  `tipSearch / hotSearch / musicSearch / musicPic / musicLyric / musicUrl / musicPicSearch / musicComment / songlistSearch / songlist / topSongs / albumSearch / album / singerSearch / singer / lyricSearch / lyricDetail`
- **统一调用协议**（`packages/shared/types/types/extension_ipc.d.ts` 【已查证】）：
  ```ts
  interface CommonParams { extensionId: string; source: string }
  interface CommonListParams extends CommonParams { page: number; limit?: number }
  musicSearch: (params: MusicSearchParams) => Promise<ListCommonResult<MusicInfoOnline>>
  musicUrl:    (params: MusicUrlParams) => Promise<MusicUrlInfo>   // {url, quality}
  interface ListCommonResult<T> { list: T[]; total: number; page: number; limit: number }
  ```
  所有动作统一经 `resourceAction(action, params)` 一个入口分发，返回 Promise；分页统一 `{page, limit, total}`。
- **运行环境**：扩展在独立 worker 线程 + VM 沙箱中执行（`extensionService/vm/`、`isolateContext` 系列 API：`createIsolateContext / runInIsolateContext / sendMessageToIsolateContext`），宿主通过 preloadFuncs 暴露 `request`（全 HTTP 动词含 WebDAV）、文件读写、配置读写、AES/RSA/MD5/SHA/zlib 等能力。
- **内置扩展示例**：`internalExtension/extensions/webdav/`（【已查证】）声明 `resource: ['musicUrl', 'musicPic', 'musicLyric']`，实现模式为：
  ```ts
  async musicUrl({ musicInfo }) {
    const url = await getMusicUrl(options, options.path)
    return { quality: musicInfo.meta.bitrateLabel || '', url }   // 结构化返回，非裸 URL
  }
  ```

### 1.2 是否支持 MV / 视频（全文搜索证据）

**结论：完全不支持 MV/视频。【已查证】**

对 `packages/` 全量搜索 `mv|video|mvurl|mvhash`（不区分大小写），仅命中 4 处，全部与音乐 MV 无关：

| 命中位置 | 实际含义 |
|---|---|
| `shared/nodejs/webdav-client/index.ts:244` `async mv(src, dest)` | WebDAV 协议 MOVE 方法（文件移动），非 Music Video |
| `shared/app/modules/worker/extensionService/shared/index.ts:321` `mvExtension()` | 扩展安装时临时目录改名移动，非 Music Video |
| `view-main/src/assets/styles/reset.less:87` `video {}`、`view-lyric/.../reset.less:87` | CSS 样式重置表对 `<video>` 标签的默认样式 |

进一步对 `view-main/src` 搜索 `<video` / `new Video` / `videoUrl` / `VideoPlayer`：**0 命中**。即 UI 层连视频元素都不存在。

### 1.3 视频播放器实现

**不存在。【已查证】** 播放器为纯音频链路（`packages/view-main/src/plugins/player/index.ts`，逐行读过）：

- 核心：`new window.Audio()`（HTMLAudioElement）+ `AudioContext`
- 音频处理图：`MediaElementSource → Analyser → 10段BiquadFilter(31Hz~16kHz均衡器) → Convolver(混响) → Panner(环绕) → Gain → destination`
- 变调：AudioWorklet `phase-vocoder` pitch shifter
- 设备切换：`setSinkId`；无任何 `<video>` 节点、无画面渲染逻辑

### 1.4 可借鉴点

1. **Manifest 自描述音源能力清单**（`contributes.resource[].resource: Action[]`）——星河音乐若做 MV 扩展，可照此让音源自声明"我支持 mvUrl / mvSearch"，宿主按能力渲染入口。
2. **结构化 URL 返回**：`musicUrl` 返回 `{url, quality}` 而非裸字符串——MV 地址同理应返回 `{url, 分辨率, 大小, 格式}`。
3. **统一入口 `resourceAction(action, params)` + Promise + 统一分页 `{list,total,page,limit}`**——协议扩展时零摩擦新增 mv 类 action。
4. **沙箱隔离 + 签名公钥校验 + 精确 grant 授权**（internet/player/music_list/isolate_context）——第三方 MV 源需要网络授权，沿用 grant 模型。
5. **宿主代发请求 + 代理缓存**（`createProxyUrl / writeProxyCache`）——MV 地址常有防盗链，宿主层代理是必需能力（网易云 `/mv/detail` 文档明说"mv 视频网易做了防盗链处理，可能不能直接播放"）。

---

## ② 音源制作.txt 协议要点（洛雪音乐 LX Music 自定义源协议）

**来源**：`D:\music\音源制作.txt` 全文 230 行完整读取（【已查证】）。

### 2.1 脚本基本要求

- 文件 UTF-8 编码，JavaScript，可用 ES6+ 语法。
- 文件开头必须含注释头：
  ```
  /**
   * @name 测试音乐源          // ≤24字符
   * @description ...         // ≤36字符，可不填
   * @version 1.0.0           // 可不填
   * @author xxx              // 可不填
   * @homepage http://xxx     // 可不填
   */
  ```

### 2.2 宿主暴露对象 `globalThis.lx`

| 属性 | 说明 |
|---|---|
| `lx.version` | 自定义源 API 版本号 |
| `lx.env` | 运行环境（桌面版固定 `desktop`） |
| `lx.currentScriptInfo` | 头部注释解析出的 name/description/version/author/homepage/rawScript |
| `lx.EVENT_NAMES` | 事件名常量：`inited / request / updateAlert` |
| `lx.on(event, handler)` | 注册宿主→脚本事件；**回调必须返回 Promise** |
| `lx.send(event, data)` | 脚本→宿主发事件 |
| `lx.request(url, options, callback)` | 无跨域限制的 HTTP 请求；options: method/headers/body/form/formData/timeout；返回取消函数 |
| `lx.utils` | buffer(from/bufToString)、crypto(aesEncrypt/md5/randomBytes/rsaEncrypt)、zlib(inflate/deflate) |

### 2.3 事件协议（核心）

**(a) `inited` 事件**——脚本初始化完成后必须发送，告知应用本脚本支持哪些源：
```js
send(EVENT_NAMES.inited, {
  openDevTools: false,
  sources: {
    kw: {                                    // source key：kw/kg/tx/wy/mg/local
      name: '酷我音乐',
      type: 'music',                         // 目前固定 music
      actions: ['musicUrl'],                 // 非 local 源固定为 ['musicUrl']
      qualitys: ['128k','320k','flac','flac24bit'],
    },
    local: {
      name: '本地音乐',
      type: 'music',
      actions: ['musicUrl', 'lyric', 'pic'], // local 源可用三动作
      qualitys: [],
    },
  },
})
```
- 规则：发送 inited 之前脚本执行出错 = 初始化失败；此事件每次运行只能发一次。

**(b) `request` 事件**——宿主调用脚本取数据：
```js
on(EVENT_NAMES.request, ({ source, action, info }) => {
  switch (action) {
    case 'musicUrl': // info = { type, musicInfo }
      // type: 音质 128k/320k/flac/flac24bit（local 源为 null）
      // 必须在 Promise 中返回 HTTP 形式的歌曲 URL
    case 'lyric':    // info = { musicInfo } → 返回 { lyric, tlyric, rlyric, lxlyric }
    case 'pic':      // info = { musicInfo } → 返回 HTTP 封面 URL
  }
})
```
- `lxlyric` 逐字歌词格式：`[分钟:秒.毫秒]<相对开始,持续>歌词文字`，例 `[00:00.000]<0,36>测<36,36>试歌词`；tlyric/rlyric/lxlyric 无内容可为 null。

**(c) `updateAlert` 事件**——`lx.send(lx.EVENT_NAMES.updateAlert, { log, updateUrl })`，log ≤1024 字符（`\n` 换行），updateUrl 选传 HTTP URL ≤1024；每次运行仅一次。

### 2.4 桌面版 vs 移动版差异

- 移动版 inited 无 `openDevTools`；
- 移动版部分 `lx.utils` 不可用；
- 移动版除 `Function.prototype.toString` 等少数外，JS 内置原型被冻结（禁止覆盖内置方法，但允许新增自定义方法如 `Array.prototype.myPush = ...`）。

### 2.5 对 MV 扩展的启示

现有协议**只有 musicUrl/lyric/pic 三种 action，type 固定 music，无视频概念**。MV 模块需要：① sources 里允许新 `type`（如 `video`）；② actions 扩展 mvUrl 等；③ 音质维度 `qualitys` 需扩展为"分辨率维度"（如 480/720/1080）。

---

## ③ 网络调研结论：GitHub 项目 MV 接口对照表

### 3.1 NeteaseCloudMusicApi（binaryify，Node.js）

**文档页本次已精读**：https://binaryify.github.io/NeteaseCloudMusicApi/ （页面更新时间 2026-10-17，【已查证】）

| 接口/方法 | 参数 | 返回结构 | 说明 |
|---|---|---|---|
| `/mv/detail` | 必选 `mvid` | MV 名字、歌手、发布时间、**支持的分辨率列表**、视频地址（防盗链，需再调 /mv/url） | mvid 来源：搜索接口传 `type=1004` |
| `/mv/url` | 必选 `id`(mv id)；可选 `r`(分辨率，默认1080，取值来自 /mv/detail 的分辨率列表) | mv 播放地址 | 例 `/mv/url?id=10896407&r=1080` |
| `/mv/detail/info` | `mvid` | mv 点赞/转发/评论数数据 | |
| `/artist/mv` | 必选 `id`(歌手id) | 歌手 MV 列表（mvid） | 拿到 mvid 再调 `/mv/detail?mvid=` |
| `/artist/new/mv` | 可选 `limit`/`before` | 关注歌手新 MV（需登录） | |
| `/artist/video` | 必选 `id`(歌手id)；可选 `size`/`cursor`/`order`(0时间/1热度) | 歌手视频 | |
| `/simi/mv` | 必选 `mvid` | 相似 mv | |
| `/mv/all` | 可选 `area`(全部/内地/港台/欧美/日本/韩国)、`type`(全部/官方版/原生/现场版/网易出品)、`order`(上升最快/最热/最新)、`limit`/`offset` | 全部 mv 列表 | |
| `/mv/first` | 可选 `area`、`limit`(默认30) | 最新 mv | |
| `/top/mv` | 可选 `limit`(默认30)、`area`、`offset` | **mv 排行** | |
| `/personalized/mv` | 无 | 推荐 mv | |
| `/mv/exclusive/rcmd` | 可选 `limit`/`offset` | 网易出品 mv | |
| `/video/detail` | 必选 `id`(视频id，形如 `89ADDE33C0AAE8EC14B99F6750DB954D`) | 视频详情 | |
| `/mlog/to/video` | 必选 `id`(mlog id) | 转成 video id，再经 `/video/url` 取播放地址 | |
| `/mlog/music/rcmd` | 必选 `songid`；可选 `mvid`（有则排首位）、`limit` | **歌曲相关视频**：官方无 MV 时返回用户上传的 Mlog | 官方"歌曲→视频"兜底机制；文档注明"偶尔返回不相关视频，请合理使用" |
| `/comment/mv` / `/mv/sub` / `/mv/sublist` / `/resource/like(type=1)` | mvid/id | mv 评论 / 收藏或取消收藏 / 收藏 MV 列表 / MV 点赞 | |

**时效与风控标注**：
- 【一方称】2024-01 网易云对该项目发律师函，GitHub 原仓库因侵权被要求删除（OSCHINA 报道 https://www.oschina.net/news/276411 ，2024-01-23）。
- 【已查证搜索结果】npm 包仍发布中（https://www.npmjs.com/package/NeteaseCloudMusicApi ，2026-05-26 更新，要求 NodeJS 18+）；Gitee 镜像自述"网易云接口复活了（之前的接口被发律师函了）"（https://gitee.com/Hua-lanni/NeteaseCloudMusicApi ，2026-10-20 更新）。
- 另有镜像文档站 https://apis.netstart.cn/music/ （2026-10-04 更新）同步维护接口列表。

**合规风险：高。** 非官方逆向聚合接口，已有明确律师函下架先例；MV 视频地址带防盗链；付费/会员内容受版权方控制。

### 3.2 QQMusicApi（jsososo，Node.js）

**文档页本次已精读**：https://jsososo.github.io/QQMusicApi/ （页面更新时间 2026-09-24，【已查证】）

| 接口/方法 | 参数 | 返回结构 | 说明 |
|---|---|---|---|
| `/search` | `key`、`pageNo`、`pageSize`、`t`（搜索类型，**`t=12` 即 MV**；0单曲/2歌单/7歌词/8专辑/9歌手） | MV 搜索结果 | |
| `/search/quick` | `key` | 混合少量歌曲/mv/专辑/歌手 | |
| `/mv` | 必选 `id`（视频的 **vid**，如 `t0032kwa29w`） | `info`=MV 信息，`recommend`=相关推荐 MV | |
| `/mv/url` | 必选 `id`（vid，**多个逗号分隔可批量**） | **可直接播放的完整 mv 视频链接** | 与网易云不同：文档明示"返回的链接都是可以直接播放的" |
| `/mv/category` | 无 | MV 分类（地区+版本类型） | |
| `/mv/list` | `pageNo`/`pageSize`/`area`(默认15全部)/`version`(默认7全部) | 分类 MV 列表 | |
| `/mv/like` | 必选 `id`(vid)、`type`(1赞/0取消，默认1) | MV 点赞 | |
| `/song/mv` | 必选 `id`（歌曲 **songid**） | **相关 MV 列表** | 歌曲→MV 匹配 |
| `/singer/mv` | 必选 `singermid`；`pageNo`/`pageSize`(默认20) | 歌手 MV 列表 | |
| `/new/mv` | `type`(0精选/1内地/2港台/3欧美/4韩国/5日本，默认0) | 新 MV 推荐 | |

**通用规则（【已查证】）**：返回包 `result: 100`=成功，`500`=穿参错误，`400`=未知异常，`301`=缺少登录 cookie；非绿钻 VIP 的 cookie 只能获取部分播放链接。

**时效与风控标注**：
- 【一方称】项目自述"部分接口依赖绿钻账号 Cookie，非 vip 用户无法获取大部分歌曲播放链接"；文档更新停在 2021 年 changelog（最后更新 21-08-22 新增 mv 点赞），但页面 2026-09 仍在更新。
- 【已查证搜索结果】PyPI `pyqqmusicapi`（2023-10）将其文档列为 QQMusicApi 的 Python 移植，功能清单含"MV接口"，注明"获取付费歌曲和高品质音乐需要绿钻"。
- 【已查证搜索结果】QQ 音乐官方开放平台 `fcg_music_custom_get_mv_by_tag.fcg`（按 tag 取 MV）已列入**废弃文档**（https://developer.y.qq.com/docs/openapi#/abandon ，2026-04 更新）。
- 【已查证搜索结果】官方正规通道：QQ 音乐 Edge Harmony（PC 壳）SDK 提供 `searchMV(keyword: string, page: number, count?: number, source?: number): Promise<OpenApiResponse<ISearchMV>>`（https://developer.y.qq.com/docs/edge_harmony#/feature/openApi ，2026-08-18 更新）。

**合规风险：高。** 逆向官方接口且需 VIP Cookie；但 `/mv/url` 直出可播放链接的形态对协议设计最友好。

### 3.3 其他开源项目 MV 支持情况（【一方称】，搜索摘要）

| 项目 | MV 相关能力 | 来源 |
|---|---|---|
| **pyncm**（Python 网易云库） | 封装与 NeteaseCloudMusicApi 同源的网易云接口（含 mv 系列），PyPI 1.8.1（2026-09-22 更新）仍维护 | https://libraries.io/pypi/pyncm ；https://pypi.org/project/pyncm/ |
| **pycloudmusic163**（Python） | `music163.mv(id_)` 获取 MV 对象、`music.mv()` 歌曲直接取 MV 实例 | https://pypi.org/project/pycloudmusic163/ （2021-12） |
| **Listen1** | 聚合网易云/QQ/酷狗/酷我/B站/咪咕；**把 Bilibili 视频作为音源/搜索源**（"增加 bilibili 视频音源搜索功能"）——视频平台补 MV 的思路；历史上 2017-11 被 QQ 音乐举报致代码库临时关闭 | https://listen1.github.io/listen1/ ；https://git-hub.com/listen1/listen1_chrome_extension |
| **MoeKoe Music**（酷狗第三方客户端，GitHub 6.4k star，2026-10 仍活跃） | 官方 Todo List 中"📺 支持 MV 播放"为**未完成项**——MV 播放对第三方客户端是公认难点；直连官方服务器+登录同步 | https://cloud.tencent.com/developer/article/2463719 （2024-11）；https://music.moekoe.cn/ （2026-10-16） |
| **UnblockNeteaseMusic** | 音源替换解锁灰歌；2024-03 作者收网易云法务函后**自行删库**（3 万 star 清零），README 写"保护版权，此仓库不再维护"；Gitee 镜像存续 | https://segmentfault.com/a/1190000044688680 ；https://gitee.com/jx_deng/UnblockNeteaseMusic |
| **violet**（project-violet/violet，Dart monorepo，397 star，2024-10 后无更新） | 未检索到明确 MV/视频支持证据，信息有限 | https://m.gitee.com/huijielu/GitHub-Chinese-Top-Charts |
| **ihmily/music-api** | 自述"酷狗/酷我接口可解析 MV 视频" | https://git-hub.com/ihmily/music-api |
| **某二次元播放器**（头条/果核剥壳报道，2026-05） | "围绕当前曲目匹配 YouTube 与 Bilibili MV，作为播放背景进入全屏沉浸模式"——**曲目→跨平台 MV 匹配 + 全屏背景**是已落地的产品形态 | http://m.toutiao.com/group/7639922057874031131/ |

### 3.4 主流音乐 App 的 MV 聚合形式（公开资料）

| 平台 | 形式 | 证据 |
|---|---|---|
| 网易云音乐 App | **播放页内嵌 MV**：App Store 更新日志（2026-05-22 更新）"播放页支持查看歌曲 mv 了！当歌曲有 mv 内容时，可在播放歌曲时快速查看" | https://apps.apple.com/cn/app/id590338362 【已查证搜索结果】 |
| 网易云音乐（旧版行为） | 竞品分析："网易云**不在音乐播放页显示 MV 查看入口**，而隐藏于歌曲'等多操作'列表；QQ 音乐对有 MV 的歌曲**直接显示在播放页**，无 MV 则无入口。差异原因：网易云 MV 版权较少" | https://www.woshipm.com/evaluating/1354210.html （2026-09-27 更新）【一方称】 |
| QQ 音乐 | **MV 巅峰榜**：`y.qq.com/n/ryqq_v2/mv_toplist`（2026-10-23 实时榜单），分内地榜等地区分榜；上榜规则：**仅官方发行正式版 MV**参与（饭制/预告/花絮/广告不算），按手机+PC+TV 端有效播放时长排序，10 分钟更新一次 | http://y.qq.com/n/ryqq_v2/mv_toplist ；http://y.qq.com/m/client/video_rank_list/rule.html 【已查证搜索结果】 |
| QQ 音乐 | **视频中心首页**聚合 MV 巅峰榜等栏目 | https://i.y.qq.com/n2/m/client/video_home/index.html （2026-10-23 更新）【已查证搜索结果】 |
| 网易云网页版（二手软文） | "热门MV榜""新歌首发MV""导演精选"栏目；MV 页下方弹幕互动 | https://m.oppozhijia.com/wz/977922.html （2026-05）【一方称，可信度一般】 |

**聚合形式总结（可直接对照设计）**：
1. **播放页 MV 按钮**：有 MV 才显示（QQ 模式）/ 新功能逐步内嵌（网易云 2026 新版）；
2. **MV 排行榜**：地区分榜 + 官方正式版白名单 + 多端播放时长聚合；
3. **歌手 MV 列表**：歌手页独立栏目；
4. **相关/相似 MV 推荐**：播放后衔接；
5. **新 MV 推荐 / 每日推荐 MV**；
6. **歌曲→MV 兜底匹配**：官方 MV > 官方 UGC 视频（网易 mlog）> 第三方视频平台（B站/YouTube，Listen1 与二次元播放器模式）。

### 3.5 2026 年可用性与风控总评

- **网易云逆向接口**：律师函先例（2024）→ 原仓库删除 → npm/Gitee 镜像"复活"并持续维护（2026-10 仍在更新），说明技术上可用，但**法律状态不稳定**，个人研究可用，产品化需自担风险。
- **QQ 音乐逆向接口**：依赖 VIP Cookie，官方接口持续变动（2019-2021 多次调整），非 VIP 只能取部分内容。
- **合规对照**：网易云 2026-03 宣布接入 OpenClaw、向 AI Agent 开放官方音乐服务 CLI（【一方称】http://m.toutiao.com/group/7620303443537789486/ ）；QQ 音乐提供 Edge Harmony 官方 SDK——**官方正规通道正在收紧/规范化，逆向通道是灰色补充**。
- **版权维权动向**：2025-11 央广网报道网易云起诉低价售卖 VIP 年卡店铺胜诉（http://www.cnr.cn/mspd/msgc/fqsf/20251113/t20251113_527428871.shtml ）——平台侧维权持续。

---

## ④ 对规格书「MV 音源协议扩展」设计的建议草案

### 4.1 总体思路

any-listen 证明了"扩展自声明能力"模式可行但它没有 MV 概念；洛雪协议证明了"事件收发 + Promise"脚本模式极简但 actions 太窄（仅 musicUrl/lyric/pic）。建议**沿用洛雪事件协议骨架，借 any-listen 的结构化返回与分页规范扩展 MV action**，保持与现有音源脚本兼容（不破坏已实现的 musicUrl 流程）。

### 4.2 sources 声明扩展（inited 事件）

```js
send(EVENT_NAMES.inited, {
  openDevTools: false,
  sources: {
    wy: {
      name: '网易云音乐',
      type: 'music',                       // 现有音乐源保持不变
      actions: ['musicUrl'],
      qualitys: ['128k', '320k', 'flac', 'flac24bit'],
    },
    wy_mv: {                               // 新增：MV 源（也可复用 wy，见下）
      name: '网易云MV',
      type: 'video',                       // 新类型，宿主据此选择视频播放器 UI
      actions: ['mvUrl', 'mvSearch', 'mvDetail', 'mvBySong', 'mvRank', 'mvBySinger'],
      qualities: ['480p', '720p', '1080p', '2k'],   // 分辨率维度取代音质维度
    },
  },
})
```
> 备选方案：不新增 source key，而是让同一 `wy` 源的 `actions` 直接追加 `mvUrl` 等（更省 source 槽位），用 `type` 字段在 info 里区分音频/视频。二选一，建议**先做"同 source 追加 action"**，与洛雪现有 actions 数组扩展语义一致。

### 4.3 request 事件新增 action 草案

统一参数沿用洛雪风格：`{ source, action, info }`，回调必须返回 Promise。

| action | info 结构 | Promise 返回 | 对应业界接口 |
|---|---|---|---|
| `mvSearch` | `{ keyword, page, limit, type? }` | `{ list: MvInfo[], total, page, limit }` | 网易 /search type=1004；QQ /search t=12 |
| `mvDetail` | `{ musicInfo 或 mvId }` | `MvInfo`（含可支持分辨率列表 `qualities`） | 网易 /mv/detail |
| `mvUrl` | `{ mvId, quality }`（quality 如 '1080p'，默认取详情中最高可用） | `{ url, quality, size?, mime? }`（**结构化，参照 any-listen MusicUrlInfo**） | 网易 /mv/url?id=&r=；QQ /mv/url?id=vid |
| `mvBySong` | `{ musicInfo }` | `MvInfo[]`（首项为官方 MV，其余为相关/UGC） | QQ /song/mv；网易 /mlog/music/rcmd |
| `mvBySinger` | `{ singerId, page, limit }` | `{ list, total, page, limit }` | 网易 /artist/mv；QQ /singer/mv |
| `mvRank` | `{ area?, page, limit }` | `{ list, total, page, limit }` | 网易 /top/mv；QQ MV巅峰榜 |
| `mvRecommend` | `{ }` | `MvInfo[]` | 网易 /personalized/mv；QQ /new/mv |
| `mvSimilar` | `{ mvId }` | `MvInfo[]` | 网易 /simi/mv；QQ /mv 的 recommend 字段 |

### 4.4 MvInfo 基础对象建议

```ts
interface MvInfo {
  id: string            // mv id（网易 mvid / QQ vid，随 source 解释）
  name: string          // MV 名
  singer: string        // 歌手名
  artists?: Array<{ id: string; name: string }>
  duration?: number     // 秒
  pic?: string          // 封面图 URL
  playTime?: number     // 播放次数
  publishTime?: string // 发布时间
  qualities?: string[]  // 可用分辨率（来自 mvDetail）
  source: string        // 音源 key
}
```

### 4.5 播放与合规设计要点

1. **视频播放器独立于音频播放器**：星河现有音频链路不受影响；MV 播放走独立 `<video>` 组件，建议支持"音频继续 + MV 全屏背景"沉浸模式（果核剥壳报道的产品形态）。
2. **防盗链代理**：网易系 MV 地址需宿主层代理（any-listen 的 `createProxyUrl` 模式），协议层 `mvUrl` 返回的 url 可能带时效签名（QQ 的 vkey 有时效），脚本应按需现取，不缓存死链。
3. **合规隔离层**：
   - 协议文档明确"仅用于学习研究，不鼓励绕过版权限制"；
   - 应用内提供开关：**仅聚合官方 MV 元信息**（标题/封面/歌手，不解析播放地址）vs **解析播放地址**；
   - 播放页标注来源音源，不伪装成官方内容；
   - 已知律师函/维权先例（NeteaseCloudMusicApi 2024、UnblockNeteaseMusic 2024、Listen1 2017）应写入规格书"风险提示"章节。
4. **兜底匹配降级链**（产品侧）：官方 MV → 官方 UGC 视频（网易 mlog）→ B站/YouTube 关键词匹配（Listen1 模式，可选插件）→ 无 MV 时不显示入口（QQ 模式）。
5. **错误规范**：无 MV 时 `mvBySong` 返回空数组而非 reject；取地址失败（防盗链/会员墙）reject 并带错误码（`NEED_COOKIE` / `FORBIDDEN` / `NOT_FOUND`），便于应用做 toast 与降级。

---

## 附：本次核查文件清单

- 解压根目录：`D:\music\docs\research\round12\_tmp\anylisten\any-listen-main\`
- 关键证据文件：
  - `packages/shared/types/types/extension.d.ts`（Manifest / ResourceAction 全集）
  - `packages/shared/types/types/extension_ipc.d.ts`（resourceAction 入参/返回结构、PreloadIPCActions 宿主能力）
  - `packages/shared/app/modules/worker/extensionService/shared/manifest.ts`（RESOURCE 白名单）
  - `packages/shared/app/modules/worker/extensionService/internalExtension/extensions/webdav/resourceAction.ts`（内置扩展实现范例）
  - `packages/view-main/src/plugins/player/index.ts`（纯音频播放器全链路，无 video）
- 输入文档：`D:\music\音源制作.txt`（全文已读）
- 本文件：`D:\music\docs\research\round12\03-anyListen与网络调研.md`
