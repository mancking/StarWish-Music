#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
星河音乐主题分支 manifest v2 自动生成器
========================================

用途
----
用户只往主题分支 Star-Wish-Theme-Library 上传主题文件夹（或旧版单 JSON），
本脚本自动扫描并生成/更新 manifest.json，使客户端「个性主题 → 在线主题」
无需人工维护清单即可拉到全部主题。

分支目录结构（S1.8 口径）
------------------------
    Star-Wish-Theme-Library/
    ├── manifest.json                       # 本脚本生成（schemaVersion=2）
    ├── themes/
    │   ├── <theme-id>/                     # v2 文件夹形态
    │   │   ├── theme.json                  # schema v2 元数据 + colors 四色
    │   │   ├── preview.png                 # 卡片预览 480×300，≤200KB
    │   │   ├── thumb.jpg                   # 缩略图 240×150，≤80KB
    │   │   ├── bg.jpg                      # 可选 播放页背景图 ≤500KB
    │   │   ├── bg.gif                      # 可选 动态背景 ≤5MB
    │   │   └── iframe.html                 # 可选 动态主题入口 ≤500KB
    │   └── <theme-id>.json                 # v1 兼容：单文件纯色主题
    └── assets/                             # 共享资产（可选，不入清单）

manifest v2 格式
----------------
    {
      "schemaVersion": 2,
      "generatedAt": "2026-10-26T12:00:00Z",
      "name": "星河官方主题库",
      "description": "…",
      "themes": [
        {
          "kind": "theme",
          "id": "lavender-haze",
          "name": "薰衣草雾",
          "version": "2.0.0",
          "author": "星河主题工坊",
          "description": "…",
          "tags": ["紫", "护眼"],
          "type": "image",
          "minAppVersion": "0.11.0",
          "preview": "themes/lavender-haze/preview.png",
          "thumb": "themes/lavender-haze/thumb.jpg",
          "url": "https://raw.githubusercontent.com/…/themes/lavender-haze/theme.json",
          "hash": "<sha256 of theme.json>",
          "assets": {
            "bgImage": { "url": "…/bg.jpg",  "sha256": "…", "size": 184320 },
            "bgGif":   { "url": "…/bg.gif",  "sha256": "…", "size": 2097152 },
            "iframe":  { "url": "…/iframe.html", "sha256": "…", "size": 40960 }
          }
        }
      ]
    }

客户端口径（app/electron/core/market-host.ts listThemeMarket / installItem）
------------------------------------------------------------------------
- url 一律是 raw.githubusercontent 直链，文件名含中文时自动 URL 编码；
- hash 是 theme.json 的 sha256，安装时逐条校验；
- assets 每项带独立 sha256 + size，安装时逐资产拉取并逐个校验；
- 资产大小上限：bgImage ≤500KB / bgGif ≤5MB / iframe ≤500KB（超限则该资产不入清单）；
- preview ≤200KB / thumb ≤80KB（超限则该字段省略，前端回退渐变预览）；
- v1 单文件主题（themes/<id>.json）继续可用，url 指向该 json，hash 同样为 sha256。

用法
----
    python generate_theme_manifest.py <branch_dir> [manifest_path]

环境变量（可选）：
    OWNER_REPO    默认 mancking/StarWish-Music
    BRANCH        默认 Star-Wish-Theme-Library
    MANIFEST_PATH 默认 <branch_dir>/manifest.json

