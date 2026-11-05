// Run without fnOS or external network: node scripts/test_proxy_config.js
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const net = require("node:net");
const { spawn, spawnSync } = require("node:child_process");
const { setTimeout: delay } = require("node:timers/promises");
const { once } = require("node:events");

const repo = path.resolve(__dirname, "..");
const keys = ["HTTP_PROXY", "HTTPS_PROXY", "ALL_PROXY", "http_proxy", "https_proxy", "all_proxy"];
const oldProxy = "http://127.0.0.1:18001", newProxy = "http://127.0.0.1:18002";
const inherited = Object.fromEntries(keys.map(k => [k, oldProxy]));
const direct = {};
const proxied = proxy => Object.fromEntries(keys.map(k => [k, proxy]));
const root = fs.mkdtempSync(path.join(os.tmpdir(), "dsh-proxy-regression-"));
const dshHome = path.join(root, "dsh_home");
const config = path.join(dshHome, "proxy.conf");
const capture = path.join(root, "children.jsonl");
const helper = path.join(root, "capture.js");
fs.mkdirSync(path.join(dshHome, "profiles/web"), { recursive: true });
fs.writeFileSync(path.join(dshHome, "profiles/web/package.json"), JSON.stringify({ dependencies: {}, dsh: { profile: { bundles: [] } } }));
fs.writeFileSync(helper, `const fs=require('node:fs'); fs.appendFileSync(process.env.CAPTURE_FILE, JSON.stringify({proxy:Object.fromEntries(${JSON.stringify(keys)}.filter(k=>process.env[k]!==undefined).map(k=>[k,process.env[k]])),bypass:process.env.NO_PROXY,untouched:process.env.PROXY_TEST_UNRELATED})+'\\n');`);
const bin = path.join(root, "bin");
fs.mkdirSync(bin);
for (const name of ["main", "pnpm"]) fs.writeFileSync(path.join(bin, name), '#!/bin/bash\nexec node "$CAPTURE_HELPER"\n', { mode: 0o700 });
const env = { ...process.env, ...inherited, NO_PROXY: "example.invalid", PROXY_TEST_UNRELATED: "keep", DSH_HOME: dshHome, DATA_DIR: root, CAPTURE_FILE: capture, CAPTURE_HELPER: helper, PATH: bin + path.delimiter + process.env.PATH };
let dashboard;

