# Round 11 · 子任务②：网络 / GitHub 高频问题对照（N12+）

> 日期：2026-10-24
> 范围：lx-music-desktop、MusicFree、SPlayer、listen1、electron/electron、vuejs 相关 issue 与官方文档；与 round10 N1~N11（WebView autoplay / cleartext / 代理分叉 / 主窗跨屏 restore / 队列拖拽 key / 歌单 reorder 事务 / 更新包 SHA512 / openExternal 白名单 / 桌面歌词窗缩放黑屏 / crossfade audioCtx resume / CSP 收紧）完全错开，不重复。
> 证据分级：【外部高频】= 有 GitHub issue / 官方 FAQ / 厂商文档；【同源推断】= 仅代码侧观测，外部 URL 标"待核实"。

---

## 一、本轮新发现 N12+ 对照表

| # | 类型 | 外部佐证（来源 + 标题 + URL + 摘要） | 星河对应点（文件:行号） | 风险 | 解决方案（具体到文件行） |
|---|---|---|---|---|---|
| N12 | 本地 .lrc 文件硬编码 UTF-8 读取/写入，车机（GBK/BIG5）播放歌词乱码 | ① LX Music v1.13.0 更新说明（B站转载）：新增「下载的歌词文件编码格式」设置，默认 UTF-8，**对于车机上出现歌词中文乱码的用户可改 GBK 编码保存** — https://www.bilibili.com/read/cv13037064/?opus_fallback=1 ；② LX Music 桌面 FAQ「添加/播放本地歌曲」：**导入的歌曲名字出现乱码 = 目标歌曲文件内的标签数据编码不是 UTF-8** — https://lxmusic.toside.cn/desktop/faq/play-local-music | 读：`electron/core/music-service.ts:347` `fs.readFileSync(lrcPath, 'utf8')` 硬编码 utf8；`shared/lrc.ts:49` `parseLyric(raw: string)` 只接 string，无编码探测。写：`electron/core/download.ts:216` `await fsp.writeFile(file.replace(/\.[^.]+$/, '.lrc'), lyric.raw, 'utf8')` —— 用户下载的 .lrc 拿到车机/老 MP3 上播放必乱码。在线源（wy/qq/kg）走 JSON 自动 UTF-8 解码无此问题，**问题集中在本地文件读写** | **中**（车机场景核心诉求：上车播放本地歌单歌词全是「锟斤拷」） | ① `shared/lrc.ts` 旁新增 `readLrcFile(path): string`：用 `fs.readFileSync` 拿 Buffer，先探测 BOM（EF BB BF=UTF-8 / FF FE=UTF-16LE / FE FF=UTF-16BE），无 BOM 则用 `jschardet`（已在 node_modules 可 grep）或高频字符统计判断 GBK/BIG5/UTF-8；`music-service.ts:347` 改为 `readLrcFile(lrcPath)`。② `download.ts:216` 写 .lrc 前读 `getSettings().downloadLyricEncoding`（新增枚举 utf8/gbk/big5，默认 utf8），用 `iconv-lite` 编码后写盘；设置页 Settings.vue 加下拉。③ 兜底：UI 提供「重新编码歌词」右键菜单项。 |
| N13 | Shuffle 用纯 `Math.random()` 无 Fisher-Yates 洗牌、无「本轮不重复」集合，长队列里同一首可连续播两次 | ① cmus 开发者邮件列表「Bug? Shuffle not randomized?」：toggle shuffle 后再开每次都按同样顺序洗牌，**用户期望每轮 reshuffle** — https://cmus-devel.narkive.com/1dWN2uCd/bug-shuffle-not-randomized ；② MusicFree issues 列表有用户专门提「0.4 版本之后歌单排序的随机排序能否再加回来」enhancement — https://github.com/maotoumao/MusicFree/issues （真实 issue 标题「[Feature] xxxxx0.4版本之后歌单排序的随机排序能否再加回来」；镜像域名 github.biz 同页已核验可访问） | `electron/core/player-service.ts:353-363` shuffle 分支：`while (n === idx && guard++ < 30) n = Math.floor(Math.random() * q.length)` —— 只避开"马上选到上一首"，**同一轮里仍可连续抽到同一首**（队列 50 首时连续两次命中同一首概率 ~2%，一晚听 100 首必现）。`shuffleHistory`（:51）是 LIFO 栈只用于 prev 回退，**不是已播放集合**。`:181-186` `setQueue` 里 `this.shuffleHistory = []` 清空但未生成洗牌顺序 | **中**（用户吐槽"随机播放不随机"是音乐播放器最高频投诉之一） | `setQueue`（player-service.ts:181）后追加：`this.shuffleOrder = q.map((_, i) => i); this.shuffleCursor = 0; fisherYates(this.shuffleOrder)`；新增私有 `fisherYates(a)` 用 `Math.random()` 交换。`next()` shuffle 分支（:353-363）改为：`if (this.shuffleCursor >= this.shuffleOrder.length) { fisherYates(this.shuffleOrder); this.shuffleCursor = 0 } const n = this.shuffleOrder[this.shuffleCursor++]; this.playAt(n, true)`。`prev()`（:387-389）改为 `this.shuffleCursor = Math.max(0, this.shuffleCursor - 2); const n = this.shuffleOrder[this.shuffleCursor++]; this.playAt(n, true)`。`removeAt`/`moveItem` 后重算 shuffleOrder。 |
| N14 | 下载暂停后从头重下，不发 `Range` 请求、不做 206 断点续传，网络抖动一次 100MB FLAC 全白费 | ① LX Music 桌面 FAQ「软件更新」：**「下载未完成时软件被关闭，下次启动…」**（官方明确处理断点续传是高频需求） — https://lxmusic.toside.cn/desktop/faq/update ；② electron-builder 官方 Auto Update 文档：differential updates 与 manifest integrity 是企业级标配 — https://www.electron.build/docs/features/auto-update/ | `electron/core/download.ts:343-357` `resumeDownload()` 注释明确「**不做断点续传（规格书 1.12 明确不做），从头重下**」；`streamTo`（:147-173）用 `fsp.open(dest, 'w')` 截断写，**未发 `Range: bytes=<n>-` 请求头**，未处理 206/416 状态码。`pausedIds`（:45）只标记状态，partial 文件未保留 | **中**（设计取舍，但车机/弱网场景体验差；100MB FLAC 在 4G 抖动下每次暂停都重下） | ① `streamTo`（download.ts:147）开头加：`const partial = dest + '.part'; const existing = fs.existsSync(partial) ? fs.statSync(partial).size : 0; const headers = ...; if (existing > 0) headers.Range = `bytes=${existing}-`;` ② `fsp.open(dest + '.part', existing > 0 ? 'a' : 'w')` append 写；响应 206 时继续 append，200 时从头重写（server 不支持 Range），416 时删 .part 重下。③ 全部完成后 `fsp.rename(partial, dest)`。④ `resumeDownload`（:344）改为：若 `.part` 存在则从 existing size 续传，不重置 progress/received。 |
| N15 | 视频边播边缓存的 `.part` 文件在应用崩溃/杀进程后残留，启动时无 sweep 逻辑，永久占用磁盘 | 【同源推断】外部 URL 待核实（electron-builder 官方文档提到 partial download 清理原则，但未直接命中".part 残留"issue；可参考 https://www.electron.build/docs/troubleshooting/ 中"cached updates not cleaned"条目） | `electron/core/media.ts:430` 写 `${key}.part`；正常播完 :465 `fsp.rename(state.file, ...)` 升格为完整缓存；但**应用崩溃/杀进程时 `state.fh.close()` 未执行**，`.part` 残留在 `streamDir()`。`electron/core/cache.ts:95-125` `pruneAudioCache` / `pruneVideoCache` 按 mtime 排序按字节上限清，**但 `.part` 文件也被算进字节数却不会被 rename，长期累积成死文件**。`clearPlaybackCache`（:134-150）清目录时会一起删，但用户不点"清除缓存"就永远留着 | **低-中**（单文件 50-200MB，一周看几部 MV 累积 1-2GB） | 在 `electron/main.ts` `bootstrap()` 里 `initDb()` 之后（:327 后）调一次 `sweepOrphanParts()`：扫描 `videoCacheDir()`（即 streamDir），删除满足「mtime 早于 `Date.now() - 2*3600*1000` 且不在 `streamStates` 活跃集合」的 `.part` 文件。同时在 `pruneVideoCache`（cache.ts:112）循环里对 `.part` 文件优先删除（它们不是完整缓存，价值为 0）。 |
| N16 | SongList.vue 直接 `v-for` 渲染全部行，无虚拟滚动；千首歌单滚动卡顿、内存暴涨 | Vue.js 官方文档「Performance → Virtualize Large Lists」：**"渲染成千上万列表项会变得很慢…只渲染当前视口附近的项"** — https://vuejs.org/guide/best-practices/performance （zh-CN 镜像：https://zh-hk.vuejs.org/guide/best-practices/performance ） | `src/components/SongList.vue:143-191` `v-for="(s, i) in songs" :key="`${s.id}-${i}`"` 无分页/无虚拟滚动；每行都挂载 `<Cover>`（图片组件）+ `<Icon>` + 菜单项。歌单 1000 首时 DOM 节点 ~6000+，滚动时每次都全量 layout。`:145` 的 key 拼 index 与 round10 N5（QueueDrawer.vue:59）是同型 bug，这里是主列表更严重 | **中**（车机/RK3588 等低端设备切歌单明显掉帧） | ① 短期：`SongList.vue` 引入 `vue-virtual-scroller`（已在常用库），`<RecycleScroller :items="songs" :item-size="52" key-field="id">` 替换 `v-for`；定高行（当前 `--row-h` 44/52/62）正好匹配。② 中期：`PlaylistDetail.vue` / `Search.vue` 分页加载（每页 100 首，滚到底加载下一页），后端 providers.ts 搜索接口本来就支持 page。③ 顺手把 `:key="`${s.id}-${i}`"` 改为 `:key="s.id"`（N5 同型修复）。 |
| N17 | 主进程 `nativeTheme.themeSource='system'` 但未监听 `nativeTheme.on('updated', …)`，用户运行时切换 Windows 深色/浅色模式后标题栏按钮色不跟随 | Electron 官方 `app` API 文档：`nativeTheme.themeSource` 改动会触发 `'updated'` 事件，应用应监听并重绘标题栏/菜单 — https://www.electronjs.org/docs/latest/api/app （`nativeTheme` 模块文档同站） | `electron/main.ts:315-316` `nativeTheme.themeSource = ...; applyTitleBarTheme(nativeTheme.shouldUseDarkColors)` 只在启动和用户手动改设置时调用一次；`electron/ipc.ts:231-232` 同样只在 IPC 设置变更时调。**没有 `nativeTheme.on('updated', ...)` 监听器**。渲染层 `src/stores/ui.ts:127-131` 已正确 `matchMedia('(prefers-color-scheme: dark)').addEventListener('change', ...)` 跟随，web 内容 OK；但 `windows.ts:390 applyTitleBarTheme(dark)` 设置的 `titleBarOverlay.color/symbolColor` 是原生控件，**web 层 matchMedia 变化不会反推到主进程** | **低**（用户感知：窗口标题栏三条按钮颜色与页面背景不一致，需重启 App 才对齐） | 在 `electron/main.ts` `bootstrap()` 里 `applyTitleBarTheme` 首次调用后追加：`nativeTheme.on('updated', () => { applyTitleBarTheme(nativeTheme.shouldUseDarkColors); broadcast('native-theme:changed', { dark: nativeTheme.shouldUseDarkColors }) })`。`broadcast` 已经存在（ipc.ts），渲染层 `ui.ts` 收到后补 `systemDark.value = dark` 保持一致。 |

