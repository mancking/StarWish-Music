# -*- coding: utf-8 -*-
"""规格书 v4.11 结构自检：标签配平 / 版本三处 / 新章节标记 / 行数统计"""
import io, sys
from html.parser import HTMLParser

PATH = r"D:\music\docs\星河音乐-全端播放模块开发规格书.html"
VOID = {"meta","link","br","img","input","hr"}

class Checker(HTMLParser):
    def __init__(self):
        super().__init__()
        self.stack = []
        self.errors = []
    def handle_starttag(self, tag, attrs):
        if tag in VOID: return
        self.stack.append(tag)
    def handle_endtag(self, tag):
        if tag in VOID: return
        if not self.stack:
            self.errors.append(f"多余闭合 </{tag}>")
            return
        if tag == self.stack[-1]:
            self.stack.pop()
        else:
            try:
                idx = len(self.stack)-1 - self.stack[::-1].index(tag)
            except ValueError:
                self.errors.append(f"无配对闭合 </{tag}>，栈顶={self.stack[-1] if self.stack else '空'}")
                return
            mid = self.stack[idx+1:]
            self.errors.append(f"</{tag}> 关闭前有未闭合: {mid}")
            del self.stack[idx:]

c = Checker()
with io.open(PATH, "r", encoding="utf-8") as f:
    html = f.read()
c.feed(html)

line_count = html.count("\n") + 1

# 版本三处
title_ok = "星河音乐 · 全端播放模块开发规格书 v4.11" in html
ver_ok = "FULL-SPEC · ALL PLATFORMS · v4.11" in html
footer_ok = "全端播放模块开发规格书 v4.11" in html and html.count("v4.11") == 3

# 新章节标记（第十五轮）
markers = [
    "0.10 统一源市场（第十五轮",
    "0.10.1 市场形态与 git 分支分发通道",
    "0.10.2 统一数据模型（MarketEntry v2）",
    "0.10.3 市场 UI（桌面 + 移动端对等）",
    "0.10.4 通道矩阵（三类源 × 五通道全打通）",
    "0.10.5 宿主适配层（market:* 门面）",
    "0.10.6 原子性与缓存",
    "0.10.7 合规与默认市场地址",
    "0.10.8 一次开发完成清单（全部必做，无二期）",
    "Bug 124~127 · C-26~28 · N28~N31 · F-27~F-32",
    "6.20 第十五轮调研",
    "统一源市场验收（第十五轮",
    "Bug 124 安装/卸载非原子",
    "C-28 git 分支托管无版本/回滚/鉴权协议",
    "F-32 本地无内容缓存",
    "Star-Wish-Plugin-Library",
    "market:list / market:search / market:install",
]
missing = [m for m in markers if m not in html]

print("== 行数 ==", line_count)
print("== 未闭合栈(应空) ==", "空" if not c.stack else c.stack[-5:], "| 栈深:", len(c.stack))
print("== 标签错误 ==", c.errors if c.errors else "无")
print("== 版本三处 v4.11 ==", {"title": title_ok, "ver": ver_ok, "footer": footer_ok, "v4.11出现次数": html.count("v4.11")})
print("== 缺失新标记 ==", missing if missing else "无")

# 旧版本残留
old = [x for x in ("v4.10", "v4.9", "v4.8", "v4.7") if x in html]
print("== 旧版本残留 ==", old if old else "无")

ok = (not c.errors) and (len(c.stack)==0) and title_ok and ver_ok and footer_ok and (not missing)
print("== 自检结论 ==", "PASS" if ok else "FAIL")
sys.exit(0 if ok else 1)
