# Round 11 · 02 round10「未落地/待修复」条目在当前代码中的实际状态核实

> 日期：2026-10-24
> 核实范围：round10 四组条目——Bug 75~96（22 条）/ C-09~C-13（5 条）/ F-01~F-13（13 条）/ N1~N11（11 条），合计 51 条
> 代码基线：`D:\music\app` 工作区（HEAD = `aaaee76 refactor(player): 播放模块按规格书 v2.7 模块化重构`，含未提交改动）
> 核实方法：逐条实读当前文件行号 + `git diff HEAD` 比对工作区改动；只读，未修改任何代码
> 状态分类：已修 / 未修 / 部分 / 已删除 / 无需修

---

## 一、Bug 75~96 落地核实表（逻辑错误复查）

| Bug | 状态 | 证据（文件:行号） | 未修原因 / 修复方案 |
|---|---|---|---|
| 75 storage/db.ts 错键名 `history:list`/`history:add` | **未修** | `app/src/storage/db.ts:20-21` 仍为 `call('history:list')` / `call('history:add')`；`ipc.ts:471-475` 注册的是 `db:history`/`db:history:add`。全仓 grep `storage/db` 0 import（死代码） | 同 C-11：整目录 `src/storage/` 零引用，建议直接删除；若保留则 :20 改 `db:history`、:21 改 `db:history:add` |
| 76 preload 白名单漏 `download:progress`/`update:progress` | **未修** | `app/electron/preload.ts:3-17` EVENT_WHITELIST 仍 13 项，无 `download:progress`/`update:progress`；:24 非白名单通道 `return () => {}` | 在 :16 后追加 `'download:progress'`、`'update:progress'` 两行（桌面下载进度条/更新进度仍死） |
| 77 mobile/player.ts loadToken 缺失 | **未修** | `app/src/mobile/player.ts:119` 仅 `if (index !== i) return`；:348-354 `setQuality` 仍 `void load(index, true)` 同 index，guard 永不成立；模块级无 `loadToken` 变量 | 模块级 `let loadToken = 0`，`load()` 入口 `const t = ++loadToken`，await 后 `if (t !== loadToken || index !== i) return` 再写 `el.src` |
| 78 catch 与 error 双路径 retryCount++ | **未修** | `app/src/mobile/player.ts:140-145`（catch 内 `retryCount++` 后 `void load(i, autoplay, true)`）与 :213-217（el 'error' 内 `retryCount++` 后 `void load(index, true, true)`）双写，无互斥标记 | 加模块级 `errorHandled` 标记，catch/error 开头检查、`load` 入口 reset；或统一由 error 事件驱动重试 |
| 79 resolveUrl 无超时 | **未修** | `app/src/mobile/player.ts:118` `const r = await resolveUrl(...)` 外层无 Promise.race | `await Promise.race([resolveUrl(...), new Promise((_,r)=>setTimeout(()=>r(new Error('取链超时')),10000))])` |
| 80 shuffle 不排除当前 index | **未修** | `app/src/mobile/player.ts:177-180` `void load(Math.floor(Math.random() * queue.length), true)` 无 while 重抽 | `let ni = index; while (queue.length>1 && ni===index) ni = Math.floor(Math.random()*queue.length); void load(ni, true)` |
| 81 player-core/state.ts PlayStatus 无 'stopped' | **未修** | `app/src/player-core/state.ts:9` `export type PlayStatus = 'idle' \| 'loading' \| 'playing' \| 'paused' \| 'error'`（仍无 stopped）；该文件全仓 0 import（死模块） | 同 a2：删除 `player-core/state.ts`；或补 `'stopped'`；移动端 :183/:412 写 'stopped' 与 shared/types.ts:87 对齐 |
| 82 addNext 不去重 | **未修** | `app/src/mobile/player.ts:365-369` `queue.splice(index+1, 0, song)` 前无 `queue.some(s => s.id === song.id)` 检查 | splice 前 `if (queue.some((s,i)=>i>index && s.id===song.id)) return state()` |
| 83 stores/player.ts seekTo/setVolume 乐观更新无回滚 | **未修** | `app/src/stores/player.ts:256-263` seekTo catch 注释「静默失败，下一次 tick 会校正」；:265-272 setVolume catch `/* ignore */` | seekTo catch 内 `call('player:state')` 回拉 applyState；setVolume catch 内 `state.value.volume = oldVolume` 回滚 |
| 84 stores/ui.ts patch() 不回滚 | **未修** | `app/src/stores/ui.ts:157-165` `settings.value = {...settings.value, ...p}` 先本地写，:161 IPC 失败 catch 仅 toast，不还原 old | catch 中 `settings.value = old; apply()`；或先 `await call(...)` 成功再写本地 |
| 85 useVideoSession selectPart/load 无 reqToken | **未修** | `app/src/player-video/useVideoSession.ts:93-115` selectPart、:117-143 load，await `music:mvurl`/`music:mvinfo`/`music:mvparts` 后无 bvid/cid 校验 | 闭包 `let reqToken = 0`，入口 `const t = ++reqToken`，await 后 `if (t !== reqToken) return` 再写 src/info |
| 86 download.ts 直写终文件、resume 清零 | **未修** | `app/electron/core/download.ts:158` `fsp.open(dest, 'w')` 直截终文件；:344-357 resumeDownload `t.received=0; t.progress=0; t.total=0` 注释「不做断点续传」 | 写 `.part` 临时文件 + `Range: bytes=<received>-` append；完成后 `fsp.rename(.part, file)`；删 :350-351 清零 |
| 87 mobile/player.ts error 处理器不校验 index | **未修** | `app/src/mobile/player.ts:210-220` error 回调内 `const song = state().song` 后直接 `markSourceFailed` + `retryCount++`，无 `el.src` 与当前 song.source 比对 | 配合 Bug77 loadToken：error 内 `if (loadToken !== tokenAtError) return`；或校验 `el.src` 仍对应当前曲 |
| 88 重复绑定两次 'playing' 事件 | **未修** | `app/src/mobile/player.ts:197-205` 第一个 listener（publish+updateMediaSession）；:221-228 第二个 listener（history 写入）。两个 addEventListener('playing') 并存 | 把 :221-228 的 history 写入合并进 :197-205 listener，删第二个 addEventListener |
| 89 歌词失败后每次广播重发 music:lyric | **未修** | `app/src/stores/player.ts:159-161` `if (same && (lyricLoading.value \|\| (lyric.value && lyric.value.lines.length))) return`；失败后 :189 `lyric.value=null`、:191 `lyricLoading=false`，下次 applyState 再走 :163-192 重发 | 模块级 `lyricFailedIds: Set<string>`，失败 id 加入；`same && lyricFailedIds.has(s.id)` 直接 return；reloadLyric 时 delete |
| 90 timeupdate/progress/tickTimer 三重驱动 | **未修** | `app/src/mobile/player.ts:83-86` setInterval 500ms；:233 `el.addEventListener('timeupdate', tick)`；:234 `el.addEventListener('progress', tick)` | 删 :233/:234，统一由 500ms setInterval 驱动（需更细精度改 200ms） |
| 91 setRate 不 saveSettings | **未修** | `app/src/mobile/player.ts:347` `setRate(rate) { el.playbackRate = Number(rate)\|\|1; return state() }`，无 `saveSettings({playbackRate: rate})` | 追加 `saveSettings({ playbackRate: rate })`；init 时读 `getSettings().playbackRate` 赋 el.playbackRate |
| 92 download.ts streamTo/read 无超时 | **未修** | `app/electron/core/download.ts:147-173` `await fetch(url, {headers, redirect, signal})` 无 AbortSignal.timeout；:163 `await reader.read()` 无 stall 检测 | fetch 加 `signal: AbortSignal.timeout(15000)`；reader.read() 包 Promise.race + 30s 无新字节超时 |
| 93 media.ts total=0 读完不 rename | **未修** | `app/electron/core/media.ts:463` `if (state.total && state.written >= state.total)` 仍依赖 total；上游不给 content-range/content-length 时 total=0，.part 永不升格 | done 分支改判 `if (state.written > 0)` 即 rename；pruneVideoCache 启动扫删 `*.part` |
| 94 useVideoSession setDanmakuEnabled 直 mutate | **未修** | `app/src/player-video/useVideoSession.ts:145-150` `(ui.settings as any).danmakuEnabled = on` + `void call('settings:set', {danmakuEnabled:on})`（不 await 不 catch） | 改 `await ui.patch({ danmakuEnabled: on })`，走原子写+回滚 |
| 95 useVideoGestures onTouchMove 高频 getBoundingClientRect | **未修** | `app/src/player-video/useVideoGestures.ts:95-96` onTouchMove 内 `const box = (e.currentTarget as HTMLElement).getBoundingClientRect()`；onTouchStart :69 已取 box 但未缓存 left | onTouchStart 缓存 `g.left = box.left; g.width = box.width`；onTouchMove 用 `t.clientX - g.left` 判左右半屏 |
| 96 media.ts 音频 chunks 整曲驻留内存 | **未修（工作区新引入）** | `app/electron/core/media.ts:495` `const chunks: Buffer[] = []`；:506 `chunks.push(Buffer.from(value))`；:502 `Buffer.concat(chunks)` done 时一次性写盘。**注：该段是工作区 diff 新增（git diff +84 行），规格书 v2.8 · 1.12 播放缓存引入** | 改边收边写 `.part` 文件（与视频同路径），done 时 rename；写盘失败不影响透传 |

