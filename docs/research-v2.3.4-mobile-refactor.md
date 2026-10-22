# v2.3.4 移动端体验重构 · 调研报告

日期：2026-10-22
范围：移动端（Android / iOS）推荐页、播放页、设置页、应用内更新；并横向排查桌面端与其它移动页面的同类问题。

---

## 一、问题复盘（根因，不止表象）

| 用户反馈 | 根因 | 位置 |
| --- | --- | --- |
| 推荐页介绍语里排行榜是重复内容 | 首页 feed 的 `daily`（每日推荐）在数据不足 24 首时**用榜单 3778678 的歌曲兜底**，而同一 feed 又单独产出 `toplists` 榜单卡 → 同一批歌曲在「每日推荐」与「热门榜单」两处重复出现；`newSongs` 兜底同样取 `neteaseNewSongs` | `electron/core/recommend.ts:63-77` |
| 热门榜单无法打开列表 | 榜单/歌单详情复用了桌面页 `src/pages/Playlist.vue`，主体是桌面语义 `SongList`（hover 出现播放键、专辑列、时长列、右键菜单用 `clientX/Y` 定位）。窄屏下条目退化、菜单弹不出来 → 用户视角「打不开列表」 | `src/pages/Playlist.vue:249` / `src/components/SongList.vue` |
| 新歌中无法打开列表 | ① 移动端 Discover 的 `watch(tab)` 只在切 tab 时触发，首次以 `?tab=new` 进入不会拉数据；② 没有 `watch(route.query)`，从首页跳 `/discover?tab=new` 时 Discover 被 KeepAlive 缓存，tab 根本不切 → 白屏 | `src/pages/mobile/Discover.vue:132-140` |
| 播放器体验差 | 移动端播放页是「自绘 mini 版」：歌词只显示 ±1 行、没有进度条拖拽以外的常用能力（倍速、音量、队列面板、定时、桌面歌词、投屏入口），视觉上与封面区割裂 | `src/pages/mobile/Player.vue` |
| 设置体验差 | 移动端直接复用 3000 行的桌面 `Settings.vue`，只是内部用 `isMobileSettings` 隐藏部分项；桌面专属项（壁纸引擎、WebDAV、快捷键、日志目录）仍占版面，移动端专属项（应用内更新、缓存、下载目录）没有一级入口 | `src/router.ts:51` / `src/pages/Settings.vue` |
| 移动端无法进行应用内更新版本 | ① AndroidManifest **未声明 `android.permission.REQUEST_INSTALL_PACKAGES`**，Android 8+ 无此权限时安装器直接拒绝；② 下载走原生线程但**无进度回调**，UI 只能「等一会儿」；③ 检查更新依赖 GitHub API 直连，弱网下无兜底 | `app/android/app/src/main/AndroidManifest.xml` / `SwBridgePlugin.java:69-100` |

---

## 二、竞品调研结论

### 2.1 移动端播放页（网易云 / QQ 音乐 / Apple Music / Spotify）
共性范式，本项目按此重构：

1. **三层结构**：顶栏（返回 + 状态 + 更多）→ 中部内容区（封面 / 歌词**双页签切换**）→ 底栏控制区（进度条 + 上一首/播放/下一首 + 功能图标行）。
2. **进度条**：细横条 + 圆形拖拽把手 + 左右分别显示已播/总时长；歌词页签内也有一根，滚动时高亮当前行（长歌词居中放大）。
3. **功能图标行**（约 4–5 个）：收藏（红心）、队列/播放列表、倍速、定时、更多。图标行是移动播放器的「入口密度」核心，桌面版没有。
4. **手势**：上滑收起、下滑关页面；左右滑切歌属于国内 App 附加能力，可保留但不作为唯一入口。
5. **歌词**：整页滚动、当前行高亮放大、自动滚动跟随，顶部带一个「歌词/封面」切换按钮。
6. **MiniPlayer**：固定在底栏之上，56–64px 高，封面 + 标题/歌手 + 播放键 + 进度细条；点击整块进播放页。

本项目重构取其形：封面/歌词双页签、进度把手、功能图标行（收藏/队列/倍速/定时/更多）、整页滚动歌词，保留现有手势与本地能力。

### 2.2 移动端设置页
主流做法是 **分组列表 + 分级子页**（iOS 设置 / 小米音乐 / QQ 音乐一致）：

- 一级页只列 8–10 个分组入口（外观与主题、播放、下载、歌词、音源与插件、网络与缓存、隐私与权限、关于与更新），每行「图标 + 标题 + 右侧当前值/箭头」。
- 二级页用**独立路由**，返回行为天然正确（Android 手势返回可用）。
- 开关类用 Switch、滑块类用 Slider，其余用开关行；危险操作（清缓存、清数据）放二级页底部并二次确认。
- 「关于与更新」独立成页：版本号、检查更新（有更新时按钮变主色「立即更新」）、更新日志、隐私说明。
- 桌面专属能力（壁纸引擎/WebDAV/快捷键/日志目录）在移动端**不出现**，不做「隐藏成不可用项」这种半吊子。

