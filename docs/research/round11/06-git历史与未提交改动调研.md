# 06 · Git 历史与未提交改动调研（round11）

> 调研时间：2026-10-24（周六）
> 仓库：`D:\music`（单一 git 仓库，`.git` 在根；`app/` 无独立 `.git`）
> HEAD：`aaaee76 refactor(player): 播放模块按规格书 v2.7 模块化重构`
> 调研方式：只读（log / status / diff / blame / ls-tree / grep / show），未做任何写操作。

---

## 一、提交历史关键发现

### 1.1 单文件历史统计（`git log --follow --oneline -- <file>`）

| 文件 | 提交次数 | 最近 5 条（hash 前 7 位） | 备注 |
|---|---|---|---|
| `app/src/pages/MvPlayer.vue` | **16** | aaaee76 / aa1e9ec / b11227e / 132d812 / f12b364 | **全仓返工冠军**，最近 5 条连续 5 次都在动它 |
| `app/electron/ipc.ts` | 11 | 82c1aa8 / b11227e / 132d812 / a80de62 / 0bbb0b4 | 每加一个规格书条目就改一次 |
| `app/src/pages/Player.vue` | 9 | aaaee76 / b11227e / 132d812 / 0bbb0b4 / 1f1aa88 | 播放页持续改 |
| `app/src/mobile/player.ts` | 8 | aa1e9ec / 82c1aa8 / b11227e / c0846fa / 065e147 | 移动端音频核心 |
| `app/electron/core/media.ts` | 4 | 8c7c5e4 / 52987d2 / 7bd7032 / bd98254 | 表面次数少，但本次工作区一次性 +84 行新增音频缓存 |
| `app/src/stores/player.ts` | 2 | b11227e / bd98254 | 仅初始化 + 一次 v2.7 视觉模式迁移 |

### 1.2 反复修改 / feat→fix→feat 循环

**G-01 · 播放模块连续 4 次聚焦提交（feat→feat→fix→refactor）**
- 证据：`b11227e feat(player): v2.3.5 全端播放模块规格书 v2.7 对齐` → `82c1aa8 feat(v2.3.5): 补齐规格书 v2.7 剩余条目（1.8/1.12/3.x/4.1/4.4）` → `aa1e9ec fix(player,video,settings): 播放页去重重构 + 视频面板紧凑化 + 移动端插件市场/最近播放修复` → `aaaee76 refactor(player): 播放模块按规格书 v2.7 模块化重构`
- 影响：v2.7 规格书条目是分批补齐的，补完又 fix、fix 完再整体 refactor —— 说明前两次 feat 并未一次到位；HEAD 的 aaaee76 就是这次"模块化重构"的产物（即工作区 renames 的基线）。
- 建议：工作区这次未提交改动本质是 aaaee76 的**未完成收尾 + v2.8 新条目叠加**，提交时应拆成"重构收尾"与"v2.8 新功能"两笔，否则以后 blame 难追溯。

**G-02 · 移动端 CORS / 真机代理连续 4 次根因修复**
- 证据：`0e85e64 fix: 移动端数据源CORS与多级导航` → `bd673b4 fix: 真机不再改写到 /__cors 代理，改用 CapacitorHttp 原生无 CORS fetch` → `5234dd4 fix: 移动端媒体播放原生代理（/swmedia）根治真机403拒载` → `d92942d fix: 真机代理手动跟随跨协议302 + 允许明文CDN流量`
- 影响：同一类问题（真机 403 / CORS）在 v2.0 周期内迭代了 4 次才收口；`/swmedia` 路径就是这次定稿的产物。
- 建议：本次工作区新增的 `SwAudioCache.java` 若要在移动端落地，应复用 `/swmedia/` 拦截链路，不要再开新代理路径。

**G-03 · v2.0.0 同版本号二次打包**
- 证据：`bd98254 feat: 星河音乐 v2.0 全新架构` → `65be2e8 fix: 修复排行榜/超长MV/标题栏主题色/启动崩溃四项缺陷，重新打包 v2.0.0`
- 影响：版本号未升即重打，说明首次 v2.0.0 发布包质量不达标；这也是后来 `StarWish-2.0.0-*.exe / 星河音乐-2.0.0-win-unpacked/` 等巨物被入库（b238917）再被本次工作区删除的根源。

