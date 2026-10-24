# Round 9 · 子任务②：GitHub/网络高频 BUG 类型对照

> 范围：LX Music desktop/mobile、Musify、Vibe、Melodee、AudioStation、Feishin、MusicFree、SPlayer 及中文社区（酷安/贴吧/V2EX/少数派/LX 官方 FAQ）高频投诉类型，逐项对照 D:\music\app 代码定位风险点。
> 已与 round8 Bug46~54 错开，不重复。
> 证据分级：【已确认高频】= 有 GitHub issue / 官方 FAQ / 社区帖来源；【推断】= 仅代码侧观测，无外部高频佐证。

---

## 一、高频 BUG 类型清单（含来源）

| # | 类型 | 外部佐证来源 | 证据级别 |
|---|---|---|---|
| T1 | Android 息屏/锁屏后播放自动暂停、被系统杀 | https://lxmusic.toside.cn/mobile/faq/playback-interruption ；https://developer.android.com/media/media3/session/background-playback ；华为 https://consumer.huawei.com/cn/support/content/zh-cn00458250/ | 已确认高频 |
| T2 | 通知栏/锁屏媒体控件不出现、线控/蓝牙按键失灵、划卡后仍播放 | https://lxmusic.toside.cn/mobile/faq/still-playing-after-terminating-process （参考 issue lyswhut/lx-music-mobile#62） | 已确认高频 |
| T3 | 来电/蓝牙耳机断开/音频焦点被抢占后音频不停或不自动恢复 | Android 官方 MediaAudioFocus 文档惯例；LX FAQ 「音频卸载」开关同源投诉 | 推断（Android 生态高频） |
| T4 | 随机播放连续重复同一批歌、不洗牌 | https://community.spotify.com/t5/Other-Podcasts-Partners-etc/Why-is-shuffle-playing-the-same-songs-repeatedly-on-a-48hr-long/m-p/6453593 ；https://contentbase.com/blog/aimp/shuffle-not-random/ | 已确认高频 |
| T5 | 缓存膨胀 / 离线视频无限堆积 / 磁盘占用持续增长 | https://idroot.us/install-feishin-manjaro/ ；https://idroot.us/install-feishin-linux-mint-22/ （Feishin memory/cache leak 用户抱怨） | 已确认高频 |
| T6 | 长时间使用内存持续上涨（整曲 Buffer 驻留、频谱/封面未释放） | 同上 Feishin 内存泄漏报告 | 已确认高频 |
| T7 | 下载暂停后无法续传、断点丢失、重下浪费流量 | https://lxmusic.toside.cn/desktop/faq/cannot-play-and-download （下载/试听故障是 LX 官方 FAQ 单列条目） | 已确认高频 |
| T8 | 歌词错位 / 拖动进度后歌词不同步 / 无全局延迟校准 | https://docs.lyricify.app/en/lyricify-4/faq/inaccurate-timeline/ ；https://betterlyrics.github.io/docs/FAQ/lyrics-display.html ；https://getmusicbee.com/forum/index.php?topic=39954.0 | 已确认高频 |
| T9 | 切歌瞬间 UI 仍残留上一首进度条/封面 | Lyricify FAQ 同条；社区通用投诉 | 推断 |
| T10 | 音源失效后无黑名单持久化、重启仍重试同一坏链 | https://lxmusic.toside.cn/desktop/faq/cannot-play-and-download （2023-10 腾讯投诉后内置源全废，用户需自换源） | 已确认高频 |
| T11 | .part 临时文件异常中断后残留泄漏 | 通用下载/缓存实现通病 | 推断 |
| T12 | 频谱/可视化在后台持续高 CPU 占用 | Feishin 内存/性能投诉同源 | 推断 |

---

## 二、逐类对照表

