# StarWish-Music 主题库（Star-Wish-Theme-Library 分支）

星河音乐（StarWish-Music）在线主题市场独立分支。客户端「设置 → 外观与主题 → 主题市场」从此分支的 `manifest.json` 拉取主题清单并一键安装。

## 目录结构

```
Star-Wish-Theme-Library/
├── manifest.json        # 市场清单（kind=theme 条目，含 sha256）
└── themes/
    └── <id>.json        # 主题包本体（JSON ≤256KB，字段白名单）
```

> 本分支同时保留主仓库代码快照（初始化时从 main 复制）。客户端仅消费 `manifest.json` 与 `themes/`，其余文件不影响主题市场。

## 主题包格式

字段白名单（其余字段客户端会丢弃）：

| 字段 | 约束 | 说明 |
|---|---|---|
| `id` | ASCII 短 ID，与文件名一致 | 主题唯一标识 |
| `name` | 必填，≤40 字符 | 主题名 |
| `author` | ≤40 字符 | 作者 |
| `version` | ≤16 字符 | 版本号 |
| `colors.primary` | `#rrggbb`，与 accent 至少其一 | 主色 |
| `colors.accent` | `#rrggbb` | 强调色（注入全局 --accent） |
| `colors.bg` | `#rrggbb` | 背景色 |
| `colors.text` | `#rrggbb` | 文字色 |
| `playerBg` | cover / lyric-wall / particle / spectrum / gradient / wallpaper / solid | 播放页背景模式 |
| `fontScale` | 0.85 ~ 1.3 | 字体缩放 |
| `borderRadius` | 0 ~ 20 | 全局圆角 |

示例：

```json
{
  "id": "lavender-haze",
  "name": "薰衣草雾",
  "author": "星河主题工坊",
  "version": "1.0.0",
  "colors": { "primary": "#8b7cf6", "accent": "#c4b5fd", "bg": "#14101f", "text": "#ece8fa" },
  "playerBg": "gradient",
  "fontScale": 1.0,
  "borderRadius": 12
}
```

## 市场清单条目

`manifest.json` 为数组，每条：

```json
{
  "kind": "theme",
  "id": "lavender-haze",
  "name": "薰衣草雾",
  "version": "1.0.0",
  "author": "星河主题工坊",
  "description": "柔和薰衣草紫渐变，低刺激护眼，适合长时间沉浸听歌",
  "url": "https://raw.githubusercontent.com/mancking/StarWish-Music/Star-Wish-Theme-Library/themes/lavender-haze.json",
  "hash": "<文件 sha256>"
}
```

`hash` 必须与 `themes/<id>.json` 文件内容的 sha256 完全一致（客户端安装时校验，不一致拒绝安装）。文件编码为 UTF-8 无 BOM、LF 行尾。

## 现有主题（32 套，2026-10-25）

- 色系系列：薰衣草雾、珊瑚粉、海盐蓝、薄荷青、翡翠绿、琥珀橙、落日红、柠檬黄、雾霾灰、暖棕可可、深空藏蓝、莓果紫红
- 材质氛围：黑金奢华、极简纯白、玻璃拟态、赛博霓虹、蒸汽波、极光幻彩、星云紫、熔岩赤、冰川蓝、沙漠驼色、森林幽绿、深渊海洋
- 场景文化：和风樱、中式朱砂、北欧极简、波普撞色、复古磁带、金属摇滚、糖果派对、像素游戏

## 投稿新主题

1. 参照 `themes/` 下现有文件新建 `<id>.json`（字段必须全部在白名单内，hex 带 `#`）；
2. 校验：客户端「设置 → 外观与主题 → 导入 JSON」实测，或运行仓库构建脚本 `build_themes.py` / `verify_themes.py`；
3. 计算 sha256 并追加 `manifest.json` 条目；
4. 提交推送至本分支。
