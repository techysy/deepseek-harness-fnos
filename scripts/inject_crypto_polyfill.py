#!/usr/bin/env python3
"""注入 crypto.randomUUID polyfill 到 dsh index.html"""
import sys

target = sys.argv[1]
with open(target, "r", encoding="utf-8") as f:
    html = f.read()

if "crypto.randomUUID" in html:
    print("already injected")
    sys.exit(0)

polyfill = (
    "<script>"
    "(function(){"
    "if(!window.crypto){window.crypto={};}"
    "if(!crypto.randomUUID){"
    "var uu=function(){"
    "return'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g,function(ch){"
    "var r=Math.random()*16|0,v=ch==='x'?r:(r&0x3|0x8);return v.toString(16);});};"
    "crypto.randomUUID=uu;"
    "}"
    "})();"
    "</script>"
)

html = html.replace('<meta charset="utf-8" />', '<meta charset="utf-8" />\n    ' + polyfill)
with open(target, "w", encoding="utf-8") as f:
    f.write(html)
print("polyfill injected to", target)