**Bug 75~96 小结：22 条全部未修。** 工作区改动是「模块化重构 + 新增音频播放缓存（规格书 v2.8 · 1.12）」，不是 round10 Bug 修复。Bug96 甚至因新缓存功能被重新引入。

---

## 二、C-09 ~ C-13 引用复查核实表

| 条目 | 状态 | 证据 | 修复方案 |
|---|---|---|---|
| C-09 `win:maximized` ipcMain.on 死监听 | **未修** | `app/electron/ipc.ts:884-886` `ipcMain.on('win:maximized', (_e, v) => { sendToMain('window:state', {maximized: !!v}) })` 仍存在；全仓 grep `win:maximized` 仅命中注册处 | 删除 :884-886 整块监听 |
| C-10 `player:internal-history` ipcMain.on 死监听 | **未修** | `app/electron/ipc.ts:888-890` `ipcMain.on('player:internal-history', ...)` 仍存在；无发送方 | 删除 :888-890 |
| C-11 `src/storage/db.ts` 孤儿模块+错键 | **未修** | `app/src/storage/db.ts:20-21` 仍错键；`app/src/storage/` 整目录（db.ts/downloads.ts/index.ts/cache.ts）在 git status 为 `??` 未跟踪，全仓 grep 0 import | 删除整个 `src/storage/` 目录；历史链路真实入口是 `stores/library.ts` + `electron/core/db.ts:addHistory` |
| C-12 `lyric:visible`/`lyric:lock` 双通道冗余 | **未修** | `app/electron/ipc.ts:606-613` 两个直连 handler 仍注册；生产渲染端统一走 `settings:set`（:237-238 已联动 showLyricWindow/setLyricLock） | 删除 :606-613 两个 handler；自检脚本 scripts/v235-desktop-check2.cjs 改走 settings:set |
| C-13 桌面 `/new` 路由注册但无入口 | **未修** | `app/src/router.ts:50-55` 仍注册 `/new`（桌面复用 Discover.vue:53）；全仓 `router.push('/new')` 仅命中 mobile/Discover.vue:258、mobile/Home.vue:227 | 桌面 Home.vue 推荐区加「新歌速递」卡片，或 Sidebar 发现组补一项；或删桌面分支 |

