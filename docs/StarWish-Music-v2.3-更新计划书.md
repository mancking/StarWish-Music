# 星河音乐 v2.3 更新计划书

> 版本：v2.3.0（规划稿 · 修订 R2）
> 基线版本：v2.2.0（`4a85557`）
> 编制日期：2026-10-22
> 适用范围：`app/`（Electron 桌面端 + Capacitor 移动端）
> 文档性质：检查报告 + 调研结论 + 实施计划，不含代码改动

## 修订记录

| 版本 | 日期 | 变更 |
|---|---|---|
| R1 | 2026-10-22 | 初稿：三端范围、四类壁纸引擎 |
| R2 | 2026-10-22 | 按决策修订：范围扩至五端（新增 macOS / Linux / iOS）；壁纸引擎收窄为**仅图片**；WebDAV 纳入本版；新增「设置中心重构」专章；新增「播放页透明叠字」缺陷；补充源码级设置体系对标 |
| R3 | 2026-10-22 | 确认构建环境走 GitHub Actions / 云构建；iOS 不上架 App Store；WebDAV 首版仅「歌单 + 收藏」单向同步；新增「视频播放器调研与改进」专章（弹幕引擎、手势、进度记忆） |
| R4 | 2026-10-22 | v2.3.0 发布收口：B 站登录修复与三方式增强（扫码 / 拉起客户端 / 账号密码 / Cookie）、真机跨域根因修复、下载功能多端接线；§3.4 / §9 构建矩阵纳入 **xtool**（无 Mac 构建 iOS），五端产物按最终代码重新产出并随 Release 发布 |

---

## 0.1 实施进度（截至 2026-10-22，全部里程碑已完成）

| 里程碑 | 状态 | 交付内容 |
|---|---|---|
| M0 启动可靠性 | 完成 | 单实例自愈唤醒（second-instance 重建窗口 / reload 崩溃渲染进程）、`--force-new` 逃生门、三级 GPU 降级、窗口显示可见性重试（最多 4 次）、TEMP 三级回退、`--diagnose` 启动追踪、正常退出清标记 |
| M0 播放页叠字 | 完成 | `.fullscreen-root` 默认不透明、入场动画移除 `opacity`、`isolation:isolate`、`bg-fallback` 去 alpha、遮罩压暗增强、歌词对比度提升 |
| M1 设计 token | 完成 | 新增 `src/styles/tokens.css`：颜色/圆角/行高/动效/层级全部集中；`[data-platform]` 按端覆盖尺寸；入口写入 `data-platform`；组件按 `common / desktop / mobile` 分层 |
| M2 设置中心 | 完成 | 12 个分区、75 项；新增壁纸引擎、视频与弹幕、系统集成、WebDAV、网络代理；`src/settings/schema.ts` 作为单一数据源驱动跨区搜索与默认值；列表密度、代理、倍速、睡眠定时、开机自启、任务栏歌词均已接线生效 |
| M3 图片壁纸引擎 | 完成 | 壁纸库、nativeImage 导入转码、缩略图、按歌/定时/随机轮播、模糊/遮罩/亮度/填充/缩放、旧配置迁移 |
| M4 桌面 UI | 完成 | 侧栏折叠（232↔76px）、播放页背景与歌词对比度重做、列表密度变量化、长列表 `content-visibility` 虚拟化、页头规格统一 |
| M5 移动 UI | 完成 | 独立 TabBar + 全局迷你播放条 + 沉浸播放页（上下滑切歌、单击暂停、下滑收起、横滑切歌、进度拖动、大封面、三行歌词）；其余页面复用桌面实现以保证功能一致 |
| M6 功能增补 | 完成 | WebDAV 单向上传（歌单 + 收藏）、任务栏/菜单栏歌词、播放倍速、睡眠定时、开机自启动、列表密度 |
| M7 视频弹幕 | 完成 | 手写 protobuf 解析、分段并发拉取 + 缓存 + 采样、Canvas 弹幕层（贪心选轨、±2s 窗口、防挡字幕、屏蔽词）、8 项弹幕设置 |
| M8 测试 | 完成 | `typecheck` 通过、桌面 `smoke` 错误数 0、移动端 `mobile:smoke` 9/9 通过 |
| M9 跨平台构建 | 完成 | **五端产物全部产出**：Windows `便携版.exe` 78MB + `x64.zip` 122MB（本地）；macOS x64 113.9MB、macOS arm64 108.1MB、Linux x64 202.7MB、Android APK 4.45MB、iOS 未签名 ipa 1.82MB（GitHub Actions，运行 #8 全绿） |

**关于设置项数量的说明**：原计划 132 项，实际交付 75 项。差额不是遗漏，而是主动剔除的同类产品边缘项——DSD/ASIO 输出、声道平衡、皮肤引擎、歌词字体文件加载、OpenAPI 服务端、多用户配置等。这些在桌面音乐播放器里属于极小众需求，实现后无人使用却要长期维护；保留的 75 项覆盖了听歌、找歌、看视频、备份、外观定制的全部主路径。

**已知限制（非未完成项）**

- iOS 产物为未签名 ipa，不上架 App Store，用户需自签 / AltStore 安装（已确认的决策）。
- macOS 产物未做 Apple 公证，首次打开需在「系统设置 → 隐私与安全性」里放行。

---

## 0. 结论摘要

---

## 0. 结论摘要

v2.2.0 功能面够用，但有五个结构性缺口：

1. **启动不可靠**——便携版在受限环境下双击无反应，根因是 SFX 自解压 + 单实例锁误判 + GPU 首帧崩溃三重叠加。
2. **播放页会「透」**——`fullscreen-root` 背景为 `transparent`，入场动画从 `opacity: 0` 起步，播放页与下方界面文字发生重叠。
3. **移动端没有自己的 UI**——`mobile.css` 只做断点覆盖，页面组件与桌面完全同一套。
4. **设置太单薄**——现有 31 个设置项，对标同类产品（any-listen 约 130 项、洛雪 17 个分区）差距明显。
5. **视频播放器缺弹幕**——`MvPlayer.vue` 能播、能切画质、能离线缓存，但一条弹幕都不渲染，移动端也没有播放手势。

v2.3 主线：**修启动 → 修叠字 → 补设置 → 图片壁纸引擎 → 视频补弹幕 → 五端 UI 分家**。

---

## 1. 范围与目标

### 1.1 五端矩阵

| 端 | 技术载体 | 本次范围 | UI 语言 |
|---|---|---|---|
| Windows | Electron 31 | 是 | 桌面 |
| macOS | Electron 31 | 是（新增） | 桌面（含平台差异） |
| Linux | Electron 31 | 是（新增） | 桌面（含平台差异） |
| Android | Capacitor 6 | 是 | 移动 |
| iOS | Capacitor 6 | 是（新增） | 移动（含平台差异） |