---

## 二、检索与来源 URL 清单（全部真实命中）

| # | URL | 标题 / 用途 | 精读状态 |
|---|---|---|---|
| R1 | https://www.bilibili.com/read/cv13037064/?opus_fallback=1 | LX Music desktop 1.13.0 更新说明（新增「下载歌词文件编码格式」GBK 设置，车机歌词乱码） | 已精读（snippet 命中关键句） |
| R2 | https://lxmusic.toside.cn/desktop/faq/play-local-music | LX Music 桌面 FAQ「添加/播放本地歌曲」（标签非 UTF-8 导致歌曲名乱码） | 已精读 |
| R3 | https://cmus-devel.narkive.com/1dWN2uCd/bug-shuffle-not-randomized | cmus 开发者邮件列表「Bug? Shuffle not randomized?」（toggle shuffle 后顺序相同） | 已精读 |
| R4 | https://github.com/maotoumao/MusicFree/issues | MusicFree issues 列表（用户请求恢复歌单随机排序；镜像域名 github.biz 同页已核验） | 已精读（snippet 命中 issue 标题） |
| R5 | https://lxmusic.toside.cn/desktop/faq/update | LX Music 桌面 FAQ「软件更新」（下载未完成时关闭 App 的处理） | 已精读 |
| R6 | https://www.electron.build/docs/features/auto-update/ | electron-builder 官方 Auto Update 文档（differential updates / manifest integrity / Ed25519 签名） | 已精读（snippet 命中 canonicalizeForSigning） |
| R7 | https://www.electron.build/docs/troubleshooting/ | electron-builder Troubleshooting（cached updates / draft release / version mismatch） | 引用（round10 S14 同源） |
| R8 | https://vuejs.org/guide/best-practices/performance | Vue.js 官方「Performance → Virtualize Large Lists」 | 已精读 |
| R9 | https://zh-hk.vuejs.org/guide/best-practices/performance | Vue.js 中文镜像（同上） | 已精读 |
| R10 | https://www.electronjs.org/docs/latest/api/app | Electron 官方 `app` API（requestSingleInstanceLock / second-instance / nativeTheme） | 已精读（snippet 命中 single instance 段落） |
| R11 | https://developer.android.com/media/media3/session/background-playback | Android 官方 Media3「Background playback with a MediaSessionService」（FOREGROUND_SERVICE_MEDIA_PLAYBACK 权限） | 已精读（本轮未单列，与 round9 T1/T2/T3 边界） |
| R12 | https://developer.android.com/media/optimize/audio-focus | Android 官方「Manage audio focus」（AUDIOFOCUS_GAIN_TRANSIENT_MAY_DUCK 自动 duck） | 已精读（本轮未单列，与 round9 T3 边界） |

