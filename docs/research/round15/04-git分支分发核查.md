# 第十五轮追加 · Git 分支分发架构核查

- 专项：插件/音源的 git 分支挂载现状 + 更新链路坐实 + 0.10 统一源市场 git 分发设计输入
- 代码快照：`D:\music\app\` + `D:\music\.github\` + git 仓库 `mancking/StarWish-Music`
- 证据原则：所有结论带 `文件:行号` 或 `git show` 输出

---

## ① Git 分支挂载现状（已查证）

### 1.1 仓库拓扑

| 项 | 值 | 证据 |
|---|---|---|
| 项目源码库 | `https://github.com/mancking/StarWish-Music.git` | `D:\music\.git\config`（`git remote -v` 输出） |
| 本地当前分支 | `main`（detached? 否，普通分支） | `git rev-parse --abbrev-ref HEAD` → `main` |
| 插件库分支 | `Star-Wish-Plugin-Library`（本地 + origin 均存在） | `git branch -a` 输出含 `+ Star-Wish-Plugin-Library` / `remotes/origin/Star-Wish-Plugin-Library` |
| 子模块 | **无**（无 `.gitmodules`，`git submodule status` 空输出） | `cmd /c "type D:\music\.gitmodules"` 空 |
| 独立插件仓库 | **无**（plugins 不是独立 repo，也不是 submodule） | 同上 |

### 1.2 插件库分支内容

`git ls-tree -r --name-only origin/Star-Wish-Plugin-Library` 输出：

```
5s.js
README.md
manifest.json
原力.js          (URL-encoded: %E5%8E%9F%E5%8A%9B.js)
小云.js          (小芸音乐)
小千.js          (歌词千寻)
小月.js          (音悦台)
小枸.js
小秋.js
小蜗.js
网易云.js        (网易音乐)
```

**共 9 个插件 .js + 1 个 manifest.json + 1 个 README.md**。全部直接提交在分支根目录，无子目录分层。

### 1.3 manifest.json 结构（从分支读取）

顶层字段：
```json
{
  "name": "星河官方插件库",
  "description": "星河音乐官方插件市场，提供可在线安装/更新的音源与歌词插件。",
  "updated": "2026-10-19",
  "plugins": [ ... 9 项 ... ]
}
```

每项字段（以 5sing 为例）：
```json
{
  "name": "5sing",
  "file": "5s.js",
  "version": "0.0.3",
  "author": "SoEasy同学",
  "platform": "5sing",
  "description": "",
  "types": ["music","album","artist","sheet"],
  "url": "https://raw.githubusercontent.com/mancking/StarWish-Music/Star-Wish-Plugin-Library/5s.js"
}
```

**与 mf-host.ts:350-360 MarketEntry 类型完全对应**（已查证 Round15 ①.1）。

### 1.4 manifest URL 与分支的关系

- OFFICIAL_SUB_URL（`Settings.vue:97` / `mobile/Settings.vue:117`）=
  `https://raw.githubusercontent.com/mancking/StarWish-Music/Star-Wish-Plugin-Library/manifest.json`
- 拆解：`<raw 域名>/<owner>/<repo>/<branch>/<path>`
  - owner=`mancking`, repo=`StarWish-Music`（与项目源码同 repo）
  - branch=`Star-Wish-Plugin-Library`（插件专用分支）
  - path=`manifest.json`
- **结论**：市场条目直链就是同一分支下的静态文件 URL；**没有 CI 生成 manifest**，没有 workflow 驱动，没有 CDN 回源——就是 git 分支本身被当成静态托管。

### 1.5 README 自述（分支内 README.md 前 30 行）

> "星河音乐官方插件市场（插件存储库）。这里的插件以 MusicFree 插件协议 编写，可在星河音乐「设置 → 音源与插件 → 插件库」中在线浏览、安装、更新与卸载。"
>
> 更新方式：
> 1. 修改对应插件 .js 的 version 字段并更新代码。
> 2. 更新 manifest.json 中该插件的 version，并把日期写入顶层 updated。
> 3. 推送到本分支（Star-Wish-Plugin-Library）。