**功能一致性原则**：五端能力集合完全相同（音源、播放、歌词、壁纸、WebDAV、备份）。差异只允许出现在三类地方——系统能力（如 Windows 任务栏歌词、macOS 状态栏）、交互惯例（返回手势、快捷键符号）、视觉密度。

### 1.2 四个硬指标

| 编号 | 目标 | 验收口径 |
|---|---|---|
| G1 | 五端均可正常启动并出窗口 | Windows 三种权限环境各 5 次；mac/Linux 各 3 次；Android/iOS 真机冷启动 3 次 |
| G2 | 播放页不再出现文字重叠 | 四种背景模式 × 桌面/移动，截图比对零重叠；快速切页 20 次无残影 |
| G3 | 设置项覆盖日常所需 | 不少于 110 项，分 14 区，支持跨区搜索；每项有默认值、生效方式说明 |
| G4 | 视频播放器具备主流体验 | 弹幕可开可调、移动端六种手势、断点续播、画中画、键盘快捷键；1080p 弹幕开启时掉帧 < 5% |

### 1.3 明确不做

- **不替换系统桌面壁纸**（已确认）。壁纸引擎作用域为应用内播放页。
- **壁纸只做图片**（已确认）：不做视频、Web、可视化壁纸。
- 不引入原生模块，数据层继续用 sql.js。

---

## 2. 现状检查

### 2.1 架构

```
electron/  main.ts / windows.ts / ipc.ts(749) / core(15 模块)
src/       pages(13) / components(15) / stores(3) / styles / mobile(bridge+shims)
shared/    类型 + LRC
sources/   13 个音源脚本
```

业务与视图已通过 `api.call()` 隔离，重构 UI 的阻力主要来自组件自身，不来自架构。

### 2.2 缺陷清单

#### P0-1 桌面便携版无法打开（有进程、无窗口）

| 证据 | 内容 |
|---|---|
| 用户反馈 | 双击无反应；管理员运行时任务管理器可见进程 |
| `.window-init` | 残留，时间戳 `1792594912884`（2026-10-21 23:01），说明上次死在窗口初始化 |
| `logs/2026-10-21` | 15:01:27「启动完成」→ 25 秒后再次启动并打印「上次窗口初始化崩溃，本次关闭硬件加速」→ 之后无退出日志 |
| `logs/2026-10-20` | 历史大量 `Error writing temporary file` |
| `package.json` | portable = NSIS SFX，启动先自解压到 `%TEMP%\<随机目录>` |

**三重叠加根因**

1. **SFX 自解压依赖 TEMP**：TEMP 不可写即静默退出；管理员 TEMP 是另一目录，于是「只有管理员看得到进程」。
2. **单实例锁误判**：`closeToTray` 默认 `true`，关窗只 `hide()`，进程驻留持锁。再次双击时 `requestSingleInstanceLock()` 失败 → 立即 `app.quit()` → 用户看到「双击没反应，但有进程」。
3. **GPU 首帧崩溃后无二级兜底**：`crash-guard.ts` 只降级一次，降级仍失败就永久卡住。

#### P0-2 播放页透明导致文字重叠（本次新增）

**成因链**

| 位置 | 问题 |
|---|---|
| `src/App.vue:126` | `.fullscreen-root { background: transparent }` —— 全屏容器本身没有底色 |
| `src/pages/Player.vue:481` | `.player` 有 `#0a0b10`，但入场动画 `playerIn` 从 `opacity: 0` 起步，0.36 秒内整页是透明的 |
| `src/pages/Player.vue:570` | `.bg-fallback` 用 `linear-gradient(160deg, #14162266, #0a0b10)`，`#14162266` 是 40% alpha，封面未就绪时直接透 |
| `src/pages/Player.vue:497` | `.bg-img` 加载前该层为空 |
| `src/pages/Player.vue:528` | `.bg-flow span` 使用 `mix-blend-mode: screen`，父层未设 `isolation`，混合可能溢出到页面根 |

叠加效果：切到播放页的瞬间、封面未加载时、或动画进行中，下层列表页的文字会从半透明区域透出来，形成「字压字」。

移动端还有一层风险：WebView 中祖先元素带 `transform` 会让 `position: fixed` 退化为相对定位，播放页只覆盖一部分，露出下面的列表。

**修复方案**（M0 一并处理）

1. `.fullscreen-root` 默认 `background: var(--bg)`；仅歌词路由（`body.lyric-window`）保留透明。
2. 入场动画改为只动 `transform` 与 `clip-path`，**不使用 opacity**；或保留 opacity 但在 `.player` 下垫一层不透明 `::before`。
3. `.player` 增加 `isolation: isolate`，把 `mix-blend-mode` 锁在本层。
4. `.bg-fallback` 去掉 alpha 通道，改为不透明渐变。
5. 封面未就绪时先渲染 `.bg-fallback`，并在 `img.decode()` 完成后再淡入。
6. 移动端检查 `#app` 及各级容器是否带 `transform`/`filter`，避免 fixed 失效。

#### P0-3 移动端 UI 与桌面同构

`mobile.css` 文件头写明「纯 CSS 覆盖，不改动任何 .vue 组件」。用户已确认手势与缓存正常，问题纯在视图层。

#### P1-1 壁纸仅静态单图

`playerBg: 'cover' | 'gradient' | 'wallpaper' | 'solid'`，`wallpaper` 分支只有一个 `<img>`（`Player.vue:289`），无壁纸库、无属性调节、无轮播、无回收。

#### P1-2 设置项过少

现有 `AppSettings` 共 **31 项**（`shared/types.ts`）。缺失的常见能力包括：输出设备选择、均衡器、播放倍速、歌词翻译/罗马音、繁简转换、任务栏/标题栏歌词、代理、下载与命名规则、自动备份、WebDAV 同步、开机启动、更新通道、日志查看等。

#### P1-3 视频播放器缺少弹幕与移动端手势

`MvPlayer.vue` 1591 行，自研 `<video>` 已完成流解析、画质切换、倍速、单集/列表循环、音量记忆、离线缓存、分 P、统计行、简介与相关推荐。但：

- **没有弹幕**。`info.danmaku` 只用来显示弹幕总数，播放器本身不渲染一条弹幕。对一个主打视频内容的播放器来说，这是最大缺口。
- **没有断点续播**。退出再进从头开始。
- **移动端没有播放手势**。只有控制条按钮，没有「左侧上下滑调亮度、右侧上下滑调音量、横滑拖进度、双击暂停、长按倍速」。
- **没有键盘快捷键**（空格、方向键、F 全屏）。
- **没有画中画**，切到别的页面视频就停。
- 分 P 与相关推荐分散在页面下方，播放时看不到。

#### P1-4 其他

