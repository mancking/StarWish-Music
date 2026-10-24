# -*- coding: utf-8 -*-
"""规格书 v4.10 结构自检：标签配平 / 版本三处 / 新章节标记 / 行数统计"""
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
title_ok = "星河音乐 · 全端播放模块开发规格书 v4.10" in html
ver_ok = "FULL-SPEC · ALL PLATFORMS · v4.10" in html
footer_ok = "全端播放模块开发规格书 v4.10" in html and html.count("v4.10") == 3

# 新章节标记（第十四轮）
markers = [
    "0.9 外部源体系（第十四轮",
    "0.9.1 框架与源边界",
    "0.9.2 导入规范与持久化",
    "0.9.3 首次启动体验（量化）",
    "0.9.4 实时更新机制",
    "0.9.5 多源冗余与降级",
    "0.9.6 视频/MV 源外部化",
    "0.9.7 本期做 / 二期做 / 不做",
    "Bug 120~123 · C-24/25 · N24~N27 · F-21~F-26",
    "6.19 第十四轮调研",
    "外部源体系验收（第十四轮",
    "Bug 120 插件运行时死链",
    "C-24 MV/视频链路绕过音源抽象",
    "F-26 移除订阅不卸载插件",
    "外部视频源</th><td>源 Tab 支持外部视频源插件",
]
missing = [m for m in markers if m not in html]

print("== 行数 ==", line_count)
print("== 未闭合栈(应空) ==", "空" if not c.stack else c.stack[-5:], "| 栈深:", len(c.stack))
print("== 标签错误 ==", c.errors if c.errors else "无")
print("== 版本三处 v4.10 ==", {"title": title_ok, "ver": ver_ok, "footer": footer_ok, "v4.10出现次数": html.count("v4.10")})
print("== 缺失新标记 ==", missing if missing else "无")

# 旧版本残留（v4.9 应为 0 处）
old = [x for x in ("v4.9", "v4.8", "v4.7") if x in html]
print("== 旧版本残留 ==", old if old else "无")

ok = (not c.errors) and (len(c.stack)==0) and title_ok and ver_ok and footer_ok and (not missing)
print("== 自检结论 ==", "PASS" if ok else "FAIL")
sys.exit(0 if ok else 1)