**一方称**：这是插件作者的发布流程，与 App 运行时无关。

### 1.6 .github/workflows 与插件分发无关

| Workflow | 作用 | 证据 |
|---|---|---|
| `build-desktop.yml` | 桌面端 Electron 构建 | `.github/workflows/` 目录列表 |
| `build-mobile.yml` | 移动端 Capacitor 构建 | 同上 |
| `release.yml` | 打 tag 时归集五端产物 + 创建 GitHub Release（release.yml:6-10 `tags: v*`） | 已读全文件 |

**没有任何 workflow 在 `Star-Wish-Plugin-Library` 分支 push 时触发**；没有 CI 生成 manifest；没有 gh-pages 部署。插件分发 = 开发者手动 push 到分支。

---

## ② 「更新替换」链路坐实（文件级覆盖，非 git 拉取）

### 2.1 运行时无任何 git 客户端

- `D:\music\app\package.json` 依赖里**无** `simple-git` / `isomorphic-git` / `nodegit`（grep `git|isomorphic` 仅命中 package.json 自身的 repository URL，行 177-182）。
- `electron/` 全目录 grep `git clone|git fetch|git pull|simple-gib|isomorphic-git|child_process.*git` **零命中**。
- **结论**：App 运行时**不执行任何 git 命令**。所谓"git 分支分发"仅指托管方式是 git 分支，App 拿到的是 raw HTTP 文件。

### 2.2 lx 音源更新替换链路

| 步骤 | 代码 | 行为 |
|---|---|---|
| 用户点「更新替换」 | `Settings.vue:408-411 updateSource(s)` | 打开导入弹窗，`replaceTarget = s` |
| 用户填新 URL / 选本地文件后提交 | `Settings.vue:388-392 doImport` | 调 `call('sources:import', {url, content, file: replaceTarget.file})` |
| IPC 入口 | `ipc.ts:272-276` | 透传到 `lxHost.importSource({url, content, file})` |
| 主进程实现 | `lx-host.ts:526-563 importSource` | 见下 |
| URL 拉取 | `lx-host.ts:528-533` | `request(payload.url)` 下载内容到内存 |
| 校验 | `lx-host.ts:534-537` | 空内容 / 非 lx API 正则 |
| 原地替换 | `lx-host.ts:546-551` | `target = payload.file`；`old = sources.find(...)`；`if (!old || old.builtin) throw`；`file = path.basename(target)` |
| 写盘 | `lx-host.ts:558` | `fs.writeFileSync(path.join(userSourcesDir(), file), content, 'utf8')` |
| 重载 | `lx-host.ts:559` | `this.load()` 重新扫描目录 |

**结论**：文件级覆盖（HTTP 下载 → 内存 → fs.writeFileSync 同名覆盖）。**无 git fetch，无 tag 比对，无回滚点**。

### 2.3 MusicFree 插件更新替换链路

| 步骤 | 代码 | 行为 |
|---|---|---|
| 市场「更新」按钮 | `Settings.vue:463-474 installFromMarket` | `call('plugins:import', {url: entry.url, origin:'subscribe'})` |
| 已安装列表 refresh icon | `Settings.vue:477-489 updatePlugin(p)` | `call('plugins:import', {url: p.sourceUrl, file: p.file, origin: p.origin})` |
| IPC 入口 | `ipc.ts:298-302` | 桌面：url 走 `mfHost.importFromUrl(url, file)`；content 走 `importFromContent(content, 'local', undefined, file)` |
| URL 拉取 | `mf-host.ts:263-270 importFromUrl` | `requestWithMirror(url)` 下载（2 镜像兜底，N-24 已报） |
| 写盘 | `mf-host.ts:249` | `fs.writeFileSync(path.join(userPluginsDir(), file), content, 'utf8')` |
| 写注册表 | `mf-host.ts:250-257` | `reg.entries[file] = {origin, sourceUrl}` → `writeRegistry` |
| 重载 | `mf-host.ts:258` | `loadAll()` |