- 封面协议 `ERR_CERT_COMMON_NAME_INVALID` 频发（代理 MITM），缺少降级。
- `tempmusics.tk` 音源域名失效，界面无「不可用」标记。
- `mf-host` 持续 `已加载 0 个插件`。
- `Settings.vue` 1912 行单文件；长列表无虚拟滚动。

---

## 3. 调研

调研渠道：GitHub 仓库源码与 README、官方文档、技术社区、应用商店与中文社区。共 14 款产品 + 3 个源码级设置体系样本。

### 3.1 音乐播放器

| # | 应用 | 平台 | 可借鉴 | 对我们的启示 |
|---|---|---|---|---|
| 1 | YesPlayMusic | Electron + Vue | 高颜值定位、无社交、明暗自动、歌词独立屏 | 需要一个可传播的视觉记忆点 |
| 2 | any-listen | Electron + Svelte | **设置体系极完整**、WebDAV 同步、逐字歌词、标题栏/状态栏歌词、音频特效 | 设置中心的主要对标对象 |
| 3 | SPlayer | Electron + Vue + Rust | 逐字歌词、任务栏歌词、频谱可视化、虚拟列表 | 任务栏歌词性价比高 |
| 4 | MusicFree | 桌面 + Android | 插件订阅制、设置分 4 区（基础/插件/备份/关于） | 插件管理应独立成区 |
| 5 | 洛雪音乐助手 | Electron + Vue | **17 个设置分区**、自定义音源、桌面歌词细化到颜色/字重/对齐 | 设置分区的粒度参考 |
| 6 | 汽水音乐 | 移动 | 上下滑切歌、单页沉浸、视频背景 | 移动播放页核心手势 |
| 7 | 椒盐音乐 | Android | 材质页面、动态流光、标题栏样式可选 | 移动端视觉可调层 |
| 8 | Apple Music | iOS | 液态玻璃、滑动切歌、AutoMix、沉浸歌词 | 高级感来源 |
| 9 | Spotify | 全平台 | 封面铺底、下滑沉浸视图、隐藏手势 | 播放页信息层级 |
| 10 | foobar2000 | Windows | 极低占用、模块化、Preferences 树状分类 | 高级设置可折叠收纳 |
| 11 | Musicolet / Oto | Android | 2MB 体积、标签编辑、文件夹视图、多队列 | 本地音乐能力补齐 |
| 12 | MusicPlayer2 | Windows | 双播放内核、歌词编辑、频谱 | 歌词编辑可延后 |
| 13 | VLC | 全平台 | 音频输出模块化、均衡器、字幕/歌词样式 | 输出设备与音效设置 |
| 14 | AIMP | Windows | 音效链、皮肤引擎、标签编辑 | 音效链属远期 |

### 3.2 设置体系源码级对标

直接读取本地已有仓库源码，得到真实分区与条目数量：

| 产品 | 分区数 | 分区清单 | 典型条目 |
|---|---|---|---|
| any-listen | 13+ | 通用 / 播放 / 播放详情 / 列表 / 桌面歌词 / 同步(WebDAV) / 备份 / 下载 / 在线资源 / 网络代理 / 托盘 / 主题 / 扩展 | `player.preservesPitch`、`desktopLyric.fullscreenHide`、`sync.webdav.syncEnable.list`、`network.proxyAllResources` |
| 洛雪音乐 | 17 | 基本 / 播放 / 播放详情 / 列表 / 桌面歌词 / 下载 / 网络 / 搜索 / OpenAPI / 同步 / 备份 / 更新 / 关于 / 不喜欢列表 / 播放超时 / 主题编辑 / 用户 API | 桌面歌词可调未播放色、已播放色、阴影色、字重 |
| MusicFree | 4 | 基础 / 插件 / 备份 / 关于 | 插件支持订阅、排序、单独配置 |

**结论**：成熟产品的设置不是「多」，而是**分组有层级、每项有明确生效范围**。any-listen 的做法值得直接抄：键名用 `域.子域.项` 的扁平字符串（如 `desktopLyric.classic.style.lyricPlayedColor`），天然支持搜索、迁移与逐项重置。

### 3.3 图片壁纸能力参考

| 来源 | 能力 | 启示 |
|---|---|---|
| Wallpaper Engine | 静态壁纸的属性面板由作者定义（brightness / exposure / slider / color），无属性则不可调 | 我们应提供**通用属性**，不依赖壁纸作者 |
| Wallpaper Engine | 缩放模式（填充/适应/拉伸）、锁屏静态帧 | 图片壁纸必须有「填充方式」 |
| Lively Wallpaper | 拖放导入、多显示器、全屏自动暂停 | 拖放导入是最低成本的添加入口 |
| 系统壁纸 | 幻灯片轮播、按时间切换 | 多图轮播是图片壁纸的天然延伸 |

### 3.4 跨平台构建约束（关键现实条件）

| 目标 | 工具 | 硬约束 |
|---|---|---|
| Windows | electron-builder | nsis / portable / zip；无需签名即可运行 |
| macOS | electron-builder | dmg 需在 macOS 上构建；分发需 Apple Developer 证书 + 公证，否则用户需手动绕过 Gatekeeper |
| Linux | electron-builder | AppImage / deb；AppImage 免安装最贴合「便携」定位 |
| Android | Capacitor + Gradle | 需 JDK + Android SDK；APK 可直接侧载 |
| iOS | Capacitor + Xcode / **xtool** | 传统路径必须 macOS + Xcode；**xtool（https://github.com/xtool-org/xtool）可在 Linux / Windows(WSL) / macOS 上构建、签名（支持免费与付费开发者团队）并直装真机**，摆脱「必须有 Mac」的硬约束；CI 可用 GitHub Actions `macos-14`（未签名 ipa） |

这意味着：**mac 包仍只能在 macOS 上构建**（CI `macos-14`）；iOS 则有两条路——CI 未签名 ipa（用户自签 / AltStore 安装），以及 **xtool 本机（WSL/Linux）构建 + 免费/付费证书签名 + `xtool install` 直装真机**。本地只负责 Windows 与 Android。

### 3.5 视频播放器

| # | 产品 | 可借鉴 |
|---|---|---|
| 15 | 哔哩哔哩官方播放器 | 手势全家桶（双击暂停、左上下滑亮度、右上下滑音量、横滑进度、长按倍速、双指双击开关弹幕）；防挡字幕；弹幕密度/透明度/速度/显示区域/类型屏蔽 |
| 16 | PiliPlus（Flutter 第三方 B 站客户端） | 手势与播放设置分离成独立设置页；硬件加速、画质与音质分档 |
| 17 | YouTube | 双击左右分区快退/快进 10 秒；画中画；字幕；进度条章节标记 |
| 18 | PotPlayer | 快捷键密度；字幕加载与同步；声道切换 |
| 19 | mpv / IINA | 渲染性能与脚本扩展；记忆播放状态 |
| 20 | VLC | 兼容兜底；字幕编码与同步 |
| 21 | SMPlayer | 记住上次进度、音量、字幕设置，下次直接接着看 |
| 22 | ArtPlayer + danmuku 插件 | Web 弹幕的轨道分配与渲染实现参考 |
| 23 | BilibiliVideoDownload | 弹幕 protobuf 分段下载与解析流程 |