**C-09~C-13 小结：5 条全部未修。**

---

## 三、F-01 ~ F-13 各端补全核实表

| 条目 | 状态 | 证据 | 修复方案 |
|---|---|---|---|
| F-01 下载失败任务无重试入口（桌面） | **未修** | `app/src/pages/Downloads.vue:122-137` done 段 ops 区仅「在文件夹中显示」「移除记录」「删除文件」，error 行无重试按钮 | ops 区首位补「重试」icon 按钮调 `call('download:add', {songs:[t.song]})` |
| F-02 暂停续传实为从头重下（桌面+移动） | **未修** | `app/src/pages/Downloads.vue:38` 注释仍自述「继续即从头重下，不做断点续传」；`electron/core/download.ts:344-357` resumeDownload 清零 received | download.ts 续传时记录已写字节、请求头加 `Range: bytes=<n>-`，206 追加写、416 标完成（同 Bug86） |
| F-03 下载进行中无实时速率（桌面） | **未修** | `app/src/pages/Downloads.vue:94-103` 进行中行仅 `received/total` 累计字节，无 KB/s | download:progress payload 增带 `speed`（相邻 tick 字节差/秒）；row pct 旁补 `{{ dl.fmtBytes(t.speed) }}/s` |
| F-04 移动下载页缺清空记录与失败重试 | **未修** | `app/src/pages/mobile/Downloads.vue:78-95` done 段仅「移除」按钮；头部无「清空完成记录」；error 卡无重试 | 头部补「清空完成记录」ghost 按钮调 `dl.clear(true)`；error 卡补「重试」 |
| F-05 插件/音源市场无搜索框 | **未修** | `plugins:search` 通道已注册（`electron/ipc.ts:308`、`src/mobile/bridge/index.ts:415`），但全 `src/` 无 call 调用点（grep 仅命中 bridge 注册处） | 市场弹窗头部加搜索输入框，防抖 400ms 调 `call('plugins:search', {file, query, page:1, type})` |
| F-06 移动缓存大小恒 0、清理空操作 | **未修** | `app/src/mobile/bridge/index.ts:614` `'cache:size': () => ({cover:0, media:0, total:0})`；:618 `'cache:clear': () => ({cover:0, media:0, total:0})` 仍返零 | bridge cache:size 实读 vfs 封面目录累计字节；cache:clear 实删 vfs cover 子目录；mobile/Settings 补缓存入口 |
| F-07 移动下载完成无法应用内直接播放 | **未修** | `app/src/pages/mobile/Downloads.vue:52-55` notice 仍文案「可在系统音乐 App 中直接播放」；done 卡 :85-95 无「立即播放」按钮 | done 卡点击调 `player.playNow(t.song)`，本地文件存在则直接播本地路径 |
| F-08 车机上下首无长按快进/快退 | **未修** | `app/src/pages/CarPlayer.vue:52-60` 上一首/播放/下一首三按钮仅 `@click`，无 `@pointerdown` 长按计时 | 上下首按钮补 `@pointerdown` 启动 500ms 长按计时、`@pointerup/leave` 取消；命中长按循环 `player.seekTo(±10s)` |
| F-09 车机页无音源/音质与下一首预告 | **未修** | `app/src/pages/CarPlayer.vue:37-49` info 区仅歌名/歌手/ProgressBar/mode 标签，无 source/quality 小字，无 nextSong 预告 | info 区歌手行下方加 `{{ player.song.source \|\| '内置' }} · {{ player.state.quality }}`；controls 区加「下一首：{{ nextSong?.name }}」 |
| F-10 车机未接管系统音量键 | **未修** | `app/src/pages/CarPlayer.vue` 无 keydown 监听（全文无 `addEventListener('keydown'`） | onMounted 注册 keydown（ArrowUp/Down）映射 `player.setVolume(v±0.1)`；同步 navigator.mediaSession |
| F-11 横屏平板移动首页仍单张横滑 | **未修** | `app/src/pages/mobile/Home.vue` 全文 grep `landscape` 0 命中；`platform.landscape` 未被消费 | mobile/Home.vue 模板加 `platform.landscape` 分支：横屏卡片容器改 `grid auto-fill 320px` |
| F-12 移动包列表行无鼠标悬停/焦点态 | **未修** | 移动包无 `@media (pointer: fine)` 下的 `.row:hover`/`:focus-visible`（桌面 SongList.vue:240 有，但移动包组件独立） | 移动包 SongList/卡片组件加 `@media (pointer: fine)` 下 hover 背景与 focus-visible outline |
| F-13 平板横屏播放页仍竖排封面+歌词 | **未修** | `app/src/pages/mobile/Player.vue:33` `kind = computed(() => (platform.value.kind==='pad'?'pad':'phone'))` 二值，未读 `platform.landscape`；模板 :126-206 仍 flex-column 竖排 | `platform.landscape && isPad` 时改 `display:grid; grid-template-columns: 1fr 1fr` 左 CoverStage 右 LyricsPane |

