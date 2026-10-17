# 星河音乐 StarWish Music · v2.0 正式版开发文档（新架构）

> 本文档替代 `StarWish-Music-正式开发文档.md`（Flutter 方案）中「技术架构」部分。
> 实际交付版本采用 **Electron + Vue 3 + TypeScript** 新架构重写，彻底移除 v1.1 的
> 「本地 HTTP 服务 + 原生 JS 单页」旧实现。旧版入口文件保留在 `app/_legacy-v11/` 仅作参考。

---

## 1. 为什么换架构

v1.1 的问题不是「某个功能没写」，而是架构导致的系统性不可用：

| 旧架构 | 后果 |
|---|---|
| 主进程起 HTTP 服务，页面走 `http://127.0.0.1` | 端口占用、白屏、首屏慢、被当成「网页版」 |
| 全部 UI 逻辑塞在 1500 行 `app.js`，无组件化 | 状态互相污染，切页丢状态，事件重复绑定 |
| 播放器用页面内 `<audio>`，与 UI 同线程 | UI 卡顿即爆音、切页即断播 |
| 封面直连平台 CDN | 防盗链 403，大量灰块/占位图 |
| 无数据库，收藏/歌单存 localStorage | 数据易丢，无法承载大曲库 |
| 无全局错误边界 | 任一 Promise 失败即整页失效 |

v2.0 的对应改造：**进程隔离 + 组件化 + 协议代理 + SQLite + 全链路错误兜底**。

---

## 2. 技术栈

| 层 | 选型 | 说明 |
|---|---|---|
| 桌面壳 | Electron 31 | 主进程 / 渲染进程 / 独立音频宿主进程 |
| UI | Vue 3.5 + TypeScript + Pinia + Vue Router | 组件化、类型安全、状态可预测 |
| 构建 | Vite 6（渲染层）+ esbuild（主进程） | 秒级构建，产物可控 |
| 数据库 | SQLite（sql.js / WebAssembly） | 零原生依赖、跨平台一致，落盘为标准 `.db` |
| 元数据 | music-metadata | MP3/FLAC/M4A/OGG/WAV 标签、时长、内嵌封面与歌词 |
| 音源 | lx-music v2 协议沙箱（`vm`） | 11 个内置音源，可导入/停用/删除 |
| 二维码 | qrcode | B 站扫码登录 |
| 打包 | electron-builder | 便携版 + NSIS 安装版 |

> 数据库选型说明：`sql.js` 是 SQLite 官方 C 实现编译出的 WASM 版本，SQL 语法与文件格式完全一致，
> 但不需要 `better-sqlite3` 的原生编译（避免 Electron ABI 不匹配导致的「装上打不开」）。
> 写入采用 600ms 防抖 + 临时文件原子替换，退出前强制落盘。

---

## 3. 进程与线程模型

```
┌──────────────────────────── 主进程 main.js ────────────────────────────┐
│ 窗口/托盘/全局快捷键 · IPC 路由 · 音源沙箱 · 平台 API · SQLite · 缓存     │
│ 播放队列权威状态 PlayerService（队列、模式、音质、失败重试、换源）        │
└───────────────┬───────────────────────────────┬───────────────────────┘
                │ IPC（contextBridge，白名单）   │ IPC（最小指令集）
      ┌─────────▼─────────┐           ┌─────────▼──────────┐
      │ 渲染进程（UI）     │           │ 音频宿主（隐藏窗口）│
      │ Vue3 + Pinia       │           │ <audio> + 淡入淡出  │
      │ 页面/歌词/队列     │           │ 独立渲染进程        │
      └────────────────────┘           └────────────────────┘
                       ┌──────────────────────────┐
                       │ 桌面歌词窗口（独立渲染）  │
                       └──────────────────────────┘
```

**隔离收益**

- UI 重渲染、路由切换、列表滚动不会影响音频解码，杜绝卡顿爆音。
- 音频宿主崩溃由主进程监听 `render-process-gone` 自动重建。
- 主窗口崩溃自动 reload，托盘与播放状态不受影响。

---

## 4. 目录结构（实际）