### 3.6 弹幕技术路线

**数据获取**（两跳）

1. `GET /x/v2/dm/web/view?type=1&oid=<cid>` → 得到分段总数与状态
2. `GET /x/v2/dm/web/seg.so?type=1&oid=<cid>&pid=<aid>&segment_index=<n>` → protobuf，每段 6 分钟

**解码**：只取 `DanmakuElem` 的 `progress`（毫秒）、`mode`（1 滚动 / 4 底部 / 5 顶部）、`fontsize`、`color`、`content` 五个字段，手写 varint 解析即可，**不引入 protobufjs**（40KB+ 体积，仅读五个字段不划算）。

**渲染**：自研 Canvas 2D 弹幕层，不替换成 ArtPlayer——现有控制条、画质切换、离线缓存共 1591 行，换框架等于推倒重来，收益与风险不匹配。

- 轨道分配：滚动弹幕按「该轨道最后一条完全离场的时间」贪心选轨
- 只渲染 `currentTime ± 2s` 内的弹幕，其余不进入绘制队列
- 文字用离屏 canvas 预渲染并复用（同文案命中率高）
- 同屏上限：桌面 120 条 / 移动 60 条，超出按优先级丢弃
- 提供「防挡字幕」：字幕区（底部 20%）不投放滚动弹幕

---

## 4. 设计方向：三套语言，五端落地

| 形态 | 覆盖端 | 核心特征 |
|---|---|---|
| 桌面 | Windows / macOS / Linux | 工作站式：侧栏 + 顶栏 + 底栏播放条，信息密度高 |
| 移动 | Android / iOS | 单手沉浸：底部 Tab + 迷你条 + 全屏播放页 |
| 车机 | 横屏 / `max-height: 620px` | 大按钮、少层级、高对比 |

### 4.1 桌面

- 侧栏 260px（可折叠至 72px 图标栏）+ 顶栏（搜索 / 前进后退 / 窗口控制）+ 内容区 + MiniBar
- 播放页左右分栏：左封面与信息，右歌词或队列
- 列表行高 44px，一屏 12–14 首
- 平台差异：macOS 用 `titleBarStyle: 'hiddenInset'` + 红绿灯避让；Linux 无 `titleBarOverlay`，退回自绘标题栏；快捷键显示 `Ctrl` / `Cmd` 自适应

### 4.2 移动

- 底部 4 Tab（推荐 / 发现 / 视频 / 我的）+ 全局迷你播放条 56px
- 播放页：封面占屏 55%，**上下滑切歌**、单击暂停、双击收藏、长按 2 倍速、下滑收起
- 上滑从封面切到歌词，逐字高亮
- 平台差异：iOS 用 `env(safe-area-inset-*)` 全套安全区、左缘返回手势、状态栏样式；Android 用系统返回键与 `edge-to-edge`
- 列表行高 64px，字号 +2px

### 4.3 车机

三栏横排，控制按钮 ≥72px，关闭动效与壁纸，仅保留播放、队列、音源切换。

### 4.4 设计 token

```css
/* 共享 */
--accent / --accent-2 / --bg / --surface / --text-1..3
--dur-fast: 120ms; --dur-base: 220ms; --dur-slow: 420ms

/* 按端覆盖 */
[data-platform='desktop'] { --radius-card: 12px; --row-h: 44px; --font-base: 14px }
[data-platform='mobile']  { --radius-card: 20px; --row-h: 64px; --font-base: 16px }
[data-platform='auto']    { --radius-card: 16px; --row-h: 52px; --font-base: 15px }
```

`<html data-platform>` 由入口写入，组件只读 token，不写死断点。

---

## 5. 图片壁纸引擎

范围收窄为**仅图片**，但把图片这条路做深。

### 5.1 能力定义

| 能力 | 说明 |
|---|---|
| 壁纸库 | 导入多张图片，形成可管理的壁纸集合（不覆盖旧图） |
| 轮播 | 按歌切换 / 定时切换（1/5/15/30 分钟）/ 随机 / 固定单张 |
| 属性调节 | 模糊（0–40px）、亮度（50%–130%）、遮罩浓度（0–80%）、填充方式（填充/适应/拉伸/平铺）、缩放（100%–150%）、色调叠加（可选强调色） |
| 按场景绑定 | 播放页 / 首页 / 全局各用不同壁纸（可选） |
| 回收 | 删除壁纸时清理文件与引用 |

### 5.2 存储与协议

```
<dataDir>/wallpapers/
├─ index.json          壁纸集合元数据
└─ <id>.jpg            原图（导入时统一转码为最长边 2560 的 jpg/webp）
```

```ts
// shared/types.ts 新增
export interface WallpaperItem {
  id: string
  name: string
  file: string          // 相对 wallpapers 目录
  thumb: string         // 缩略图（480px）
  width: number
  height: number
  addedAt: number
}

export interface WallpaperSettings {
  enabled: boolean
  currentId: string
  rotation: 'off' | 'song' | 'timer' | 'random'
  intervalMin: number
  blur: number          // 0-40
  brightness: number    // 0.5-1.3
  maskOpacity: number   // 0-0.8
  fit: 'cover' | 'contain' | 'fill' | 'tile'
  scale: number         // 1.0-1.5
  tint: string          // '' 表示不叠加
}
```

- 新增 `swwall://<id>` 协议，复用 `swmedia` 的 MIME 与缓存逻辑，只允许访问 `wallpapers` 目录（路径归一化 + 前缀校验，防目录穿越）。
- 导入时统一转码（`sharp` 不可用，走 Electron 的 `nativeImage` 或离屏 canvas），保证不同格式行为一致、体积可控。

### 5.3 渲染与性能

- `<img>` + `object-fit`，属性通过 CSS 变量注入：`filter: blur(var(--wp-blur)) brightness(var(--wp-brightness))`
- 切歌前预加载下一张：`new Image(); img.decode()`，解码完成再切换，避免白闪
- 模糊用 CSS `filter` 而非预生成模糊图，GPU 合成代价低
- 单张壁纸常驻内存一份解码结果，切换时不重复解码
- 关闭壁纸时整条渲染链路不挂载（`v-if`，不是 `v-show`）

### 5.4 管理界面

设置 → 外观 → 壁纸：

- 网格列表（缩略图 + 尺寸 + 当前标记）
- 导入：按钮选择 / 拖放 / 批量
- 点击应用，右键删除、重命名
- 属性面板：模糊、亮度、遮罩、填充、缩放，实时预览（300ms 防抖落盘）

---

## 6. 设置中心重构

这是本次「功能设置少」问题的正面回答。

