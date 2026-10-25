# 内置音源目录（已清空）

round16 起，**发布包内不携带任何音源脚本**（零音源发布，详见 `docs/round16-02-零音源发布与测试门禁规格草案.md`）。

## 现状

| 目录 | 用途 | 是否随包发布 |
|---|---|---|
| `app/sources/` | 空目录占位，仅保留本说明 | 否（无 .js） |
| `app/dev-sources/` | **开发通道**自研/测试音源源码 | 否（仅 dev 通道打包） |
| `%APPDATA%\StarWish\sources` | 用户通过应用内导入的音源 | 否（运行时数据） |

- 开发通道（`BUILD_CHANNEL=dev`）：`scripts/copy-dev-sources.mjs` 把 `dev-sources/*.js` 复制到 `resources/sources/`，随包分发，便于自测。
- 发布通道（`BUILD_CHANNEL=release`）：`scripts/gate-zero-source.mjs` 门禁校验产物中无任何音源 JS，不通过即中断构建。

## 用户如何获取音源

应用内「设置 → 音源与插件 → 导入音源」支持：

- 在线链接（http/https）
- 本地 `.js` 文件

导入后复制到用户数据目录 `%APPDATA%\StarWish\sources`，与内置音源统一管理（启停、查看源码）。

## 自研音源

开发自己的音源见 [`docs/音源开发指南.md`](../../docs/音源开发指南.md)。开发调试时把脚本放到 `app/dev-sources/`，dev 通道构建即可内置。

## 目录优先级（运行时加载顺序）

1. 安装目录 `resources/sources`（release 通道为空目录）
2. 用户目录 `%APPDATA%\StarWish\sources`（用户导入）
3. 开发态 `app/dev-sources`（仅开发调试）

同名文件以先加载者为准；用户导入的新文件会自动获得唯一文件名，不会覆盖其他脚本。