### 2.3 Android 应用内更新（自更新 APK）标准做法
1. `AndroidManifest` 声明 `<uses-permission android:name="android.permission.REQUEST_INSTALL_PACKAGES" />`。
2. 下载到应用私有目录（`filesDir/update/`），用 `FileProvider.getUriForFile` 生成 `content://` URI，`ACTION_VIEW` + `application/vnd.android.package-archive` 拉起安装器，并 `FLAG_GRANT_READ_URI_PERMISSION`。
3. `FileProvider` 的 `file_paths.xml` 需覆盖 `files-path` 指向 `update/`（本项目已配置）。
4. 首次安装需用户授权「安装未知应用」——应用内应给出明确引导文案。
5. 下载要有进度反馈（原生 `notifyListeners` → JS `on('downloadProgress')`），否则大包下载期间界面「假死」。

本项目缺失 1、2（进度）、引导文案，本轮补齐。

---

## 三、重构方案（模板级，非修补）

| # | 事项 | 动作 |
| --- | --- | --- |
| 1 | 首页内容重复 | `recommend.ts` 每日推荐兜底不再用榜单/新歌，改为「去重 + 排除榜单内曲目」；首页榜单区改「榜单速览」（封面 + 名称 + 前 3 首预览），点进独立榜单页 |
| 2 | 榜单/歌单详情 | 新建 `src/pages/mobile/Playlist.vue`（移动端专属详情页：大封面头 + 播放全部 + 行式曲单 + 排序/筛选），路由按端分流 |
| 3 | 新歌 | 移动端 Discover 修 `route.query` 同步与首屏加载；新增 `/new` 完整新歌页，首页「新歌速递」入口跳转该页 |
| 4 | 播放页 | `src/pages/mobile/Player.vue` 模板级重写：封面/歌词双页签、进度把手、功能图标行、整页滚动歌词 |
| 5 | 设置页 | 新建 `src/pages/mobile/Settings.vue`：一级分组入口 + 二级子页（含「关于与更新」），路由按端分流 |
| 6 | 应用内更新 | Manifest 补权限；`SwBridgePlugin` 增加进度事件与安装引导；移动端设置「关于与更新」页接入检查/下载/安装 |
| 7 | 横向排查 | 桌面端同步修同类问题（首页重复内容、桌面更新仅跳浏览器 → 保留但增加说明；桌面 Discover 新歌已正常） |

## 四、风险与约束
- 移动端与桌面端共享 `electron/core/*` 业务模块（providers/db/recommend），改动必须两端同时受益、不能引入 Node 专属依赖。
- 所有出站 payload 必须经 `src/api.ts` 的 `toPlain()`。
- 版本号仍为 2.3.4（本次不升版）。

---

## 五、第二轮：桌面端播放/启动/私人电台问题（根因与修复）

本轮用户反馈 4 个问题，均为**根因型缺陷**而非样式问题，修复方式为重构而非打补丁。

### 5.1 桌面端 MV 播放器「只能播放，其他功能丢失」

**根因**：`src/pages/MvPlayer.vue` 的控制条模板写成
`<div v-if="isMobileMv" class="ctrl-row m-ctrl">` —— **桌面分支完全没有控制条 DOM**。
CSS 里 `.ctrl-left` / `.ctrl-right` / `.vol-range` / `.tlab` 等规则都在，但没有对应元素，
于是桌面端只剩一个裸 `<video>`。不是样式失效，是结构缺失。

**修复**：补齐桌面控制条 `v-else class="ctrl-row d-ctrl"`，含：
播放/暂停、后退 5 秒、前进 5 秒、当前时间/总时长、音量滑杆 + 静音、
画质菜单（多档）、倍速菜单（0.75/1.0/1.25/1.5/2.0）、更多菜单（循环模式、画面比例、自动连播、弹幕开关）、
画中画（PiP）、全屏。静音图标名修正为 `volume-mute`（Icon.vue 无 `volume-off`）。

**实测**：桌面控制条存在，9 个功能按钮 + 3 个下拉菜单全部渲染；画质菜单选项 `["64P","16P"]` 可展开。

### 5.2 播放页切换「歌词、舞台」延迟且变化小

**根因**：`src/pages/Player.vue` 给 `.player` 绑定了 `stage-lyrics / stage-particle / stage-cinema / stage-podcast`
四个类，但**全项目搜索不到任何对应的 CSS 规则**。切舞台时 DOM 结构不变、尺寸不变，
只有内部少量内容替换 → 用户感知「延迟 + 变化小」。与引擎无关，是舞台样式从未实现。

**修复**：
- 差异化布局：封面列宽按舞台变化 `340 → 280 → 320 → 210px`；
  栅格列宽按舞台变化（歌词 `588/649`、粒子 `495/742`、电影 `526/711`）；
  粒子舞台加强光晕（blur 46px / opacity .85）；播客舞台收窄封面、放大歌词区。
- 右侧内容用 `<Transition name="stage-fade" mode="out-in">` 包裹（key: podcast / empty / lyrics），
  进入位移 10px + 透明度过渡。