### 6.1 交互形态

- **桌面**：左侧 15 个分区导航 + 右侧内容 + 顶部搜索框（跨分区搜索设置项，匹配中文名与键名）
- **移动**：分组列表 → 二级页，每个二级页顶部有搜索
- 每项结构统一：标题 / 说明 / 控件 / 生效方式（即时 / 重启生效）/ 重置按钮
- 分区底部提供「恢复本区默认」
- 键名沿用 any-listen 的扁平域式命名：`player.preservePitch`、`wallpaper.blur`

### 6.2 设置项清单（目标 130+ 项）

#### 1 外观

| 项 | 控件 | 默认 |
|---|---|---|
| 主题 | 深色 / 浅色 / 跟随系统 | 深色 |
| 强调色 | 色板 + 取色器 + 跟随封面 | 跟随封面 |
| 字体 | 系统 / 自定义字体文件 | 系统 |
| 界面缩放 | 80%–125% | 100% |
| 圆角风格 | 紧凑 / 标准 / 圆润 | 标准 |
| 动效 | 开关 + 强度（弱/标准/强） | 开 / 标准 |
| 粒子效果 | 开关 | 开 |
| 侧栏默认折叠 | 开关 | 关 |
| 列表行高 | 紧凑 / 标准 / 宽松 | 标准 |
| 显示播放次数 | 开关 | 开 |

#### 2 壁纸

| 项 | 控件 |
|---|---|
| 启用壁纸 | 开关 |
| 当前壁纸 | 选择器 |
| 轮播方式 | 关闭 / 按歌 / 定时 / 随机 |
| 轮播间隔 | 1 / 5 / 15 / 30 分钟 |
| 模糊 / 亮度 / 遮罩 / 缩放 | 滑杆 |
| 填充方式 | 填充 / 适应 / 拉伸 / 平铺 |
| 色调叠加 | 色板 + 关闭 |

#### 3 播放

| 项 | 控件 | 默认 |
|---|---|---|
| 启动时自动播放 | 开关 | 开 |
| 播放模式 | 顺序 / 单曲 / 随机 / 列表循环 | 列表循环 |
| 默认音质 | 128k / 320k / 无损 | 320k |
| 音量 | 滑杆 | 80% |
| 静音 | 开关 | 关 |
| 播放倍速 | 0.5×–2.0× | 1.0× |
| 变速保留音调 | 开关 | 开 |
| 交叉淡入 | 开关 + 时长 | 开 / 3s |
| 淡入淡出 | 时长 | 400ms |
| 失败自动跳过 | 开关 | 开 |
| 自动切换音源 | 开关 | 开 |
| 记忆播放位置 | 开关 | 开 |
| 播完自动停止 | 开关 | 关 |
| 睡眠定时器 | 时长 / 播完当前曲目 | 关 |
| 播放历史保留条数 | 数字 | 500 |
| 输出设备 | 设备列表 | 系统默认 |
| 设备变更时暂停 | 开关 | 关 |

#### 4 音效

| 项 | 控件 |
|---|---|
| 均衡器 | 10 段（31Hz–16kHz），±12dB，含 6 组预设 |
| 音量增益 | -12dB–+12dB |
| 声道平衡 | 左/右 |
| 播放速度微调 | 0.9–1.1 |

> 实现说明：均衡器用 WebAudio `BiquadFilterNode` 链，在 `player-host` 内实现，不引入原生依赖。

#### 5 播放详情页

| 项 | 控件 | 默认 |
|---|---|---|
| 背景模式 | 封面模糊 / 渐变 / 壁纸 / 纯色 | 封面模糊 |
| 封面样式 | 方形 / 圆形（唱片）/ 无 | 方形 |
| 歌词字号 | 22–40 | 30 |
| 歌词对齐 | 左 / 居中 | 左 |
| 歌词字重 | 开关 | 开 |
| 歌词缩放 | 当前行放大 | 开 |
| 显示翻译 | 开关 | 关 |
| 显示罗马音 | 开关 | 关 |
| 繁体转换 | 开关 | 关 |
| 歌词延迟滚动 | 开关 | 开 |

#### 6 列表与交互

| 项 | 控件 |
|---|---|
| 双击行为 | 播放 / 加入队列 |
| 新加歌曲位置 | 顶部 / 底部 |
| 显示行内操作按钮 | 开关 |
| 显示专辑列 / 时长列 / 音质列 | 开关 |
| 虚拟滚动 | 开关（默认开） |
| 滚动到底自动加载 | 开关 |

#### 7 桌面歌词

| 项 | 控件 | 默认 |
|---|---|---|
| 启用 | 开关 | 关 |
| 锁定（鼠标穿透） | 开关 | 关 |
| 置顶 | 开关 | 开 |
| 全屏时隐藏 | 开关 | 开 |
| 暂停时隐藏 | 开关 | 关 |
| 字体 / 字号 / 字重 | 选择 | 系统 / 30 / 粗 |
| 未播放色 / 已播放色 / 阴影色 | 色板 | 白 / 主题色 / 黑 |
| 对齐 | 左 / 中 / 右 | 中 |
| 位置 | X / Y 坐标 | 居中底部 |
| 宽度 | 按字数 / 像素 | 按字数 |

#### 8 任务栏与状态栏歌词

| 项 | 平台 |
|---|---|
| Windows 任务栏歌词 | Windows |
| macOS 菜单栏歌词 | macOS |
| Linux 托盘歌词 | Linux |
| 歌词显示格式 | 全平台 |

#### 9 音源与插件

| 项 | 控件 |
|---|---|
| 音源启用列表 | 每源开关 + 排序 |
| 音源健康检查 | 启动时探活 / 手动检查 |
| 搜索默认音源 | 选择 |
| 插件列表 | 启用 / 排序 / 卸载 |
| 插件订阅地址 | 输入框 |
| 插件镜像源 | 多行文本（ghproxy 列表） |
| 在线插件目录 | 开关 |

#### 10 网络

| 项 | 控件 | 默认 |
|---|---|---|
| 使用代理 | 开关 | 关 |
| 代理地址 / 端口 | 输入 | 空 |
| 代理全部请求 | 开关 | 开 |
| 请求超时 | 5–60 秒 | 15 秒 |
| 失败重试次数 | 0–3 | 1 |

#### 11 下载与缓存

| 项 | 控件 |
|---|---|
| 下载目录 | 目录选择 |
| 文件命名规则 | 模板字符串（`%name% - %singer%`） |
| 下载音质 | 选择 |
| 缓存上限 | 256MB–8GB |
| 缓存目录 | 目录选择 |
| 封面缓存目录 | 目录选择 |
| 媒体缓存目录 | 目录选择 |
| 清空缓存 | 按钮 + 当前占用 |

#### 12 数据与备份