**结论**：同上，文件级覆盖。**无 git 操作**。

### 2.4 订阅源批量更新链路

- `mf-host.ts:281-341 importSubscription(url, name)`：
  - 拉订阅 URL → 解析为插件清单 JSON 或 URL 列表（287-303）
  - 逐个 `requestWithMirror(item.url)` 下载（311）
  - 按 `sourceUrl` 匹配 registry.entries，命中则 `fs.writeFileSync` 覆盖（316-319），否则走 `importFromContent`（321）
- **结论**：同上，HTTP 文件覆盖。

---

## ③ Git 分支分发与 plugins:market 的关系（已坐实）

| 维度 | 现状 |
|---|---|
| 市场条目来源 | manifest.json **提交在 git 分支**（`Star-Wish-Plugin-Library`） |
| 市场条目指向 | 每条的 `url` 字段是 `raw.githubusercontent.com/.../<branch>/<file>.js` 直链 |
| App 运行时 | **只做 HTTP 下载**，不 clone、不 fetch、不 checkout |
| 镜像 | 桌面 2 镜像（raw + cdn.jsdelivr），移动 5 镜像（见 Round15 ①.2） |
| CI | 无 workflow 参与插件分发；纯手动 push |
| 私有仓库 | **不支持**（request 不带 token，见 `http.ts` 未读但 `mf-host.ts:265 requestWithMirror` 无 auth header） |

**一句话**：git 分支是"静态文件托管"，App 是"HTTP 客户端"，二者之间没有 git 协议对话。

---

## ④ 0.10 统一源市场「git 分支分发通道」设计输入

### 4.1 若升级为真 git 拉取，原子性现状与风险

| 能力 | 现状 | 风险 | 建议 |
|---|---|---|---|
| 安装（clone / 稀疏检出） | 无 git 客户端 | 引入 isomorphic-git 增加 ~2MB 包体；移动端 WebView 内 fs 支持有限 | **继续走 HTTP raw 下载**（现有方案），把"git 分支分发"当作托管细节，不升级为 git 协议 |
| 更新（fetch + checkout tag） | 无 tag 概念 | 引入 tag 比对需要 manifest 加 `gitTag` / `commitSha` 字段 | manifest 加 `version` 字段已够（当前有），继续 HTTP 覆盖 |
| 回滚（前一 commit） | **完全无回滚能力**——覆盖写盘无备份 | 新版本插件有 bug 时用户只能重装旧版 URL | 写盘前先备份旧版本到 `<userData>/plugins/.backup/<file>.<timestamp>.js` |
| 鉴权（私有仓库 token） | **无** | 私有仓库 / 付费插件无法分发 | settings 加 `gitToken` 字段，request 时带 `Authorization: token <PAT>` |
| 缓存（本地镜像分支） | **无**——每次安装/更新都重新 HTTP 下载 | 弱网环境重复下载 | 本地缓存按 `url + sha1(content)` 落盘，命中跳过下载 |

### 4.2 推荐：保持 HTTP raw 下载，但补齐工程化

**结论**：不引入 git 客户端是对的（包体 / 移动端兼容性 / 复杂度都不划算）。git 分支作为托管方式继续用，但 App 侧要补齐：

1. **写盘前备份旧版**（回滚能力）
2. **manifest 加 `kind` / `minAppVersion` / `changelog` 字段**（C-27 已报）
3. **settings 加 `gitToken`**（未来私有仓库支持）
4. **本地缓存 sha1 → content**（减少重复下载）
5. **manifest 顶层 `updated` 字段已有**（`manifest.json` 第 5 行 `"updated": "2026-10-19"`），可作为"是否需要刷新市场"的弱信号