无第三方依赖，仅 Python 3 标准库。
"""

import hashlib
import json
import os
import re
import sys
from datetime import datetime, timezone
from urllib.parse import quote

DEFAULT_REPO = "mancking/StarWish-Music"
DEFAULT_BRANCH = "Star-Wish-Theme-Library"

# 资产大小上限（字节）—— 与客户端 theme-v2.ts 校验口径一致
MAX_BG_IMAGE = 500 * 1024
MAX_BG_GIF = 5 * 1024 * 1024
MAX_IFRAME = 500 * 1024
MAX_PREVIEW = 200 * 1024
MAX_THUMB = 80 * 1024
MAX_THEME_JSON = 256 * 1024

# 资产文件 → (assets 键, 大小上限)
ASSET_FILES = [
    ("bg.jpg", "bgImage", MAX_BG_IMAGE),
    ("bg.gif", "bgGif", MAX_BG_GIF),
    ("iframe.html", "iframe", MAX_IFRAME),
]

PREVIEW_FILE = "preview.png"
THUMB_FILE = "thumb.jpg"
THEME_JSON = "theme.json"

SEMVER_RE = re.compile(r"^\d+(\.\d+){0,2}([-+][0-9A-Za-z.-]+)?$")


def sha256_file(path):
    h = hashlib.sha256()
    with open(path, "rb") as f:
        for chunk in iter(lambda: f.read(65536), b""):
            h.update(chunk)
    return h.hexdigest()


def raw_url(repo, branch, rel_path):
    """raw.githubusercontent 直链；路径逐段 URL 编码（中文文件名安全）。"""
    quoted = "/".join(quote(seg, safe="") for seg in rel_path.split("/"))
    return "https://raw.githubusercontent.com/%s/%s/%s" % (repo, branch, quoted)


def read_json(path):
    try:
        with open(path, "r", encoding="utf-8") as f:
            return json.load(f)
    except (OSError, ValueError):
        return None


def norm_str(v, limit):
    s = str(v or "").strip()
    if not s:
        return None
    return s[:limit]


def norm_tags(v):
    if not isinstance(v, list):
        return []
    out = []
    for t in v:
        s = str(t or "").strip()[:12]
        if s and s not in out:
            out.append(s)
    return out[:5]


def build_folder_entry(theme_dir, rel_prefix, repo, branch, old_by_id):
    """themes/<id>/ 文件夹形态 → manifest v2 条目"""
    meta_path = os.path.join(theme_dir, THEME_JSON)
    if not os.path.isfile(meta_path):
        return None
    size = os.path.getsize(meta_path)
    if size > MAX_THEME_JSON:
        print("skip: %s theme.json 超过 %dKB" % (rel_prefix, MAX_THEME_JSON // 1024))
        return None
    meta = read_json(meta_path)
    if not isinstance(meta, dict):
        print("skip: %s theme.json 不是有效 JSON" % rel_prefix)
        return None

    tid = str(meta.get("id") or os.path.basename(theme_dir)).strip()[:40]
    old = old_by_id.get(tid) or {}
    name = norm_str(meta.get("name"), 50) or norm_str(old.get("name"), 50) or tid
    author = norm_str(meta.get("author"), 30) or norm_str(old.get("author"), 30) or "未知作者"
    version = norm_str(meta.get("version"), 16) or "1.0.0"
    if not SEMVER_RE.match(version):
        version = "1.0.0"
    desc = norm_str(meta.get("description"), 200) or norm_str(old.get("description"), 200)
    tags = norm_tags(meta.get("tags")) or norm_tags(old.get("tags"))
    ttype = str(meta.get("type") or "").strip()
    if ttype not in ("color", "image", "gif", "iframe"):
        ttype = "image" if any(
            os.path.isfile(os.path.join(theme_dir, fn))
            for fn, _k, _l in ASSET_FILES
        ) else "color"
    min_app = norm_str(meta.get("minAppVersion"), 16)

    entry = {
        "kind": "theme",
        "id": tid,
        "name": name,
        "version": version,
        "author": author,
        "type": ttype,
        "url": raw_url(repo, branch, "%s/%s" % (rel_prefix, THEME_JSON)),
        "hash": sha256_file(meta_path),
    }
    if desc:
        entry["description"] = desc
    if tags:
        entry["tags"] = tags
    if min_app:
        entry["minAppVersion"] = min_app

    # 预览图 / 缩略图（相对路径，客户端按 manifest base 补全）
    for fname, key, limit in ((PREVIEW_FILE, "preview", MAX_PREVIEW), (THUMB_FILE, "thumb", MAX_THUMB)):
        fp = os.path.join(theme_dir, fname)
        if os.path.isfile(fp) and os.path.getsize(fp) <= limit:
            entry[key] = "%s/%s" % (rel_prefix, fname)

    # 资产清单（逐个 sha256 + size）
    assets = {}
    for fname, key, limit in ASSET_FILES:
        fp = os.path.join(theme_dir, fname)
        if not os.path.isfile(fp):
            continue
        fsize = os.path.getsize(fp)
        if fsize > limit:
            print("skip asset: %s/%s 超过 %dKB" % (rel_prefix, fname, limit // 1024))
            continue
        assets[key] = {
            "url": raw_url(repo, branch, "%s/%s" % (rel_prefix, fname)),
            "sha256": sha256_file(fp),
            "size": fsize,
        }
    if assets:
        entry["assets"] = assets
    return entry


def build_legacy_entry(json_path, rel_path, repo, branch, old_by_id):
    """themes/<id>.json 单文件形态 → v1 兼容条目"""
    size = os.path.getsize(json_path)
    if size > MAX_THEME_JSON:
        print("skip: %s 超过 %dKB" % (rel_path, MAX_THEME_JSON // 1024))
        return None
    meta = read_json(json_path)
    if not isinstance(meta, dict):
        return None
    tid = str(meta.get("id") or os.path.splitext(os.path.basename(rel_path))[0]).strip()[:40]
    old = old_by_id.get(tid) or {}
    name = norm_str(meta.get("name"), 50) or norm_str(old.get("name"), 50) or tid
    entry = {
        "kind": "theme",
        "id": tid,
        "name": name,
        "version": norm_str(meta.get("version"), 16) or "1.0.0",
        "author": norm_str(meta.get("author"), 30) or "未知作者",
        "type": "color",
        "url": raw_url(repo, branch, rel_path),
        "hash": sha256_file(json_path),
    }
    desc = norm_str(meta.get("description"), 200)
    if desc:
        entry["description"] = desc
    tags = norm_tags(meta.get("tags"))
    if tags:
        entry["tags"] = tags
    return entry


def read_old_manifest(manifest_path):
    """读取旧 manifest，返回 (顶层字段, {id: entry})。"""
    top = {}
    by_id = {}
    raw = read_json(manifest_path)
    if isinstance(raw, dict):
        top = {k: v for k, v in raw.items() if k != "themes"}
        arr = raw.get("themes")
    elif isinstance(raw, list):
        arr = raw
    else:
        arr = []
    if not isinstance(arr, list):
        arr = []
    for it in arr:
        if isinstance(it, dict) and it.get("id"):
            by_id[str(it["id"])] = it
    return top, by_id


def main():
    branch_dir = sys.argv[1] if len(sys.argv) > 1 else "."
    manifest_path = (
        os.environ.get("MANIFEST_PATH", "") or os.path.join(branch_dir, "manifest.json")
    )
    if not os.path.isdir(branch_dir):
        print("error: branch_dir 不存在: %s" % branch_dir)
        return 2

    repo = os.environ.get("OWNER_REPO", DEFAULT_REPO)
    branch = os.environ.get("BRANCH", DEFAULT_BRANCH)

    old_top, old_by_id = read_old_manifest(manifest_path)

    themes_dir = os.path.join(branch_dir, "themes")
    entries = []
    if os.path.isdir(themes_dir):
        # 文件夹形态（v2）优先
        for name in sorted(os.listdir(themes_dir)):
            d = os.path.join(themes_dir, name)
            if not os.path.isdir(d):
                continue
            e = build_folder_entry(d, "themes/%s" % name, repo, branch, old_by_id)
            if e:
                entries.append(e)
        # 单文件形态（v1 兼容）
        for name in sorted(os.listdir(themes_dir)):
            fp = os.path.join(themes_dir, name)
            if not os.path.isfile(fp) or not name.endswith(".json"):
                continue
            e = build_legacy_entry(fp, "themes/%s" % name, repo, branch, old_by_id)
            if e:
                entries.append(e)

    # 同 id 去重：文件夹形态优先（先收集），后出现的同名条目丢弃
    seen = set()
    themes = []
    for e in entries:
        if e["id"] in seen:
            continue
        seen.add(e["id"])
        themes.append(e)
    themes.sort(key=lambda e: e["id"])

    def norm(items):
        return json.dumps(items, ensure_ascii=False, sort_keys=True)

    same = norm(old_top.get("themes") or []) == norm(themes)
    if same:
        print("no change: manifest 内容与上次一致，跳过写入")
        return 0

    manifest = dict(old_top)
    manifest["schemaVersion"] = 2
    manifest["name"] = old_top.get("name") or "星河官方主题库"
    manifest["description"] = (
        old_top.get("description")
        or "星河音乐官方主题库，提供 v2 文件夹主题（图片/动图/iframe 背景）与 v1 纯色主题。"
    )
    manifest["generatedAt"] = datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
    manifest["themes"] = themes

    new_text = json.dumps(manifest, ensure_ascii=False, indent=2) + "\n"
    try:
        with open(manifest_path, "r", encoding="utf-8") as f:
            old_text = f.read()
    except OSError:
        old_text = ""
    if old_text == new_text:
        print("no change: manifest 内容与上次一致，跳过写入")
        return 0

    with open(manifest_path, "w", encoding="utf-8") as f:
        f.write(new_text)
    print("written: %s 条主题 -> %s" % (len(themes), manifest_path))
    return 0


if __name__ == "__main__":
    sys.exit(main())