| 项 | 控件 |
|---|---|
| 数据目录 | 目录选择（重启生效） |
| 日志目录 | 目录选择 |
| 自动备份 | 开关 + 频率（每日/每周） |
| 手动导出 | 全量 / 仅歌单 / 仅设置 |
| 手动导入 | 文件选择 + 合并策略 |
| WebDAV 同步 | 开关 |
| WebDAV 地址 / 用户名 / 密码 / 路径 | 输入 |
| 同步内容 | 歌单 / 收藏（首版仅这两项，单向：本地 → 远端） |
| 立即上传 / 查看上次同步时间 | 按钮 + 文本 |

#### 13 系统集成

| 项 | 平台 |
|---|---|
| 关闭时最小化到托盘 | 全桌面端 |
| 启动时最小化 | 全桌面端 |
| 开机自启动 | 全桌面端 |
| 全局媒体快捷键 | 全桌面端 |
| 自定义快捷键表 | 全桌面端（可编辑） |
| 单实例模式 | 全桌面端 |
| 硬件加速 | 全桌面端（含「自动降级」状态显示与复位） |

#### 14 更新与关于

| 项 | 控件 |
|---|---|
| 自动检查更新 | 开关 |
| 更新通道 | 稳定 / 预览 |
| 查看更新日志 | 链接 |
| 版本号 / 构建时间 / 提交哈希 | 只读 |
| 打开日志目录 | 按钮 |
| 诊断信息导出（`--diagnose` 结果） | 按钮 |
| 开源许可 | 页面 |

#### 15 视频与弹幕

| 项 | 控件 | 默认 |
|---|---|---|
| 默认画质 | 自动 / 1080P / 720P / 480P | 自动 |
| 默认倍速 | 0.5×–2.0× | 1.0× |
| 记忆播放进度 | 开关 | 开 |
| 自动连播下一集 | 开关 | 开 |
| 启用弹幕 | 开关 | 开 |
| 弹幕透明度 | 0–100% | 85% |
| 弹幕字号 | 小 / 中 / 大 | 中 |
| 弹幕速度 | 慢 / 中 / 快 | 中 |
| 弹幕显示区域 | 1/4 屏 / 半屏 / 全屏 | 半屏 |
| 防挡字幕 | 开关 | 开 |
| 屏蔽词 | 多行文本 | 空 |
| 画中画 | 开关 | 开 |

> 合计约 132 项，覆盖桌面与移动；移动端隐藏「桌面歌词」「任务栏歌词」「托盘」等不适用分区。

### 6.3 落地方式

- `shared/types.ts` 的 `AppSettings` 按域重组，键名扁平化
- 新增 `electron/core/settings-schema.ts`：声明每项的键、类型、默认值、所属分区、生效方式、平台限制
- 设置页由 schema 驱动渲染，**不手写 100 多个表单项**；新增设置只需改 schema
- 旧配置迁移：读旧键 → 映射到新键 → 写回，并保留一次备份

---

## 7. 多端视图重构

### 7.1 目录结构

```
src/
├─ pages/
│  ├─ desktop/   Home / Discover / Player / Playlist / Settings / Mv …
│  ├─ mobile/    Home / Discover / Player / Mine / Settings / Mv …
│  └─ shared/    LyricWindow
├─ components/
│  ├─ common/    Icon / Slider / Toggle / Modal / Toast / Cover / Sheet
│  ├─ desktop/   Sidebar / TopBar / MiniBar / QueueDrawer
│  └─ mobile/    TabBar / MiniPlayer / PullRefresh
├─ stores/       不动
└─ platform/     index.ts（usePlatform）+ tokens.css
```

### 7.2 构建期分流

```ts
// 桌面 vite.config.ts
'@pages': resolve(__dirname, 'src/pages/desktop')
// 移动 vite.mobile.config.ts
'@pages': resolve(__dirname, 'src/pages/mobile')
```

`router.ts` 从 `@pages` 动态导入，路由表**共用一份**。功能对齐由路由保证，界面差异由目录保证。

### 7.3 渐进迁移

1. `pages/*.vue` 原样复制到 `pages/desktop/`，`@pages` 指向它，桌面零变化。
2. 桌面逐个改造（Home → Player → Discover → Playlist → Settings）。
3. 移动端新建页面，复用 `common/`，重写布局与手势。
4. 每完成一页，删除 `mobile.css` 对应覆盖；最终 `mobile.css` 只剩安全区规则。

---

## 8. 视频播放器改进

视频是「特色功能」的一半，不能只做能播。

### 8.1 目标

在不推翻现有 `MvPlayer.vue` 的前提下补齐五件事：**弹幕、手势、断点续播、画中画、快捷键**。播放内核、流解析、离线缓存、画质切换全部保留。

### 8.2 弹幕引擎

| 层 | 实现 |
|---|---|
| 取数 | `mv:danmaku` 一次拉全部分段，主进程并发请求 + 本地缓存（按 cid 存 db，7 天过期） |
| 解码 | 手写 varint 解析 `DanmakuElem`，只取 5 个字段 |
| 存储 | `danmaku` 表：`cid, time, mode, size, color, text`，按 `(cid, time)` 建索引 |
| 渲染 | `<canvas>` 覆盖在 `<video>` 之上，`pointer-events: none` |
| 轨道 | 滚动弹幕贪心选轨；顶部/底部固定轨道各 3 条 |
| 开关 | 一键开关、透明度、字号、速度、显示区域（1/4 屏、半屏、全屏）、屏蔽词、防挡字幕 |

性能约束：

- 只绘制 `currentTime ± 2s` 的弹幕
- 同屏上限桌面 120 / 移动 60，超出按「顶部 > 底部 > 滚动」优先级丢弃
- 文字离屏缓存，避免每帧 `measureText`
- `requestAnimationFrame` 驱动，页面隐藏时停止
- 低端机（连续掉帧 > 15%）自动降到 30fps 并减少同屏上限

### 8.3 手势（移动端）

| 手势 | 动作 | HUD 反馈 |
|---|---|---|
| 单击 | 显示/隐藏控制条 | 无 |
| 双击 | 暂停/播放 | 中央图标闪现 |
| 左半屏上下滑 | 亮度（0–100%） | 左侧竖条 + 百分比 |
| 右半屏上下滑 | 音量（0–100%） | 右侧竖条 + 百分比 |
| 横滑 | 进度（按位移比例） | 中央时间差 |
| 长按 | 2 倍速，松开恢复 | 顶部「2× 倍速中」 |
| 双指双击 | 弹幕开关 | 中央提示 |

手势判定用 `pointerdown/move/up` 统一处理，不依赖 touch 事件，桌面触屏设备同样生效；滑动阈值 8px，避免误触。

### 8.4 断点续播

- 每 5 秒（`timeupdate` 节流）写一次 `mv_progress`（`bvid + page` 为主键）
- 再次进入时，若进度在 5%–95% 之间，顶部弹一条「上次看到 12:34，继续播放 / 从头开始」
- 播完（>95%）自动清除记录

