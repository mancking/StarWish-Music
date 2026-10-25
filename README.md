# Star Wish Plugin Library

星河音乐官方插件市场（插件存储库）。

这里的插件以 **MusicFree 插件协议** 编写，可在星河音乐「设置 → 音源与插件 → 插件库」中在线浏览、安装、更新与卸载。

## 目录

- `manifest.json` — 插件市场目录索引，软件从这里拉取可安装插件列表（名称、版本、作者、支持类型、下载地址）。
- `*.js` — 各插件源码，MusicFree 协议（`module.exports = { platform, version, supportedSearchType, search, getLyric, getMusicUrl, ... }`）。

## 更新方式

1. 修改对应插件 `.js` 的 `version` 字段并更新代码。
2. 更新 `manifest.json` 中该插件的 `version`，并把日期写入顶层 `updated`。
3. 推送到本分支（`Star-Wish-Plugin-Library`）。
4. 用户端点「插件库 → 检查更新」即可拉到新版本（按 `file` 名匹配覆盖安装）。

## 依赖

插件运行时由宿主（星河音乐）注入以下依赖，插件内可直接 `require`：

`axios`、`cheerio`、`crypto-js`、`dayjs`、`qs`
