# -*- coding: utf-8 -*-
"""规格书 v4.8 结构自检：标签配平 / 版本三处 / 新章节标记 / 行数统计"""
import io, sys
from html.parser import HTMLParser

PATH = r"D:\music\docs\星河音乐-全端播放模块开发规格书.html"
VOID = {"meta","link","br","img","input","hr"}

class Checker(HTMLParser):
    def __init__(self):
        super().__init__()
        self.stack = []
        self.errors = []
        self.counts = {}
        self.title = None
        self.ver = None
        self.footer = None
    def handle_starttag(self, tag, attrs):
        if tag in VOID: return
        if tag in ("details","table","section","div","ol","ul","script","style"):
            self.counts[tag] = self.counts.get(tag,0)+1
        self.stack.append(tag)
    def handle_endtag(self, tag):
        if tag in VOID: return
        if not self.stack:
            self.errors.append(f"多余闭合 </{tag}>")
            return
        # 找匹配的最近同名开标签
        if tag == self.stack[-1]:
            self.stack.pop()
        else:
            # 允许 html/body 隐式（parser 有时不推入）——按常规处理
            try:
                idx = len(self.stack)-1 - self.stack[::-1].index(tag)
            except ValueError:
                self.errors.append(f"无配对闭合 </{tag}>，栈顶={self.stack[-1] if self.stack else '空'}")
                return
            # 中间的未闭合视为错误
            mid = self.stack[idx+1:]
            self.errors.append(f"</{tag}> 关闭前有未闭合: {mid}")
            del self.stack[idx:]
    def handle_data(self, data):
        pass

c = Checker()
with io.open(PATH, "r", encoding="utf-8") as f:
    html = f.read()
c.feed(html)

line_count = html.count("\n") + 1
problems = []
for t in ("details","table","section","div","ol"):
    problems.append((t, c.counts.get(t,0)))

# 版本三处
title_ok = "星河音乐 · 全端播放模块开发规格书 v4.8" in html
ver_ok = "FULL-SPEC · ALL PLATFORMS · v4.8" in html
footer_ok = "全端播放模块开发规格书 v4.8" in html and html.count("v4.8") == 3

# 新章节标记
markers = [
    "2.17 MV 音源协议扩展（特色 · 音源获取 MV）",
    "2.18 播放页 MV 按钮（特色）",
    "2.19 MV 与视频统一播放器规格（特色）",
    "3.10 视频 / MV 聚合页（B站视频 + 多音源 MV · 特色）",
    "6.17 第十二轮调研",
    "Bug 109~110 · C-16/C-17 · N18/N19 · F-14~F-16",
    "视频 + MV 聚合特色验收（第十二轮）",
    "mv_{source}_{id}_{quality}",
    "xinyuan_resume_mv_",
    "mvSearch/mvUrl",
]
missing = [m for m in markers if m not in html]

print("== 行数 ==", line_count)
print("== 标签计数(开) ==", problems)
print("== 未闭合栈(应空) ==", c.stack[-5:] if c.stack else "空", "| 栈深:", len(c.stack))
print("== 标签错误 ==", c.errors if c.errors else "无")
print("== 版本三处 v4.8 ==", {"title": title_ok, "ver": ver_ok, "footer": footer_ok, "v4.8出现次数": html.count("v4.8")})
print("== 缺失新标记 ==", missing if missing else "无")

# 旧版本残留检查
old = [x for x in ("v4.7", "视频 / MV 页</summary>") if x in html]
print("== v4.7/旧标题残留 ==", old if old else "无")

ok = (not c.errors) and (len(c.stack)==0) and title_ok and ver_ok and footer_ok and (not missing)
print("== 自检结论 ==", "PASS" if ok else "FAIL")
sys.exit(0 if ok else 1)
