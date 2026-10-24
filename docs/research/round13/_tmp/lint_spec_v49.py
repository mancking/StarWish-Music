# -*- coding: utf-8 -*-
"""规格书 v4.9 结构自检：标签配平 / 版本三处 / 新章节标记 / 行数统计"""
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
title_ok = "星河音乐 · 全端播放模块开发规格书 v4.9" in html
ver_ok = "FULL-SPEC · ALL PLATFORMS · v4.9" in html
footer_ok = "全端播放模块开发规格书 v4.9" in html and html.count("v4.9") == 3

# 新章节标记（第十三轮）
markers = [
    "0.8 内置音源治理专项（第十三轮",
    "0.8.1 风险分级与处置总表",
    "0.8.2 运行时隔离与失败隔离",
    "0.8.3 调试与监控",
    "0.8.4 设置链路与导入加固",
    "0.8.5 本期做 / 二期做 / 不做",
    "Bug 111~119 · C-18~C-23 · N20~N23 · F-17~F-20",
    "6.18 第十三轮调研",
    "内置音源治理验收（第十三轮",
    "Bug 111 第三方音源全量随包分发",
    "C-21 sql.js 整包进 asar",
    "F-20 主进程未压缩",
]
missing = [m for m in markers if m not in html]

print("== 行数 ==", line_count)
print("== 未闭合栈(应空) ==", "空" if not c.stack else c.stack[-5:], "| 栈深:", len(c.stack))
print("== 标签错误 ==", c.errors if c.errors else "无")
print("== 版本三处 v4.9 ==", {"title": title_ok, "ver": ver_ok, "footer": footer_ok, "v4.9出现次数": html.count("v4.9")})
print("== 缺失新标记 ==", missing if missing else "无")

# 旧版本残留
old = [x for x in ("v4.8", "v4.7") if x in html]
print("== 旧版本残留 ==", old if old else "无")

ok = (not c.errors) and (len(c.stack)==0) and title_ok and ver_ok and footer_ok and (not missing)
print("== 自检结论 ==", "PASS" if ok else "FAIL")
sys.exit(0 if ok else 1)
