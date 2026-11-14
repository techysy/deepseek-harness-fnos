#!/usr/bin/env node
/**
 * verify-inline-js.js — 校验 dashboard.js 模板渲染出的内联 <script> 语法
 *
 * 背景 (issue #18): cmd/dashboard.js 的 HTML_TMPL 是 Node 模板字面量, 里面嵌着
 * 发给浏览器的大段内联 JS 与 i18n 字符串. 服务端文件自身可 node --check 通过,
 * 但模板字面量会消耗一层转义 — 服务端写 `\\"` 渲染到浏览器只剩裸 `"`,
 * 字符串被提前终结, 整个 <script> SyntaxError, 页面停在占位骨架.
 * 0.2.2-rc.2 的 applySkipMsg 英文文案曾踩中 (en 条目内嵌 "already installed").
 *
 * 用法: node scripts/verify-inline-js.js [dashboard.js 路径]
 * 退出码: 0 = 语法通过; 1 = 语法错误 (打印错误行)
 */
const fs = require("fs");
const vm = require("vm");

const file = process.argv[2] || require("path").join(__dirname, "..", "cmd", "dashboard.js");
const src = fs.readFileSync(file, "utf8");

const m = src.match(/const HTML_TMPL = `([\s\S]*?)`;\s*\n\/\/ 授权命令改为运行时/);
if (!m) { console.error("ERROR: HTML_TMPL 模板未找到 (" + file + ")"); process.exit(1); }

// 求值模板字面量: dashboard.js 顶层 const 对脚本无副作用 (HTML_TMPL 是纯字符串插值)
const html = eval("`" + m[1] + "`");

const scripts = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map(x => x[1]);
if (!scripts.length) { console.error("ERROR: 渲染产物中无 <script> 块"); process.exit(1); }

let failed = 0;
for (let i = 0; i < scripts.length; i++) {
  try {
    new vm.Script(scripts[i], { filename: "inline-script-" + (i + 1) + ".js" });
    console.log("OK  <script> #" + (i + 1) + " (" + scripts[i].length + " chars)");
  } catch (e) {
    failed++;
    console.error("FAIL <script> #" + (i + 1) + ": " + e.message.slice(0, 200));
    // 定位错误片段: 逐行单测找首炸行
    const lines = scripts[i].split("\n");
    for (let ln = 0; ln < lines.length; ln++) {
      try { new vm.Script(lines[ln]); } catch (le) {
        if (le.message.includes("Unexpected")) {
          console.error("     行 " + (ln + 1) + ": " + lines[ln].trim().slice(0, 180));
          break;
        }
      }
    }
  }
}
process.exit(failed ? 1 : 0);