| 类型 | 星河对应点（文件:行号） | 风险级别 | 解决方案 |
|---|---|---|---|
| T1 Android 后台被系统杀/息屏停播 | android/app/src/main/java/com/starwish/music/MainActivity.java:5-15（仅 BridgeActivity，无 MediaSessionService/startForeground） | 高 | 新增 Kotlin MediaSessionService + 前台通知（AndroidX media3），MainActivity 注册 service；播放中 startForeground，暂停 10min 后自动 stopForeground |
| T2 通知栏/锁屏媒体控件失控 | src/mobile/player.ts:252-290（navigator.mediaSession 仅 WebView 层）+ SwMediaClient.java:35-64（原生未接管 MediaSession） | 高 | 原生层实现 MediaSessionService，setMetadata/setPlaybackState/setMediaButtonReceiver；WebView 仅作 UI，系统控件走原生 |
| T3 音频焦点/蓝牙断连/来电未处理 | android 工程全局无 AudioManager.requestAudioFocus（Grep 0 命中）；src/mobile/player.ts 无 headset-unplug 监听 | 中 | 原生 onResume 时 requestAudioFocus(TRANSIENT_MAY_DUCK)，监听 AUDIOFOCUS_LOSS/TRANSIENT_LOSS 调桥接接口 pause()；监听 ACTION_AUDIO_BECOMING_NOISY 自动暂停 |
| T4 shuffle 纯 Math.random 无洗牌/无历史去重 | src/mobile/player.ts:177-179（`Math.floor(Math.random()*queue.length)`，不 Fisher-Yates、不记历史） | 中 | 构建 shuffledOrder 数组，Fisher-Yates 洗牌；维护 playedStack，next 从剩余未播放池抽；与 Bug53「不排除当前 index」互补 |
| T5 离线 MV 缓存无容量上限 | electron/core/media.ts:150-245（saveOfflineVideo/listOfflineVideos/removeOfflineVideos 仅有 manifest，无 prune/LRU/总量上限） | 高 | 参照 pruneVideoCache()（cache.ts:112）补 pruneOfflineVideos()，默认 2GB 上限，超出删最旧 savedAt；OfflineCache.vue 加「自动清理」开关 |
| T6 整曲 Buffer[] 驻留内存致播放几首后膨胀 | electron/core/media.ts:494-513（`const chunks:Buffer[]=[]`，done 时才 `Buffer.concat(chunks)` 写盘） | 中 | 改为边收边写 .part 文件（同视频 tee 方案 line 414-491），done 时 rename；避免 FLAC 30MB×N 驻留 JS 堆 |
| T7 下载无断点续传，暂停从头重下 | electron/core/download.ts:158（`fsp.open(dest,'w')` 截断）；343-357（resumeDownload 注释「不做断点续传，从头重下」，progress/received/total 清零） | 中 | streamTo 改 'a' 模式，发 Range: bytes=<received>-；resumeDownload 保留 received/total 并重新 resolveUrl；遇 200 不支持 Range 时降级重下 |
| T8 歌词 500ms tick + 硬编码 +0.12s，无全局延迟校准 | src/mobile/player.ts:85（setInterval 500ms）；src/player-music/lyrics.ts:39（`position.value + 0.12` 硬编码） | 中 | tick 提到 200ms 或 rAF 驱动；settings 增加 lyricOffsetMs(-500~+500)，lyrics.ts 读取；拖动 seek 后立即触发一次 activeIndex 重算（已 computed 依赖 position，OK） |
| T9 切歌瞬间 UI 残留上一首进度 | src/mobile/player.ts:114-116（load() 在 publish 前已把 position=0，但 await resolveUrl 期间旧 tick 仍 emit 旧 position） | 低 | load() 开头同步 publish 一次 position=0/duration=0 的 loading 状态，不等 resolveUrl |
| T10 失败音源仅内存数组，重启即丢 | src/mobile/player.ts:37（`failedSources:string[]` 模块级）；165-167（consecutiveFails>=3 仅 toast 一次） | 中 | failedSources 落 electron-store(db.ts)，按 song.id+source 记录失败时间戳，24h 内不再选；连续失败后自动弹出音源选择面板而非仅 toast |
| T11 .part 异常残留 | electron/core/cache.ts:71（filter `.part` 不算命中，但 listFiles 统计 bytes 时含 .part）；electron/core/media.ts:121-146 releaseMediaCache 启动清；SwAudioCache.java 同构 | 低 | pruneAudioCache/pruneVideoCache 启动时扫一遍删 *.part；clearPlaybackCache 已递归删整个目录可覆盖 |
| T12 频谱 60ms pump 后台不停止 | src/mobile/player.ts:537-541（startPump 60ms，仅靠 spectrumSinks.size===0 停） | 低 | 监听 document.visibilitychange / mobile 路由离开播放器页时，强制退订所有 sink；pumpSpectrum 内判 el.paused 已有，补 document.hidden 早退 |

---

## 三、备注

- T4 与 round8 Bug53（shuffle 不排除当前 index）角度互补：Bug53 是「当前首可能立刻再抽到」，本条 T4 是「整体无洗牌算法 + 无历史去重，长列表仍会短程重复」，二者可合并修复。
- T6 与 Feishin 已知问题（idroot.us 两篇用户操作指南均建议「重启 Feishin / 减小 image cache」）根因一致：边播边收集 chunk 到内存是 Electron Chromium 下常见 OOM 路径。
- T1/T2 在 Android 工程侧（android/app/src/main/java/com/starwish/music/）完全无 MediaSessionService 痕迹，属架构级缺失，不是微调能解决；建议 round10 立项做原生播放服务重构。
