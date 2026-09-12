#!/usr/bin/env node
/**
 * dashboard.js — dsh 独立管理面板 (端口 28001)
 * ---------------------------------------------------------------
 * 零依赖单文件, 由 cmd/main 启动 (也可手动 node dashboard.js).
 * 功能: 服务状态 / dsh 日志查看 / 插件管理 (bundles 禁用启用删除) /
 *       版本检查 (上游 dsh + 本项目 Release) / 重启 dsh.
 * 安全: Host/Origin 信任围栏 (与 dsh 一致: 回环 + 本机 IP + fnos.net
 *       + trusted_hosts.conf), 围栏外一律 403. 勿暴露到不受信网络.
 */
"use strict";
const http = require("http");
const https = require("https");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { execFile, execSync, spawn } = require("child_process");

// ---- 配置: 环境变量优先, 否则自动探测 ----
function detectDataDir() {
  if (process.env.DATA_DIR && fs.existsSync(process.env.DATA_DIR)) return process.env.DATA_DIR;
  for (const v of fs.readdirSync("/").filter(d => /^vol\d+$/.test(d))) {
    const cand = path.join("/", v, "@appdata/dsh");
    if (fs.existsSync(path.join(cand, "dsh_home"))) return cand;
  }
  return null;
}
const DATA_DIR = detectDataDir();
const DSH_HOME = process.env.DSH_HOME || (DATA_DIR ? path.join(DATA_DIR, "dsh_home") : null);
const APP_DIR = process.env.APP_DIR || "/var/apps/dsh";
const DSH_PORT = process.env.DSH_PORT || "28000";
const DASH_PORT = process.env.DASH_PORT || "28001";
const CMD_MAIN = process.env.CMD_MAIN || path.join(APP_DIR, "cmd", "main");
const MANIFEST = process.env.MANIFEST || path.join(APP_DIR, "manifest");
const PROFILE = () => path.join(DSH_HOME, "profiles", "web");
const PKG_JSON = () => path.join(PROFILE(), "package.json");
const NODE_BIN = process.env.NODE_BIN || path.join("/var/apps/nodejs_v24/target/bin", "node");

