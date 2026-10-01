#!/usr/bin/env node
/**
 * dashboard.js — dsh 独立管理面板 (端口 28001)
 * ---------------------------------------------------------------
 * 零依赖单文件, 由 cmd/main 启动 (也可手动 node dashboard.js).
 * 功能: 服务状态 / 版本与热更新 (下载进度条 + 出站代理 + sudo 授权探测) /
 *       插件管理 (官方实验性 + 第三方, bundles ∪ dependencies 合并视图) /
 *       日志查看 (关键字过滤 / 自动刷新) / 重启 dsh.
 * UI/UX: 设计语言对齐 CreditDaddy 面板 (techysy/CreditDaddy) — panel+toolbar
 *       布局、视图导航、胶囊状态、黑白主按钮、亮暗双主题.
 * 安全: Host/Origin 信任围栏 (与 dsh 一致: 回环 + 本机 IP + fnos.net /
 *       5ddd.com + trusted_hosts.conf), 围栏外一律 403. 勿暴露到不受信网络.
 */
"use strict";
const http = require("http");
const https = require("https");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { execFile, execFileSync, execSync, spawn, spawnSync } = require("child_process");

// ---- 配置: 环境变量优先, 否则自动探测 ----
function detectDataDir() {
  if (process.env.DATA_DIR && fs.existsSync(process.env.DATA_DIR)) return process.env.DATA_DIR;
  for (const v of fs.readdirSync("/").filter(d => /^vol\d+$/.test(d))) {
    const cand = path.join("/", v, "@appdata/dsh");
    if (fs.existsSync(path.join(cand, "dsh_home"))) return cand;
  }
  return null;
}
// 工作空间落点 (issue #2 收敛方案): 单一事实源是 cmd/main 每次 start 落盘的
// workspace.active; 环境变量/路径探测只作该文件缺失时的兜底. 工作区本身不可切换 —
// 目录选择统一走 fnOS 原生「应用设置 → 授权目录」, 面板经开放 API 读取.
function detectSharedHome(dataDir) {
  try {
    const active = fs.readFileSync(path.join(dataDir, "workspace.active"), "utf8").trim();
    if (active && path.isAbsolute(active) && fs.existsSync(active)) return active;
  } catch {}
  const marker = path.join(dataDir, "dsh_home", ".migrated-to-share");
  if (!fs.existsSync(marker)) return null;   // 未迁移 → 仍用 @appdata
  const cands = [];
  if (process.env.WORK_HOME) cands.push(process.env.WORK_HOME);
  if (process.env.TRIM_DATA_SHARE_PATHS) cands.push(path.join(process.env.TRIM_DATA_SHARE_PATHS.split(":")[0], "dsh_home"));
  const appDir = process.env.APP_DIR || "/var/apps/dsh";
  cands.push(path.join(appDir, "share", "dsh", "dsh_home"));
  for (const v of (() => { try { return fs.readdirSync("/").filter(d => /^vol\d+$/.test(d)); } catch { return []; } })())
    cands.push(path.join("/", v, "@appshare/dsh/dsh_home"));
  for (const c of cands) if (fs.existsSync(c)) return c;
  return null;
}
const DATA_DIR = detectDataDir();
// 优先级: workspace.active (cmd/main 落盘的事实源) > DSH_HOME 环境变量 (可能只是
// 数据区路径, 共享布局下不准) > 兜底数据区. 顺序颠倒会让面板定位回数据区 → 插件 API ENOENT.
const DSH_HOME = (DATA_DIR ? detectSharedHome(DATA_DIR) : null)
  || process.env.DSH_HOME
  || (DATA_DIR ? path.join(DATA_DIR, "dsh_home") : null);
const APP_DIR = process.env.APP_DIR || "/var/apps/dsh";
const DSH_PORT = process.env.DSH_PORT || "28000";
const DASH_PORT = process.env.DASH_PORT || "28001";
const CMD_MAIN = process.env.CMD_MAIN || path.join(APP_DIR, "cmd", "main");
const MANIFEST = process.env.MANIFEST || path.join(APP_DIR, "manifest");
const UPDATE_DIR = DSH_HOME ? path.join(DSH_HOME, "update") : null;
const UPD_DIR_CONF = DATA_DIR ? path.join(DATA_DIR, "update-dir.conf") : null;

// ---- fnOS 开放平台 API (developer.fnnas.com/api): unix socket + Bearer TRIM_API_TOKEN.
// 用于查询管理员在「应用设置 → 授权目录」里授权的目录, 作为可选下载目录 (issue #4).
// Scope 需在 config/resource 声明: "api-scope": ["trim.file.sharedAccess"].
// 老版本 fnOS 无 socket/token 时返回 null, 面板优雅回退默认目录.
const TRIM_API_SOCKET = "/var/run/trim_open_gateway_apiscope.socket";
function trimApi(req, data = {}) {
  const token = process.env.TRIM_API_TOKEN;
  if (!token) return Promise.resolve(null);
  return new Promise(resolve => {
    try {
      const r = http.request({
        socketPath: TRIM_API_SOCKET, path: "/api/v1/trimapp", method: "POST",
        timeout: 4000, headers: { "Content-Type": "application/json", "Authorization": "Bearer " + token },
      }, res => {
        let d = ""; res.on("data", c => (d += c)); res.on("end", () => {
          try { const j = JSON.parse(d); resolve(j.code === 0 ? j : null); } catch { resolve(null); }
        });
      });
      r.on("timeout", () => { r.destroy(); resolve(null); });
      r.on("error", () => resolve(null));
      r.end(JSON.stringify({ reqId: String(Date.now()), req, appName: process.env.TRIM_APPNAME || "dsh", data }));
    } catch { resolve(null); }
  });
}
let dirCache = { at: 0, val: null, ok: false };
function authorizedDirs() {
  if (dirCache.val && Date.now() - dirCache.at < 60000) return Promise.resolve(dirCache.val);
  return trimApi("trim.file.getSharedAccessibleFolders").then(j => {
    const list = Array.isArray(j && j.data) ? j.data.filter(x => typeof x === "string" && x.startsWith("/")) : [];
    dirCache = { at: Date.now(), val: list, ok: !!j };
    return list;
  });
}
function selectedUpdateDir() {
  // 用户选择的下载目录 (持久化在数据区); 必须已存在, 否则回退默认
  try {
    const v = fs.readFileSync(UPD_DIR_CONF, "utf8").trim();
    if (v.startsWith("/") && fs.existsSync(v)) return v;
  } catch {}
  return UPDATE_DIR;
}
function updateDirName(dir) { return dir === UPDATE_DIR ? UPDATE_DIR : dir; }
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
  // 内置两条飞牛 FN Connect 域名后缀 (issue #7); 其余来自用户的 trusted_hosts.conf
  const out = new Set(["fnos.net", "5ddd.com"]);
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
function humanSize(n) {
  if (!n && n !== 0) return "?";
  if (n < 1024) return n + "B";
  const u = ["KB", "MB", "GB", "TB"]; let i = -1;
  do { n /= 1024; i++; } while (n >= 1024 && i < u.length - 1);
  return n.toFixed(n >= 100 ? 0 : 1) + u[i];
}

// ---- 出站代理 (issue #4): 与 dsh 主进程共用 proxy.conf (PROXY=http://IP:PORT),
// 面板对 GitHub/Gitee 的 API 探测与 fpk 下载经 HTTP 代理 CONNECT 隧道转发.
// 仅代理公网地址; 回环/局域网直连, 不影响健康检查与 NAS 内部通信.
function readProxyConf() {
  try {
    const f = path.join(DATA_DIR, "dsh_home", "proxy.conf");
    const line = fs.readFileSync(f, "utf8").split("\n").find(l => l.startsWith("PROXY="));
    if (line) { const v = line.slice(6).trim(); if (/^https?:\/\/.+/.test(v)) return v; }
  } catch {}
  return null;
}
function needsProxy(host) {
  if (!host) return false;
  if (/^(127\.|localhost|\[::1\]|::1)/i.test(host)) return false;
  if (/^10\./.test(host) || /^192\.168\./.test(host) || /^172\.(1[6-9]|2\d|3[01])\./.test(host)) return false;
  return true;
}
function proxyConnect(proxyUrl, host, port, timeout = 15000) {
  return new Promise((resolve, reject) => {
    const u = new URL(proxyUrl);
    const req = http.request({
      host: u.hostname, port: Number(u.port) || 80, method: "CONNECT",
      path: host + ":" + port, headers: { Host: host + ":" + port, "User-Agent": "dsh-dashboard" }, timeout,
    });
    req.on("connect", (res, socket) => {
      if (res.statusCode === 200) return resolve(socket);
      socket.destroy(); reject(new Error("proxy CONNECT HTTP " + res.statusCode));
    });
    req.on("timeout", () => { req.destroy(); reject(new Error("proxy timeout")); });
    req.on("error", reject);
    req.end();
  });
}
async function makeRequest(url, options = {}) {
  const u = new URL(url);
  const proxy = readProxyConf();
  const port = Number(u.port) || (u.protocol === "https:" ? 443 : 80);
  if (proxy && needsProxy(u.hostname)) {
    const socket = await proxyConnect(proxy, u.hostname, port, options.timeout || 15000);
    const mod = u.protocol === "https:" ? https : http;
    return mod.request(url, { ...options, agent: false, createConnection: () => socket });
  }
  const mod = u.protocol === "https:" ? https : http;
  return mod.request(url, options);
}
function httpGet(url, timeout = 6000) {
  return new Promise(async resolve => {
    try {
      const req = await makeRequest(url, { timeout, headers: { "User-Agent": "dsh-dashboard" } });
      req.on("response", res => {
        let d = ""; res.on("data", c => (d += c)); res.on("end", () => resolve({ ok: true, status: res.statusCode, body: d }));
      });
      req.on("timeout", () => { req.destroy(); resolve({ ok: false }); });
      req.on("error", () => resolve({ ok: false }));
      req.end();
    } catch { resolve({ ok: false }); }
  });
}