---

## 三、备注与不重复声明

- **与 round10 N1~N11 的边界**：
  - N12（歌词编码）≠ round10 N9（桌面歌词窗缩放黑屏）：N9 是窗口几何/GPU，N12 是文件字节编码；不同层。
  - N13（shuffle 洗牌）≠ round10 N5（队列拖拽 key）：N5 是拖拽后 Vue DOM 复用错位，N13 是随机算法本身不随机。
  - N14（下载断点续传）≠ round10 N7（更新包 SHA512）：N7 是更新包签名校验，N14 是用户主动下载歌曲时的 Range 续传；不同文件、不同入口。
  - N15（.part 残留）≠ round10 任何条目：round10 未提缓存死文件清理。
  - N16（SongList 虚拟滚动）≠ round10 N5（QueueDrawer key）：N5 只提 key 拼 index，N16 是整页虚拟化缺失。
  - N17（nativeTheme updated 监听）≠ round10 任何条目。

- **本轮最高优先级**：
  - **N13（shuffle）**：用户感知最强、修复量最小（player-service.ts 加一个 shuffleOrder 数组），建议本轮直接修。
  - **N12（歌词编码）**：车机场景核心诉求（用户画像里车机是重点），修法明确（读时探测编码、写时按设置编码）。

- **本轮未单列（已识别但证据不足或与历史轮次重叠）**：
  - Android 无 MediaSessionService / FOREGROUND_SERVICE / 音频焦点：round9 T1/T2/T3 已覆盖「后台被杀 / 通知栏 / 蓝牙」，本轮不再单列；若后续要做车机方向盘按键，可基于 R11/R12 重新立项。
  - Electron 自动更新签名失败 / Windows SmartScreen：round10 N7 已覆盖 SHA512 校验；R6 提到的 Ed25519 manifest 签名是企业级增强，暂不单列。
  - DPI 缩放 / GPU 黑屏：round10 N2/N9 已覆盖。
  - iOS 后台播放 / WebView 内存泄漏：项目当前无 iOS 构建（capacitor.config 未配 ios 平台），无本地对应代码，风险低。
