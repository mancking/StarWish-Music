# 星河音乐 v1.0.0 发布说明

> 2026-10-25 ｜ 首次全端统一版本

## 简介

全端跨平台音乐播放器——桌面（Windows/macOS/Linux）和移动端（Android/iOS）一套源码覆盖。支持多音源聚合搜索、歌单/排行榜/新歌发现、MV视频播放、插件市场扩展、主题换肤、桌面歌词、下载管理与离线缓存。

## 主要更新

- **插件/主题市场分离**：插件走 Star-Wish-Plugin-Library 分支，主题走 Star-Wish-Theme-Library 分支，互不干扰；编辑器式固定头面板，搜索框与标签不再随列表滚动
- **多音源保障**：镜像并发竞速与强制刷新机制，上传音源后即时拉取；播放失败精准换源不跳过候选池
- **主题与外观**：预置皮肤切换修复、色谱式强调色选择（预设+色相滑杆）、动画开关滑块居右、开源壁纸归入主题市场
- **播放器重构**：移动端——喜欢/音效/倍速/封面切换/定时/更多移入进度条上方，播放模式/上一首/播放/暂停/下一首/列表置于底部居中；双击视频暂停；播放设置面板层级已修正不再被底栏遮挡；桌面端——两栏等分布局（唱片+歌词），实时频谱置进度条上方，控件组居中对齐
- **移动端设置**：移除多余账号分组，下载保存位置可更改目录，页面支持左右边缘滑动返回
- **发现页**：歌单/排行榜支持小蜗音乐（酷我别名），分类标签与榜单数据通道完整
- **视频/MV**：B站登录后刷新可获取；Q音视频搜索接口异常时静默降级不阻塞；酷我/酷狗搜索可用
- **源码清理**：移除内部规划书章节编号与Bug标签等开发引用

## 平台构建产物

每条产物均可从本 Release 页面直接下载。

### Android（3 设备形态 × 2 构建类型 = 6 个 APK）

| 设备形态 | ApplicationId | Release (未签名) | Debug |
|----------|---------------|------------------|-------|
| 手机 | `com.starwish.music.phone` | `StarWish-1.0.0-android-phone-release-unsigned.apk` | `StarWish-1.0.0-android-phone-debug.apk` |
| 平板 | `com.starwish.music.tablet` | `StarWish-1.0.0-android-tablet-release-unsigned.apk` | `StarWish-1.0.0-android-tablet-debug.apk` |
| 车机 | `com.starwish.music.automotive` | `StarWish-1.0.0-android-automotive-release-unsigned.apk` | `StarWish-1.0.0-android-automotive-debug.apk` |

### iOS（2 设备形态、未签名）

| 设备 | BundleId | 产物 |
|------|----------|------|
| 手机 | `com.starwish.music.phone` | `StarWish-iPhone-1.0.0-unsigned.ipa` |
| 平板 | `com.starwish.music.ipad` | `StarWish-iPad-1.0.0-unsigned.ipa` |

### 桌面

| 平台 | 产物 |
|------|------|
| Windows 安装版 (x64) | `StarWish-1.0.0-Setup.exe` |
| Windows 便携版 (x64) | `StarWish-1.0.0-win-portable.exe` |
| Windows 绿色版 (x64) | `StarWish-1.0.0-win-x64.zip` |
| Linux AppImage (x64) | `StarWish-1.0.0-linux-x86_64.AppImage` |
| Linux deb (x64) | `StarWish-1.0.0-linux-amd64.deb` |
| macOS dmg (x64) | `StarWish-1.0.0-mac-x64.zip` |
| macOS dmg (arm64) | `StarWish-1.0.0-mac-arm64.zip` |

## 安装引导

- **Android 侧载**：下载对应设备形态的 `debug` APK 直接安装；`release-unsigned` APK 需自签名或用 `jarsigner` 处理后安装
- **iOS 侧载**：下载对应设备的 `unsigned.ipa`，通过 AltStore / SideStore / TrollStore 自签安装（需 Apple ID）
- **桌面**：安装版双击 Setup.exe；便携版解压即用

## 说明

- 第三方音源不随包分发：请到「设置 → 源市场」安装
- Linux/macOS 产物通过 GitHub Actions 自动构建（推送标签后触发）
- 无广告、无埋点、不采集个人信息