- 网格/宽度/opacity 加 `.32s` 过渡，消除切换跳变。
- 移动端播放页同步：封面/歌词双页签改用方向感知 `<Transition>`（左进右出 / 右进左出），
  并新增舞台维度（歌词 / 粒子 / DJ）——粒子舞台加呼吸光晕，DJ 舞台加 28 根律动波形。

**实测**：4 态封面宽度与栅格列宽实测差异明确；回切歌词恢复正常布局。

### 5.3 启动后需等待约 10 秒才在桌面显示

**根因**：`electron/main.ts` 旧顺序为
`initDb() → lxHost.load() → registerIpc() → createMainWindow()`。
`initDb()`（sql.js 读盘建库）与 `lxHost.load()`（同步解析全部音源脚本）都在**主线程串行**执行，
窗口在这两件事做完之后才创建 → 桌面长时间空窗。

**修复（三段式）**：
1. `electron/main.ts`：**窗口先行**——先 `registerIpc()` → `createMainWindow()` → `restoreWindowState()`，
   再后台 `await initDb() / initBiliLogin() / lxHost.load() / mfHost.init() / registerCoverProtocol() /
   registerMediaProtocol() / applyProxy()`，最后 `markBootReady()`。
2. `electron/ipc.ts`：新增**启动就绪闸门**——Promise + 20 秒超时兜底；
   `sw:invoke` 在 `bootResolved === false` 时先 `await Promise.race([bootReadyPromise, timeout])`，
   保证早到的调用排队而非报错。
3. `src/main.ts`：渲染层**先挂载后取数**——`app.mount('#app')` → `await ui.init()` → 隐藏 splash，
   `player.init()` / `library.init()` 用 `Promise.allSettled` 后台并行，不再阻塞首屏。

**实测**：空库 **553ms 可见 / 600ms 首帧**；真实数据（47MB 目录 + 385KB DB）**566ms 可见 / 605ms 首帧**。
原 8 秒 `ready-to-show` 强制显示兜底不再触发。

### 5.4 私人电台显示的是榜单内容 / 历史歌曲

**根因**：旧实现里「私人电台」区块直接渲染 `onRepeat`（播放次数最多的历史歌曲），
所以内容必然是历史歌；某些降级路径又取了榜单，于是变成榜单内容。没有任何「电台」逻辑。

**修复**：新建 `electron/core/radio.ts` 私人电台引擎：
1. **口味画像**：收藏 ×3 + 历史 ×1 + 播放次数 ×1，累加出歌手权重。
2. **种子扩展**：取权重 Top 歌手，用 `searchNetease(name, 1, 20)` 拉同歌手其它作品作为主力。
3. **冷启动底料**：口味不足时用 `neteaseNewSongs(30)` 补。
4. **兜底**：仍不足才用榜单。
5. **剔除已听**：剔除近 200 首已听（收藏保留）。
6. **跨区块去重**：`dedupeAgainst(main, ...others)` 按 Song.id 集合差集，
   `collectFeedSongIds()` 收集每日推荐 / 新歌 / 榜单已用 id。
7. **交错编排**：`interleaveBySinger()` 按歌手轮转，避免同歌手扎堆。

桌面首页与移动端首页区块统一改用 `radio:build` IPC 通道（新增），并提供「换一批」（force 重算）。

**实测**：60 首零重复；与历史/收藏/每日推荐/新歌/榜单的交集**全为 0**；
口味种子 `["66音乐库","高清mv收藏","恶童ETON"]`，样本为新歌。

### 5.5 同步排查：数据层跨区块去重加强

`electron/core/recommend.ts` 原来只做了 `newSongs` 去 `daily`，新歌与榜单仍重叠 6 首。
现改为三方互斥：`daily`/`newSongs`/`toplistSongs` 两两交集为 0，且各区块内部无重复。
同时新歌取数池由 `neteaseNewSongs(10)` 扩到 `neteaseNewSongs(36)`（去重后仍剩 26 首，避免区块被吃空）。

**实测**：`daily: 30 / newSongs: 26 / toplistSongs: 18`，`dailyXnew:0 dailyXtop:0 newXtop:0`。

### 5.6 桌面端应用内更新（本轮补齐）

新建 `electron/core/updater.ts`：node http/https 手写跟随重定向（≤8 次）的流式下载，
`.part` 落盘后 rename，每 200ms 广播 `update:progress`；`relaunchWithUpdate()` 用
`spawn(exePath, {detached:true})` + `app.relaunch()` + `app.exit(0)` 完成重启替换。
桌面设置页「前往下载」升级为「下载并安装」，并提供「重启并安装」「打开所在文件夹」。

### 5.7 第二轮回归结果

- `npm run typecheck`（vue-tsc）通过。
- `npm run build`（renderer + electron）通过；`npm run build:mobile` 通过（488 modules transformed）。
- 桌面冒烟 `scripts/smoke.cjs`：**错误数 0**，首页/搜索/发现/本地/设置/播放/歌词/舞台/榜单/MV 全通过。
- 移动端冒烟 `scripts/mobile-smoke.mjs`：**9/9 通过**（window.sw、sources:list、db:playlists、首页渲染、
  发现页、player:state、cache:size、无 error、渲染进程未崩溃）。