```
app/
├── electron/
│   ├── main.ts                 # 应用生命周期、协议注册、托盘、快捷键、崩溃兜底
│   ├── ipc.ts                  # 统一 IPC 路由（单一入口 sw:invoke）+ 错误归一化
│   ├── preload.ts              # contextBridge：invoke / 事件白名单
│   ├── player-host.ts          # 音频宿主：解码、淡入淡出、缓冲看门狗
│   ├── player-preload.ts
│   ├── player.html
│   ├── windows.ts              # 主窗口 / 音频宿主 / 桌面歌词 / 标题栏主题
│   └── core/
│       ├── paths.ts            # 数据目录（含不可写自动降级）
│       ├── log.ts              # 按天滚动文件日志
│       ├── http.ts             # 超时/重试/JSON 归一化 + 按域名限流
│       ├── lx-host.ts          # lx-music 协议沙箱、音源注册表、搜索/取链/歌词/封面
│       ├── providers.ts        # 网易云/QQ/酷狗/酷我/咪咕/B 站原生接口
│       ├── bili.ts             # B 站扫码登录、合集分 P 解析
│       ├── music-service.ts    # 聚合搜索、取链降级、自动换源、多源歌词
│       ├── cover.ts            # 封面多级回退 + 磁盘缓存 + swcover 协议
│       ├── media.ts            # swmedia 媒体代理（Range / Referer / Cookie）
│       ├── db.ts               # SQLite 表结构与 DAO
│       ├── library.ts          # 本地音乐扫描（标签/内嵌封面/内嵌歌词）
│       ├── player-service.ts   # 播放队列权威状态与失败重试
│       ├── recommend.ts        # 每日推荐 / 首页聚合（30 分钟落盘缓存）
│       └── settings.ts
├── src/
│   ├── main.ts / App.vue / router.ts / api.ts
│   ├── components/  # Icon/Cover/SongList/MiniBar/QueueDrawer/Modal/Menu/Slider...
│   ├── pages/       # Home/Discover/Mv/Search/Playlist/Favorites/Local/History/Settings/Player/LyricWindow
│   ├── stores/      # player / library / ui
│   ├── styles/
│   └── assets/      # 星河品牌封面与图标
├── shared/          # 主进程与渲染层共享的类型、LRC 解析
├── sources/         # 11 个内置音源脚本
├── resources/       # icon.png / icon.ico / cover.png / tray.png
└── scripts/         # 构建、图标生成、冒烟测试
```

---

## 5. 关键机制

### 5.1 自定义协议（解决渲染与防盗链）

| 协议 | 用途 | 处理 |
|---|---|---|
| `swcover://covers/r/<encoded>` | 远端封面 | 主进程带 Referer 抓取 → 磁盘缓存 → 返回图片，失败回退占位 |
| `swcover://covers/l/<file>` | 本地内嵌封面 | 直接读缓存目录 |
| `swmedia://stream/?u=<target>` | 音频/视频流 | 本地文件手写 Range；远端透传 Range，注入 Referer 与 B 站 Cookie |

渲染层不再直接访问平台 CDN，CSP 仅放行 `self / swcover / swmedia / data / blob`。

> 实测坑：网易云外链会 302 到 `http://m*.music.126.net`，Chromium 网络栈会以
> `ERR_BLOCKED_BY_CLIENT` 拦截明文跳转。媒体代理因此优先使用 Node 原生 `fetch`，
> 失败再退回 `net.fetch`。

### 5.2 播放链路（可靠性优先）

```
点击歌曲 → 主进程 setQueue → resolveUrl(音质链 24bit→flac→320k→128k)
        → 逐音源尝试取链 → 成功则下发 swmedia 地址给音频宿主
        → 失败：自动换源（同名/去括号版本，最多 4 个候选）
        → 宿主 error：同曲换源重试 2 次 → 仍失败则跳下一首
        → 连续 3 首失败：暂停并提示检查音源
```

- 音频宿主每 500ms 上报位置，UI 用 `requestAnimationFrame` 插值，进度条平滑且 IPC 压力低。
- 25 秒无进度且缓冲不足判定为卡死，主动上报错误触发重试。
- 播放历史、播放次数在 `ended` 时写入数据库。

### 5.3 歌词引擎

1. 本地音乐：内嵌歌词（ID3 USLT）→ 同目录 `.lrc`；纯音乐不做猜测。
2. 在线音乐：音源插件 → 平台官方（网易云 / QQ / 酷狗）→ 网易云同名+时长匹配。
3. 多候选全部解析后按有效行数择优，避免「插件返回一段错误文本导致整首无歌词」。
4. 支持 LRC / QRC / YRC 时间标签、翻译行配对、逐字 `<mm:ss.xx>` 高亮、±500ms 偏移校准。
5. 内存 LRU 缓存 300 首，切歌不重复请求。

