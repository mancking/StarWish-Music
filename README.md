# Star Wish Plugin Library

星河音乐官方插件市场（插件存储库）。

这里的插件以 **MusicFree 插件协议** 编写，可在星河音乐「设置 → 音源与插件 → 插件库」中在线浏览、安装、更新与卸载。

## 目录

- `manifest.json` — 插件市场目录索引，软件从这里拉取可安装插件列表（名称、版本、作者、支持类型、下载地址）。
- `*.js` — 各插件源码，MusicFree 协议（`module.exports = { platform, version, supportedSearchType, search, getLyric, getMusicUrl, ... }`）。

## 插件列表

| 插件 | 平台 | 版本 | 支持 |
| --- | --- | --- | --- |
| 5s.js | 5sing | 0.0.3 | 歌曲/专辑/歌手/歌单 |
| 原力.js | bilibili | 0.3.0 | 歌曲/专辑/歌手 |
| 小云.js | 小芸音乐 | 0.0.3 | 歌曲/专辑/歌单/歌手/歌词 |
| 小千.js | 歌词千寻 | 0.0.0 | 歌词 |
| 小月.js | 音悦台 | 0.0.1 | 歌曲 |
| 小枸.js | 小枸音乐 | 0.0.3 | 歌曲/专辑/歌单 |
| 小秋.js | 小秋音乐 | 0.0.3 | 歌曲/专辑/歌单/歌手/歌词 |
| 小蜗.js | 小蜗音乐 | 0.0.3 | 歌曲/专辑/歌单/歌手 |
| 网易云.js | 网易音乐 | 2025.09.14 | 歌曲/专辑/歌单/歌手/歌词 |

## 更新方式

1. 修改对应插件 `.js` 的 `version` 字段并更新代码。
2. 更新 `manifest.json` 中该插件的 `version`，并把日期写入顶层 `updated`。
3. 推送到本分支（`Star-Wish-Plugin-Library`）。
4. 用户端点「插件库 → 检查更新」即可拉到新版本（按 `file` 名匹配覆盖安装）。

## 依赖

插件运行时由宿主（星河音乐）注入以下依赖，插件内可直接 `require`：

`axios`、`cheerio`、`crypto-js`、`dayjs`、`qs`、`he`、`big-integer`

## 插件开发指南

星河音乐的插件采用 **MusicFree 插件协议**编写，运行在宿主（`mf-host.ts`）用 `node:vm` 创建的沙箱环境中。插件本质是一个 CommonJS 模块，导出一个对象。

### 基本结构

```js
// my-plugin.js
const axios = require('axios')

module.exports = {
  platform: '我的平台',            // 平台名（唯一标识，用于「当前音源」展示）
  version: '1.0.0',                // 版本号（semver 建议）
  srcUrl: 'https://github.com/you/repo',  // 源码地址（可选）
  author: '你的名字',              // 作者（可选）
  description: '插件说明',          // 描述（可选）
  supportedSearchType: ['music', 'album', 'artist', 'sheet', 'lyric'],

  // 搜索。type 取 supportedSearchType 中的值
  async search(query, page, type) {
    // 必须返回 { isEnd, data }，data 是数组
    // 音乐项：{ id, title, artist, album, artwork, url, ... }
    return { isEnd: true, data: [] }
  },

  // 歌词。musicItem 是搜索/播放选中的歌曲对象
  async getLyric(musicItem) {
    // 返回 { lrc } 或 { rawLrc }
    return { lrc: '' }
  },

  // 播放地址（可选 getMusicUrl）
  async getMusicUrl(musicItem, quality) {
    return ''  // 返回可直接播放的 URL（http/https）
  },

  // 其他可选：getAlbum、getArtist、getArtistAlbum、getSheet、getMusicInfo 等
}
```

### 可用依赖

插件内可直接 `require`（无需打包），宿主已注入：

- `axios` — HTTP 请求
- `cheerio` — HTML 解析
- `crypto-js` — 加密
- `dayjs` — 时间处理
- `qs` — 查询串序列化
- `he` — HTML 实体编解码
- `big-integer` — 大整数

其余 `require` 一律抛「插件依赖 X 不在支持列表内」，请勿引用其他包。

### manifest.json（市场索引）

每个插件需在 `manifest.json` 中登记，才能在插件市场被列出：

```json
{
  "name": "我的插件",
  "file": "my-plugin.js",
  "url": "https://raw.githubusercontent.com/mancking/StarWish-Music/Star-Wish-Plugin-Library/my-plugin.js",
  "version": "1.0.0",
  "author": "你的名字",
  "platform": "我的平台",
  "description": "插件说明",
  "supportedSearchType": ["music", "album", "artist", "sheet", "lyric"]
}
```

`file` 对应分支上的 `.js` 文件名，`url` 指向该文件在本分支的 raw 地址。

### 运行环境与注意事项

- 沙箱超时 20 秒（`timeout: 20000`），单次调用超过会被中断，注意不要阻塞太久。
- 插件运行在 Electron 主进程，可访问 Node API（但请只用注入的依赖）。
- **默认关闭**：用户在「设置 → 音源与插件 → 插件库」安装后，需手动启用该插件才会参与搜索/取词。
- 更新插件时同步更新 `manifest.json` 的 `version`，详见上方「更新方式」。

### 调试

把 `.js` 放到 `manifest.json` 后推送本分支，用户端「插件库 → 检查更新」拉取安装，启用后在搜索/歌词页验证；异常会显示在插件列表的加载错误字段。