**F-01~F-13 小结：13 条全部未修。**

---

## 四、N1 ~ N11 网络/安全核实表

| 条目 | 状态 | 证据 | 修复方案 |
|---|---|---|---|
| N1 Android WebView 有声 autoplay 被拦截 | **未修** | `app/android/app/src/main/java/com/starwish/music/MainActivity.java:14` 仅 `bridge.setWebViewClient(new SwMediaClient(bridge))`，未调 `getSettings().setMediaPlaybackRequiresUserGesture(false)` | load() 内 setWebViewClient 后补 `bridge.getWebView().getSettings().setMediaPlaybackRequiresUserGesture(false)`；车机分支静音 autoplay→unmute 解锁 |
| N2 usesCleartextTraffic 全局放行 http | **未修** | `app/android/app/src/main/AndroidManifest.xml:7` `android:usesCleartextTraffic="true"`；全仓无 `res/xml/network_security_config.xml`；`src/index.mobile.html:10` CSP `media-src ... http:` | 新建 network_security_config.xml，base-config 拒 cleartext + domain-config 白名单旧 CDN；Manifest 改 `android:networkSecurityConfig` 删全局放行 |
| N3 主进程 fetch 不读 Chromium session 代理 | **部分** | `app/electron/ipc.ts:166-176` applyProxy 仍仅 `session.defaultSession.setProxy`；`electron/core/media.ts:257/397`、`download.ts:132/151` 仍优先 `await fetch(url)`，catch 后才回落 `net.fetch`（:259/:399/:134/:153）——fallback 已加，但主路径未切 | 把 4 处 `await fetch(url, ...)` 全改 `net.fetch(url, ...)`（Electron net 走 Chromium session 自动吃 applyProxy）；或注入 undici ProxyAgent |
| N4 主窗 restore 未校验 x/y 在屏 | **未修** | `app/electron/main.ts:269-281` restoreWindowState 仅判 `bounds.width>800 && bounds.height>600`，无 `screen.getAllDisplays().some()` 校验；对比 windows.ts:265-270 歌词窗已有 inSomeDisplay | restoreWindowState 内追加 getAllDisplays().some() 校验，不在则复位 +40/+40；监听 `screen.on('display-metrics-changed'/'display-removed')` 重算 |
| N5 队列拖拽 `:key="s.id+i"` | **未修** | `app/src/components/QueueDrawer.vue:59` 仍 `:key="s.id + i"`；:32-36 onDrop 无 dragend 兜底 | key 改 `:key="s.id"`；onDragStart 后补 `window.addEventListener('dragend', resetDrag, {once:true})` |
| N6 歌单 reorder 无事务、不校验 ids | **未修** | `app/electron/core/db.ts:425-430` `ids.forEach((id,i) => run('UPDATE playlist_song SET pos=? ...'))` 无 BEGIN/COMMIT、无 existing 集合校验 | 开头 `run('BEGIN')` 包 forEach+COMMIT；先查 existing set，ids 与 existing 不一致 throw 不落库；reorder 后回读 broadcast |
| N7 更新包下载无 SHA512/签名校验 | **未修** | `app/src/utils/update-check.ts:32-58` 仅取 `assets[].browser_download_url`，无 `.sha512` asset；`electron/ipc.ts:212-216` `app:downloadUpdate` 直接 `downloadDesktopUpdate(url)` 落盘 | checkUpdate 内多抓 `assets.find(a=>/\.sha512$/i.test(a.name))`；download.ts 流式写盘结束后 `crypto.createHash('sha512')` 比对，不符删文件拒绝 |
| N8 openExternal 无域名白名单 | **未修** | `app/electron/ipc.ts:202-206` 仅 `if (!/^https?:\/\//i.test(url)) throw` 后 `shell.openExternal(url)`，无 hostname 白名单 | 加 ALLOWED 数组（github.com/bilibili.com/music.163.com 等），`new URL(url)` 后 hostname 后缀校验 |
| N9 桌面歌词窗跨屏/DPI 缩放 | **部分** | `app/electron/windows.ts:264-270` inSomeDisplay 校验已有（round9 落地）；但 :304-308 `win.on('moved')` 未监听 `screen.on('display-metrics-changed')`；:299 `setAlwaysOnTop(true,'screen-saver')` 后无 `setVisibleOnAllWorkspaces(true)`；main.ts 无 `disable-features=CalculateNativeWinOcclusion` | ① 监听 display-metrics-changed 重判 bounds；② `setVisibleOnAllWorkspaces(true)`；③ app.ready 前加 `app.commandLine.appendSwitch('disable-features','CalculateNativeWinOcclusion')` |
| N10 crossfade 期间 audioCtx 挂起无声 | **未修** | `app/electron/player-host.ts:71` 仅 buildGraph 内 `void audioCtx.resume()`；:262 fadeTo onEnd 未校验 `audioCtx.state==='running'`；无 `powerMonitor.on('resume')`/`browser-window-focus` 监听 | 模块顶层 `app.on('browser-window-focus', () => void audioCtx?.resume().catch(()=>{}))`；`powerMonitor.on('resume', ...)` 触发 resume + 重新 attach 当前源；fadeTo onEnd 先判 state |
| N11 CSP prod 仍 unsafe-inline/eval | **未修** | `app/src/index.html:7` `script-src 'self' 'unsafe-inline' http://localhost:5273`（dev 端口硬编码）；`src/index.mobile.html:10` `script-src 'self' 'unsafe-inline' 'unsafe-eval' 'wasm-unsafe-eval'` + `media-src/img-src/connect-src ... http:` | vite.mobile.config.ts / vite.config.ts 用 define 在 build 时替换 CSP，prod 去掉 unsafe-inline/eval 与 localhost:5273 |