### 4.3 验收口径建议

| 场景 | 验收 |
|---|---|
| 安装市场插件 | 下载 → 写盘 → 注册表写成功；任一步失败不留孤儿文件（修 Bug 124） |
| 更新市场插件 | 写盘前备份旧版到 `.backup/`；失败可回滚 |
| 私有仓库分发 | settings 填 token 后，manifest URL 为 `raw.githubusercontent.com/<private>/...` 时能下载 |
| 弱网重复更新 | 同一 url 内容未变时跳过下载（sha1 缓存命中） |
| 市场列表刷新 | manifest 顶层 `updated` 变化时提示用户有新版本 |

---

## ⑤ 新增编号问题（延续 Round15）

> 已占用：Bug 120-126 / C-24-27 / N-24-30 / F-21-31。本轮从 Bug 127 / C-28 / N-31 / F-32 起。

### Bug 127 · 更新替换无回滚点，覆盖写盘丢失旧版

- **问题**：`lx-host.ts:558` / `mf-host.ts:249` 直接 `fs.writeFileSync` 覆盖旧文件；新版本插件有 bug 时用户无法一键回到旧版（只能重装旧 URL）。
- **证据**：`lx-host.ts:558`, `mf-host.ts:249`。
- **风险**：中
- **处置建议**：写盘前 `fs.copyFileSync(oldPath, oldPath + '.bak.' + Date.now())`；设置里加「回滚到上一版」按钮。
- **影响面**：所有更新场景。
- **回退路径**：用户手动从 git 分支历史找旧版 URL。
- **验收口径**：更新失败时能一键恢复上一版。

### C-28 · Git 分支作为托管但无版本/回滚/鉴权协议

- **问题**：当前"git 分支分发"只利用了 raw HTTP 静态托管；manifest 无 tag/commit sha、无 changelog、无 minAppVersion、无 token 字段。
- **证据**：`manifest.json` 顶层只有 `name/description/updated/plugins`；每项只有 `name/file/version/author/platform/description/types/url`。
- **风险**：中
- **处置建议**：manifest 规范扩展字段（见 4.2）。
- **影响面**：统一市场协议。
- **回退路径**：保持现状。
- **验收口径**：manifest 能表达"需要 App >= 0.10 才能装"。

### N-31 · 私有仓库 / 付费插件分发无 token 支持

- **问题**：`mf-host.ts:265 requestWithMirror` / `lx-host.ts:530 request` 都不带 `Authorization` header；settings 也没有 `gitToken` 字段。
- **证据**：`mf-host.ts:263-270`, `lx-host.ts:528-533`。
- **风险**：低（当前只有公共仓库）
- **处置建议**：settings schema 加 `gitToken`；http.ts request 自动附带。
- **影响面**：未来私有插件市场。
- **回退路径**：无。
- **验收口径**：填 token 后能下载私有 raw URL。

### F-32 · 本地无插件内容缓存，弱网重复下载

- **问题**：每次安装/更新都重新 HTTP 下载完整 .js；无 sha1 缓存。
- **证据**：`mf-host.ts:263-270` 每次都 request；无缓存层。
- **风险**：低
- **处置建议**：`<userData>/plugins/.cache/<sha1(url+content)>.js`；命中跳过。
- **影响面**：弱网体验。
- **回退路径**：无。
- **验收口径**：同一插件重复更新时 sha1 未变则不重新下载。

---

## 附：本轮核查未覆盖

- `build-desktop.yml` / `build-mobile.yml` 详细步骤（与插件分发无关，未读）。
- 分支 `Star-Wish-Plugin-Library` 的 git 历史（作者 push 频率、PR 流程）。
- 其他 zip 包（`lx-music-source-main.zip` 等）与当前市场的关系（一方称是参考素材，未深入）。
- `D:\music\MusicFreePlugins-master\` 目录（本地参考插件集，未查是否被 App 引用）。
