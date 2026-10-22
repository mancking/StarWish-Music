# 多端 UI 调研与平台适配决策（v2.3.1）

> 结论先行：本项目的四类交付形态（Windows / macOS / Linux 桌面，Android，iOS）
> 不应共享同一套视觉与交互。本文档给出各端 HIG 调研结论、差异矩阵与已落地实现。

## 一、现状问题

此前全端只有两套 token：`desktop` / `mobile`（tokens.css）。这意味着：
- macOS 与 Windows/Linux 用户看到完全相同的窗口形态（红绿灯位置、滚动条、字体全同）；
- Android 与 iOS WebView 共用一套样式（iOS 缺大标题、安全区之外的 HIG 细节）；
- 字体栈写死 Segoe UI 优先，macOS 上中文回退链不理想。

「多端共用一个相似 UI」在使用体验上确实是硬伤：每端用户带着各自系统的
肌肉记忆进来，控件位置、滚动手感、标题层级都应该符合本端惯例。

## 二、各端 HIG 调研要点

### Windows 11（Fluent Design）
- 字体 **Segoe UI Variable**（回退 Segoe UI / Microsoft YaHei）；
- 内容为主、克制的色彩，「calm foundation」，圆角 8px 控件级；
- 桌面传统交互：窗口按钮、密滚轮、右键菜单，细滚动条可见。

### macOS（Human Interface Guidelines）
- 红绿灯按钮占左上角，侧栏顶部必须避让（约 70px）；
- 字体 **SF Pro**（回退 PingFang SC）；侧栏材质 vibrancy（半透明模糊）；
- **overlay 滚动条**（平时隐藏），圆角偏大、阴影更柔。

### Linux（GNOME / KDE 惯例）
- 字体 Cantarell / Noto Sans CJK，系统 system-ui 优先；
- Headerbar 式间距、克制阴影，滚动条细窄。

### Android（Material 3 / Material You）
- **Roboto**；动态取色（本项目已有「强调色跟随封面」）；
- 底部导航、bottom sheet、下拉刷新、边缘返回、大触控目标（≥44dp）——
  v2.3.1 移动端全面重构已落地（见 mobile-ui-research-v2.3.1.md 与 mobile.css 两层皮肤）。

### iOS（Human Interface Guidelines）
- 字体 **SF Pro**；**Large Title** 页头（导航推入时收缩）；
- 全套 `env(safe-area-inset-*)`；左缘右滑返回；
- 无 hover、触控高亮关闭、overscroll 由系统接管。

## 三、差异矩阵（已实现 → 标 ✅）

| 维度 | win32 | darwin | linux | android | ios |
| --- | --- | --- | --- | --- | --- |
| 字体栈 | Segoe UI Variable ✅ | SF Pro ✅ | Cantarell/system-ui ✅ | Roboto ✅ | SF Pro ✅ |
| 窗口控件 | 自绘 win 控件（已有） | 红绿灯避让 ✅ | 无（静默） | 系统状态栏 | 安全区（已有） |
| 侧栏材质 | 实色 + 微渐变 ✅ | 半透明 vibrancy ✅ | 实色 ✅ | 无侧栏 | 无侧栏 |
| 滚动条 | 细可见 ✅ | overlay 隐藏 ✅ | 细窄 ✅ | 隐藏 ✅ | 系统托管 ✅ |
| 页头 | 常规 | 常规 | 常规 | 大标题 ✅ | Large Title ✅ |
| 手势 | 快捷键（已有） | 同左 | 同左 | 边缘返回/下拉刷新 ✅ | 边缘返回 ✅ |
| 底部动作 | 菜单（已有） | 菜单 | 菜单 | bottom sheet ✅ | bottom sheet ✅ |

## 四、实现方式

1. **平台感知**：桌面入口按 UA 注入 `data-os="win32|darwin|linux"`；
   移动入口按 `Capacitor.getPlatform()` 注入 `data-os="android|ios"`
   （替代此前写死的 'android'）。
2. **样式层**：新增 `styles/platform.css`，全部作用域为
   `:root[data-os='…']`，只调字体、避让、材质、滚动条、页头字号——
   不动布局骨架（骨架差异已由 desktop/mobile 两套布局承载）。
3. **布局骨架分层**：desktop = 左侧栏 + 顶栏 + 迷你条；mobile = 底部 Tab +
   迷你播放条 + 沉浸播放页。两套骨架完全异构，token（tokens.css）已分端。

## 五、边界与后续

- macOS vibrancy 用 CSS 半透明近似（真材质需 Electron BrowserWindow vibrancy
  参数，留待后续版本配合窗口层改造）。
- iOS Large Title 收缩动画以 CSS scroll-driven 降级为固定大标题（WKWebView
  15+ 支持 scroll-driven 之前不做 JS 监听，避免滚动抖动）。
- Linux 各发行版差异以 GNOME 为基准，KDE 用户可通过设置切换主题色。