**N1~N11 小结：9 条未修，2 条部分（N3 net.fetch fallback、N9 歌词窗 restore 校验）。**

---

## 五、git 工作区改动与落地关联说明

### 5.1 最近提交（HEAD = aaaee76）

```
aaaee76 refactor(player): 播放模块按规格书 v2.7 模块化重构
aa1e9ec fix(player,video,settings): 播放页去重重构 + 视频面板紧凑化 + 移动端插件市场/最近播放修复
82c1aa8 feat(v2.3.5): 补齐规格书 v2.7 剩余条目
b11227e feat(player): v2.3.5 全端播放模块规格书 v2.7 对齐
```

HEAD 已含「模块化重构」与「v2.7 对齐」提交，但 round10 列的 51 条未落地项在 HEAD 中均未解决（round10 就是基于 HEAD 工作区取证）。

### 5.2 未提交工作区改动（与 round10 修复的关系）

| 改动 | 关联 round10 条目 | 实际关系 |
|---|---|---|
| `R app/src/platform.ts → platform/index.ts` | — | 纯路径重构，无逻辑修复 |
| `R app/src/audio/eq.ts → player-core/eq.ts`、`audio/spectrum.ts → player-core/spectrum.ts` | — | 纯路径重构 |
| `R app/src/player/* → player-music/*`、`video/* → player-video/*` | — | 纯路径重构 |
| `M app/electron/core/media.ts`（+84 行） | Bug93/Bug96 | **新增规格书 v2.8 · 1.12 音频播放缓存功能**（isAudioUrl + audioCacheFile + putAudioCache + chunks 收集）。Bug93（total=0 不 rename）未改；Bug96（chunks 驻留内存）**因新功能被重新引入**（:495-507） |
| `M app/electron/ipc.ts`（+5 行） | — | 新增 `cache:info`/`cache:clear` 双轨（:537-539 与 :729-754 重复注册），非 round10 条目 |
| `M app/src/pages/Home.vue`（+96 行） | b8 | **部分修复**：:245 `feed?.totalToplists \|\| 0` 榜单数已动态化；:247 音源数仍硬编码 `<b>6</b>` |
| `M CarPlayer.vue / MvPlayer.vue / Player.vue / mobile/*` | F-08/F-09/F-10/F-13 | 仅 import 路径随 player-music/player-video 重命名调整，无功能补全 |
| `M EqPanel.vue / SpectrumBars.vue / main.ts / main.mobile.ts` | — | import 路径随 eq.ts/spectrum.ts 重命名调整 |
| `?? app/src/platform/useGlobalShortcuts.ts`（新文件） | b7（Bug6） | **基础设施已建但未接线**：installGlobalShortcuts 函数存在，但 main.ts 与 App.vue 均未调用（全仓 grep 仅命中定义处） |
| `?? app/electron/core/cache.ts`（新文件） | F-06 | 桌面端播放缓存管理（audio 50 首/500MB、video 1GB、clearPlaybackCache），但**移动端 bridge/index.ts:614/618 仍返零 stub**，未接 cache.ts |
| `?? app/android/.../SwAudioCache.java`（新文件） | — | Android 原生音频缓存辅助类，非 round10 条目 |
| `?? app/src/storage/`（未跟踪目录） | a1/C-11/Bug75 | 仍是死代码（0 import），未删除，错键名仍在 |
| `?? app/src/player-core/state.ts`（未跟踪） | a2/Bug81 | 仍是死模块（0 import），PlayStatus 仍无 stopped |

