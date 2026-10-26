#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
星河音乐插件分支 manifest 自动生成器
======================================

用途
----
用户只往插件分支上传/更新 *.js 音源与插件文件，本脚本自动扫描分支目录，
生成/更新 manifest.json，使客户端插件市场无需人工维护清单即可拉到全部内容。

对齐客户端口径（app/electron/core/market-host.ts 的 inferKind / refreshMarketList）：
- kind 推断：内容含 musicSearch -> lx-source；含 videoSearch -> video-source；否则 musicfree-plugin
- 顶层格式：{"name": ..., "description": ..., "updated": ..., "plugins": [...]}
- url 使用 raw.githubusercontent 直链，中文/特殊字符文件名自动 URL 编码
- hash 为文件内容 sha256（客户端安装时逐条校验，必须与下载内容一致）

去重策略
--------
相同 sha256 的文件只保留一条：优先保留旧 manifest 已登记的文件名，
否则保留字典序在前者（ASCII 文件名天然靠前，如 molan-unified.js 优先于 墨澜音乐源v2.3.4.js）。

用法
----
    python generate_manifest.py <branch_dir> [manifest_path]

环境变量（可选）：
    OWNER_REPO   默认 mancking/StarWish-Music
    BRANCH       默认 Star-Wish-Plugin-Library
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
DEFAULT_BRANCH = "Star-Wish-Plugin-Library"
HEAD_BYTES = 8192  # 元信息只从文件头部提取（模块头通常在前 8KB）

# 头部字段提取：lookbehind 防止误抓 minAppVersion / appVersion 等尾缀
FIELD_RES = {
    "version": re.compile(r"(?<![A-Za-z])version\s*[:=]\s*[\"']?([^\"',`\s;}]+)", re.I),
    "author": re.compile(r"(?<![A-Za-z])(?:author|开发者|作者)\s*[:=]\s*[\"']?([^\"',`\s;}]+)", re.I),
    "platform": re.compile(r"(?<![A-Za-z])platform\s*[:=]\s*[\"']?([^\"',`\s;}]+)", re.I),
    "name": re.compile(r"(?<![A-Za-z])name\s*[:=]\s*[\"']?([^\"',`\s;}]+)", re.I),
}


def read_head(path: str) -> str:
    """读取文件头部文本，解码失败时替换非法字节，不中断扫描。"""
    try:
        with open(path, "rb") as f:
            data = f.read(HEAD_BYTES)
        return data.decode("utf-8", errors="replace")
    except OSError:
        return ""


def extract(field: str, head: str):
    m = FIELD_RES[field].search(head)
    if not m:
        return None
    val = m.group(1).strip()
    return val if val else None


def infer_kind(head: str) -> str:
    """与 market-host.ts inferKind 一致：musicSearch 优先，其次 videoSearch。"""
    if re.search(r"musicSearch", head):
        return "lx-source"
    if re.search(r"videoSearch", head):
        return "video-source"
    return "musicfree-plugin"


def file_sha256(path: str) -> str:
    with open(path, "rb") as f:
        return hashlib.sha256(f.read()).hexdigest()


def read_old_manifest(manifest_path: str):
    """读取旧 manifest，返回 (顶层字段, {file: entry}, [plugins])。"""
    top = {}
    by_file = {}
    arr = []
    try:
        with open(manifest_path, "r", encoding="utf-8") as f:
            raw = json.load(f)
    except (OSError, ValueError):
        return top, by_file, arr
    if isinstance(raw, dict):
        top = {k: v for k, v in raw.items() if k != "plugins"}
        arr = raw.get("plugins")
    elif isinstance(raw, list):
        arr = raw
    if not isinstance(arr, list):
        arr = []
    for it in arr:
        if isinstance(it, dict):
            fname = it.get("file") or ""
            if fname:
                by_file[fname] = it
    return top, by_file, arr