// ---- 信任围栏: 与 dsh/cmd/main 同一信任面 ----
function localIps() {
  const out = new Set(["127.0.0.1", "::1", "localhost"]);
  for (const ifs of Object.values(os.networkInterfaces()).flat())
    if (ifs && ifs.address) out.add(ifs.address);
  return out;
}
function trustedHosts() {
  const out = new Set(["fnos.net"]);
  try {
    const f = path.join(DSH_HOME, "trusted_hosts.conf");
    if (fs.existsSync(f))
      for (const line of fs.readFileSync(f, "utf8").split("\n")) {
        let h = line.replace(/^https?:\/\//, "").replace(/\/$/, "").trim();
        if (h && !h.startsWith("#")) out.add(h);
      }
  } catch {}
  return out;
}
function hostAllowed(host) {
  if (!host) return false;
  const h = host.split(":")[0].toLowerCase();
  if (localIps().has(h)) return true;
  if (h === "fnos.net" || h.endsWith(".fnos.net")) return true;
  for (const t of trustedHosts()) {
    if (h === t || h.endsWith("." + t)) return true;
  }
  return false;
}

// ---- 工具 ----
function sh(cmd, args, opts = {}) {
  try { return execFileSync_sh(cmd, args, opts); } catch (e) { return (e.stdout || "") + (e.stderr || String(e.message || "")); }
}
function execFileSync_sh(cmd, args, opts) {
  const { spawnSync } = require("child_process");
  const r = spawnSync(cmd, args, { encoding: "utf8", timeout: opts.timeout || 10000, ...opts });
  if (r.error) throw r.error;
  return (r.stdout || "") + (r.stderr || "");
}
function tail(file, lines = 200) {
  try {
    const st = fs.statSync(file);
    const size = Math.min(st.size, 512 * 1024);
    const fd = fs.openSync(file, "r");
    const buf = Buffer.alloc(size);
    fs.readSync(fd, buf, 0, size, st.size - size);
    fs.closeSync(fd);
    const all = buf.toString("utf8").split("\n").filter(Boolean);
    return all.slice(-lines).join("\n");
  } catch (e) { return "(日志不存在: " + file + ")"; }
}
function manifestField(k) {
  try {
    const m = fs.readFileSync(MANIFEST, "utf8");
    const l = m.split("\n").find(l => l.startsWith(k));
    return l ? l.split("=").slice(1).join("=").trim() : "";
  } catch { return ""; }
}
function pidAlive(pid) {
  try { process.kill(Number(pid), 0); return true; } catch { return false; }
}
function httpGet(url, timeout = 6000) {
  return new Promise(resolve => {
    try {
      const mod = url.startsWith("https:") ? https : http;
      const req = mod.get(url, { timeout, headers: { "User-Agent": "dsh-dashboard" } }, res => {
        let d = ""; res.on("data", c => (d += c)); res.on("end", () => resolve({ ok: true, status: res.statusCode, body: d }));
      });
      req.on("timeout", () => { req.destroy(); resolve({ ok: false }); });
      req.on("error", () => resolve({ ok: false }));
    } catch { resolve({ ok: false }); }
  });
}

// ---- API handlers ----
async function apiStatus() {
  const pid = (() => { try { return fs.readFileSync(path.join(DATA_DIR, "dsh.pid"), "utf8").trim(); } catch { return ""; } })();
  const running = pid && pidAlive(pid);
  let uptime = "";
  if (running) { try { uptime = execSync(`ps -o etime= -p ${Number(pid)}`).toString().trim(); } catch {} }
  const h = await httpGet(`http://127.0.0.1:${DSH_PORT}/`, 3000);
  const proxyPid = (() => { try { return fs.readFileSync(path.join(DATA_DIR, "proxy.pid"), "utf8").trim(); } catch { return ""; } })();
  return {
    fpkVersion: manifestField("version"),
    dshPkgVersion: (() => {
      const cands = [
        path.join(APP_DIR, "server/node_modules/@deepseek-ai/dsh/package.json"),
        path.join(APP_DIR, "target/server/node_modules/@deepseek-ai/dsh/package.json"),
      ];
      try { for (const v of fs.readdirSync("/")) { if (/^vol\d+$/.test(v)) cands.push(path.join("/", v, "@appcenter/dsh/server/node_modules/@deepseek-ai/dsh/package.json")); } } catch {}
      for (const c of cands) { try { return JSON.parse(fs.readFileSync(c, "utf8")).version; } catch {} }
      return "?";
    })(),
    dsh: { pid, running: !!running, uptime, health: h.ok && h.status === 200 ? "OK" : "不可达", port: DSH_PORT },
    proxy: { running: !!(proxyPid && pidAlive(proxyPid)) },
    dashboard: process.pid,
    dataDir: DATA_DIR,
    dshHome: DSH_HOME,
  };
}
async function apiVersion() {
  const st = await apiStatus();
  const out = { fpk: st.fpkVersion, dshInstalled: st.dshPkgVersion, upstreamDsh: null, projectRelease: null };
  for (const reg of ["https://registry.npmmirror.com/@deepseek-ai/dsh", "https://registry.npmjs.org/@deepseek-ai/dsh"]) {
    const r = await httpGet(reg + "/latest", 6000);
    if (r.ok) { try { out.upstreamDsh = JSON.parse(r.body).version; break; } catch {} }
  }
  const g = await httpGet("https://gitee.com/api/v5/repos/techysy/deepseek-harness-fnos/releases/latest", 6000);
  if (g.ok) { try { const d = JSON.parse(g.body); out.projectRelease = { tag: d.tag_name, name: d.name, url: d.html_url }; } catch {} }
  if (!out.projectRelease) {
    const h = await httpGet("https://api.github.com/repos/techysy/deepseek-harness-fnos/releases/latest", 6000);
    if (h.ok) { try { const d = JSON.parse(h.body); out.projectRelease = { tag: d.tag_name, name: d.name, url: d.html_url }; } catch {} }
  }
  return out;
}
function apiPlugins() {
  const pkg = JSON.parse(fs.readFileSync(PKG_JSON(), "utf8"));
  const bundles = (pkg.dsh && pkg.dsh.profile && pkg.dsh.profile.bundles) || [];
  const deps = pkg.dependencies || {};
  const CORE = /^@deepseek-ai\//;
  return {
    profile: "web",
    packageJsonPath: PKG_JSON(),
    plugins: Object.entries(deps)
      .filter(([n]) => !CORE.test(n))
      .map(([name, ver]) => ({
        name, version: ver,
        enabled: bundles.includes(name),
      })),
    coreBundles: bundles.filter(n => CORE.test(n)),
    userBundles: bundles.filter(n => !CORE.test(n)),
  };
}
function savePlugins(mut) {
  const p = PKG_JSON();
  const pkg = JSON.parse(fs.readFileSync(p, "utf8"));
  pkg.dsh = pkg.dsh || {}; pkg.dsh.profile = pkg.dsh.profile || {};
  pkg.dsh.profile.bundles = mut(pkg.dsh.profile.bundles || [], pkg) || pkg.dsh.profile.bundles;
  fs.writeFileSync(p, JSON.stringify(pkg, null, 2) + "\n");
}
function readBody(req) {
  return new Promise(res => { let d = ""; req.on("data", c => (d += c)); req.on("end", () => { try { res(JSON.parse(d || "{}")); } catch { res({}); } }); });
}
function restartDsh() {
  const log = fs.openSync(path.join(DATA_DIR, "dashboard.log"), "a");
  const child = spawn("bash", [CMD_MAIN, "restart"], { detached: true, stdio: ["ignore", log, log], env: { ...process.env } });
  child.unref();
}

// ---- HTML (单页, 无外部依赖) ----
const HTML = `<!DOCTYPE html>
<html lang="zh-CN"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>dsh 管理面板</title>
<style>
:root{--bg:#0f1419;--card:#1a2129;--bd:#2a3441;--tx:#d8dee6;--dim:#8a97a6;--ac:#4da3ff;--ok:#3fb950;--bad:#f85149;--warn:#d29922}
*{box-sizing:border-box;margin:0;padding:0}
body{background:var(--bg);color:var(--tx);font:14px/1.6 -apple-system,"Segoe UI","Microsoft YaHei",sans-serif;padding:20px;max-width:1100px;margin:0 auto}
h1{font-size:20px;margin-bottom:4px}h1 small{color:var(--dim);font-size:12px;font-weight:normal}
.grid{display:grid;grid-template-columns:1fr 1fr;gap:14px;margin-top:14px}
.card{background:var(--card);border:1px solid var(--bd);border-radius:10px;padding:14px 16px}
.card h2{font-size:14px;color:var(--ac);margin-bottom:10px}
.kv{display:flex;justify-content:space-between;padding:3px 0;border-bottom:1px dashed var(--bd)}
.kv:last-child{border-bottom:none}
.kv b{font-weight:normal;color:var(--dim)}
.ok{color:var(--ok)}.bad{color:var(--bad)}.warn{color:var(--warn)}
button{background:var(--ac);color:#fff;border:none;border-radius:6px;padding:6px 14px;cursor:pointer;font-size:13px}
button.gray{background:var(--bd)}button.red{background:var(--bad)}button:disabled{opacity:.4;cursor:wait}
table{width:100%;border-collapse:collapse;font-size:13px}
td,th{padding:6px 4px;border-bottom:1px solid var(--bd);text-align:left}
th{color:var(--dim);font-weight:normal}
pre{background:#0b0f14;border:1px solid var(--bd);border-radius:8px;padding:10px;font:12px/1.5 Consolas,monospace;overflow:auto;max-height:420px;white-space:pre-wrap;word-break:break-all}
.row{display:flex;gap:8px;align-items:center;margin:6px 0;flex-wrap:wrap}
input,select{background:#0b0f14;color:var(--tx);border:1px solid var(--bd);border-radius:6px;padding:6px 8px;font-size:13px}
.full{grid-column:1/-1}
#toast{position:fixed;top:14px;right:14px;background:var(--card);border:1px solid var(--ac);border-radius:8px;padding:10px 16px;display:none}
a{color:var(--ac)}
</style></head><body>
<h1>🛠️ dsh 管理面板 <small id="sub"></small></h1>
<div class="grid">
  <div class="card"><h2>服务状态</h2><div id="status">加载中…</div>
    <div class="row" style="margin-top:10px">
      <button onclick="restartDsh()">重启 dsh</button>
      <button class="gray" onclick="loadAll()">刷新全部</button>
    </div></div>
  <div class="card"><h2>版本 / 更新</h2><div id="version">加载中…</div>
    <div class="row" style="margin-top:10px"><button onclick="loadVersion()">检查更新</button><span id="verlink"></span></div></div>
  <div class="card full"><h2>插件管理 <small style="color:var(--dim)">(profile: web · bundles 开关需重启 dsh 生效)</small></h2>
    <div id="plugins">加载中…</div>
    <div class="row"><input id="newpkg" placeholder="@scope/plugin-name 或 包名" style="flex:1">
    <button onclick="addPlugin()">安装插件</button></div></div>
  <div class="card full"><h2>日志</h2>
    <div class="row">
      <select id="logfile"><option value="app">app.log(生命周期)</option><option value="dsh">dsh.log(dsh 输出)</option><option value="dashboard">dashboard.log(本面板)</option></select>
      <select id="lines"><option>100</option><option selected>300</option><option>800</option></select>
      <label><input type="checkbox" id="auto" onchange="autoLogs()">自动刷新(5s)</label>
      <button class="gray" onclick="loadLogs()">刷新</button>
    </div>
    <pre id="logview">加载中…</pre></div>
</div>
<div id="toast"></div>
<script>
const $=id=>document.getElementById(id);
function toast(m,bad){const t=$('toast');t.textContent=m;t.style.borderColor=bad?'var(--bad)':'var(--ac)';t.style.display='block';setTimeout(()=>t.style.display='none',2600)}
async function api(p,opt){try{const r=await fetch(p,opt);if(r.status===403){toast('被信任围栏拒绝 (403)',1);return null}return await r.json()}catch(e){toast('请求失败: '+e.message,1);return null}}
async function loadStatus(){const d=await api('/api/status');if(!d)return;$('sub').textContent='fpk '+d.fpkVersion+' · 数据区 '+d.dataDir;
$('status').innerHTML=
kv('dsh web', d.dsh.running?('<span class=ok>运行中 pid '+d.dsh.pid+'</span>'+(d.dsh.uptime?' ('+d.dsh.uptime+')':'')):'<span class=bad>未运行</span>')+
kv('健康检查 (:'+d.dsh.port+')', d.dsh.health==='OK'?'<span class=ok>OK</span>':'<span class=bad>'+d.dsh.health+'</span>')+
kv('proxy 网关', d.proxy.running?'<span class=ok>运行中</span>':'<span class=bad>未运行</span>')+
kv('上游 dsh 版本', d.dshPkgVersion)}
function kv(k,v){return '<div class="kv"><b>'+k+'</b><span>'+v+'</span></div>'}
async function loadVersion(){const d=await api('/api/version');if(!d)return;
let up='';
if(d.upstreamDsh) up=(d.upstreamDsh===d.dshInstalled)?'<span class=ok>已是最新</span>':'<span class=warn>有新版 '+d.upstreamDsh+' (当前 '+d.dshInstalled+')</span>';else up='<span class=dim>探测失败</span>';
let pr=d.projectRelease?(' <a href="'+d.projectRelease.url+'" target="_blank">'+d.projectRelease.tag+'</a>'):'';
$('version').innerHTML=kv('fpk 版本',d.fpk)+kv('上游 dsh (npm latest)',up)+kv('本项目最新 Release',pr||'<span class=dim>探测失败</span>')+
'<div class=row style="color:var(--dim)">更新方式: 下载 Release 页 fpk → 应用中心手动安装 (数据区保留)</div>'}
async function loadPlugins(){const d=await api('/api/plugins');if(!d)return;
let h='<table><tr><th>插件</th><th>版本</th><th>状态</th><th>操作</th></tr>';
if(!d.plugins.length)h+='<tr><td colspan=4 style="color:var(--dim)">未安装第三方插件</td></tr>';
for(const p of d.plugins){h+='<tr><td>'+p.name+'</td><td>'+p.version+'</td><td>'+(p.enabled?'<span class=ok>启用</span>':'<span class=warn>禁用</span>')+
'</td><td>'+(p.enabled?'<button class=gray onclick=\\'plug("'+p.name+'",false)\\'>禁用</button>':'<button onclick=\\'plug("'+p.name+'",true)\\'>启用</button>')+
' <button class=red onclick=\\'plugRemove("'+p.name+'")\\'>删除</button></td></tr>'}
h+='</table><div style="color:var(--dim);margin-top:6px">核心 bundles: '+d.coreBundles.join(' , ')+'</div>';
$('plugins').innerHTML=h}
async function plug(name,enable){if(!confirm((enable?'启用':'禁用')+' '+name+'? (需重启 dsh 生效)'))return;
const d=await api('/api/plugins/toggle',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({name,enable})});
d&&d.ok?(toast('已'+(enable?'启用':'禁用')+', 重启 dsh 生效'),loadPlugins()):toast('操作失败',1)}
async function plugRemove(name){if(!confirm('删除插件 '+name+'? (从 bundles 移除 + pnpm remove)'))return;
const d=await api('/api/plugins/remove',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({name})});
d&&d.ok?(toast('已删除'+(d.pnpm?' (pnpm remove 完成)':' (pnpm 不可用, 仅移出 bundles)')),loadPlugins()):toast('删除失败',1)}
async function addPlugin(){const n=$('newpkg').value.trim();if(!n)return;
const d=await api('/api/plugins/add',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({name:n})});
d&&d.ok?(toast('已安装并启用, 重启 dsh 生效'),$('newpkg').value='',loadPlugins()):toast('安装失败: '+(d&&d.err||''),1)}
async function restartDsh(){if(!confirm('重启 dsh? (面板会短暂离线, 30s 内自动恢复)'))return;
toast('重启指令已发送…');try{await fetch('/api/dsh/restart',{method:'POST'})}catch(e){}
for(let i=0;i<15;i++){await new Promise(r=>setTimeout(r,2000));try{const d=await api('/api/status');if(d&&d.dsh.health==='OK'){toast('重启完成');loadAll();return}}catch(e){}}
toast('重启超时, 请刷新页面检查',1)}
async function loadLogs(){const f=$('logfile').value,n=$('lines').value;const d=await api('/api/logs?file='+f+'&lines='+n);if(d&&d.ok)$('logview').textContent=d.text||'(空)'}
let timer=null;function autoLogs(){clearInterval(timer);if($('auto').checked)timer=setInterval(loadLogs,5000)}
function loadAll(){loadStatus();loadVersion();loadPlugins();loadLogs()}
loadAll();
</script></body></html>`;

// ---- 路由 ----
const server = http.createServer(async (req, res) => {
  const host = req.headers.host || "";
  if (!hostAllowed(host)) { res.writeHead(403); return res.end("403 — 管理口仅信任本机/局域网 IP 与 fnos.net/自定义信任域"); }
  const u = new URL(req.url, "http://x");
  const send = (code, body, type = "application/json; charset=utf-8") => { res.writeHead(code, { "Content-Type": type }); res.end(body); };
  try {
    if (u.pathname === "/" && req.method === "GET") return send(200, HTML, "text/html; charset=utf-8");
    if (!DATA_DIR) return send(500, JSON.stringify({ error: "未找到 dsh 数据区" }));
    if (u.pathname === "/api/status") return send(200, JSON.stringify(await apiStatus()));
    if (u.pathname === "/api/version") return send(200, JSON.stringify(await apiVersion()));
    if (u.pathname === "/api/plugins") return send(200, JSON.stringify(apiPlugins()));
    if (u.pathname === "/api/logs" && req.method === "GET") {
      const f = u.searchParams.get("file") || "app";
      const n = Math.min(Number(u.searchParams.get("lines")) || 300, 2000);
      const map = { app: path.join(DATA_DIR, "app.log"), dsh: path.join(DATA_DIR, "dsh.log"), dashboard: path.join(DATA_DIR, "dashboard.log") };
      if (!map[f]) return send(400, JSON.stringify({ ok: false, err: "bad file" }));
      return send(200, JSON.stringify({ ok: true, text: tail(map[f], n) }));
    }
    if (u.pathname === "/api/dsh/restart" && req.method === "POST") { restartDsh(); return send(200, JSON.stringify({ ok: true, msg: "restart dispatched" })); }
    if (u.pathname === "/api/plugins/toggle" && req.method === "POST") {
      const { name, enable } = await readBody(req);
      if (!/^[@a-zA-Z0-9._-]+$/.test(name || "")) return send(400, JSON.stringify({ ok: false, err: "bad name" }));
      savePlugins((bundles) => {
        const set = new Set(bundles);
        if (enable) set.add(name); else set.delete(name);
        return [...set];
      });
      return send(200, JSON.stringify({ ok: true }));
    }
    if (u.pathname === "/api/plugins/remove" && req.method === "POST") {
      const { name } = await readBody(req);
      if (!/^[@a-zA-Z0-9._-]+$/.test(name || "")) return send(400, JSON.stringify({ ok: false, err: "bad name" }));
      let pnpm = false;
      try {
        execSync(`pnpm remove ${JSON.stringify(name)}`, { cwd: PROFILE(), stdio: "ignore", timeout: 120000, env: process.env });
        pnpm = true;
      } catch {}
      savePlugins((bundles) => bundles.filter(b => b !== name));
      const deps = JSON.parse(fs.readFileSync(PKG_JSON(), "utf8")).dependencies || {};
      if (pnpm === false && deps[name]) {
        delete deps[name];
        const pkg = JSON.parse(fs.readFileSync(PKG_JSON(), "utf8")); pkg.dependencies = deps;
        fs.writeFileSync(PKG_JSON(), JSON.stringify(pkg, null, 2) + "\n");
      }
      return send(200, JSON.stringify({ ok: true, pnpm }));
    }
    if (u.pathname === "/api/plugins/add" && req.method === "POST") {
      const { name } = await readBody(req);
      if (!/^[@a-zA-Z0-9._/-]+$/.test(name || "")) return send(400, JSON.stringify({ ok: false, err: "bad name" }));
      let pnpm = true;
      try { execSync(`pnpm add ${JSON.stringify(name)}`, { cwd: PROFILE(), stdio: "ignore", timeout: 300000, env: process.env }); }
      catch (e) { return send(200, JSON.stringify({ ok: false, err: "pnpm add 失败 (pnpm 不可用或包不存在)" })); }
      savePlugins((bundles) => { const s = new Set(bundles); s.add(name); return [...s]; });
      return send(200, JSON.stringify({ ok: true, pnpm }));
    }
    return send(404, JSON.stringify({ error: "not found" }));
  } catch (e) { return send(500, JSON.stringify({ error: String(e.message || e) })); }
});

if (!DATA_DIR || !DSH_HOME) { console.error(`[${new Date().toISOString()}] dashboard: 未找到 dsh 数据区 (DATA_DIR=${DATA_DIR}), 退出`); process.exit(1); }
server.listen(Number(DASH_PORT), "0.0.0.0", () => {
  console.log(`[${new Date().toISOString()}] dashboard: 管理面板已启动 http://0.0.0.0:${DASH_PORT}/ (DATA_DIR=${DATA_DIR})`);
});
process.on("uncaughtException", e => console.error(`[${new Date().toISOString()}] dashboard: uncaught ${e.message}`));