### 5.3 结论

**round10 列的 51 条「未落地/待修复」条目，截至 round11 取证时：已修 0 条、部分 2 条（N3、N9）、其余 49 条全部未修。**

工作区当前改动方向是「规格书 v2.8 · 1.12 音频播放缓存 + 模块化路径重构 + 桌面快捷键基础设施」，与 round10 列出的 Bug 修复清单**完全错开**。其中 Bug96（音频 chunks 驻留内存）还因新缓存功能被重新引入到 media.ts:495-507。

---

## 六、三大最重要发现

1. **round10 全部 51 条未落地项几乎零修复**：Bug 75~96（22 条）+ C-09~C-13（5 条）+ F-01~F-13（13 条）+ N1~N11 中 9 条 = 49 条全部未修；仅 N3（net.fetch fallback 已加）、N9（歌词窗 restore 校验）2 条部分落地。工作区未提交改动是「规格书 v2.8 · 1.12 音频播放缓存 + 模块化路径重构」，与 round10 修复清单无交集。

2. **Bug96（音频 chunks 整曲驻留内存）被工作区新代码重新引入**：`electron/core/media.ts:495-507` 的新音频缓存逻辑（git diff +84 行）用 `const chunks: Buffer[] = []` 收集整曲后 `Buffer.concat(chunks)` 一次性写盘——这正是 round10 Bug96 描述的反模式。30MB FLAC 全程驻留内存，连播峰值飙升。修复方向应改为边收边写 `.part`（与视频缓存同路径）。

3. **桌面快捷键基础设施（b7/Bug6）已建但未接线**：新文件 `src/platform/useGlobalShortcuts.ts` 实现了 installGlobalShortcuts（空格/方向/Ctrl+方向/Ctrl+L/Ctrl+D/Ctrl+K），但 `main.ts` 与 `App.vue` 均未调用（全仓 grep 仅命中定义处）。这是「改了一半」的典型——函数写完没接进 bootstrap，用户实际仍无桌面快捷键。一行 `installGlobalShortcuts({player, ui, router, focusSearch})` 接入 main.ts:bootstrap 即可闭环。