// ---- API handlers ----
function installedDshVersion() {
  const cands = [
    path.join(APP_DIR, "server/node_modules/@deepseek-ai/dsh/package.json"),
    path.join(APP_DIR, "target/server/node_modules/@deepseek-ai/dsh/package.json"),
  ];
  try { for (const v of fs.readdirSync("/")) { if (/^vol\d+$/.test(v)) cands.push(path.join("/", v, "@appcenter/dsh/server/node_modules/@deepseek-ai/dsh/package.json")); } } catch {}
  for (const c of cands) { try { return JSON.parse(fs.readFileSync(c, "utf8")).version; } catch {} }
  return null;
}
// 磁盘占用 (issue #8 P2): du 慢, 10 分钟缓存
let diskCache = { at: 0, val: null };
function diskUsage() {
  if (diskCache.val && Date.now() - diskCache.at < 600000) return diskCache.val;
  const du = dir => { try { return execFileSync("du", ["-sh", dir], { timeout: 60000 }).toString().split("\t")[0].trim(); } catch { return null; } };
  const out = {};
  if (DATA_DIR) out.dataDir = du(DATA_DIR);
  if (DSH_HOME) out.speech = du(path.join(DSH_HOME, "speech-to-text"));
  const upd = UPDATE_DIR && selectedUpdateDir();
  if (upd && fs.existsSync(upd)) out.update = du(upd);
  diskCache = { at: Date.now(), val: out };
  return out;
}
async function apiStatus() {
  const pid = (() => { try { return fs.readFileSync(path.join(DATA_DIR, "dsh.pid"), "utf8").trim(); } catch { return ""; } })();
  const running = pid && pidAlive(pid);
  let uptime = "";
  if (running) { try { uptime = execSync(`ps -o etime= -p ${Number(pid)}`).toString().trim(); } catch {} }
  const h = await httpGet(`http://127.0.0.1:${DSH_PORT}/`, 3000);
  const proxyPid = (() => { try { return fs.readFileSync(path.join(DATA_DIR, "proxy.pid"), "utf8").trim(); } catch { return ""; } })();
  return {
    fpkVersion: manifestField("version"),
    dshPkgVersion: installedDshVersion() || "?",
    dsh: { pid, running: !!running, uptime, health: h.ok && h.status === 200 ? "OK" : "不可达", port: DSH_PORT },
    proxy: { running: !!(proxyPid && pidAlive(proxyPid)), conf: readProxyConf() },
    dashboard: process.pid,
    dataDir: DATA_DIR,
    dshHome: DSH_HOME,
    disk: diskUsage(),
  };
}
async function apiVersion() {
  const st = await apiStatus();
  const out = { fpk: st.fpkVersion, dshInstalled: st.dshPkgVersion, upstreamDsh: null, upstreamTag: null, upstreamUrl: null, projectRelease: null };

  // 上游 dsh 版本探测: 优先查询 GitHub deepseek-ai/deepseek-harness Releases 的 tag
  const ghUpstream = await httpGet("https://api.github.com/repos/deepseek-ai/deepseek-harness/releases?per_page=1", 6000);
  if (ghUpstream.ok && ghUpstream.status === 200) {
    try {
      const list = JSON.parse(ghUpstream.body);
      if (Array.isArray(list) && list.length > 0 && list[0].tag_name) {
        const rawTag = list[0].tag_name;
        out.upstreamTag = rawTag;
        out.upstreamDsh = rawTag.replace(/^(dsh-)?v?/, "");
        out.upstreamUrl = list[0].html_url || ("https://github.com/deepseek-ai/deepseek-harness/releases/tag/" + rawTag);
      }
    } catch {}
  }

  // 兜底: 若 GitHub 探测不到上游 tag, 则从 npmmirror / npmjs 探测
  if (!out.upstreamDsh) {
    for (const reg of ["https://registry.npmmirror.com/@deepseek-ai/dsh", "https://registry.npmjs.org/@deepseek-ai/dsh"]) {
      const r = await httpGet(reg + "/latest", 6000);
      if (r.ok) {
        try {
          const v = JSON.parse(r.body).version;
          out.upstreamDsh = v;
          out.upstreamTag = "v" + v;
          out.upstreamUrl = "https://github.com/deepseek-ai/deepseek-harness/releases";
          break;
        } catch {}
      }
    }
  }

  // 本项目 Release 探测: GitHub 优先 (列表降序, per_page=1 即最新), Gitee 兜底
  // (Gitee 列表为升序, 须取全量后按 created_at 取最新; /releases/latest 对纯
  //  prerelease 仓库在 GitHub 恒 404, Gitee 语义亦不稳, 统一走列表端点)
  let tag = null;
  const h = await httpGet("https://api.github.com/repos/techysy/deepseek-harness-fnos/releases?per_page=1", 6000);
  if (h.ok) { try { const l = JSON.parse(h.body); if (Array.isArray(l) && l[0] && l[0].tag_name) tag = l[0].tag_name; } catch {} }
  if (!tag) {
    const g = await httpGet("https://gitee.com/api/v5/repos/techysy/deepseek-harness-fnos/releases?per_page=100", 6000);
    if (g.ok) {
      try {
        const l = JSON.parse(g.body);
        if (Array.isArray(l) && l.length)
          tag = l.reduce((a, b) => ((a.created_at || "") > (b.created_at || "") ? a : b)).tag_name;
      } catch {}
    }
  }
  if (tag) out.projectRelease = { tag, url: "https://github.com/techysy/deepseek-harness-fnos/releases/tag/" + tag };
  return out;
}
// ---- 插件 (issue #8 P1): 数据源取 bundles ∪ dependencies, 官方实验性插件
// 只写在 bundles (dependencies 无条目), 版本从 node_modules/<name>/package.json 读.
const CORE_RE = /^@deepseek-ai\/(?!dsh-experimental-)/;
const OFFICIAL_RE = /^@deepseek-ai\/dsh-experimental-/;
function pluginModuleVersion(name) {
  try { return JSON.parse(fs.readFileSync(path.join(PROFILE(), "node_modules", name, "package.json"), "utf8")).version || null; } catch { return null; }
}
function apiPlugins() {
  const pkg = JSON.parse(fs.readFileSync(PKG_JSON(), "utf8"));
  const bundles = (pkg.dsh && pkg.dsh.profile && pkg.dsh.profile.bundles) || [];
  const deps = pkg.dependencies || {};
  const dshVer = installedDshVersion();
  const map = new Map();
  for (const [n, v] of Object.entries(deps)) {
    if (CORE_RE.test(n)) continue;
    map.set(n, { name: n, version: v, source: "dep" });
  }
  for (const b of bundles) {
    if (CORE_RE.test(b) || map.has(b)) continue;
    map.set(b, { name: b, version: pluginModuleVersion(b), source: "bundle" });
  }
  // 核心组件 = @deepseek-ai 作用域里随 fpk 出厂的部分; 官方实验性插件
  // (@deepseek-ai/dsh-experimental-*) 是用户后装的, 与第三方插件一样可
  // 禁用/启用/删除 (如语音输入 bundle 出问题导致 dsh 崩溃循环时可在此救急)
  const plugins = [...map.values()].map(p => {
    const official = OFFICIAL_RE.test(p.name);
    const modVer = pluginModuleVersion(p.name) || p.version;
    return {
      name: p.name,
      version: modVer || "?",
      source: p.source,
      official,
      enabled: bundles.includes(p.name),
      // 版本一致性 (issue #8 P1.3): 官方插件安装时钉到已装 dsh 版本, 不等即警示
      mismatch: official && modVer && dshVer ? modVer !== dshVer : false,
      dshVersion: official ? dshVer : undefined,
    };
  }).sort((a, b) => (a.official === b.official ? a.name.localeCompare(b.name) : a.official ? 1 : -1));
  return {
    profile: "web",
    packageJsonPath: PKG_JSON(),
    dshVersion: dshVer,
    plugins,
    coreBundles: bundles.filter(n => CORE_RE.test(n)),
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
// 下载进度 (issue #4): 全局状态供 /api/update/state 轮询, 前端渲染进度条.
// req 引用用于「停止下载」: destroy 当前请求 → downloadToFile reject → 清理 .part
const dlState = { busy: false, file: null, received: 0, total: 0, speed: 0, startedAt: 0, err: null, req: null };
function downloadToFile(url, dest, depth = 0) {
  // 返回 Promise<size>; 处理 30x 跳转 (Gitee 附件 → raw CDN), https/http 自适应.
  // 先写 .part 临时名, 完成后改名 — 中断/取消不会留下可被误装的半成品 fpk
  return new Promise(async (resolve, reject) => {
    if (depth > 5) return reject(new Error("too many redirects"));
    const partFile = dest + ".part";
    try {
      const req = await makeRequest(url, { timeout: 120000, headers: { "User-Agent": "dsh-dashboard" } });
      dlState.req = req;
      req.on("response", res => {
        if ([301, 302, 303, 307, 308].includes(res.statusCode) && res.headers.location) {
          res.resume();
          return downloadToFile(new URL(res.headers.location, url).href, dest, depth + 1).then(resolve, reject);
        }
        if (res.statusCode !== 200) { res.resume(); return reject(new Error("HTTP " + res.statusCode)); }
        dlState.total = Number(res.headers["content-length"]) || 0;
        dlState.received = 0; dlState.startedAt = Date.now();
        let lastT = Date.now(), lastR = 0;
        const out = fs.createWriteStream(partFile);
        res.on("data", c => {
          dlState.received += c.length;
          const now = Date.now();
          if (now - lastT >= 500) { dlState.speed = Math.round((dlState.received - lastR) / ((now - lastT) / 1000)); lastT = now; lastR = dlState.received; }
        });
        res.pipe(out);
        out.on("finish", () => {
          out.close(() => {
            try { fs.renameSync(partFile, dest); } catch (e) { return reject(e); }
            resolve(fs.statSync(dest).size);
          });
        });
        out.on("error", reject);
      });
      req.on("timeout", () => { req.destroy(); reject(new Error("timeout")); });
      req.on("error", reject);
      req.end();
    } catch (e) { reject(e); }
  });
}
async function fetchLatestRelease() {
  // GitHub 优先: 0.1.7-rc.1 起 fpk >100MB 超 Gitee 附件上限, Release 附件只在 GitHub;
  // GitHub 列表降序 per_page=1 即最新。Gitee 兜底: 列表升序, 须取全量按 created_at
  // 挑最新 (老版本仍有附件)。/releases/latest 对纯 prerelease 仓库在 GitHub 恒 404。
  const gh = await httpGet("https://api.github.com/repos/techysy/deepseek-harness-fnos/releases?per_page=1", 8000);
  if (gh.ok && gh.status === 200) {
    try { const l = JSON.parse(gh.body); if (Array.isArray(l) && l[0] && l[0].tag_name) return l[0]; } catch {}
  }
  const g = await httpGet("https://gitee.com/api/v5/repos/techysy/deepseek-harness-fnos/releases?per_page=100", 8000);
  if (g.ok && g.status === 200) {
    try {
      const l = JSON.parse(g.body);
      if (Array.isArray(l) && l.length) return l.reduce((a, b) => ((a.created_at || "") > (b.created_at || "") ? a : b));
    } catch {}
  }
  return null;
}
function assetFor(release, arch, variant) {
  const list = (release.assets || []).map(a => ({ name: a.name, url: a.browser_download_url || a.path || "" }));
  // Gitee assets: browser_download_url; 无则拼 raw 下载 (attachments 需登录, 用 release 页面下载链接兜底)
  return list.find(a => a.name.includes(arch) && a.name.includes(variant) && a.name.endsWith(".fpk") && !a.name.includes("tar.gz"))
      || list.find(a => a.name.includes(arch) && a.name.endsWith(".fpk"));
}
function updateFiles() {
  const dir = selectedUpdateDir();
  if (!dir || !fs.existsSync(dir)) return [];
  return fs.readdirSync(dir).filter(f => f.endsWith(".fpk")).map(f => {
    let size = 0, mtime = 0;
    try { const st = fs.statSync(path.join(dir, f)); size = st.size; mtime = st.mtimeMs; } catch {}
    return { name: f, size, mtime };
  });
}
// sudo 授权探测 (issue #4): sudo -n -l 只列规则不执行命令, 安全.
// 按**实际文件路径**校验: sudoers 白名单路径必须覆盖当前下载目录里的 fpk,
// 不能只看命令里有没有 install-fpk (共享布局后 update 目录搬到 @appshare,
// 旧 @appdata 白名单对它失效 — 真机踩过: 面板显示已授权, 实际 sudo 拒绝).
function sudoAuthorized() {
  const dir = selectedUpdateDir();
  const files = updateFiles();
  const probe = path.join(dir, files.map(f => f.name).sort().pop() || "probe.fpk");
  let out = "";
  try {
    const r = spawnSync("sudo", ["-n", "-l"], { encoding: "utf8", timeout: 5000 });
    if (r.status !== 0) return false;
    out = (r.stdout || "") + (r.stderr || "");
  } catch { return false; }
  const ruleRe = /NOPASSWD:\s*(\S+\s+install-fpk\s+(\S+))/g;
  let m;
  while ((m = ruleRe.exec(out))) {
    if (!m[2]) continue;
    const argRe = new RegExp("^" + m[2].replace(/[.+^${}()|[\]\\]/g, "\\$&").replace(/\*/g, ".*").replace(/\?/g, ".") + "$");
    if (argRe.test(probe)) return true;
  }
  return false;
}
// sudoers 白名单跟随所选目录生成: 卷号通配 (/vol4 → /vol*), 其余精确匹配
function sudoHintFor(dir) {
  const pat = dir.replace(/^\/(vol\d+)/, "/vol*") + "/*";
  return "echo 'dsh ALL=(root) NOPASSWD: /usr/local/bin/appcenter-cli install-fpk " + pat + "' | sudo tee /etc/sudoers.d/dsh-hotfix\nsudo chmod 440 /etc/sudoers.d/dsh-hotfix";
}
let updateBusy = false;
async function updateDownload() {
  if (updateBusy || dlState.busy) return { ok: false, err: "已有下载在进行" };
  const rel = await fetchLatestRelease();
  if (!rel) return { ok: false, err: "无法获取最新 Release (GitHub/Gitee 均不可达)" };
  const cur = manifestField("version");
  const tag = (rel.tag_name || "").replace(/^v/, "");
  const asset = assetFor(rel, ARCH, "iframe") || assetFor(rel, ARCH, "");
  if (!asset || !asset.url) return { ok: false, err: "Release 未含 " + ARCH + " 架构 fpk 附件 (0.1.7 起 Gitee 超 100MB 上限停传, 需 GitHub 可达)" };
  if (tag === cur && !rel.prerelease) return { ok: false, err: "当前已是最新版本 " + cur, same: true };
  updateBusy = true; dlState.busy = true; dlState.err = null; dlState.file = asset.name; dlState.received = 0; dlState.total = 0; dlState.speed = 0;
  let dest = null;
  try {
    const dir = selectedUpdateDir();
    fs.mkdirSync(dir, { recursive: true });
    // 清理旧下载
    for (const f of fs.readdirSync(dir)) if (f.endsWith(".fpk") || f.endsWith(".part")) fs.unlinkSync(path.join(dir, f));
    dest = path.join(dir, asset.name);
    const size = await downloadToFile(asset.url, dest);
    return { ok: true, file: dest, size, tag: rel.tag_name };
  } catch (e) {
    dlState.err = String(e.message || e);
    // 清掉 .part 半成品 (取消/失败都不残留)
    try { if (dest) fs.rmSync(dest + ".part", { force: true }); } catch {}
    const msg = dlState.err === "cancelled" ? "下载已停止" : "下载失败: " + (e.message || e);
    return { ok: false, stopped: dlState.err === "cancelled", err: msg };
  } finally { updateBusy = false; dlState.busy = false; }
}
function updateApply() {
  // sudo -n: 未授权时立即失败 (不挂起), 返回一次性授权命令
  const files = updateFiles();
  if (!files.length) return { ok: false, err: "update 目录没有已下载的 fpk" };
  if (!sudoAuthorized()) return { ok: false, err: "sudo 白名单未覆盖当前下载目录 (授权命令见下方, 路径跟随所选目录)" };
  const file = path.join(selectedUpdateDir(), files.map(f => f.name).sort().pop());
  const log = fs.openSync(path.join(DATA_DIR, "dashboard.log"), "a");
  const child = spawn("sudo", ["-n", "/usr/local/bin/appcenter-cli", "install-fpk", file], { detached: true, stdio: ["ignore", log, log] });
  child.on("error", () => {});
  child.unref();
  return { ok: true, dispatched: true, file };
}
// 代理设置 (issue #4): 写回 proxy.conf 与 dsh 主进程共用 (重启后 dsh 也走代理)
function writeProxyConf(value) {
  const f = path.join(DATA_DIR, "dsh_home", "proxy.conf");
  let lines = [];
  try { lines = fs.readFileSync(f, "utf8").split("\n"); } catch {}
  lines = lines.filter(l => !l.startsWith("PROXY="));
  if (value) lines.push("PROXY=" + value);
  fs.mkdirSync(path.dirname(f), { recursive: true });
  fs.writeFileSync(f, lines.filter((l, i, a) => l !== "" || i < a.length - 1).join("\n").replace(/\n{3,}/g, "\n\n").trim() + "\n", { mode: 0o600 });
}
// pnpm 失败可读化 (issue #8 P1.2)
function pnpmHint(errTail) {
  const t = (errTail || "").toLowerCase();
  if (/spawn.*enoent|command not found|not recognized/.test(t)) return "pnpm 不可用: 请确认依赖应用 nodejs_v24 已安装, 并重启一次 dsh (corepack shim 随启动注入)";
  if (/enotfound|etimedout|econnrefused|econnreset|socket hang up|network|certificate/.test(t)) return "网络不通或超时: 可在「总览 → 出站代理」配置代理后重试 (面板已自动回退 npmmirror 源)";
  if (/no match|404|not found/.test(t)) return "包或版本不存在: 检查名称/版本号; @deepseek-ai/* 插件会自动钉到已装 dsh 版本, 该版本的插件包可能尚未发布";
  return "";
}

// ---- HTML (单页, 无外部依赖; 设计语言对齐 CreditDaddy) ----
const HTML_403 = `<!DOCTYPE html>
<html lang="zh-CN"><head><meta charset="utf-8"><title>403 — DeepSeek Harness</title>
<style>
:root{--bg:#f5f6f8;--surface:#fff;--border:#e5e5e5;--text:#1f1f1f;--text-3:#999;--warn:#d97706}
@media (prefers-color-scheme: dark){:root{--bg:#0a0a0c;--surface:#131316;--border:rgba(255,255,255,.13);--text:#e6e6e9;--text-3:rgba(230,230,233,.5);--warn:#ffb03a}}
body{font:14px/1.7 -apple-system,BlinkMacSystemFont,"PingFang SC","Microsoft YaHei",sans-serif;background:var(--bg);color:var(--text);display:flex;align-items:center;justify-content:center;min-height:100vh;margin:0}
.box{background:var(--surface);border:1px solid var(--border);border-radius:18px;padding:28px 32px;max-width:520px}
h1{font-size:16px;margin:0 0 10px}code{background:var(--surface);border:1px solid var(--border);border-radius:6px;padding:1px 6px;font-size:12px}
.dim{color:var(--text-3);font-size:12px}.w{color:var(--warn)}
</style></head><body><div class="box">
<h1>⛔ 403 — 被信任围栏拦截</h1>
<p>管理面板仅信任 <b>本机 / 局域网 IP</b>、<code>fnos.net</code> / <code>5ddd.com</code> 及 <code>trusted_hosts.conf</code> 中配置的自定义信任域。</p>
<p>当前访问来源 Host: <code>__HOST__</code></p>
<p class="w">若这是你的合法入口 (如自定义 DDNS 域名), 请在 fnOS 应用设置页把它加入信任域 (FN Connect ID 或自定义域名), 保存后重启 dsh 生效。</p>
<p class="dim">请勿把 28001 端口暴露到不受信任的网络。</p>
</div></body></html>`;

const HTML_TMPL = `<!DOCTYPE html>
<html lang="zh-CN"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>DeepSeek Harness</title>
<style>
:root{--bg:#f5f6f8;--surface:#ffffff;--surface-2:#fafafa;--tertiary:#f0f0f0;--hover:#f5f6f8;--active:#eef0f3;--border-subtle:#eeeeee;--border:#e5e5e5;--border-strong:#cccccc;--text:#1f1f1f;--text-2:#5f6368;--text-3:#999999;--btn-bg:#1f1f1f;--btn-fg:#ffffff;--accent:#22c55e;--ok:#16a34a;--warn:#d97706;--err:#dc2626;--warn-soft:rgba(245,158,11,.12);--err-soft:rgba(239,68,68,.1);--shadow:0 10px 40px rgba(0,0,0,.12);--toast-shadow:0 6px 24px rgb(0 0 0 / 14%);--mask:rgba(0,0,0,.4)}
html[data-theme="dark"]{--bg:#0a0a0c;--surface:#131316;--surface-2:#17171b;--tertiary:#1b1b20;--hover:rgba(255,255,255,.06);--active:rgba(255,255,255,.1);--border-subtle:#202025;--border:rgba(255,255,255,.13);--border-strong:#3a3a42;--text:#e6e6e9;--text-2:rgba(230,230,233,.72);--text-3:rgba(230,230,233,.5);--btn-bg:rgba(255,255,255,.92);--btn-fg:#0a0a0c;--accent:#7f77dd;--ok:#2ee59d;--warn:#ffb03a;--err:#ff6b6b;--warn-soft:rgba(255,176,58,.12);--err-soft:rgba(255,107,107,.12);--shadow:0 10px 40px rgba(0,0,0,.5);--toast-shadow:0 6px 24px rgb(0 0 0 / 45%);--mask:rgba(0,0,0,.55)}
*{box-sizing:border-box;margin:0;padding:0}
body{font-family:-apple-system,BlinkMacSystemFont,"PingFang SC","Microsoft YaHei",sans-serif;font-size:13px;color:var(--text);background:var(--bg);min-height:100vh;-webkit-font-smoothing:antialiased}
button,input,select{font-family:inherit;font-size:inherit;color:inherit}
.wrap{max-width:1120px;margin:0 auto;padding:18px 22px 40px}
.num{font-variant-numeric:tabular-nums}
.head{display:flex;align-items:center;justify-content:space-between;gap:12px;padding:4px 2px 16px}
.brand{display:flex;align-items:center;gap:10px;min-width:0}
.logo{width:36px;height:36px;flex-shrink:0;display:block;border-radius:9px;object-fit:cover}
svg{width:15px;height:15px;flex-shrink:0;vertical-align:middle}
.ic{display:inline-flex;align-items:center}
.ic svg,.btn svg{width:14px;height:14px}
.busy svg{animation:spin 1s linear infinite}
.title{font-size:17px;font-weight:750;letter-spacing:-.5px;line-height:1.15}
.ver{color:var(--text-3);font-size:11px;line-height:1.3;font-variant-numeric:tabular-nums}
.head-right{display:flex;align-items:center;gap:10px;color:var(--text-3);font-size:12px}
.notice{margin:0 0 14px;padding:9px 12px;border-radius:10px;background:var(--warn-soft);color:var(--warn);font-size:12px;line-height:1.6;display:none}
.notice a{color:inherit;font-weight:600}
.nav{display:flex;gap:4px;padding:4px;margin-bottom:14px;background:var(--surface);border:1px solid var(--border-subtle);border-radius:12px;width:fit-content;max-width:100%;overflow-x:auto}
.nav button{display:inline-flex;align-items:center;gap:6px;border:none;background:transparent;color:var(--text-2);font-size:13px;font-weight:600;padding:7px 14px;border-radius:9px;cursor:pointer;white-space:nowrap;transition:background .15s,color .15s}
.nav button:hover{color:var(--text);background:var(--hover)}
.nav button.active{background:var(--btn-bg);color:var(--btn-fg)}
.nav .cnt{font-size:11px;font-weight:600;padding:1px 6px;border-radius:999px;background:var(--tertiary);color:var(--text-3);font-variant-numeric:tabular-nums}
.nav button.active .cnt{background:rgba(255,255,255,.18);color:inherit}
html[data-theme="dark"] .nav button.active .cnt{background:rgba(0,0,0,.12)}
.view{display:none}.view.active{display:block}
.panel{background:var(--surface);border:1px solid var(--border-subtle);border-radius:18px;box-shadow:0 1px 2px rgba(0,0,0,.03);overflow:hidden}
.toolbar{display:flex;align-items:center;justify-content:space-between;gap:12px;padding:12px 16px;border-bottom:1px solid var(--border-subtle);flex-wrap:wrap}
.summary{display:flex;align-items:center;gap:12px;flex-wrap:wrap}
.stat{display:flex;align-items:baseline;gap:5px;white-space:nowrap}
.stat span{color:var(--text-3);font-weight:500}
.stat strong{font-weight:700;font-variant-numeric:tabular-nums}
.divider{width:1px;height:16px;background:var(--border-subtle)}
.actions{display:flex;align-items:center;gap:6px;flex-wrap:wrap}
.btn{display:inline-flex;align-items:center;justify-content:center;gap:5px;padding:6px 11px;border:1px solid var(--border);border-radius:8px;background:var(--surface-2);color:var(--text-2);font-size:12px;font-weight:600;cursor:pointer;transition:all .15s;line-height:1.2;white-space:nowrap}
.btn:hover{background:var(--hover);border-color:var(--border-strong);color:var(--text)}
.btn.primary{background:var(--btn-bg);color:var(--btn-fg);border-color:var(--btn-bg)}
.btn.primary:hover{opacity:.88}
.btn.danger{background:#c62828;border-color:#c62828;color:#fff}
.btn:disabled{opacity:.5;cursor:not-allowed}
.icon-btn{width:28px;height:28px;border-radius:8px;display:inline-flex;align-items:center;justify-content:center;border:1px solid transparent;background:var(--hover);color:var(--text-2);cursor:pointer;transition:all .15s;padding:0}
.icon-btn:hover{background:var(--active);color:var(--text)}
.icon-btn.del:hover{background:var(--err-soft);color:var(--err)}
@keyframes spin{to{transform:rotate(360deg)}}
@keyframes indet{0%{transform:translateX(-100%)}100%{transform:translateX(350%)}}
.pcard{margin-top:14px;background:var(--surface);border:1px solid var(--border-subtle);border-radius:14px;padding:12px 14px}
.pcard-title{display:flex;align-items:center;justify-content:space-between;gap:8px;font-size:13px;font-weight:700}
.hint{color:var(--text-3);font-size:11px;font-weight:500}
.list{display:grid;grid-template-columns:repeat(auto-fill,minmax(440px,1fr));gap:4px 10px;padding:10px}
.card{position:relative;padding:11px 12px 12px;border-radius:12px;transition:background .12s;min-width:0}
.card:hover{background:var(--hover)}
.row1{display:flex;align-items:center;justify-content:space-between;gap:10px;min-height:28px;margin-bottom:7px}
.name{font-size:14px;font-weight:600;max-width:260px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.badge{display:inline-flex;align-items:center;font-size:10px;line-height:1;padding:3px 7px;border-radius:999px;font-weight:500;background:var(--tertiary);color:var(--text-2);white-space:nowrap}
.badge.official{color:#7c3aed;background:rgba(124,58,237,.1)}
html[data-theme="dark"] .badge.official{color:#b8a4ff}
.pill{display:inline-flex;align-items:center;height:22px;padding:1px 8px;border-radius:999px;font-size:11px;font-weight:600;white-space:nowrap;border:1px solid var(--border);background:transparent;color:var(--text-2)}
.pill.ok{color:var(--ok);border-color:rgba(22,163,74,.5)}
html[data-theme="dark"] .pill.ok{color:var(--ok);border-color:rgba(46,229,157,.4)}
.pill.off{color:var(--text-3)}
.pill.warnp{color:var(--warn);border-color:var(--warn-soft)}
.pill.errp{color:var(--err);border-color:var(--err-soft)}
.ops{display:flex;gap:6px;flex-shrink:0}
.meta{display:flex;align-items:center;justify-content:space-between;gap:12px;margin-bottom:6px;font-size:12px}
.mi{display:flex;align-items:center;gap:6px;min-width:0}
.lbl{color:var(--text-3);flex-shrink:0;white-space:nowrap}
.val{color:var(--text);font-variant-numeric:tabular-nums;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.dim{color:var(--text-3)}
.mono{font-family:ui-monospace,SFMono-Regular,Consolas,monospace}
.logs{margin-top:8px;font-family:ui-monospace,SFMono-Regular,Consolas,monospace;font-size:11px;line-height:1.65;max-height:420px;overflow-y:auto;background:var(--tertiary);border-radius:9px;padding:8px 10px;white-space:pre-wrap;word-break:break-all}
.logs .errl{color:var(--err)}.logs .warnl{color:var(--warn)}.logs .diml{color:var(--text-3)}
.kv{display:flex;justify-content:space-between;gap:12px;padding:4px 0;border-bottom:1px dashed var(--border-subtle);font-size:12.5px}
.kv:last-child{border-bottom:none}
.kv b{font-weight:normal;color:var(--text-3)}
.kv .val{flex-shrink:1}
.row{display:flex;gap:8px;align-items:center;margin:6px 0;flex-wrap:wrap}
input,select{background:var(--surface-2);color:var(--text);border:1px solid var(--border);border-radius:8px;padding:6px 9px;font-size:12.5px;outline:none}
input:focus,select:focus{border-color:var(--border-strong)}
.bar{display:flex;width:100%;height:5px;background:var(--tertiary);border-radius:3px;overflow:hidden}
.bar-in{height:100%;background:var(--accent);border-radius:3px;transition:width .4s}
.bar-ind{position:relative;width:100%}
.bar-ind::after{content:"";position:absolute;top:0;left:0;width:30%;height:100%;background:var(--accent);border-radius:3px;animation:indet 1.2s ease-in-out infinite}
.seg-ctl{display:inline-flex;gap:2px;padding:2px;border-radius:9px;background:var(--hover)}
.seg-ctl button{border:none;background:transparent;color:var(--text-2);font-size:12px;font-weight:600;padding:4px 10px;border-radius:7px;cursor:pointer}
.seg-ctl button.active{background:var(--surface);color:var(--text);box-shadow:0 1px 3px rgba(0,0,0,.08)}
html[data-theme="dark"] .seg-ctl button.active{background:rgba(255,255,255,.1)}
.empty{text-align:center;color:var(--text-3);padding:32px 12px;font-size:13px}
a{color:inherit;text-decoration:none}
.mask{position:fixed;inset:0;z-index:50;background:var(--mask);display:none;align-items:center;justify-content:center;padding:16px}
.mask.show{display:flex}
.modal{width:460px;max-width:100%;max-height:90vh;overflow-y:auto;background:var(--surface);border-radius:14px;padding:16px 18px;box-shadow:var(--shadow)}
.modal-title{display:flex;align-items:center;justify-content:space-between;font-size:14px;font-weight:700;margin-bottom:12px}
.modal-actions{display:flex;gap:8px;justify-content:flex-end;margin-top:14px}
#toast{position:fixed;bottom:24px;left:50%;transform:translate(-50%,8px);z-index:60;background:var(--surface);border:1px solid var(--border);border-radius:10px;padding:9px 14px;font-size:12px;box-shadow:var(--toast-shadow);opacity:0;pointer-events:none;transition:opacity .2s,transform .2s;max-width:80vw;white-space:pre-wrap}
#toast.show{opacity:1;transform:translate(-50%,0)}
#toast.err{border-color:var(--err);color:var(--err)}
</style></head><body data-theme="dark">
<div class="wrap">
  <header class="head">
    <div class="brand">
      <img class="logo" src="/logo.png" alt="dsh" onerror="this.style.display='none'">
      <div><div class="title">DeepSeek Harness</div><div class="ver" id="sub"></div></div>
    </div>
    <div class="head-right">
      <button class="icon-btn" id="langBtn" onclick="toggleLang()" title="Language">EN</button>
      <a class="icon-btn" href="https://github.com/techysy/deepseek-harness-fnos" target="_blank" rel="noopener" title="GitHub"><span data-ic="home"></span></a>
      <button class="icon-btn" id="themeBtn" onclick="toggleTheme()" title="Theme"></button>
    </div>
  </header>
  <div class="notice" id="upgradeBanner"></div>
  <nav class="nav">
    <button data-view="dash" class="active"><span data-i="navDash"></span></button>
    <button data-view="plugins"><span data-i="navPlugins"></span><span class="cnt" id="cnt-plugins">0</span></button>
    <button data-view="logs"><span data-i="navLogs"></span></button>
  </nav>

  <!-- 总览 -->
  <section class="view active" id="view-dash">
    <div class="panel">
      <div class="toolbar">
        <div class="summary" id="statSummary"><span class="dim">…</span></div>
        <div class="actions">
          <button class="btn" onclick="loadAll()"><span class="ic" data-ic="refresh"></span><span data-i="refreshAll"></span></button>
          <button class="btn primary" onclick="restartDsh(this)"><span class="ic" data-ic="refresh"></span><span data-i="restart"></span></button>
        </div>
      </div>
      <div style="padding:10px 16px 14px" id="statusDetail"><span class="dim">…</span></div>
    </div>
    <section class="pcard"><div class="pcard-title"><span data-i="versionCard"></span><span class="hint" id="verHint"></span></div>
      <div id="version" style="margin-top:8px"><span class="dim">…</span></div>
    </section>
    <section class="pcard"><div class="pcard-title"><span data-i="proxyCard"></span><span class="hint" data-i="proxyCardHint"></span></div>
      <div class="row" style="margin-top:8px">
        <input id="proxyInput" data-ip="proxyPh" style="flex:1;min-width:200px" class="mono">
        <button class="btn primary" onclick="saveProxy(this)" data-i="proxySave"></button>
        <span id="proxyState" class="hint"></span>
      </div>
    </section>
  </section>

  <!-- 插件 -->
  <section class="view" id="view-plugins">
    <div class="panel">
      <div class="toolbar">
        <div class="summary" id="plugSummary"><span class="dim">…</span></div>
        <div class="actions">
          <input id="newpkg" data-ip="newpkgPh" style="width:230px">
          <button class="btn primary" id="addBtn" onclick="addPlugin(this)"><span class="ic" data-ic="plus"></span><span data-i="installPlugin"></span></button>
        </div>
      </div>
      <div id="plugins" class="list"><span class="dim">…</span></div>
    </div>
    <div class="row" style="color:var(--text-3);font-size:11.5px;margin-top:10px"><span data-i="pluginsHint"></span></div>
  </section>

  <!-- 日志 -->
  <section class="view" id="view-logs">
    <div class="panel">
      <div class="toolbar">
        <div class="summary">
          <select id="logfile"><option value="app" data-i="logApp"></option><option value="dsh" data-i="logDsh"></option><option value="dashboard" data-i="logPanel"></option></select>
          <select id="lines"><option>100</option><option selected>300</option><option>800</option></select>
          <div class="seg-ctl" id="grepSeg">
            <button class="active" data-grep="">ALL</button>
            <button data-grep="error">error</button>
            <button data-grep="EADDRINUSE">EADDRINUSE</button>
            <button data-grep="patch">patch</button>
            <button data-grep="share:">share:</button>
          </div>
        </div>
        <div class="actions">
          <label style="display:inline-flex;align-items:center;gap:5px;color:var(--text-2);font-size:12px"><input type="checkbox" id="auto" onchange="autoLogs()" style="padding:0"><span data-i="autoRefresh"></span></label>
          <button class="btn" onclick="loadLogs()"><span class="ic" data-ic="refresh"></span><span data-i="refresh"></span></button>
        </div>
      </div>
      <div class="logs" id="logview"><span class="dim">…</span></div>
    </div>
  </section>
</div>

<div id="toast"></div>
<div class="mask" id="modalMask">
  <div class="modal">
    <div class="modal-title"><span id="modalTitle"></span><button class="icon-btn" id="modalX" onclick="modalCleanup(false)"><span data-ic="x"></span></button></div>
    <div id="modalBody" style="font-size:12.5px;line-height:1.7;white-space:pre-wrap;word-break:break-word"></div>
    <div class="modal-actions">
      <button class="btn" id="modalCancelBtn" data-i="cancel">取消</button>
      <button class="btn primary" id="modalConfirmBtn" data-i="confirm">确定</button>
    </div>
  </div>
</div>

<script>
const $=id=>document.getElementById(id);
const I18N={
zh:{title:"DeepSeek Harness 管理面板",panelSub:"管理面板",navDash:"总览",wsLabel:"工作区",dlStop:"停止",dlStopped:"已停止下载",copyLink:"复制直链",navPlugins:"插件",navLogs:"日志",restart:"重启 dsh",refreshAll:"刷新全部",refresh:"刷新",loading:"加载中…",running:"运行中",notRunning:"未运行",health:"健康",uptime:"运行",statDsh:"dsh web",statFpk:"fpk 版本",statDisk:"数据区",statModel:"语音模型",statProxy:"网关代理",versionCard:"版本 / 更新",proxyCard:"出站代理 (GitHub / Gitee)",proxyCardHint:"与 dsh 主进程共用 proxy.conf; 面板立即生效, dsh 重启后生效",proxyPh:"http://IP:端口 (留空保存 = 恢复直连)",proxySave:"保存代理",proxySaved:"已保存; dsh 主进程重启后同样生效",proxyBad:"格式无效, 需 http:// 开头",proxyCurrent:"当前代理",proxyNone:"未配置 (直连)",dirDefault:"默认 (dsh_home/update)",dirRefresh:"刷新目录列表",dirApiNA:"自定义目录需 fnOS ≥ 1.34.0: 在 应用设置 → 授权目录 添加后点刷新 (官方开放 API)",dirSaved:"下载目录已保存",fpkVer:"fpk 版本",dshInstalled:"已装 dsh 版本",upstreamVer:"上游官方版本",projectRel:"本项目最新 Release",isLatest:"已是最新",hasNew:"发现新版",detectFail:"探测失败",hotDownload:"一键下载到 NAS",hotHint:"GitHub 直链 · 约 121MB",downloading:"下载中…",dlDone:"下载完成",dlFail:"下载失败",dlEta:"剩余",dlSpeed:"速度",updateFilesTitle:"已下载的更新",noUpdateFiles:"update 目录为空",installUpdate:"安装更新 (appcenter-cli)",sudoNeed:"安装前需一次配置 sudo 白名单 (永久生效, 仅允许安装所选目录内的 fpk):",sudoAuthorized:"已授权",sudoNotAuthorized:"未授权",copy:"复制",copied:"已复制",delUpdQ:"删除已下载的 {name} ?",updateWays:"更新方式: ① 面板一键下载 → 安装更新 ② 下载 GitHub Release fpk → 应用中心手动安装 (数据区保留)",pluginsHint:"安装 @deepseek-ai/* 自动钉到已装 dsh 版本 · bundles 开关重启 dsh 生效 · 官方实验性插件也可在 dsh 内置插件页管理 (组件级开关)",thirdParty:"第三方插件",officialExp:"官方实验性插件",officialHintLine:"也可在 dsh 内置插件页管理 (组件级开关)",badgeThird:"第三方",badgeOfficial:"官方实验",badgeBundleOnly:"仅 bundles",enabled:"启用中",disabled:"已禁用",enableQ:"启用",disableQ:"禁用",noPlugins:"未安装第三方 / 官方实验性插件",coreBundles:"核心 bundles: ",versionMismatch:"与 dsh 版本不一致",mismatchTip:"版本不一致: 可在本面板重装该插件 (自动钉到当前 dsh 版本), 或在 dsh 插件页升级",installPlugin:"安装",newpkgPh:"@scope/plugin-name 或 包名",installing:"安装中… 最长 5 分钟",pinConfirmTitle:"安装官方插件",pinConfirmMsg:"将安装 {name}@{ver} (自动钉到已装 dsh 版本)。确认继续?",pluginCount:"插件",consistencyWarn:"版本不一致",restartConfirmTitle:"确认重启服务",restartConfirmMsg:"确定要重启 dsh 吗? 管理面板会短暂离线, 约 15~30 秒后自动恢复连接。",restartSent:"重启指令已发送…",restartDone:"重启完成",restartTimeout:"重启超时, 请刷新页面检查",fence403:"被信任围栏拒绝 (403)",reqFail:"请求失败: ",opFail:"操作失败",enableConfirmTitle:"启用插件确认",disableConfirmTitle:"禁用插件确认",enableConfirmMsg:"确定要启用插件 {name} 吗? 修改配置后需重启 dsh 才能生效。",disableConfirmMsg:"确定要禁用插件 {name} 吗? 禁用后此插件将被移出活动 bundles, 需重启 dsh 生效。",removeConfirmTitle:"删除插件确认",removeConfirmMsg:"确定要彻底删除插件 {name} 吗? 将从 profiles/web/package.json 彻底移除并清理依赖。此操作无法撤销!",deleteConfirmTitle:"删除文件确认",enableDone:"已启用, 重启 dsh 生效",disableDone:"已禁用, 重启 dsh 生效",removeDone:"已删除",removeDonePnpm:"已删除 (pnpm remove 完成)",removeDoneNo:"已删除 (pnpm 不可用, 仅移出 bundles)",removeFail:"删除失败",addDone:"已安装并启用, 重启 dsh 生效",addFail:"安装失败",applyConfirmTitle:"确认热更新安装",applyConfirmMsg:"确定使用 appcenter-cli 覆盖安装此版本吗? 安装期间系统会自动重启 dsh 服务, 管理面板将短暂离线约 1 分钟。",applySent:"安装指令已下发, App Center 安装中… 约 1 分钟后刷新页面",applyFail:"安装失败: 可能未授权 sudo",applyNeedAuth:"尚未授权 sudo, 请先执行下方授权命令",logApp:"app.log (生命周期)",logDsh:"dsh.log (dsh 输出)",logPanel:"dashboard.log (本面板)",autoRefresh:"自动刷新(5s)",emptyLog:"(空)",upgradedTitle:"🎉 fpk 已升级: {old} → {new}",viewNotes:"查看更新说明",confirm:"确定",cancel:"取消",dataDirLabel:"数据区"},
en:{title:"DeepSeek Harness Console",panelSub:"Console",navDash:"Overview",dlStop:"Stop",dlStopped:"Download stopped",copyLink:"Copy link",wsLabel:"Workspace",dlStop:"Stop",dlStopped:"Download stopped",wsLabel:"Workspace",navPlugins:"Plugins",navLogs:"Logs",restart:"Restart dsh",refreshAll:"Refresh all",refresh:"Refresh",loading:"Loading…",running:"Running",notRunning:"Stopped",health:"Health",uptime:"Uptime",statDsh:"dsh web",statFpk:"fpk version",statDisk:"Data dir",statModel:"Voice model",statProxy:"Gateway proxy",versionCard:"Version / Update",proxyCard:"Outbound proxy (GitHub / Gitee)",proxyCardHint:"Shared proxy.conf with dsh main process; effective for panel immediately, for dsh after restart",proxyPh:"http://IP:port (save empty = direct)",proxySave:"Save proxy",proxySaved:"Saved; also applies to dsh main process after restart",proxyBad:"Invalid format, must start with http://",proxyCurrent:"Current proxy",proxyNone:"Not configured (direct)",dirDefault:"Default (dsh_home/update)",dirRefresh:"Refresh dir list",dirApiNA:"Custom dir needs fnOS ≥ 1.34.0: add it in App Settings → Authorized dirs, then refresh (official open API)",dirSaved:"Download dir saved",fpkVer:"fpk version",dshInstalled:"Installed dsh",upstreamVer:"Upstream official",projectRel:"Latest project Release",isLatest:"Up to date",hasNew:"New version",detectFail:"Not detected",hotDownload:"Download to NAS",hotHint:"GitHub direct · ~121MB",downloading:"Downloading…",dlDone:"Download complete",dlFail:"Download failed",dlEta:"ETA",dlSpeed:"Speed",updateFilesTitle:"Downloaded updates",noUpdateFiles:"update dir is empty",installUpdate:"Install update (appcenter-cli)",sudoNeed:"One-time sudo whitelist required before installing (persistent, allows installing fpk from the selected dir only):",sudoAuthorized:"Authorized",sudoNotAuthorized:"Not authorized",copy:"Copy",copied:"Copied",delUpdQ:"Delete downloaded {name} ?",updateWays:"Update paths: ① panel download → install update ② download GitHub Release fpk → App Center manual install (data preserved)",pluginsHint:"Installing @deepseek-ai/* pins to installed dsh version · bundle toggles take effect after dsh restart · official experimental plugins can also be managed in dsh built-in plugin page",thirdParty:"Third-party plugins",officialExp:"Official experimental",officialHintLine:"Also manageable in the dsh built-in plugin page (component toggles)",badgeThird:"3rd-party",badgeOfficial:"Official exp.",badgeBundleOnly:"bundles only",enabled:"Enabled",disabled:"Disabled",enableQ:"Enable",disableQ:"Disable",noPlugins:"No third-party or official experimental plugins installed",coreBundles:"Core bundles: ",versionMismatch:"Version mismatch",mismatchTip:"Version mismatch: reinstall this plugin here (pins to current dsh version) or upgrade it in the dsh plugin page",installPlugin:"Install",newpkgPh:"@scope/plugin-name or name",installing:"Installing… up to 5 min",pinConfirmTitle:"Install official plugin",pinConfirmMsg:"Will install {name}@{ver} (pinned to installed dsh version). Continue?",pluginCount:"Plugins",consistencyWarn:"Mismatch",restartConfirmTitle:"Restart Service",restartConfirmMsg:"Restart dsh? The panel will go offline briefly and auto-recover in 15-30s.",restartSent:"Restart command sent…",restartDone:"Restart complete",restartTimeout:"Restart timed out, please refresh",fence403:"Blocked by trust fence (403)",reqFail:"Request failed: ",opFail:"Operation failed",enableConfirmTitle:"Enable Plugin",disableConfirmTitle:"Disable Plugin",enableConfirmMsg:"Enable plugin {name}? Takes effect after restarting dsh.",disableConfirmMsg:"Disable plugin {name}? Removed from active bundles, takes effect after restarting dsh.",removeConfirmTitle:"Remove Plugin",removeConfirmMsg:"Permanently delete {name}? Removed from profiles/web/package.json with dependencies cleaned. Cannot be undone!",deleteConfirmTitle:"Delete File",enableDone:"Enabled, takes effect after dsh restart",disableDone:"Disabled, takes effect after dsh restart",removeDone:"Deleted",removeDonePnpm:"Deleted (pnpm remove done)",removeDoneNo:"Deleted (pnpm unavailable, bundles only)",removeFail:"Delete failed",addDone:"Installed & enabled, takes effect after dsh restart",addFail:"Install failed",applyConfirmTitle:"Confirm Hot Update",applyConfirmMsg:"Install this fpk update via appcenter-cli? dsh will restart automatically and the panel will be offline for about 1 minute.",applySent:"Install dispatched, App Center installing… refresh in ~1 min",applyFail:"Install failed: sudo not granted?",applyNeedAuth:"sudo not granted yet, run the grant command below first",logApp:"app.log (lifecycle)",logDsh:"dsh.log (dsh output)",logPanel:"dashboard.log (panel)",autoRefresh:"Auto (5s)",emptyLog:"(empty)",upgradedTitle:"🎉 fpk upgraded: {old} → {new}",viewNotes:"Release notes",confirm:"Confirm",cancel:"Cancel",dataDirLabel:"data dir"}
};
let LANG=localStorage.getItem("dsh-lang")||((navigator.language||"").toLowerCase().indexOf("zh")===0?"zh":"en");
function t(k){const d=I18N[LANG]||I18N.zh;return d[k]!==undefined?d[k]:(I18N.zh[k]!==undefined?I18N.zh[k]:k)}
function applyStaticLang(){document.documentElement.lang=LANG==="zh"?"zh-CN":"en";document.title=t("title");
document.querySelectorAll("[data-i]").forEach(e=>e.textContent=t(e.dataset.i));
document.querySelectorAll("[data-ip]").forEach(e=>e.placeholder=t(e.dataset.ip));
$("langBtn").textContent=LANG==="zh"?"EN":"中"}
function toggleLang(){LANG=LANG==="zh"?"en":"zh";localStorage.setItem("dsh-lang",LANG);applyStaticLang();loadAll()}
let THEME=localStorage.getItem("dsh-theme")||(window.matchMedia&&matchMedia("(prefers-color-scheme: light)").matches?"light":"dark");
function applyTheme(){document.documentElement.dataset.theme=THEME;applyIcons()}
function toggleTheme(){THEME=THEME==="dark"?"light":"dark";localStorage.setItem("dsh-theme",THEME);applyTheme()}
let toastTimer=null;
function toast(m,bad){const el=$("toast");el.textContent=m;el.classList.toggle("err",!!bad);el.classList.add("show");clearTimeout(toastTimer);toastTimer=setTimeout(()=>el.classList.remove("show"),3200)}
function esc(s){return String(s==null?"":s).replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;")}
function copyText(txt,btn){
  const done=()=>{if(btn){const sp=btn.querySelector("span");const tgt=sp||btn;const o=tgt.textContent;tgt.textContent=t("copied");setTimeout(()=>tgt.textContent=o,1500)}else toast(t("copied"))};
  if(navigator.clipboard&&window.isSecureContext){navigator.clipboard.writeText(txt).then(done,()=>fallback())}else fallback();
  function fallback(){const ta=document.createElement("textarea");ta.value=txt;ta.style.position="fixed";ta.style.opacity="0";document.body.appendChild(ta);ta.select();try{document.execCommand("copy");done()}catch(e){}document.body.removeChild(ta)}
}
async function saveUpdDir(dir){
  const d=await api("/api/update/dir",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({dir})});
  d&&d.ok?(toast(t("dirSaved")),loadVersion()):toast((d&&d.err)||t("opFail"),1);
}
// 视图导航 (CreditDaddy 式)
document.querySelectorAll(".nav button").forEach(b=>b.addEventListener("click",()=>{
  document.querySelectorAll(".nav button").forEach(x=>x.classList.remove("active"));b.classList.add("active");
  document.querySelectorAll(".view").forEach(v=>v.classList.remove("active"));
  $("view-"+b.dataset.view).classList.add("active");
}));
// 现代友好的异步模态确认弹窗 (CreditDaddy mask/modal 样式)
let modalResolve=null;
function modalConfirm({title, text, okText, danger, warn}){
  return new Promise(resolve=>{
    modalResolve=resolve;
    $("modalTitle").textContent=(danger?"⚠️ ":"")+(title||t("confirm"));
    $("modalBody").textContent=text||"";
    const ok=$("modalConfirmBtn");
    ok.textContent=okText||t("confirm");
    ok.className="btn "+(danger?"danger":(warn?"primary":"primary"));
    $("modalMask").classList.add("show");
    ok.focus();
  });
}
function modalCleanup(res){$("modalMask").classList.remove("show");if(modalResolve){modalResolve(res);modalResolve=null}}
$("modalConfirmBtn").addEventListener("click",()=>modalCleanup(true));
$("modalCancelBtn").addEventListener("click",()=>modalCleanup(false));
$("modalMask").addEventListener("click",e=>{if(e.target===$("modalMask"))modalCleanup(false)});
window.addEventListener("keydown",e=>{if(e.key==="Escape")modalCleanup(false)});
async function api(p,opt){try{const r=await fetch(p,opt);if(r.status===403){toast(t("fence403"),1);return null}return await r.json()}catch(e){toast(t("reqFail")+e.message,1);return null}}
function stat(label,val,cls){return '<div class="stat"><span>'+label+'</span><strong'+(cls?' class="'+cls+'"':'')+'>'+val+"</strong></div>"}
function kv(k,v){return '<div class="kv"><b>'+k+'</b><span class="val">'+v+"</span></div>"}
function pill(text,cls){return '<span class="pill '+(cls||"")+'">'+text+"</span>"}
let lastPlugins=null;
// ---- 总览 ----
async function loadStatus(){const d=await api("/api/status");if(!d)return;
$("sub").textContent=t("panelSub")+" · fpk "+d.fpkVersion+" · "+t("dataDirLabel")+" "+d.dataDir;
const disk=d.disk||{};
$("statSummary").innerHTML=
stat(t("statDsh"),d.dsh.running?t("running"):t("notRunning"),d.dsh.running?"":"errp")+
'<div class="divider"></div>'+
stat(t("health"),d.dsh.health==="OK"?"OK":d.dsh.health,d.dsh.health==="OK"?"":"errp")+
stat(t("uptime"),esc(d.dsh.uptime||"-"))+
'<div class="divider"></div>'+
stat(t("statFpk"),esc(d.fpkVersion))+
stat(t("statDisk"),disk.dataDir||"-")+
stat(t("statModel"),disk.speech||"-")+
stat(t("statProxy"),d.proxy&&d.proxy.running?t("running"):t("notRunning"),d.proxy&&d.proxy.running?"":"");
$("statusDetail").innerHTML=
kv("pid",esc(d.dsh.pid||"-")+" · panel "+esc(d.dashboard))+
kv(t("dshInstalled"),esc(d.dshPkgVersion))+
kv(t("wsLabel"),esc(d.dshHome||"-"))+
kv(t("statDisk"),esc(disk.dataDir||"-")+" · "+t("statModel")+" "+esc(disk.speech||"-")+" · update "+esc(disk.update||"0"));
// 升级横幅 (issue #8 P2): fpk 版本变化时提示 changelog
const KEY="dsh-fpk-ver",stored=localStorage.getItem(KEY);
if(stored&&stored!==d.fpkVersion){
  $("upgradeBanner").style.display="block";
  $("upgradeBanner").innerHTML=t("upgradedTitle").replace("{old}",esc(stored)).replace("{new}",esc(d.fpkVersion))+' <a href="https://github.com/techysy/deepseek-harness-fnos/releases/tag/v'+esc(d.fpkVersion)+'" target="_blank" rel="noopener">'+t("viewNotes")+"</a>";
}
localStorage.setItem(KEY,d.fpkVersion);
}
// ---- 版本 / 更新 ----
let dlPoll=null;
async function loadVersion(){const d=await api("/api/version");if(!d)return;
let up="";
if(d.upstreamDsh){
  const tagDisplay=d.upstreamTag||("v"+d.upstreamDsh);
  const tagLink=d.upstreamUrl?('<a href="'+d.upstreamUrl+'" target="_blank" rel="noopener" style="text-decoration:underline">'+esc(tagDisplay)+"</a>"):esc(tagDisplay);
  // 已是最新判定兼容本地构建段 (docs/packaging-fpk.md §1): fpk 版本 = 上游版本 + 纯数字构建段
  // (如 0.2.0-rc.2.1), 等于上游号或以其为前缀加 "." 即视为最新; 上游真出新版时正常提示
  const inst=d.dshInstalled||"";
  const isLatest=inst===d.upstreamDsh||(d.upstreamDsh&&inst.startsWith(d.upstreamDsh+"."));
  if(isLatest) up=pill(t("isLatest"),"ok")+" "+tagLink;
  else up=pill(t("hasNew"),"warnp")+" "+tagLink;
} else up='<span class="dim">'+t("detectFail")+"</span>";
let pr=d.projectRelease?('<a href="'+d.projectRelease.url+'" target="_blank" rel="noopener" style="text-decoration:underline">'+esc(d.projectRelease.tag)+"</a>"):'<span class="dim">'+t("detectFail")+"</span>";
let html=kv(t("fpkVer"),esc(d.fpk))+kv(t("upstreamVer"),up)+kv(t("projectRel"),pr);
html+='<div class="row" style="margin-top:10px"><button class="btn primary" id="dlBtn" onclick="hotUpdate(this)">'+svg(ICONS.download)+"<span>"+t("hotDownload")+'</span></button><button class="btn" id="linkBtn" onclick="copyLink(this)">'+svg(ICONS.copy)+"<span>"+t("copyLink")+"</span></button>"+'<span class="hint">'+t("hotHint")+"</span></div>";
html+='<div id="dlArea"></div>';
// 已下载的更新 + 授权状态 + 下载目录选择
const st=await api("/api/update/state");
if(st){
  SUDO_CMD=st.sudoHint||"";
  const files=st.files||[];
  // 下载目录 (issue #4): 默认 + fnOS 官方授权目录 (应用设置 → 授权目录)
  const dirs=[[st.defaultDir,t("dirDefault")]].concat((st.authorizedDirs||[]).filter(x=>x!==st.defaultDir).map(x=>[x,x]));
  html+='<div class="row" style="margin-top:10px">'+svg(ICONS.folder)+'<select id="updDir" onchange="saveUpdDir(this.value)" style="flex:1;min-width:220px">';
  for(const dv of dirs) html+='<option value="'+esc(dv[0])+'"'+(dv[0]===st.updateDir?" selected":"")+">"+esc(dv[1])+"</option>";
  html+='</select><button class="btn" onclick="loadVersion()" title="'+t("dirRefresh")+'">'+svg(ICONS.refresh)+"</button></div>";
  if(!st.dirApiAvailable) html+='<div class="hint" style="margin-top:2px">'+t("dirApiNA")+"</div>";
  html+='<div class="pcard-title" style="margin-top:12px"><span>'+t("updateFilesTitle")+"</span>"+(st.authorized?pill(t("sudoAuthorized"),"ok"):pill(t("sudoNotAuthorized"),"warnp"))+"</div>";
  if(!files.length) html+='<div class="dim" style="margin-top:6px">'+t("noUpdateFiles")+"</div>";
  else{
    for(const f of files) html+='<div class="row"><span class="mono val" style="flex:1">'+esc(f.name)+'</span><span class="dim num">'+humanSize(f.size)+" · "+new Date(f.mtime).toLocaleString()+'</span><button class="icon-btn del" onclick="delUpdate(this)" data-name="'+esc(f.name)+'" title="delete">'+svg(ICONS.x)+"</button></div>";
    html+='<div class="row"><button class="btn primary" onclick="applyUpdate()">'+t("installUpdate")+"</button></div>";
  }
  if(!st.authorized){
    html+='<div class="dim" style="margin-top:8px">'+t("sudoNeed")+"</div>";
    html+='<div class="row"><button class="btn" onclick="copyText(SUDO_CMD,this)">'+svg(ICONS.copy)+"<span>"+t("copy")+"</span></button></div>";
    html+='<div class="logs mono" style="max-height:90px">'+esc(st.sudoHint||"")+"</div>";
  }
}
$("version").innerHTML=html;
// 恢复轮询: 页面加载时若后端正在下载, 继续显示进度
if(st&&st.downloading){$("dlBtn")&&($("dlBtn").disabled=true);renderProgress(st);startDlPoll()}
}
let SUDO_CMD="";
function humanSize(n){if(!n&&n!==0)return"-";if(n<1024)return n+"B";const u=["KB","MB","GB","TB"];let i=-1;do{n/=1024;i++}while(n>=1024&&i<u.length-1);return n.toFixed(n>=100?0:1)+u[i]}
// Feather 风格内联 SVG (对齐 CreditDaddy): stroke=currentColor, 无外部依赖
const ICONS={
moon:'<path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"/>',
sun:'<circle cx="12" cy="12" r="5"/><line x1="12" y1="1" x2="12" y2="3"/><line x1="12" y1="21" x2="12" y2="23"/><line x1="4.22" y1="4.22" x2="5.64" y2="5.64"/><line x1="18.36" y1="18.36" x2="19.78" y2="19.78"/><line x1="1" y1="12" x2="3" y2="12"/><line x1="21" y1="12" x2="23" y2="12"/><line x1="4.22" y1="19.78" x2="5.64" y2="18.36"/><line x1="18.36" y1="5.64" x2="19.78" y2="4.22"/>',
home:'<path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/><polyline points="9 22 9 12 15 12 15 22"/>',
x:'<line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>',
download:'<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/>',
copy:'<rect x="9" y="9" width="13" height="13" rx="2" ry="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/>',
refresh:'<polyline points="23 4 23 10 17 10"/><polyline points="1 20 1 14 7 14"/><path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15"/>',
plus:'<line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/>',
trash:'<polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/>',
folder:'<path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/>'
};
function svg(p){return '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">'+p+'</svg>'}
function applyIcons(){
  document.querySelectorAll("[data-ic]").forEach(e=>{e.innerHTML=svg(ICONS[e.dataset.ic]||"")});
  $("themeBtn").innerHTML=svg(ICONS[THEME==="dark"?"moon":"sun"]);
}
function renderProgress(s){
  const area=$("dlArea");if(!area)return;
  const pct=s.total?Math.min(100,Math.round(s.received/s.total*100)):0;
  const spd=s.speed?(s.speed/1048576).toFixed(2)+"MB/s":"-";
  const eta=(s.total&&s.speed)?Math.max(0,Math.round((s.total-s.received)/s.speed))+"s":"-";
  const bar=s.total?'<div class="bar"><div class="bar-in" style="width:'+pct+'%"></div></div>':'<div class="bar"><div class="bar-ind"></div></div>';
  area.innerHTML='<div style="margin-top:8px">'+bar+
  '<div class="row num" style="justify-content:space-between;color:var(--text-2);font-size:12px"><span>'+(s.total?pct+"% · ":"")+humanSize(s.received)+(s.total?" / "+humanSize(s.total):"")+"</span><span>"+t("dlSpeed")+" "+spd+(s.total?" · "+t("dlEta")+" "+eta:"")+'</span><button class="btn" onclick="stopDownload(this)">'+svg(ICONS.x)+"<span>"+t("dlStop")+"</span></button></div></div>";
}
async function stopDownload(btn){
  btn.disabled=true;
  const d=await api("/api/update/stop",{method:"POST"});
  d&&d.ok?toast(t("dlStopped")):toast((d&&d.err)||t("opFail"),1);
}
async function copyLink(btn){
  btn.disabled=true;
  const d=await api("/api/update/url");
  btn.disabled=false;
  if(d&&d.ok&&d.url){copyText(d.url,btn)}else toast((d&&d.err)||t("opFail"),1);
}
function startDlPoll(){if(dlPoll)return;dlPoll=setInterval(async()=>{
  const s=await api("/api/update/state");if(!s)return;
  if(s.downloading)renderProgress(s);
  else{clearInterval(dlPoll);dlPoll=null;loadVersion()}
},1000)}
async function hotUpdate(btn){
  btn.disabled=true;btn.classList.add("busy");btn.innerHTML=svg(ICONS.refresh)+"<span>"+t("downloading")+"</span>";
  $("dlArea").innerHTML='<div style="margin-top:8px"><div class="bar"><div class="bar-ind"></div></div><div class="dim" style="margin-top:4px">'+t("downloading")+"</div></div>";
  startDlPoll();
  const d=await api("/api/update/download",{method:"POST"});
  clearInterval(dlPoll);dlPoll=null;
  if(d&&d.ok){toast(t("dlDone"));loadVersion();loadStatus()}
  else if(d&&d.stopped){$("dlArea").innerHTML='<div class="row dim">'+t("dlStopped")+"</div>";btn.disabled=false;btn.classList.remove("busy");btn.innerHTML=svg(ICONS.download)+"<span>"+t("hotDownload")+"</span>"}
  else{$("dlArea").innerHTML='<div class="row" style="color:var(--err)">'+t("dlFail")+": "+esc((d&&d.err)||t("opFail"))+"</div>";btn.disabled=false;btn.classList.remove("busy");btn.innerHTML=svg(ICONS.download)+"<span>"+t("hotDownload")+"</span>"}
}
async function delUpdate(btn){
  const name=btn.dataset.name;
  const ok=await modalConfirm({title:t("deleteConfirmTitle"),text:t("delUpdQ").replace("{name}",name),okText:"✕",danger:true});
  if(!ok)return;
  const d=await api("/api/update/delete",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({name})});
  d&&d.ok?(toast(t("removeDone")),loadVersion()):toast(t("removeFail"),1);
}
async function applyUpdate(){
  const st=await api("/api/update/state");
  if(st&&!st.authorized){toast(t("applyNeedAuth"),1);return}
  const ok=await modalConfirm({title:t("applyConfirmTitle"),text:t("applyConfirmMsg"),okText:t("installUpdate"),warn:true});
  if(!ok)return;
  const d=await api("/api/update/apply",{method:"POST"});
  if(d&&d.ok){toast(t("applySent"));setTimeout(()=>location.reload(),60000)}
  else toast(t("applyFail"),1);
}
async function loadProxy(){const d=await api("/api/status");if(!d)return;
$("proxyInput").value=(d.proxy&&d.proxy.conf)||"";
$("proxyState").textContent=d.proxy&&d.proxy.conf?t("proxyCurrent")+": "+d.proxy.conf:t("proxyNone")}
async function saveProxy(btn){
  const v=$("proxyInput").value.trim();
  if(v&&!(v.startsWith("http://")||v.startsWith("https://"))){toast(t("proxyBad"),1);return}
  btn.disabled=true;
  const d=await api("/api/proxy",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({proxy:v})});
  btn.disabled=false;
  if(d&&d.ok){toast(t("proxySaved"));$("proxyState").textContent=v?t("proxyCurrent")+": "+v:t("proxyNone")}
  else toast(t("opFail"),1);
}
// ---- 插件 ----
async function loadPlugins(){const d=await api("/api/plugins");if(!d)return;lastPlugins=d;
const third=d.plugins.filter(p=>!p.official),official=d.plugins.filter(p=>p.official);
const mism=d.plugins.filter(p=>p.mismatch).length;
$("cnt-plugins").textContent=d.plugins.length;
$("plugSummary").innerHTML=
stat(t("pluginCount"),d.plugins.length)+
stat(t("thirdParty"),third.length)+
stat(t("officialExp"),official.length)+
(mism?stat(t("consistencyWarn"),mism,"errp"):"");
$("plugins").innerHTML=d.plugins.length?d.plugins.map(p=>{
  const status=p.enabled?pill(t("enabled"),"ok"):pill(t("disabled"),"off");
  const badges=(p.official?'<span class="badge official">'+t("badgeOfficial")+"</span>":'<span class="badge">'+t("badgeThird")+"</span>")+
    (p.source==="bundle"?'<span class="badge">'+t("badgeBundleOnly")+"</span>":"");
  let meta='<div class="meta"><div class="mi"><span class="lbl">'+t("ver")+'</span><span class="val mono">'+esc(p.version)+"</span>"+(p.mismatch?pill(t("versionMismatch"),"warnp"):"")+"</div></div>";
  let tip="";
  if(p.official) tip+='<div class="dim" style="font-size:11px;margin-top:2px">'+(p.dshVersion?"dsh "+esc(p.dshVersion)+" · ":"")+t("officialHintLine")+"</div>";
  if(p.mismatch) tip+='<div style="font-size:11px;margin-top:2px;color:var(--warn)">'+t("mismatchTip")+"</div>";
  return '<div class="card"><div class="row1"><div class="name mono" title="'+esc(p.name)+'">'+esc(p.name)+"</div>"+
  '<div class="ops">'+status+badges+
  (p.enabled?'<button class="btn" data-act="dis" data-name="'+esc(p.name)+'">'+t("disableQ")+"</button>":'<button class="btn" data-act="en" data-name="'+esc(p.name)+'">'+t("enableQ")+"</button>")+
  '<button class="icon-btn del" data-act="rm" data-name="'+esc(p.name)+'" title="delete">'+svg(ICONS.x)+"</button></div></div>"+meta+tip+"</div>";
}).join(""):'<div class="empty" style="grid-column:1/-1">'+t("noPlugins")+"</div>";
}
document.addEventListener("click",e=>{const b=e.target.closest("[data-act]");if(!b)return;const n=b.dataset.name,a=b.dataset.act;
if(a==="dis")plug(n,false);else if(a==="en")plug(n,true);else if(a==="rm")plugRemove(n)});
async function plug(name,enable){
  const ok=await modalConfirm({title:enable?t("enableConfirmTitle"):t("disableConfirmTitle"),text:(enable?t("enableConfirmMsg"):t("disableConfirmMsg")).replace("{name}",name),okText:enable?t("enableQ"):t("disableQ"),warn:!enable});
  if(!ok)return;
  const d=await api("/api/plugins/toggle",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({name,enable})});
  d&&d.ok?(toast(enable?t("enableDone"):t("disableDone")),loadPlugins()):toast(t("opFail"),1);
}
async function plugRemove(name){
  const ok=await modalConfirm({title:t("removeConfirmTitle"),text:t("removeConfirmMsg").replace("{name}",name),okText:"✕",danger:true});
  if(!ok)return;
  const d=await api("/api/plugins/remove",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({name})});
  d&&d.ok?(toast(d.pnpm?t("removeDonePnpm"):t("removeDoneNo")),loadPlugins()):toast(t("removeFail"),1);
}
async function addPlugin(btn){
  const n=$("newpkg").value.trim();if(!n)return;
  // 官方插件钉版本提示 (issue #8 P1.2): 后端会自动钉, 前端明示
  let spec=n;
  if(n.startsWith("@deepseek-ai/")&&lastPlugins&&lastPlugins.dshVersion&&!n.replace(/^@/,"").includes("@")){
    const ok=await modalConfirm({title:t("pinConfirmTitle"),text:t("pinConfirmMsg").replace("{name}",n).replace("{ver}",lastPlugins.dshVersion),okText:t("installPlugin")});
    if(!ok)return;
  }
  btn.disabled=true;btn.classList.add("busy");btn.innerHTML=svg(ICONS.refresh)+"<span>"+t("installing")+"</span>";
  const d=await api("/api/plugins/add",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({name:n})});
  btn.disabled=false;btn.classList.remove("busy");btn.innerHTML=svg(ICONS.plus)+"<span>"+t("installPlugin")+"</span>";
  if(d&&d.ok){toast(t("addDone"));$("newpkg").value="";loadPlugins()}
  else{let m=t("addFail")+": "+((d&&d.err)||t("opFail"));if(d&&d.hint)m+="\\n💡 "+d.hint;toast(m,1)}
}
// ---- 日志 ----
let curGrep="";
$("grepSeg").addEventListener("click",e=>{const b=e.target.closest("[data-grep]");if(!b)return;
$("grepSeg").querySelectorAll("button").forEach(x=>x.classList.remove("active"));b.classList.add("active");
curGrep=b.dataset.grep;loadLogs()});
async function loadLogs(){const f=$("logfile").value,n=$("lines").value;
const d=await api("/api/logs?file="+f+"&lines="+n+(curGrep?"&grep="+encodeURIComponent(curGrep):""));
if(d&&d.ok){
  const lines=(d.text||"").split("\\n");
  $("logview").innerHTML=lines.map(l=>{
    const cls=/error|fail|exception|eaddrinuse|eacces/i.test(l)?"errl":(/warn/i.test(l)?"warnl":(/^[\\s]*$/.test(l)?"diml":""));
    return cls?'<span class="'+cls+'">'+esc(l)+"</span>":esc(l);
  }).join("\\n")||t("emptyLog");
}}
let timer=null;function autoLogs(){clearInterval(timer);if($("auto").checked)timer=setInterval(loadLogs,5000)}
function loadAll(){loadStatus();loadVersion();loadProxy();loadPlugins();loadLogs()}
applyTheme();applyStaticLang();loadAll();
</script></body></html>`;

// 授权命令改为运行时从 /api/update/state 获取 (跟随所选下载目录), 不再静态注入
const HTML = HTML_TMPL;

// ---- 路由 ----
const server = http.createServer(async (req, res) => {
  const host = req.headers.host || "";
  if (!hostAllowed(host)) {
    const body = HTML_403.replace("__HOST__", String(host).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;"));
    res.writeHead(403, { "Content-Type": "text/html; charset=utf-8" });
    return res.end(body);
  }
  const u = new URL(req.url, "http://x");
  const send = (code, body, type = "application/json; charset=utf-8") => { res.writeHead(code, { "Content-Type": type }); res.end(body); };
  try {
    if (u.pathname === "/" && req.method === "GET") return send(200, HTML, "text/html; charset=utf-8");
    if (u.pathname === "/logo.png") {
      // dsh 应用图标 (DeepSeek 鲸鱼): NAS 上取安装目录, 本地/开发取仓库根
      const cands = [path.join(APP_DIR, "ICON_256.PNG"), path.join(__dirname, "..", "ICON_256.PNG"), path.join(__dirname, "ICON_256.PNG")];
      for (const c of cands) { try { const b = fs.readFileSync(c); res.writeHead(200, { "Content-Type": "image/png" }); return res.end(b); } catch {} }
      return send(404, "not found");
    }
    if (!DATA_DIR) return send(500, JSON.stringify({ error: "未找到 dsh 数据区" }));
    if (u.pathname === "/api/status") return send(200, JSON.stringify(await apiStatus()));
    if (u.pathname === "/api/version") return send(200, JSON.stringify(await apiVersion()));
    if (u.pathname === "/api/plugins") return send(200, JSON.stringify(apiPlugins()));
    if (u.pathname === "/api/logs" && req.method === "GET") {
      const f = u.searchParams.get("file") || "app";
      const n = Math.min(Number(u.searchParams.get("lines")) || 300, 2000);
      const grep = (u.searchParams.get("grep") || "").toLowerCase().slice(0, 64);
      const map = { app: path.join(DATA_DIR, "app.log"), dsh: path.join(DATA_DIR, "dsh.log"), dashboard: path.join(DATA_DIR, "dashboard.log") };
      if (!map[f]) return send(400, JSON.stringify({ ok: false, err: "bad file" }));
      let text = tail(map[f], n);
      if (grep) text = text.split("\n").filter(l => l.toLowerCase().includes(grep)).join("\n");
      return send(200, JSON.stringify({ ok: true, text }));
    }
    if (u.pathname === "/api/dsh/restart" && req.method === "POST") { restartDsh(); return send(200, JSON.stringify({ ok: true, msg: "restart dispatched" })); }
    if (u.pathname === "/api/update/download" && req.method === "POST") return send(200, JSON.stringify(await updateDownload()));
    if (u.pathname === "/api/update/apply" && req.method === "POST") return send(200, JSON.stringify(updateApply()));
    if (u.pathname === "/api/update/stop" && req.method === "POST") {
      // 停止下载: destroy 当前请求 → downloadToFile reject → updateDownload 清理 .part
      if (!dlState.busy || !dlState.req) return send(200, JSON.stringify({ ok: false, err: "无进行中的下载" }));
      try { dlState.req.destroy(new Error("cancelled")); } catch {}
      return send(200, JSON.stringify({ ok: true }));
    }
    if (u.pathname === "/api/update/url" && req.method === "GET") {
      // 直链给 IDM/浏览器下载: 用户拿链接自行下载后, 经飞牛文件管理器/SMB 传入
      // 共享区 update 目录, 面板「安装更新」即可识别
      const rel = await fetchLatestRelease();
      if (!rel) return send(200, JSON.stringify({ ok: false, err: "无法获取最新 Release (GitHub/Gitee 均不可达)" }));
      const asset = assetFor(rel, ARCH, "iframe") || assetFor(rel, ARCH, "");
      if (!asset || !asset.url) return send(200, JSON.stringify({ ok: false, err: "Release 未含 " + ARCH + " 架构 fpk 附件" }));
      return send(200, JSON.stringify({ ok: true, url: asset.url, tag: rel.tag_name }));
    }
    if (u.pathname === "/api/update/delete" && req.method === "POST") {
      const { name } = await readBody(req);
      if (!name || /[\/\\]/.test(name) || !name.endsWith(".fpk")) return send(400, JSON.stringify({ ok: false, err: "bad name" }));
      const file = path.join(selectedUpdateDir(), name);
      if (!fs.existsSync(file)) return send(200, JSON.stringify({ ok: false, err: "not found" }));
      fs.unlinkSync(file);
      return send(200, JSON.stringify({ ok: true }));
    }
    if (u.pathname === "/api/update/dir" && req.method === "POST") {
      // 选择下载目录: 仅允许默认目录或官方授权目录列表中的条目 (防任意路径写入)
      const { dir } = await readBody(req);
      const auth = await authorizedDirs();
      if (dir !== UPDATE_DIR && !auth.includes(dir)) return send(200, JSON.stringify({ ok: false, err: "目录不在授权列表中 (fnOS 应用设置 → 授权目录 添加后重试)" }));
      if (dir !== UPDATE_DIR && !fs.existsSync(dir)) return send(200, JSON.stringify({ ok: false, err: "目录不存在" }));
      fs.writeFileSync(UPD_DIR_CONF, dir + "\n", { mode: 0o600 });
      return send(200, JSON.stringify({ ok: true, dir: selectedUpdateDir() }));
    }
    if (u.pathname === "/api/update/state" && req.method === "GET") {
      const cur = selectedUpdateDir();
      const auth = await authorizedDirs();
      return send(200, JSON.stringify({
        ok: true, updateDir: cur, defaultDir: UPDATE_DIR,
        dirApiAvailable: !!(process.env.TRIM_API_TOKEN && dirCache.ok),
        authorizedDirs: auth,
        files: updateFiles(),
        sudoHint: sudoHintFor(cur),
        authorized: sudoAuthorized(),
        downloading: dlState.busy, file: dlState.file,
        received: dlState.received, total: dlState.total, speed: dlState.speed,
        lastError: dlState.err,
      }));
    }
    if (u.pathname === "/api/proxy" && req.method === "GET") return send(200, JSON.stringify({ ok: true, proxy: readProxyConf() }));
    if (u.pathname === "/api/proxy" && req.method === "POST") {
      const { proxy } = await readBody(req);
      const v = (proxy || "").trim();
      if (v && !/^https?:\/\/\S+$/.test(v)) return send(200, JSON.stringify({ ok: false, err: "bad format" }));
      writeProxyConf(v || null);
      return send(200, JSON.stringify({ ok: true, proxy: readProxyConf() }));
    }
    if (u.pathname === "/api/plugins/toggle" && req.method === "POST") {
      const { name, enable } = await readBody(req);
      if (!/^[@a-zA-Z0-9._\/-]+$/.test(name || "")) return send(400, JSON.stringify({ ok: false, err: "bad name" }));
      savePlugins((bundles) => {
        const set = new Set(bundles);
        if (enable) set.add(name); else set.delete(name);
        return [...set];
      });
      return send(200, JSON.stringify({ ok: true }));
    }
    if (u.pathname === "/api/plugins/remove" && req.method === "POST") {
      const { name } = await readBody(req);
      if (!/^[@a-zA-Z0-9._\/-]+$/.test(name || "")) return send(400, JSON.stringify({ ok: false, err: "bad name" }));
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
      // 官方插件版本跟随 dsh: @deepseek-ai/ 作用域且未显式带 @版本/@tag 时,
      // 钉到已装 dsh 版本再装 — 该作用域 dist-tags 的 latest 可能指向 alpha
      // (如 voice-input-bundle latest=0.1.7-alpha.1), 与运行中的 rc 版不匹配
      let spec = name;
      const dshVer = installedDshVersion();
      if (name.startsWith("@deepseek-ai/") && dshVer && !name.replace(/^@/, "").includes("@")) spec = `${name}@${dshVer}`;
      // 默认源失败回退 npmmirror (NAS 无代理时 npmjs 常超时)
      let installed = false, errTail = "";
      for (const args of [["add", spec], ["add", spec, "--registry=https://registry.npmmirror.com"]]) {
        try {
          execFileSync("pnpm", args, { cwd: PROFILE(), stdio: ["ignore", "pipe", "pipe"], timeout: 300000, env: process.env });
          installed = true;
          break;
        } catch (e) { errTail = ((e.stdout || "") + (e.stderr || "")).trim().slice(-300); }
      }
      if (!installed) return send(200, JSON.stringify({ ok: false, err: `pnpm add 失败 (pnpm 不可用、包/版本不存在或网络不通; 可在名称后显式加 @版本): ${errTail || "no output"}`, hint: pnpmHint(errTail) }));
      savePlugins((bundles) => { const s = new Set(bundles); s.add(name); return [...s]; });
      return send(200, JSON.stringify({ ok: true, pinned: spec !== name ? spec : undefined }));
    }
    return send(404, JSON.stringify({ error: "not found" }));
  } catch (e) { return send(500, JSON.stringify({ error: String(e.message || e) })); }
});

if (!DATA_DIR || !DSH_HOME) { console.error(`[${new Date().toISOString()}] dashboard: 未找到 dsh 数据区 (DATA_DIR=${DATA_DIR}), 退出`); process.exit(1); }
server.listen(Number(DASH_PORT), "0.0.0.0", () => {
  console.log(`[${new Date().toISOString()}] dashboard: 管理面板已启动 http://0.0.0.0:${DASH_PORT}/ (DATA_DIR=${DATA_DIR})`);
});
process.on("uncaughtException", e => console.error(`[${new Date().toISOString()}] dashboard: uncaught ${e.message}`));
