# 星河音乐 v2.3.1 发布说明

> 发布日期：2026-10-22 ｜ 代号：真机修复与移动端全面重构
> 上一版本：2.3.0（2026-10-22）

## 本次重点

2.3.0 真机测试（红米 K70 / Android 16）暴露的一批问题全部收口，并对移动端 UI 做了
**全面重构**（依据《docs/mobile-ui-research-v2.3.1.md》调研决策，非桌面端缩小版）。

### 多端 UI 平台适配（本次新增调研与重构）

依据《docs/multi-platform-ui-research-v2.3.1.md》对 Windows Fluent / macOS HIG /
GNOME 惯例 / Material 3 / iOS HIG 的调研，新增平台适配层 `styles/platform.css`：

- **平台感知**：桌面按 UA 注入 `data-os=win32|darwin|linux`，移动端按
  `Capacitor.getPlatform()` 注入 `data-os=android|ios`（替代写死的 android）
- **Windows**：Segoe UI Variable 字体栈、细可见滚动条、8px 控件圆角
- **macOS**：SF Pro 字体栈、红绿灯避让（侧栏品牌行右移）、overlay 隐藏滚动条、
  侧栏半透明 vibrancy 近似、更柔阴影
- **Linux**：Cantarell/Noto 字体栈、细窄滚动条、克制阴影
- **Android**：Roboto 字体栈、M3 式按压 state-layer 反馈
- **iOS**：SF Pro 字体栈、Large Title 大页头、关闭触碰呼出、overscroll 交还系统
- 布局骨架本身两端异构：桌面=侧栏+顶栏+迷你条；移动=底部 Tab+迷你播放条+沉浸播放页

### 修复

| 问题 | 根因 | 修复 |
| --- | --- | --- |
| 安装 2.3.0 扫描安装包显示 2.2.0 | `android/app/build.gradle` 写死 versionName，与主包脱节 | 版本号单一来源化：Gradle 构建期直接读取 `app/package.json`，versionCode 由 semver 推导（2.3.1 → 2003001），此后永不脱节 |
| 进入应用后所有功能网络不可用 | 真机原生 HTTP 通道强依赖 `@capacitor-community/http` 动态 import，失败即全网断 | 原生通道三级回退：`Capacitor.nativePromise('CapacitorHttp')`（零依赖）→ 社区包 → WebView fetch；每一级失败自动降级，且 CSP 放开 `http:` 数据/媒体/连接 |
| 下载需要跳转浏览器下载安装包 | 移动端更新入口只「复制链接」 | 新增原生插件 `SwBridge`：应用内下载 Release 中的 APK 到私有目录 → FileProvider 授权 → 直接拉起系统安装器；无 APK 产物时才回退复制链接 |
| 部分系统能力受限 | 移动端无系统集成、无法下载歌曲、外链无法打开 | ① **MediaSession**：锁屏/通知栏/蓝牙线控（封面+标题+上下曲+进度）；② **移动端可下载歌曲**：`/swmedia/` 原生代理流式拉流 → MediaStore 写入公共音乐库 `Music/星河音乐/`（API 29+ 免存储权限），下载管理页可用；③ 外链经系统浏览器打开 |

### 移动端 UI 全面重构（与桌面完全异构）

- **首页**：桌面多列网格 → 分区横滑卡片流（scroll-snap），148px 大封面卡
- **发现页**：3 列小卡 → 2 列大封面卡；排行榜横向胶囊行
- **歌曲列表**：桌面表格式（序号/专辑/时长列）→ 触屏行式，行高 56px、操作常显
- **设置页**：两栏表单 → 单栏 + 分类胶囊行 + 行卡片化，内联控件 44px+
- **播放队列 / 弹窗**：桌面右下弹层 → 底部动作面板（bottom sheet + 把手）
- **「我的」**：入口卡片化，品牌色图标块
- **全局触控目标 ≥44px**，弹层深蒙层沉浸，轻提示移至拇指热区

### 手势体系

- **边缘右滑返回**（全局，带跟手指示条）
- **迷你播放条上滑**展开沉浸播放页（跟手位移+回弹）
- **下拉刷新修复**：v2.3.0 绑定错容器（桌面 `.content`，移动端是 `.m-content`）导致真机无响应，且需按住 3 秒；现在绑对容器、**松手即刷**
- 播放页原有手势（上/下滑切歌、下滑收起、左右滑切歌、单击暂停）保留

### 体验

- **启动提速**：界面先行挂载（骨架屏即现），数据库/音源/收藏初始化并行化并转后台，消除白屏等待
- **引擎升级引导弹窗**：老设备 WebView 内核过旧（< Chrome 100 或缺 PointerEvent/dvh/color-mix）时，启动自检弹窗引导跳应用商店升级（新设备不触发）

### 其他端检查结论

- **桌面（Windows/mac/Linux）**：版本号本就取自 package.json，无错乱；更新走系统浏览器为桌面正常形态；UI 为指针+键盘独立设计
- **iOS（CI 未签名 ipa）**：与本端共享移动渲染层，网络/CSP/手势/UI 重构全部生效；`openExternal` 补跨端回退（WKWebView 多窗口）

## 产物

| 平台 | 产物 | 来源 |
| --- | --- | --- |
| Windows | `星河音乐-2.3.1-便携版.exe` / `Setup.exe` / `x64.zip` | 本地构建 |
| Android | `星河音乐-2.3.1-android.apk`（release 签名）+ debug | 本地构建 |
| macOS / Linux / iOS | CI（tag `v2.3.1` 触发 `build-desktop.yml` / `build-mobile.yml`） | GitHub Actions |

## 升级说明

- Android 直接安装新 APK 覆盖升级（versionCode 2003001 > 2）。
- 应用内「设置 → 关于 → 检查更新」现可直接下载并拉起安装器。