**G-04 · v2.3.3 "网页无法打开" 热修复 → v2.3.4 又两轮根因修复**
- 证据：`9903b92 fix(v2.3.3): 启动「网页无法打开」热修复` → `f12b364 feat(v2.3.4): 真机三轮反馈收口` → `132d812 refactor(v2.3.4): 第二轮根因修复（私人电台/桌面MV控制条/播放器舞台/启动耗时/桌面应用内更新）`
- 影响：启动问题先热修、后根因修，说明 9903b92 是表面修复；`132d812` 同一笔提交里又碰了 MvPlayer / Player / media 舞台，与本次 MvPlayer.vue 的 16 次返工互为因果。

**G-05 · 未见 revert 语义提交**
- 全量 80 条 `git log --oneline -80` 中**没有任何 `revert:` / `回退` / `撤销` 字样**。
- 影响：历史上没有"显式回退"，但存在**"修复 → 后续版本再次动同一处"**的隐性反复（见 G-01/G-02/G-04）；这意味着 round10 发现的 Bug96 这类"被改回去"的情况**不会在 message 里留痕**，只能靠 diff/blame 反推。

---

## 二、工作区未提交改动逐文件分析

### 2.1 总览（`git diff --stat`）
- 123 files changed, **+256 / −8466**。
- 删除的 8466 行里 ~99% 是**被入库的旧打包产物**（`星河音乐-2.0.0-win-unpacked/` 整目录、两个 apk、三个根目录 exe、旧 docs/*.md 设计文档）——属于清理历史包袱，不是代码回退。
- 真正的代码改动只集中在 ~18 个源文件，方向一致指向 **规格书 v2.8 · 0.6 模块拆分 + 1.12 播放缓存 + 1.9 快捷键 + 3.1 首页搜索框 + 1.2 封面统一圆形唱片**。

### 2.2 重构类（路径迁移，import 已同步）

| 旧路径（HEAD） | 新路径（工作区） | import 是否同步 |
|---|---|---|
| `src/platform.ts` | `src/platform/index.ts` | 无需改（目录化） |
| `src/audio/eq.ts` | `src/player-core/eq.ts` | ✅ main.ts / main.mobile.ts / EqPanel.vue |
| `src/audio/spectrum.ts` | `src/player-core/spectrum.ts` | ✅ main.mobile.ts / SpectrumBars.vue |
| `src/player/*`（lyrics/stages/usePlaybackGestures/5 个组件） | `src/player-music/*` | ✅ Player.vue / mobile/Player.vue / CarPlayer.vue / LyricsPane.vue |
| `src/video/*`（useVideoGestures/useVideoSession/2 组件）+ `src/components/video/AudioModeView.vue` | `src/player-video/*` | ✅ MvPlayer.vue / mobile/MvPlayer.vue / VideoStage.vue |

**G-06 · 重命名后唯一残留：SpectrumBars.vue 第 5 行注释**
- 证据：`D:\music\app\src\components\player\SpectrumBars.vue:5` 注释仍写 `数据来自真实 AnalyserNode（见 src/audio/spectrum.ts）`。
- 影响：仅注释，不影响构建；但属于路径迁移漏网。
- 建议：把注释改成 `见 src/player-core/spectrum.ts`。

**G-07 · 未发现悬空 import**
- 在 `D:\music\app` 下 grep `platform\.ts|audio/eq|audio/spectrum|@/player/|@/video/|components/video/` 仅命中上述 1 处注释。
- 影响：路径迁移本身完整，不会因重命名导致构建失败。

### 2.3 新功能类（v2.8 条目）

**G-08 · media.ts 新增音频播放缓存（+84 行）——与 round10 Bug96 方向相反**
- 证据（`git diff app/electron/core/media.ts`）：
  - 新增 `AUDIO_EXT` 集合 + `isAudioUrl()` + `extOf()`。
  - `protocol.handle('swmedia', …)` 头部新增 ~35 行：**先查 `audioCacheFile(target)` 命中就直接 `fs.createReadStream` + Range 206 回复**。
  - 远端拉流分支尾部新增 ~24 行：`if (body && isAudioUrl(target) && res.status === 200 && !range)` 时用 `chunks: Buffer[]` 把整曲边播边收集，播完 `putAudioCache(target, Buffer.concat(chunks), ext)`。
  - 视频完整缓存升格后新增一行 `pruneVideoCache()`（视频缓存 1GB 上限）。
- 影响：
  - 这正是背景情报提到的 **"chunks 收集整曲"** 代码。若 round10 Bug96 的结论是"整曲 chunks 收集有缺陷/不该这样做"，那这次工作区是**把被否定的方案又写回来了**，存在 Bug96 回归风险。
  - 新代码 `if (!range)` 才收集：首段 Range=0- 的请求不会进入收集分支，意味着**只有不带 Range 的完整 GET 才会落盘**——而播放器一般都会发 Range 头，可能导致缓存实际不生效。
  - 收集在 `pull()` 里逐块 `chunks.push`，长曲目（10~20MB）会全部驻留内存直到播完，才有内存峰值隐患。
- 建议：提交前对照 round10 Bug96 的根因描述核对；确认 `!range` 分支条件；考虑用 `.part` 流式写盘而不是 Buffer.concat。

**G-09 · ipc.ts 新增 `cache:info` / `cache:clear` 两个 handler —— 但 `cache:clear` 与已有 handler 重名，新代码被遮蔽**
- 证据：
  - 新增（diff +4 行）：`'cache:info': () => playbackCacheInfo(),` 和 `'cache:clear': () => clearPlaybackCache(),`（位于 handlers 表 ~537 行）。
  - **旧 handler 已存在**：`app/electron/ipc.ts:729` `'cache:clear': ({ scope = 'all' }: any = {}) => { if (scope === 'all' || scope === 'cover') clearCoverCache(); … }`。
  - JS 对象字面量后写的 key 覆盖先写的 —— 工作区里 **~537 行的新 `cache:clear` 是死代码**，实际生效的仍是 729 行旧版（按 scope 清 cover/media，且直接 `fs.readdirSync(mediaCacheDir())` 全删）。
- 影响：
  - 用户在设置页点"清除播放缓存"（`Settings.vue:739` `call('cache:clear', { scope })`）走的还是旧逻辑，**新 `clearPlaybackCache()`（区分 audio/stream、不动下载目录）根本不会被调用**。
  - 新 `cache:info` 只有 `app/src/storage/cache.ts:21` 调用，而 `storage/` 目录整体无人 import（见 G-12）——所以 `cache:info` 也没有真正的渲染层消费者。
- 建议：把新逻辑合并进 729 行旧 handler（按 scope 分发：cover → clearCoverCache；media → clearPlaybackCache；并补 audio/ 子目录），删掉 ~537 行重复项。

**G-10 · package.json 新增依赖 `lamejs: ^1.2.1`**
- 证据：`git diff app/package.json` 仅 +1 行 `"lamejs": "^1.2.1"`；package-lock.json 同步 20 行。
- 影响：lamejs 是浏览器端 MP3 编码器，本次 diff 中**没有任何 src/ 代码 import 它**（`git log -Slamejs` 无历史）。疑似为 v2.8 后续"下载/转码"条目预埋，或用于 EQ 频谱导出。
- 建议：确认它是否本期就要用；若不用就先移除，避免无谓增大包体。

### 2.4 UI 类（小改动）

| 文件 | 改动 | 性质 |
|---|---|---|
| `pages/Home.vue` (+96/-?) | 新增顶部右侧搜索框（`hero-search`）+ App 图标 + `submitSearch()` 跳 `/search?q=`；新增 brand-icon.png 引用；加 1180px 断点 wrap | 规格书 v2.8 · 3.1 新功能 |
| `player-music/components/CoverStage.vue` (+42/-?) | **删除 phone 方形封面分支**，phone/pad/desktop 全部统一圆形唱片；pad 160→180，phone inner 96→60；注释明确"禁止手机端方形" | 规格书 v2.8 · 1.2 统一规则（破坏性 UI 变更，可能与 round10 真机反馈相左） |
| `pages/CarPlayer.vue` / `Player.vue` / `mobile/Player.vue` / `MvPlayer.vue` / `mobile/MvPlayer.vue` | 仅 import 路径从 `@/player/*`、`@/video/*` 改为 `@/player-music/*`、`@/player-video/*` | 重构配套 |
| `EqPanel.vue` / `SpectrumBars.vue` | 仅 import 路径 `@/audio/eq` → `@/player-core/eq`、`@/audio/spectrum` → `@/player-core/spectrum` | 重构配套 |
| `main.ts` / `main.mobile.ts` | 仅 eq/spectrum import 路径切换 | 重构配套 |

**G-11 · CoverStage 统一圆形唱片与历史"phone 方形"设计相反**
- 证据：旧实现（diff `-` 行）注释写明"phone：200×200 方形、圆角 12、不旋转、纯渐变背景"；新实现明确写"禁止手机端方形、禁止平板竖屏方形（v2.8 明确不允许）"。
- 影响：这是规格书驱动的视觉回退——把之前真机调试做出来的 phone 方形布局删掉了。如果 round10 真机反馈里有"手机封面要方形"的条目，这次就是**主动改回圆形**。

---

## 三、旧命名迁移验证

### 3.1 前缀现状

| 旧前缀 / key | 当前是否残留 | 位置 | 性质 |
|---|---|---|---|
| `xinyuan_*` | **现行标准** | `platform/index.ts:33` `PREFIX = 'xinyuan_'`；`mobile/bridge/index.ts:737` `xinyuan_video_offline` | v2.7 规格书统一前缀，**不是残留** |
| `sw.stage` | 仅作一次性迁移读取 | `stores/player.ts:30` `localStorage.getItem('sw.stage')`，读取后 `:396 removeItem` | 有意迁移代码，正确 |
| `sw.sidebar.collapsed` | **仍在使用** | `components/Sidebar.vue:20,23` | Sidebar 未接入 `lsGet/lsSet` 的 `xinyuan_` 前缀，**遗漏迁移** |
| `sw.engineWarned` | **仍在使用** | `components/mobile/EngineGuard.vue:25` | 同上，未接入统一前缀 |
| `window.sw`（IPC 桥） | **仍在使用** | `api.ts:20,41`、`pages/Local.vue:52` | 桥对象名，可保留 |
| `swmedia://` / `swcover://` | **仍在使用** | `electron/core/media.ts:51,283`、`index.html:7` CSP、Android `SwMediaClient.java` | 协议 scheme，属正常命名 |
| `bili-login.json` | **仍在使用** | `electron/paths.ts:101`、`ipc.ts:766` | B 站登录态文件名，已在 .gitignore |
| `buvid / buvid3 / buvid4` | **仍在使用** | `electron/core/bili.ts` 全文 | B 站官方字段名，**不是旧命名残留** |
| `starwish-*` | 仍在使用 | Java 包 `com.starwish.music`、`sources/starwish-bilibili.js` / `starwish-unified.js` | 项目曾用名 StarWish 延续 |

**G-12 · 两处 `sw.*` localStorage key 未迁移到 `xinyuan_` 前缀**
- 证据：`Sidebar.vue:20-23` 直接 `localStorage.getItem/setItem('sw.sidebar.collapsed', …)`；`EngineGuard.vue:25` `const KEY = 'sw.engineWarned'`。
- 影响：规格书 v2.7 · 0.5 要求"xinyuan_* 键统一入口"，这两处绕过了 `platform.ts` 的 `lsGet/lsSet`，意味着未来若改存储策略（加密/迁移/同步）这两个 key 会漏网。
- 建议：改成 `lsSet('sidebar.collapsed', …)` / `lsGet('engineWarned')`，由 `xinyuan_` 前缀统一加挂。

### 3.2 历史轨迹（`git log -S`）
- `git log -S"putAudioCache" -- app`、`git log -S"chunks" -- app/electron/core/media.ts`、`git log -S"lamejs" -- app` 均**无命中**——说明这三个概念在 HEAD 历史里从未出现过，全部是本次工作区新增。
- `sw.stage` 在 HEAD 的 `stores/player.ts:30` 已存在（b11227e 引入），属于有意保留的迁移读取。

---

## 四、热点文件 blame 结论

### 4.1 `app/electron/core/media.ts`
- 全文件 blame 按 commit 聚合（剔除本次工作区未提交行）：
  - `bd98254`（v2.0 初版架构）：`protocol.handle('swmedia', …)` 骨架、本地文件分支、Range 解析。
  - `7bd70321`（v2.0.1 十项修复）：`releaseMediaCache()` 启动清空、`isVideoUrl` 完整缓存直连（~L280-297）。
  - `52987d2`（v2.0.2）：视频缓存降级守卫。
  - `8c7c5e4`（v2.1.0）：MV 加载更多 / 播放器增强。
- **高频返工函数**：`registerMediaProtocol()` 内的 `protocol.handle('swmedia', …)` 回调本身——每次加缓存/降级/代理都往里塞一段。本次工作区又在同一个回调里加了 ~60 行（音频命中 + chunks 收集）。
- 结论：`swmedia` handler 已变成 **if-else 面条**（本地文件 → 视频命中 → 视频 Range tee → **音频命中（新）** → 远端透传 → **音频 chunks tee（新）**），建议下一轮重构把"按 URL 类别分发到独立 handler"抽出来。

### 4.2 `app/src/stores/player.ts`
- blame 显示：
  - `bd98254`：骨架（EMPTY 状态、defineStore）。
  - `b11227ef`：仅改了视觉模式相关 ~L9-41（`StageMode` / `STAGE_LEGACY` / `readStage` / `readLoopMode`）和 `:396` `removeItem('sw.stage')`。
- **高频返工函数**：`readStage()` / `readLoopMode()` / 视觉模式持久化块——v2.7 规格书要求改 key 名时动过一次。store 主体本身稳定。

---

## 五、未跟踪 / 孤儿文件

### 5.1 `git status --short` 的 `??` 项（已剔除 node_modules/dist）

| 路径 | 性质 | 是否接线 |
|---|---|---|
| `app/electron/core/cache.ts` | 新增 v2.8 · 1.12 缓存实现（audio 50 首/500MB、video 1GB、prune） | ✅ 被 `ipc.ts:73` import，但新 handler 被旧 handler 遮蔽（G-09） |
| `app/src/player-core/index.ts` | 新模块公共出口（re-export state/eq/spectrum） | ❌ **无人 import**（grep 0 命中） |
| `app/src/player-core/state.ts` | `coreState` / `patchCore` 全局播放状态单例 | ❌ **无人调用**（grep 仅自身定义） |
| `app/src/platform/useGlobalShortcuts.ts` | v2.8 · 1.9 桌面快捷键入口 | ❌ **无人调用**（grep 仅自身定义） |
| `app/src/storage/{cache,db,downloads,index}.ts` | v2.8 · 0.6 storage/ 模块 | ❌ **0 import**（grep 0 命中）；其中 `cache.ts:21,27` 调了 `cache:info/cache:clear`，但整条链没人接 |
| `app/android/.../SwAudioCache.java` | Android 端 v2.8 · 1.12 音频缓存原生实现 | ❌ **未被 SwMediaClient / MainActivity 引用**（grep 仅自身类定义） |
| `docs/_backup/` `docs/_shots/` `docs/research/` | 研究/备份目录 | 目录，本调研正在写入 `docs/research/round11/` |
| `docs/星河音乐-全端美化模板开发规格.html` | 新规格书 | 文档 |

**G-13 · 6 个新模块里有 5 个"写完未接线"**
- 证据见上表"是否接线"列。
- 影响：本次工作区处于 **"写了一半的 v2.8 模块化重构"** 状态：路径迁移（player/→player-music/、video/→player-video/、audio/→player-core/）做完了，但 player-core 的新 state、platform 的新快捷键、storage/ 整套、Android 的 SwAudioCache 都还没被任何入口 import。
- 风险：
  1. 直接提交会留下大量"死文件"，后续开发者会困惑这些模块是否还在用。
  2. TypeScript 构建时若开了 `noUnusedLocals` 不一定报错（因为这些文件本身是模块，只要没 import 就不会被打包），所以问题不会在 CI 暴露。
- 建议：提交前要么 (a) 把 `installGlobalShortcuts` 接到 `main.ts`、把 `storage/index.ts` 接到相关页面、把 `SwAudioCache` 接到 `SwMediaClient`；要么 (b) 先把这 5 个文件移出工作区（或加到 `.gitignore`），分两期提交。

### 5.2 被删除的历史包袱（`D` 项）
- `StarWish-2.0.0-Setup.exe`、`StarWish-2.0.1-win-portable.exe`、`StarWish-2.0.2-win-portable.exe`：根目录 3 个旧 exe。
- `星河音乐-2.0.0-win-unpacked/` 整目录（~80MB，含 resources/app.asar、locales/*、sources/*.js）。
- `星河音乐-2.0.0-android.apk` / `-debug.apk`。
- `docs/StarWish-Music-v2.*.md` 共 11 份旧设计文档（v2.0 / v2.3 / v2.3.1-4 / 初始开发文档 / v1.1 修复文档 / mobile-ui-research / multi-platform-ui-research / research-v2.3.4-mobile-refactor）——疑似被移到未跟踪的 `docs/_backup/`。

**G-14 · 这些删除与 `.gitignore` 规则自相矛盾**
- 证据：根 `.gitignore` 里写着 `!星河音乐-2.0.0-win-unpacked/`、`!星河音乐-2.0.0.exe`、`!星河音乐-2.0.0-android.apk` 等"例外允许入库"。
- 影响：本次工作区把它们从工作区删了，但 `.gitignore` 的白名单例外规则还在——下次有人重新打包这些产物，它们又会被 `git status` 视为"应跟踪"。
- 建议：提交删除时同步清理 `.gitignore` 里对应的 `!` 例外行。

### 5.3 `.gitignore` 备注
- 根 `.gitignore` 已忽略 `node_modules/ dist/ out/ release/ app/.tmp/ bili-login.json` 等；`app/.gitignore` 仅 `.tmp-esbuild/`。
- 未见 `docs/_backup/` `docs/_shots/` `docs/research/` 的忽略规则——本调研产物即落在 `docs/research/` 下，会被未来 `git status` 列为 `??`，属正常。

---

## 六、与 round10 Bug 的对应关系（结论）

| round10 已知项 | 工作区改动是否在修它 | 说明 |
|---|---|---|
| **Bug96（media.ts chunks 收集相关）** | ⚠️ **方向相反 / 疑似回归** | 工作区在 media.ts 又加了 ~24 行 `chunks: Buffer[]` 整曲收集 + `putAudioCache` 落盘（见 G-08）。若 Bug96 的结论是"不该用整曲收集"，本次就是把它重新写回；需要 round10 报告对照确认。 |
| 路径悬空引用（player/→player-music/、video/→player-video/） | ✅ **已修** | 所有页面 import 都同步改完，仅 SpectrumBars.vue 第 5 行一处注释残留（G-06）。 |
| 旧 `audio/eq` `audio/spectrum` 引用 | ✅ **已修** | main.ts / main.mobile.ts / EqPanel.vue / SpectrumBars.vue 全部切到 `player-core/`。 |
| `sw.*` localStorage key 迁移 | ❌ **未修完** | `Sidebar.vue`、`EngineGuard.vue` 仍直接用 `sw.sidebar.collapsed` / `sw.engineWarned`（G-12）。 |
| 缓存清理逻辑 | ⚠️ **改了但接错** | 新增 `cache:info` / `cache:clear` handler，但 `cache:clear` 与旧 handler 重名被遮蔽，新代码是死代码（G-09）。 |
| 首页搜索框 / 封面统一圆形唱片 / 桌面快捷键 / storage 模块 | 🆕 **v2.8 新条目** | 与 round10 Bug 无关，是规格书 v2.8 的新需求（G-08/G-11/G-13）。 |
| 删除入库的 exe/apk/unpacked | 🧹 **清理** | 与 round10 Bug 无关，是仓库瘦身；但 `.gitignore` 例外规则未同步删（G-14）。 |

---

## 七、关键发现速查（G 编号汇总）

- **G-01** 播放模块 4 连改（b11227e→82c1aa8→aa1e9ec→aaaee76），v2.7 分批补齐。
- **G-02** 移动端 CORS/代理 4 连修（0e85e64→bd673b4→5234dd4→d92942d），定稿 `/swmedia/`。
- **G-03** v2.0.0 未升版号二次打包（65be2e8），是后来大产物入库再被删的根源。
- **G-04** v2.3.3 启动问题热修（9903b92）→ v2.3.4 根因修（132d812）。
- **G-05** 全历史无 revert 提交，隐性反复只能靠 diff/blame 反推。
- **G-06** SpectrumBars.vue:5 注释残留 `src/audio/spectrum.ts` 旧路径。
- **G-07** 路径迁移完整，无悬空 import。
- **G-08** media.ts +84 行新增音频整曲 chunks 缓存，与 round10 Bug96 方向相反，且 `!range` 条件可能导致缓存实际不生效。
- **G-09** ipc.ts 新增 `cache:clear` 与已有 :729 handler 重名，新代码被遮蔽为死代码；`cache:info` 无渲染层消费者。
- **G-10** package.json 新增 `lamejs: ^1.2.1` 但无代码 import。
- **G-11** CoverStage 删除 phone 方形分支，全端统一圆形唱片（规格书 v2.8 · 1.2 强制）。
- **G-12** `sw.sidebar.collapsed`、`sw.engineWarned` 两个 localStorage key 未迁移到 `xinyuan_` 前缀。
- **G-13** 6 个新文件里 5 个未接线（player-core/state、useGlobalShortcuts、storage/ 4 文件、SwAudioCache.java）。
- **G-14** 删除入库产物但 `.gitignore` 的 `!` 白名单例外规则未同步清理。
