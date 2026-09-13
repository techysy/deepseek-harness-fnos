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
const UPDATE_DIR = DSH_HOME ? path.join(DSH_HOME, "update") : null;
const PROFILE = () => path.join(DSH_HOME, "profiles", "web");
const PKG_JSON = () => path.join(PROFILE(), "package.json");
const ARCH = process.arch === "arm64" ? "arm" : "x86";
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
  // Release 探测 Gitee 优先 (国内可达性), 链接统一指向 GitHub Release
  let tag = null;
  const g = await httpGet("https://gitee.com/api/v5/repos/techysy/deepseek-harness-fnos/releases/latest", 6000);
  if (g.ok) { try { tag = JSON.parse(g.body).tag_name; } catch {} }
  if (!tag) {
    const h = await httpGet("https://api.github.com/repos/techysy/deepseek-harness-fnos/releases/latest", 6000);
    if (h.ok) { try { tag = JSON.parse(h.body).tag_name; } catch {} }
  }
  if (tag) out.projectRelease = { tag, url: "https://github.com/techysy/deepseek-harness-fnos/releases/tag/" + tag };
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

// ---- 更新下载 / 热安装 ----
function downloadToFile(url, dest, depth = 0) {
  // 返回 Promise<size>; 处理 30x 跳转 (Gitee 附件 → raw CDN), https/http 自适应
  return new Promise((resolve, reject) => {
    if (depth > 5) return reject(new Error("too many redirects"));
    const mod = url.startsWith("https:") ? https : http;
    const req = mod.get(url, { timeout: 30000, headers: { "User-Agent": "dsh-dashboard" } }, res => {
      if ([301, 302, 303, 307, 308].includes(res.statusCode) && res.headers.location)
        return res.resume(), downloadToFile(res.headers.location, dest, depth + 1).then(resolve, reject);
      if (res.statusCode !== 200) return res.resume(), reject(new Error("HTTP " + res.statusCode));
      const out = fs.createWriteStream(dest);
      res.pipe(out);
      out.on("finish", () => out.close(() => resolve(fs.statSync(dest).size)));
      out.on("error", reject);
    });
    req.on("timeout", () => { req.destroy(); reject(new Error("timeout")); });
    req.on("error", reject);
  });
}
async function fetchLatestRelease() {
  for (const u of ["https://gitee.com/api/v5/repos/techysy/deepseek-harness-fnos/releases/latest",
                   "https://api.github.com/repos/techysy/deepseek-harness-fnos/releases/latest"]) {
    const r = await httpGet(u, 8000);
    if (r.ok && r.status === 200) { try { const d = JSON.parse(r.body); if (d.tag_name) return d; } catch {} }
  }
  return null;
}
function assetFor(release, arch, variant) {
  const list = (release.assets || []).map(a => ({ name: a.name, url: a.browser_download_url || a.path || "" }));
  // Gitee assets: browser_download_url; 无则拼 raw 下载 (attachments 需登录, 用 release 页面下载链接兜底)
  return list.find(a => a.name.includes(arch) && a.name.includes(variant) && a.name.endsWith(".fpk") && !a.name.includes("tar.gz"))
      || list.find(a => a.name.includes(arch) && a.name.endsWith(".fpk"));
}
let updateBusy = false;
async function updateDownload() {
  if (updateBusy) return { ok: false, err: "已有下载在进行" };
  const rel = await fetchLatestRelease();
  if (!rel) return { ok: false, err: "无法获取最新 Release (Gitee/GitHub 均不可达)" };
  const cur = manifestField("version");
  const tag = (rel.tag_name || "").replace(/^v/, "");
  const asset = assetFor(rel, ARCH, "iframe") || assetFor(rel, ARCH, "");
  if (!asset || !asset.url) return { ok: false, err: "Release 中未找到 " + ARCH + " 架构的 fpk 资产" };
  if (tag === cur && !rel.prerelease) return { ok: false, err: "当前已是最新版本 " + cur, same: true };
  updateBusy = true;
  try {
    fs.mkdirSync(UPDATE_DIR, { recursive: true });
    // 清理旧下载
    for (const f of fs.readdirSync(UPDATE_DIR)) if (f.endsWith(".fpk") || f.endsWith(".part")) fs.unlinkSync(path.join(UPDATE_DIR, f));
    const dest = path.join(UPDATE_DIR, asset.name);
    const size = await downloadToFile(asset.url, dest);
    return { ok: true, file: dest, size, tag: rel.tag_name };
  } catch (e) {
    return { ok: false, err: "下载失败: " + (e.message || e) };
  } finally { updateBusy = false; }
}
function updateApply() {
  // sudo -n: 未授权时立即失败 (不挂起), 返回一次性授权命令
  const files = fs.existsSync(UPDATE_DIR) ? fs.readdirSync(UPDATE_DIR).filter(f => f.endsWith(".fpk")) : [];
  if (!files.length) return { ok: false, err: "update 目录没有已下载的 fpk" };
  const file = path.join(UPDATE_DIR, files.sort().pop());
  const log = fs.openSync(path.join(DATA_DIR, "dashboard.log"), "a");
  const child = spawn("sudo", ["-n", "/usr/local/bin/appcenter-cli", "install-fpk", file], { detached: true, stdio: ["ignore", log, log] });
  child.on("error", () => {});
  child.unref();
  return { ok: true, dispatched: true, file };
}