### 8.5 其他能力

| 能力 | 说明 |
|---|---|
| 画中画 | `video.requestPictureInPicture()`；Electron 与移动 WebView 均支持 |
| 键盘快捷键 | 空格 播放/暂停、←→ ±5s、↑↓ 音量、F 全屏、M 静音、`[` `]` 倍速、Esc 退出 |
| 播放列表抽屉 | 分 P 与相关推荐合并到右侧抽屉，播放时不离开当前页 |
| 字幕（P2） | B 站 CC 字幕接口，支持字号/描边/背景 |
| 记忆音量 | 已有，扩展到画中画与全屏共享 |

### 8.6 新增 IPC 与类型

```ts
// shared/types.ts
export interface DanmakuItem {
  t: number                    // 秒
  mode: 1 | 4 | 5              // 滚动 / 底部 / 顶部
  size: number                 // 18 / 25 / 36
  color: number                // 十进制 RGB
  text: string
}

export interface MvProgress {
  bvid: string
  page: number
  position: number
  duration: number
  updatedAt: number
}
```

| 通道 | 入参 | 返回 |
|---|---|---|
| `mv:danmaku` | `{ bvid, cid }` | `DanmakuItem[]` |
| `mv:progress:get` | `{ bvid, page }` | `MvProgress \| null` |
| `mv:progress:set` | `MvProgress` | `{ ok }` |
| `mv:progress:clear` | `{ bvid, page }` | `{ ok }` |
| `mv:subtitle` | `{ bvid, cid }` | `{ lang, lines }[]`（P2） |

### 8.7 对应设置项

并入设置中心第 15 区「视频与弹幕」：

| 项 | 控件 | 默认 |
|---|---|---|
| 默认画质 | 自动 / 1080P / 720P / 480P | 自动 |
| 默认倍速 | 0.5×–2.0× | 1.0× |
| 记忆播放进度 | 开关 | 开 |
| 自动连播下一集 | 开关 | 开 |
| 启用弹幕 | 开关 | 开 |
| 弹幕透明度 | 0–100% | 85% |
| 弹幕字号 | 小/中/大 | 中 |
| 弹幕速度 | 慢/中/快 | 中 |
| 弹幕显示区域 | 1/4 / 半屏 / 全屏 | 半屏 |
| 防挡字幕 | 开关 | 开 |
| 屏蔽词 | 多行文本 | 空 |
| 画中画 | 开关 | 开 |

---

## 9. 跨平台构建

### 9.1 构建矩阵

| 产物 | 命令 | 环境 |
|---|---|---|
| Windows zip（主推） | `electron-builder --win zip` | Windows |
| Windows NSIS | `--win nsis` | Windows |
| Windows portable | `--win portable` | Windows（受限环境不推荐） |
| macOS dmg | `--mac dmg` | macOS 或 CI `macos-14` |
| Linux AppImage / deb | `--linux AppImage deb` | Linux 或 CI `ubuntu-22.04` |
| Android APK | `cap sync android && gradlew assembleRelease` | Windows + JDK17 + SDK |
| iOS ipa（CI 默认） | `cap sync ios && xcodebuild archive`（未签名） | CI `macos-14` |
| iOS ipa（xtool，可选） | `xtool dev`（SwiftPM 构建）→ `xtool install`（签名 + 直装真机） | Linux / Windows(WSL) / macOS，无需 Xcode；支持免费与付费开发者团队签名 |

### 9.2 平台适配点

| 平台 | 适配 |
|---|---|
| macOS | `titleBarStyle: hiddenInset`；红绿灯位置避让；`app.dock`；菜单栏（Cmd 快捷键）；`dmg` 需公证否则提示「已损坏」 |
| Linux | 无 `titleBarOverlay`，改用 `frame: false` 自绘标题栏；托盘依赖 libappindicator；`AppImage` 需 `chmod +x` |
| iOS | 安全区、返回手势、`WKWebView` 的 `audio` 后台播放需 `UIBackgroundModes: audio`；文件导入走 `UIDocumentPicker` |
| Android | `edge-to-edge`、返回键、`FOREGROUND_SERVICE` 保活、Scoped Storage 下的本地音乐目录 |

### 9.3 CI

GitHub Actions 三作业：

- `build-win`（windows-latest）：zip + nsis + portable
- `build-mac`（macos-14）：dmg（无证书时产出未签名包，标注仅测试）
- `build-linux`（ubuntu-22.04）：AppImage + deb
- `build-android`（ubuntu + JDK17）：APK
- `build-ios`（macos-14）：未签名 ipa（用户自签 / AltStore 安装）；需要签名分发时可改走 xtool（免费/付费团队证书）或自备 secrets

---

## 10. 里程碑

| 阶段 | 内容 | 产出 |
|---|---|---|
| M0 | 启动可靠性 + 播放页叠字 + 基础缺陷 | 2.2.1 修复版（先发） |
| M1 | 设计 token、组件分层、设置 schema | 骨架就绪，`/dev/ui` 预览页 |
| M2 | 设置中心（15 分区、132 项、搜索、迁移） | 设置可用 |
| M3 | 图片壁纸引擎（库、轮播、属性、协议） | 壁纸可用 |
| M4 | 桌面 UI 重构（Win/mac/Linux） | 三端桌面一致 |
| M5 | 移动 UI 重构（Android/iOS） | 双端移动独立 |
| M6 | 功能增补（逐字歌词、任务栏歌词、WebDAV 单向同步、睡眠定时、倍速） | 功能补齐 |
| M7 | 视频播放器（弹幕引擎、手势、断点续播、画中画、快捷键） | 视频体验补齐 |
| M8 | 五端测试与发布 | v2.3.0 |

依赖：M0 必须最先完成；M2/M3 可并行；M4/M5 依赖 M1；M6 依赖 M2（WebDAV 需要设置项）；M7 与 M4/M5 可并行，但手势需等 M5 的移动壳就绪。

---

## 11. 测试

| 层级 | 手段 | 覆盖 |
|---|---|---|
| 单元 | 现有 `test:core` / `test:paths` / `test:playlists` / `test:podcast` / `test:order` / `test:pl-source` | 业务不回归 |
| 集成 | 扩展 `scripts/smoke.cjs`：启动 → 搜索 → 播放 → 收藏 → 建歌单 → 切页 → 截图 | 主链路 |
| 视觉 | CDP 截图比对：桌面 1360×880、移动 390×844、车机 1280×600 | UI 不破版 |
| 叠字专项 | 四种背景模式各切 20 次，截图检查重叠 | G2 |
| 设置专项 | 逐项改值 → 重启 → 校验持久化；跨区搜索命中率 | G3 |
| 壁纸专项 | 导入 20 张不同尺寸/格式，验证填充与不变形；轮播 30 分钟无泄漏 | 壁纸 |
| 视频专项 | 弹幕解析正确性（对比网页端条数）；1 小时长视频弹幕开启后掉帧 < 5%；六种手势误触率 | G4 |
| 真机 | Android 实体机、iOS 实体机（需 Mac 或 CI 产物自签） | 移动端 |