def build_entry(fname: str, fpath: str, old: dict) -> dict:
    head = read_head(fpath)
    prev = old.get(fname) or {}
    # name：旧清单优先 -> 头部 name -> 文件名（去 .js）
    name = str(prev.get("name") or "") or extract("name", head) or fname[:-3] if fname.endswith(".js") else fname
    version = str(prev.get("version") or "") or extract("version", head)
    author = str(prev.get("author") or "") or extract("author", head)
    platform = str(prev.get("platform") or "") or extract("platform", head)
    entry = {
        "name": name,
        "file": fname,
    }
    if version:
        entry["version"] = version
    if author:
        entry["author"] = author
    if platform:
        entry["platform"] = platform
    desc = str(prev.get("description") or "")
    if desc:
        entry["description"] = desc
    types = prev.get("types")
    if isinstance(types, list) and types:
        entry["types"] = types
    kind = prev.get("kind")
    if not kind:
        kind = infer_kind(head)
    entry["kind"] = kind
    entry["hash"] = file_sha256(fpath)
    entry["size"] = os.path.getsize(fpath)
    repo = os.environ.get("OWNER_REPO", DEFAULT_REPO)
    branch = os.environ.get("BRANCH", DEFAULT_BRANCH)
    entry["url"] = "https://raw.githubusercontent.com/%s/%s/%s" % (repo, branch, quote(fname))
    return entry


def dedupe_by_hash(branch_dir, files, old):
    """同 sha256 只保留一条：优先旧清单已登记的文件名。"""
    keep = {}  # hash -> fname
    hashes = {}
    for fname in files:
        hashes[fname] = file_sha256(os.path.join(branch_dir, fname))
    for fname in files:
        h = hashes[fname]
        if h not in keep:
            keep[h] = fname
        elif old.get(fname) and not old.get(keep[h]):
            keep[h] = fname
    return list(keep.values())


def main():
    branch_dir = sys.argv[1] if len(sys.argv) > 1 else "."
    manifest_path = os.environ.get("MANIFEST_PATH", "") or os.path.join(branch_dir, "manifest.json")
    if not os.path.isdir(branch_dir):
        print("error: branch_dir 不存在: %s" % branch_dir)
        return 2

    old_top, old_by_file, old_plugins = read_old_manifest(manifest_path)
    raw_files = sorted(
        f for f in os.listdir(branch_dir)
        if f.endswith(".js") and os.path.isfile(os.path.join(branch_dir, f))
    )
    files = sorted(dedupe_by_hash(branch_dir, raw_files, old_by_file))

    plugins = [build_entry(f, os.path.join(branch_dir, f), old_by_file) for f in files]
    plugins.sort(key=lambda e: e["file"])

    # 内容比较（忽略 updated 时间戳），避免无变化时仍触发提交
    def norm(items):
        return json.dumps(items, ensure_ascii=False, sort_keys=True)

    same_plugins = norm(old_plugins) == norm(plugins)
    # 顶层字段除 updated 外逐项比较
    def top_changed(old_top, new_top):
        for k in set(old_top) | {"name", "description"}:
            if k == "updated":
                continue
            if norm(old_top.get(k)) != norm(new_top.get(k)):
                return True
        return False

    manifest = dict(old_top)
    if same_plugins and not top_changed(old_top, manifest):
        print("no change: manifest 内容与上次一致，跳过写入")
        return 0

    manifest["updated"] = datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
    if "name" not in manifest:
        manifest["name"] = "星河官方插件库"
    if "description" not in manifest:
        manifest["description"] = "星河音乐官方插件市场，提供可在线安装/更新的音源与歌词插件。"
    manifest["plugins"] = plugins

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
    print("written: %s 条插件 -> %s" % (len(plugins), manifest_path))
    print("changed files: %s -> %s" % (len(old_by_file), len(plugins)))
    return 0


if __name__ == "__main__":
    sys.exit(main())