### 5.4 音源沙箱

- `vm.createContext` 提供 `lx.request/send/on/env/utils/EVENT_NAMES`，宿主侧统一走带超时与重试的 HTTP。
- 单个音源加载失败只标记该源不可用，不影响其余 10 个。
- 导入支持在线 URL / 本地 JS 文件，校验脚本特征后写入用户数据目录。
- 搜索聚合采用「到点即返回」：插件最多等待 2.6s，慢音源不阻塞 UI。

### 5.5 数据模型

```sql
songs(id PK, source, song_id, name, singer, album, duration, pic, local_path, qualitys, extra, created_at)
playlists(id PK, name, pic, description, source, remote_id, kind, created_at, updated_at)
playlist_song(playlist_id, song_id, pos, added_at, PK(playlist_id, song_id))
favorites(song_id PK, added_at)
play_history(id PK AUTOINCREMENT, song_id, played_at, ms)
play_count(song_id PK, count, last_at)
settings(key PK, value)
```

---

## 6. 功能清单（v2.0 已实现）

**首页**：时段问候、星河品牌封面 Hero、继续收听、推荐歌单、每日推荐（基于收藏/历史歌手 + 热歌兜底）、热门榜单三卡、心情与活动（8 类）、新歌速递、播客精选。

**发现**：22 个标签筛选 + 最热/最新排序 + 分页加载；网易云/QQ/酷狗榜单树（动态拉取真实榜单，共 100+ 个）与歌曲表格。

**搜索**：网易云 + QQ + 酷狗 + 插件聚合，相关度排序（原名/歌手命中加权，翻唱 DJ 降权），平台过滤。

**播放页**：黑胶唱片 + 真实封面、歌词舞台 / 粒子舞台 / 电影镜头 / 播客 DJ 四态、逐字歌词、点击歌词跳转、队列抽屉（拖拽排序）、音质切换、收藏、桌面歌词。

**我的音乐**：我喜欢的音乐、本地音乐（扫描/筛选/内嵌封面与歌词）、最近播放、自建歌单、平台歌单导入（网易云/QQ/酷狗/酷我/咪咕/B 站合集）。

**视频 / MV**：B 站搜索、视频播放（swmedia 代理）、一键切换为音频模式。

**系统**：托盘菜单、媒体键与全局快捷键、关闭到托盘、窗口状态记忆、深浅色/跟随系统、封面主色自适应、桌面歌词悬浮窗（锁定穿透）、日志与缓存管理、B 站扫码登录。

---

## 7. 构建与发布

```powershell
cd app
npm install
npm run dev            # 开发（Vite + Electron）
npm run build          # 构建 dist/renderer + dist/electron
npm run dist           # 便携版 + 安装版（dist/release）
```

产物：

- `dist/release/星河音乐-2.0.0-便携版.exe`
- `dist/release/星河音乐-2.0.0-安装版.exe`

品牌资源由 `scripts/make-icon.cjs` 代码绘制生成（星河 + 音符 + 月牙），无需外部素材。

---

## 8. 质量保障

`scripts/smoke.cjs` 启动真实 Electron 应用并逐页验证：

1. 首页 Hero、歌单封面、榜单数据是否渲染（检查 DOM 与图片 `naturalWidth`）。
2. 点击搜索结果第一行 → 播放 → 位置递增、无 error、封面 600px、歌词 63 行。
3. 收藏按钮 → 数据库计数变化。
4. 发现/榜单/视频/设置/本地/播放页截图。
5. 收集全部 `console-message` 错误，要求为 0。

`scripts/diag*.cjs` 为专项诊断脚本（取链、歌词、媒体代理、本地扫描、浅色主题、桌面歌词）。

---

## 9. 已知边界

- 版权受限歌曲可能所有免费音源都无法取链，此时会提示「该歌曲暂时无法播放」，属音源能力边界。
- 平台接口随时可能变更；原生接口失败时由插件音源兜底，两者都失败会以明确文案提示。
- 播客仅提供精选入口（跳转 Apple Podcasts），未做内嵌播客播放器。
- 咪咕歌单接口已改为 App 签名接口，导入会给出明确提示并建议改用其他平台。