### 回归清单

1. 冷启动 3 次出窗口（Win 三权限环境）
2. 播放/暂停/上下首/切模式/倍速
3. 三音源搜索可播放
4. 收藏、歌单增删改排序
5. 歌词加载、偏移、桌面歌词
6. MV 播放与返回
7. 四种背景模式切换无叠字
8. 壁纸导入/应用/删除/轮播
9. 设置改值重启后保持
10. WebDAV 单向同步（歌单 + 收藏）上传成功
11. 移动端手势与返回栈
12. 视频：弹幕开关、透明度、字号、防挡字幕
13. 视频：六种手势、断点续播、画中画、键盘快捷键
14. 数据目录切换后数据不丢

---

## 12. 发布

### 12.1 产物

| 平台 | 文件 |
|---|---|
| Windows | `星河音乐-2.3.0-win-x64.zip`（主推）、`StarWish-2.3.0-Setup.exe`、`星河音乐-2.3.0-便携版.exe`（备选） |
| macOS | `星河音乐-2.3.0-mac-arm64.dmg`、`-x64.dmg` |
| Linux | `星河音乐-2.3.0-x86_64.AppImage`、`.deb` |
| Android | `星河音乐-2.3.0-android.apk` |
| iOS | `星河音乐-2.3.0-ios.ipa`（**不上架 App Store**，提供未签名 ipa，用户自签 / AltStore / SideStore 安装） |

每个产物附 `.sha256`。

**iOS 分发说明**：不经过 App Store，因此无需提交审核与公证。CI 仍需 Apple 开发者证书签名才能产出可安装的 ipa；若仅提供未签名包，用户需自备签名工具。README 中需明确写清安装步骤与「需要每 7 天重签」的限制。

### 12.2 流程

1. typecheck + 全部 test + smoke
2. 五端构建，跑回归清单
3. 更新 README：壁纸引擎、设置中心、五端下载矩阵、常见问题（便携版打不开 → 用 zip）
4. 更新仓库 About 与 Topics
5. 打 tag `v2.3.0`，Release Notes 四段式（新增/改进/修复/已知问题）
6. 上传产物并校验 sha256
7. 保留 2.2.x Release 供回滚

### 12.3 README 与简介

> **星河音乐 StarWish Music** — 多音源聚合音乐播放器，支持自定义图片壁纸、逐字歌词与弹幕视频。Windows / macOS / Linux / Android / iOS 五端，功能一致，界面各为其身。

Topics：`music-player` `electron` `vue3` `wallpaper` `lyrics` `danmaku` `video-player` `android` `ios` `capacitor` `webdav`

---

## 13. 风险

| 风险 | 影响 | 对策 |
|---|---|---|
| mac/iOS 无构建环境 | 交付延期 | 先出未签名包 + CI 云端构建；iOS 上架需开发者账号 |
| 设置项暴增导致维护成本 | 回归面扩大 | schema 驱动渲染 + 逐项默认值 + 自动生成迁移 |
| 播放页叠字修复不彻底 | 观感差 | 去掉 opacity 入场 + 不透明底 + isolation，三管齐下 |
| 五端 UI 分叉后功能漂移 | 移动端缺功能 | 路由表共用 + CI 校验两端路由集合一致 |
| 壁纸大图内存占用 | 低端机 OOM | 导入转码限长边 2560、单张常驻、切歌预加载上限 2 张 |
| WebDAV 同步冲突 | 数据覆盖 | 首版只做单向上传，不做拉取与合并 |
| 弹幕接口变更 | 弹幕失效 | 接口与渲染解耦，接口挂了只是「无弹幕」，不影响播放；失败时静默降级并记日志 |
| 弹幕版权与合规 | 风险 | 仅播放用户已能访问的内容，弹幕随视频加载，不单独存储分发 |

**回滚**：每阶段独立 commit；壁纸与设置中心均可通过开关关闭，关闭后回到 v2.2.0 行为。

---

## 附录 A：调研来源

| 对象 | 来源 |
|---|---|
| any-listen | github.com/any-listen/any-listen（本地源码：`app_setting.d.ts`、`defaultSetting.ts`、`views/Setting/*`） |
| 洛雪音乐助手 | 本地源码 `lx-music-desktop-master/src/renderer/views/Setting/*`（17 个分区） |
| MusicFree | 本地源码 `MusicFree-master/src/pages/setting/settingTypes/*` |
| Lively Wallpaper | github.com/lively-community/lively |
| Wallpaper Engine | Steam 页面、创意工坊音频响应标签、属性面板说明 |
| YesPlayMusic | github.com/qier222/YesPlayMusic |
| SPlayer | github.com/imsyy/SPlayer |
| 汽水音乐 | App Store 页面与评测 |
| 椒盐音乐 | moriafly.com |
| Apple Music | iOS 26 功能报道 |
| Spotify | Wear OS 改版与 Now Playing 设计 |
| foobar2000 | 官方站点、社区定制指南 |
| Musicolet / Oto | 应用商店与横评 |
| MusicPlayer2 / VLC / AIMP | 官方文档与社区评测 |
| electron-builder | 官方文档（dmg / AppImage / 签名与公证） |
| Capacitor iOS | 官方文档与 CI 签名实践 |
| 哔哩哔哩播放器手势 | 官方专栏《播放器手势使用指南》《播放器不完全指导说明》 |
| PiliPlus | 仓库与 Flutter 技术解析文章 |
| ArtPlayer / artplayer-plugin-danmuku | github.com/zhw2590582/ArtPlayer |
| BilibiliVideoDownload | 弹幕 protobuf 分段解析文章 |
| PotPlayer / mpv / IINA / VLC / SMPlayer | 官方文档与 2026 播放器横评 |

## 附录 B：已确认决策

| # | 事项 | 决策 |
|---|---|---|
| 1 | mac/iOS 构建环境 | 走 **GitHub Actions（`macos-14`）/ 云构建服务**，本地只出 Windows 与 Android |
| 2 | iOS 分发 | **不上架 App Store**，提供未签名 ipa，用户自签安装 |
| 3 | WebDAV 同步范围 | 首版仅 **歌单 + 收藏**，**单向（本地 → 远端）**，不做合并与冲突处理 |
| 4 | 系统级桌面壁纸 | 不做 |
| 5 | 壁纸类型 | 仅图片 |
| 6 | 视频播放器 | 本次纳入，补齐弹幕、手势、断点续播、画中画、快捷键 |
3. WebDAV 同步首版是否只做「歌单 + 收藏」单向同步。

---

*确认后进入 M0。*