async function waitUntil(check) {
  for (let i = 0; i < 100; i++) { if (await check()) return; await delay(30); }
  throw new Error("Timed out waiting for fixture dashboard or child");
}
async function run() {
  // Execute the actual startup proxy block with isolated, real Git configuration.
  const main = fs.readFileSync(path.join(repo, "cmd/main"), "utf8");
  const block = main.slice(main.indexOf("    # 网络代理:"), main.indexOf("    # 工作区注册表路径修复:"));
  assert(block.includes("CFG_PROXY"));
  const gitConfig = path.join(dshHome, ".gitconfig");
  for (const value of [undefined, `PROXY=${newProxy}\n`, "", "PROXY=\n", "# direct\n"]) {
    if (value === undefined) { if (fs.existsSync(config)) fs.unlinkSync(config); } else fs.writeFileSync(config, value);
    fs.writeFileSync(gitConfig, `[http]\n\tproxy = ${oldProxy}\n[https]\n\tproxy = ${oldProxy}\n[user]\n\tname = fixture\n`);
    const result = spawnSync("bash", ["-c", 'log() { :; };\n' + block + '\nnode "$CAPTURE_HELPER"'], { env: { ...env, GIT_CONFIG_GLOBAL: gitConfig }, encoding: "utf8" });
    assert.equal(result.status, 0, result.stderr);
    const actual = JSON.parse(fs.readFileSync(capture, "utf8").trim().split("\n").pop());
    assert.deepEqual(actual, { proxy: value === undefined ? inherited : value.includes(newProxy) ? proxied(newProxy) : direct, bypass: "example.invalid", untouched: "keep" });
    const setting = spawnSync("git", ["config", "--global", "--get", "http.proxy"], { env: { ...env, GIT_CONFIG_GLOBAL: gitConfig }, encoding: "utf8" });
    assert.equal(setting.stdout.trim(), value === undefined ? oldProxy : value.includes(newProxy) ? newProxy : "");
    assert.equal(spawnSync("git", ["config", "--global", "--get", "https.proxy"], { env: { ...env, GIT_CONFIG_GLOBAL: gitConfig }, encoding: "utf8" }).stdout.trim(), setting.stdout.trim());
    assert(fs.readFileSync(gitConfig, "utf8").includes("name = fixture"));
  }
  fs.writeFileSync(capture, "");
  fs.writeFileSync(gitConfig, `[http]\n\tproxy = ${oldProxy}\n[https]\n\tproxy = ${oldProxy}\n[user]\n\tname = fixture\n`);
  if (fs.existsSync(config)) fs.unlinkSync(config);
  const listener = net.createServer(); listener.listen(0, "127.0.0.1"); await once(listener, "listening");
  const port = listener.address().port; await new Promise(resolve => listener.close(resolve));
  dashboard = spawn(process.execPath, [path.join(repo, "cmd/dashboard.js")], { env: { ...env, DASH_PORT: String(port), CMD_MAIN: path.join(bin, "main"), APP_DIR: root }, stdio: ["ignore", "ignore", "pipe"] });
  let error = ""; dashboard.stderr.on("data", data => { error += data; });
  const url = `http://127.0.0.1:${port}`;
  await waitUntil(async () => { assert.equal(dashboard.exitCode, null, error); try { return (await fetch(url + "/api/proxy")).ok; } catch { return false; } });
  const post = async (route, body) => {
    const response = await fetch(url + route, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    assert.equal(response.status, 200); const result = await response.json(); assert.equal(result.ok, true, JSON.stringify(result));
  };
  let count = 0;
  const child = async (route, body, expected) => {
    await post(route, body);
    await waitUntil(() => fs.readFileSync(capture, "utf8").trim().split("\n").filter(Boolean).length > count);
    const records = fs.readFileSync(capture, "utf8").trim().split("\n").map(s => JSON.parse(s));
    assert.deepEqual(records[count++], { proxy: expected, bypass: "example.invalid", untouched: "keep" });
  };
  await child("/api/dsh/restart", {}, inherited); // no saved file: external environment remains supported
  await post("/api/proxy", { proxy: newProxy });
  for (const key of ["http.proxy", "https.proxy"]) assert.equal(spawnSync("git", ["config", "--file", gitConfig, "--get", key], { encoding: "utf8" }).stdout.trim(), newProxy);
  await child("/api/dsh/restart", {}, proxied(newProxy));
  await child("/api/plugins/add", { name: "fixture-plugin" }, proxied(newProxy));
  await post("/api/proxy", { proxy: "" });
  for (const key of ["http.proxy", "https.proxy"]) assert.equal(spawnSync("git", ["config", "--file", gitConfig, "--get", key], { encoding: "utf8" }).stdout.trim(), "");
  assert(fs.readFileSync(gitConfig, "utf8").includes("name = fixture"));
  await child("/api/dsh/restart", {}, direct);
  await child("/api/plugins/add", { name: "fixture-plugin" }, direct);
  await child("/api/plugins/remove", { name: "fixture-plugin" }, direct);
  fs.writeFileSync(config, `PROXY=${oldProxy}\n`); // manual file edits must also take effect
  await child("/api/dsh/restart", {}, proxied(oldProxy));
  fs.writeFileSync(config, "");
  await child("/api/dsh/restart", {}, direct);
  await child("/api/dashboard/restart", {}, direct);
  console.log("PASS: startup, Git cleanup, saved proxy changes/clearing, dsh/dashboard restart and plugin child environments");
}
run().catch(error => { console.error(error); process.exitCode = 1; }).finally(async () => {
  if (dashboard && dashboard.exitCode === null) { dashboard.kill(); await once(dashboard, "exit"); }
  fs.rmSync(root, { recursive: true, force: true });
});