// ---- HTML (单页, 无外部依赖) ----
const HTML = `<!DOCTYPE html>
<html lang="zh-CN"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>dsh Admin Panel</title>
<style>
:root{--bg:#0f1419;--card:#1a2129;--bd:#2a3441;--tx:#d8dee6;--dim:#8a97a6;--ac:#4da3ff;--ok:#3fb950;--bad:#f85149;--warn:#d29922;--pre:#0b0f14}
body[data-theme="light"]{--bg:#f6f8fa;--card:#ffffff;--bd:#d0d7de;--tx:#1f2328;--dim:#656d76;--ac:#0969da;--ok:#1a7f37;--bad:#cf222e;--warn:#9a6700;--pre:#eef1f4}
*{box-sizing:border-box;margin:0;padding:0}
body{background:var(--bg);color:var(--tx);font:14px/1.6 -apple-system,"Segoe UI","Microsoft YaHei",sans-serif;padding:20px;max-width:1100px;margin:0 auto}
.top{display:flex;justify-content:space-between;align-items:flex-start;gap:10px}
h1{font-size:20px;margin-bottom:4px}h1 small{color:var(--dim);font-size:12px;font-weight:normal}
.tools{display:flex;gap:6px}
.tools button{background:var(--bd);color:var(--tx);border:none;border-radius:6px;padding:5px 10px;cursor:pointer;font-size:12px}
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
pre{background:var(--pre);border:1px solid var(--bd);border-radius:8px;padding:10px;font:12px/1.5 Consolas,monospace;overflow:auto;max-height:420px;white-space:pre-wrap;word-break:break-all}
.row{display:flex;gap:8px;align-items:center;margin:6px 0;flex-wrap:wrap}
input,select{background:var(--pre);color:var(--tx);border:1px solid var(--bd);border-radius:6px;padding:6px 8px;font-size:13px}
.full{grid-column:1/-1}
#toast{position:fixed;top:14px;right:14px;background:var(--card);border:1px solid var(--ac);border-radius:8px;padding:10px 16px;display:none}
a{color:var(--ac)}
</style></head><body data-theme="dark">
<div class="top">
  <h1>🛠️ <span data-i="title"></span> <small id="sub"></small></h1>
  <div class="tools"><button id="themeBtn" onclick="toggleTheme()" data-t="theme">🌙</button><button id="langBtn" onclick="toggleLang()">EN</button></div>
</div>
<div class="grid">
  <div class="card"><h2 data-i="status"></h2><div id="status"><span class="dim">…</span></div>
    <div class="row" style="margin-top:10px">
      <button onclick="restartDsh()" data-i="restart"></button>
      <button class="gray" onclick="loadAll()" data-i="refreshAll"></button>
    </div></div>
  <div class="card"><h2 data-i="version"></h2><div id="version"><span class="dim">…</span></div>
    <div class="row" style="margin-top:10px"><button onclick="loadVersion()" data-i="checkUpdate"></button><span id="verlink"></span></div></div>
  <div class="card full"><h2><span data-i="plugins"></span> <small style="color:var(--dim)" data-i="pluginsHint"></small></h2>
    <div id="plugins"><span class="dim">…</span></div>
    <div class="row"><input id="newpkg" style="flex:1">
    <button onclick="addPlugin()" data-i="installPlugin"></button></div></div>
  <div class="card full"><h2 data-i="logs"></h2>
    <div class="row">
      <select id="logfile"><option value="app" data-i="logApp"></option><option value="dsh" data-i="logDsh"></option><option value="dashboard" data-i="logPanel"></option></select>
      <select id="lines"><option>100</option><option selected>300</option><option>800</option></select>
      <label><input type="checkbox" id="auto" onchange="autoLogs()"><span data-i="autoRefresh"></span></label>
      <button class="gray" onclick="loadLogs()" data-i="refresh"></button>
    </div>
    <pre id="logview"><span class="dim">…</span></pre></div>
</div>
<div id="toast"></div>
<script>
const $=id=>document.getElementById(id);
const I18N={
zh:{title:"dsh 管理面板",status:"服务状态",version:"版本 / 更新",plugins:"插件管理",pluginsHint:"(profile: web · bundles 开关需重启 dsh 生效)",logs:"日志",restart:"重启 dsh",refreshAll:"刷新全部",refresh:"刷新",loading:"加载中…",running:"运行中",notRunning:"未运行",health:"健康检查",proxy:"proxy 网关",upstreamVer:"上游 dsh 版本",fpkVer:"fpk 版本",npmLatest:"上游 dsh (npm latest)",projectRel:"本项目最新 Release",checkUpdate:"检查更新",plugin:"插件",ver:"版本",statusTh:"状态",actions:"操作",enabled:"启用",disabled:"禁用",noPlugins:"未安装第三方插件",coreBundles:"核心 bundles: ",installPlugin:"安装插件",newpkgPh:"@scope/plugin-name 或 包名",logApp:"app.log(生命周期)",logDsh:"dsh.log(dsh 输出)",logPanel:"dashboard.log(本面板)",autoRefresh:"自动刷新(5s)",emptyLog:"(空)",isLatest:"已是最新",hasNewPre:"有新版 ",hasNewMid:" (当前 ",detectFail:"探测失败",downloaded:"📥 已下载: ",installUpdate:"安装更新 (appcenter-cli)",sudoHint:"若失败, 先在 NAS 授权一次性 sudo:",hotDownload:"📥 一键下载到 NAS",hotHint:"下载对应架构 fpk (Gitee 优先)",downloading:"下载中… (约 50MB, 请稍候)",updateWays:"更新方式: ① 面板一键下载 → 安装更新 (需一次性 sudo 授权) ② 下载 Release fpk → 应用中心手动安装 (数据区保留)",restartConfirm:"重启 dsh? (面板会短暂离线, 30s 内自动恢复)",restartSent:"重启指令已发送…",restartDone:"重启完成",restartTimeout:"重启超时, 请刷新页面检查",fence403:"被信任围栏拒绝 (403)",reqFail:"请求失败: ",opFail:"操作失败",enableQ:"启用",disableQ:"禁用",qTail:"? (需重启 dsh 生效)",removeQ1:"删除插件 ",removeQ2:"? (从 bundles 移除 + pnpm remove)",enableDone:"已启用, 重启 dsh 生效",disableDone:"已禁用, 重启 dsh 生效",removeDone:"已删除",removeDonePnpm:"已删除 (pnpm remove 完成)",removeDoneNo:"已删除 (pnpm 不可用, 仅移出 bundles)",removeFail:"删除失败",addDone:"已安装并启用, 重启 dsh 生效",addFail:"安装失败: ",applyConfirm:"使用 appcenter-cli 安装更新? (会自动重启 dsh, 面板短暂离线)",applySent:"安装指令已下发, App Center 安装中… 约 1 分钟后刷新页面",applyFail:"安装失败: 可能未授权 sudo",hotDone:"已下载 (",dataDirLabel:"数据区"},
en:{title:"dsh Admin Panel",status:"Service Status",version:"Version / Update",plugins:"Plugin Management",pluginsHint:"(profile: web · bundle toggles take effect after dsh restart)",logs:"Logs",restart:"Restart dsh",refreshAll:"Refresh all",refresh:"Refresh",loading:"Loading…",running:"Running",notRunning:"Not running",health:"Health check",proxy:"proxy gateway",upstreamVer:"Upstream dsh version",fpkVer:"fpk version",npmLatest:"Upstream dsh (npm latest)",projectRel:"Latest project Release",checkUpdate:"Check update",plugin:"Plugin",ver:"Version",statusTh:"Status",actions:"Actions",enabled:"Enabled",disabled:"Disabled",noPlugins:"No third-party plugins installed",coreBundles:"Core bundles: ",installPlugin:"Install plugin",newpkgPh:"@scope/plugin-name or package name",logApp:"app.log (lifecycle)",logDsh:"dsh.log (dsh output)",logPanel:"dashboard.log (panel)",autoRefresh:"Auto refresh (5s)",emptyLog:"(empty)",isLatest:"Up to date",hasNewPre:"New version available: ",hasNewMid:" (current ",detectFail:"Not detected",downloaded:"📥 Downloaded: ",installUpdate:"Install update (appcenter-cli)",sudoHint:"If it fails, grant one-time sudo on the NAS first:",hotDownload:"📥 Download to NAS",hotHint:"Download arch-matched fpk (Gitee first)",downloading:"Downloading… (~50MB, please wait)",updateWays:"Update paths: ① panel download → Install update (one-time sudo grant needed) ② download Release fpk → App Center manual install (data preserved)",restartConfirm:"Restart dsh? (panel briefly offline, auto-recovers within 30s)",restartSent:"Restart command sent…",restartDone:"Restart complete",restartTimeout:"Restart timed out, please refresh",fence403:"Blocked by trust fence (403)",reqFail:"Request failed: ",opFail:"Operation failed",enableQ:"Enable",disableQ:"Disable",qTail:"? (takes effect after dsh restart)",removeQ1:"Delete plugin ",removeQ2:"? (removes from bundles + pnpm remove)",enableDone:"Enabled, takes effect after dsh restart",disableDone:"Disabled, takes effect after dsh restart",removeDone:"Deleted",removeDonePnpm:"Deleted (pnpm remove done)",removeDoneNo:"Deleted (pnpm unavailable, removed from bundles only)",removeFail:"Delete failed",addDone:"Installed & enabled, takes effect after dsh restart",addFail:"Install failed: ",applyConfirm:"Install update via appcenter-cli? (dsh auto-restarts, panel briefly offline)",applySent:"Install dispatched, App Center installing… refresh in ~1 min",applyFail:"Install failed: sudo not granted?",hotDone:"Downloaded (",dataDirLabel:"data dir"}
};
let LANG=localStorage.getItem("dsh-lang")||((navigator.language||"").toLowerCase().indexOf("zh")===0?"zh":"en");
function t(k){const d=I18N[LANG]||I18N.zh;return d[k]!==undefined?d[k]:(I18N.zh[k]!==undefined?I18N.zh[k]:k)}
function applyStaticLang(){document.documentElement.lang=LANG==="zh"?"zh-CN":"en";document.title=t("title");
document.querySelectorAll("[data-i]").forEach(e=>e.textContent=t(e.dataset.i));
document.querySelectorAll("[data-ip]").forEach(e=>e.placeholder=t(e.dataset.ip));
$("langBtn").textContent=LANG==="zh"?"EN":"中文"}
function toggleLang(){LANG=LANG==="zh"?"en":"zh";localStorage.setItem("dsh-lang",LANG);applyStaticLang();loadAll()}
let THEME=localStorage.getItem("dsh-theme")||(window.matchMedia&&matchMedia("(prefers-color-scheme: light)").matches?"light":"dark");
function applyTheme(){document.body.dataset.theme=THEME;$("themeBtn").textContent=THEME==="dark"?"🌙":"☀️"}
function toggleTheme(){THEME=THEME==="dark"?"light":"dark";localStorage.setItem("dsh-theme",THEME);applyTheme()}
function toast(m,bad){const t2=$("toast");t2.textContent=m;t2.style.borderColor=bad?"var(--bad)":"var(--ac)";t2.style.display="block";setTimeout(()=>t2.style.display="none",2600)}
async function api(p,opt){try{const r=await fetch(p,opt);if(r.status===403){toast(t("fence403"),1);return null}return await r.json()}catch(e){toast(t("reqFail")+e.message,1);return null}}
function kv(k,v){return '<div class="kv"><b>'+k+"</b><span>"+v+"</span></div>"}
async function loadStatus(){const d=await api("/api/status");if(!d)return;$("sub").textContent="fpk "+d.fpkVersion+" · "+t("dataDirLabel")+" "+d.dataDir;
$("status").innerHTML=
kv("dsh web", d.dsh.running?('<span class=ok>'+t("running")+" pid "+d.dsh.pid+"</span>"+(d.dsh.uptime?" ("+d.dsh.uptime+")":"")):('<span class=bad>'+t("notRunning")+"</span>"))+
kv(t("health")+" (:"+d.dsh.port+")", d.dsh.health==="OK"?'<span class=ok>OK</span>':'<span class=bad>'+d.dsh.health+"</span>")+
kv(t("proxy"), d.proxy.running?'<span class=ok>'+t("running")+"</span>":('<span class=bad>'+t("notRunning")+"</span>"))+
kv(t("upstreamVer"), d.dshPkgVersion)}
async function loadVersion(){const d=await api("/api/version");if(!d)return;
let up="";
if(d.upstreamDsh) up=(d.upstreamDsh===d.dshInstalled)?('<span class=ok>'+t("isLatest")+"</span>"):('<span class=warn>'+t("hasNewPre")+d.upstreamDsh+t("hasNewMid")+d.dshInstalled+")</span>");else up='<span class=dim>'+t("detectFail")+"</span>";
let pr=d.projectRelease?('<a href="'+d.projectRelease.url+'" target="_blank">'+d.projectRelease.tag+"</a>"):'<span class=dim>'+t("detectFail")+"</span>";
let hot="";
try{const st=await api("/api/update/state");
if(st&&st.files&&st.files.length){hot+='<div class=row style="margin-top:8px"><span class=ok>'+t("downloaded")+st.files.join(" , ")+"</span></div><div class=row><button onclick=applyUpdate()>"+t("installUpdate")+'</button><span style="color:var(--dim)">'+t("sudoHint")+'</span></div><pre style="max-height:100px">'+(st.sudoHint||"")+"</pre></div>";}
}catch(e){}
$("version").innerHTML=kv(t("fpkVer"),d.fpk)+kv(t("npmLatest"),up)+kv(t("projectRel"),pr)+
'<div class=row style="margin-top:8px"><button onclick="hotUpdate()">'+t("hotDownload")+'</button><span id=hotstat style="color:var(--dim)">'+t("hotHint")+"</span></div>"+hot+
'<div class=row style="color:var(--dim)">'+t("updateWays")+"</div>"}
async function hotUpdate(){$("hotstat").textContent=t("downloading");const b=event.target;b.disabled=true;
const d=await api("/api/update/download",{method:"POST"});b.disabled=false;
if(d&&d.ok){$("hotstat").innerHTML='<span class=ok>'+t("hotDone")+Math.round(d.size/1048576)+"MB): "+d.file.split("/").pop()+"</span>";loadVersion();}
else{$("hotstat").innerHTML='<span class=bad>'+((d&&d.err)||t("opFail"))+"</span>"}}
async function applyUpdate(){if(!confirm(t("applyConfirm")))return;
const d=await api("/api/update/apply",{method:"POST"});
if(d&&d.ok){toast(t("applySent"));setTimeout(()=>location.reload(),60000)}
else toast(t("applyFail"),1)}
async function loadPlugins(){const d=await api("/api/plugins");if(!d)return;
let h='<table><tr><th>'+t("plugin")+"</th><th>"+t("ver")+"</th><th>"+t("statusTh")+"</th><th>"+t("actions")+"</th></tr>";
if(!d.plugins.length)h+='<tr><td colspan=4 style="color:var(--dim)">'+t("noPlugins")+"</td></tr>";
for(const p of d.plugins){h+='<tr><td>'+p.name+"</td><td>"+p.version+"</td><td>"+(p.enabled?'<span class=ok>'+t("enabled")+"</span>":('<span class=warn>'+t("disabled")+"</span>"))+
"</td><td>"+(p.enabled?'<button class=gray data-act="dis" data-name="'+p.name+'">'+t("disableQ")+"</button>":('<button data-act="en" data-name="'+p.name+'">'+t("enableQ")+"</button>"))+
' <button class=red data-act="rm" data-name="'+p.name+'">✕</button></td></tr>'}
h+="</table>"+'<div style="color:var(--dim);margin-top:6px">'+t("coreBundles")+d.coreBundles.join(" , ")+"</div>";
$("plugins").innerHTML=h}
document.addEventListener("click",e=>{const b=e.target.closest("[data-act]");if(!b)return;const n=b.dataset.name,a=b.dataset.act;
if(a==="dis")plug(n,false);else if(a==="en")plug(n,true);else if(a==="rm")plugRemove(n)});
async function plug(name,enable){if(!confirm((enable?t("enableQ"):t("disableQ"))+" "+name+t("qTail")))return;
const d=await api("/api/plugins/toggle",{method:"POST",headers:{'Content-Type':'application/json'},body:JSON.stringify({name,enable})});
d&&d.ok?(toast(enable?t("enableDone"):t("disableDone")),loadPlugins()):toast(t("opFail"),1)}
async function plugRemove(name){if(!confirm(t("removeQ1")+name+t("removeQ2")))return;
const d=await api("/api/plugins/remove",{method:"POST",headers:{'Content-Type':'application/json'},body:JSON.stringify({name})});
d&&d.ok?(toast(d.pnpm?t("removeDonePnpm"):t("removeDoneNo")),loadPlugins()):toast(t("removeFail"),1)}
async function addPlugin(){const n=$("newpkg").value.trim();if(!n)return;
const d=await api("/api/plugins/add",{method:"POST",headers:{'Content-Type':'application/json'},body:JSON.stringify({name:n})});
d&&d.ok?(toast(t("addDone")),$("newpkg").value="",loadPlugins()):toast(t("addFail")+(d&&d.err||""),1)}
async function restartDsh(){if(!confirm(t("restartConfirm")))return;
toast(t("restartSent"));try{await fetch("/api/dsh/restart",{method:"POST"})}catch(e){}
for(let i=0;i<15;i++){await new Promise(r=>setTimeout(r,2000));try{const d=await api("/api/status");if(d&&d.dsh.health==="OK"){toast(t("restartDone"));loadAll();return}}catch(e){}}
toast(t("restartTimeout"),1)}
async function loadLogs(){const f=$("logfile").value,n=$("lines").value;const d=await api("/api/logs?file="+f+"&lines="+n);if(d&&d.ok)$("logview").textContent=d.text||t("emptyLog")}
let timer=null;function autoLogs(){clearInterval(timer);if($("auto").checked)timer=setInterval(loadLogs,5000)}
function loadAll(){loadStatus();loadVersion();loadPlugins();loadLogs()}
applyTheme();applyStaticLang();loadAll();
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
    if (u.pathname === "/api/update/download" && req.method === "POST") return send(200, JSON.stringify(await updateDownload()));
    if (u.pathname === "/api/update/apply" && req.method === "POST") return send(200, JSON.stringify(updateApply()));
    if (u.pathname === "/api/update/state" && req.method === "GET") {
      const files = fs.existsSync(UPDATE_DIR) ? fs.readdirSync(UPDATE_DIR).filter(f => f.endsWith(".fpk")) : [];
      return send(200, JSON.stringify({ ok: true, updateDir: UPDATE_DIR, files, sudoHint: files.length ? "sudo tee /etc/sudoers.d/dsh-hotfix <<< 'dsh ALL=(root) NOPASSWD: /usr/local/bin/appcenter-cli install-fpk /vol*/@appdata/dsh/dsh_home/update/*'" : null }));
    }
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
