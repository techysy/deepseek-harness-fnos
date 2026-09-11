#!/usr/bin/env bash
# =============================================================================
# fix-browser-auth-401.sh — 手动修复桌面打开 401
# "dsh web authentication required; reopen the URL printed by dsh web"
# =============================================================================
# 背景: 上游 dsh 0.1.2+ 给 web 加了浏览器 token 鉴权 (launch token → 30 天
# cookie), fpk 桌面入口是静态 URL 裸 /, 无 cookie 即 401.
# cmd/main 启动时本会自动打此补丁; 本脚本用于:
#   - cmd/main 补丁因环境差异静默失败的环境 (如 /usr/bin/python3 缺失)
#   - 升级/重装后不想重启整个应用, 快速热修
#
# 用法 (在 NAS SSH 里, 二选一):
#   bash fix-browser-auth-401.sh
#   curl -sL https://gitee.com/techysy/deepseek-harness-fnos/raw/main/scripts/fix-browser-auth-401.sh | sudo bash
#
# 打完需在 应用中心 重启 dsh (或重启 NAS) 生效.
# =============================================================================
set -uo pipefail

# ---- 定位 node (nodejs_v24 依赖应用, dsh 硬依赖) ----
NODE=""
for cand in /var/apps/nodejs_v24/target/bin/node /var/apps/nodejs_v24/target/bin/../bin/node \
            "$(find /vol*/@appcenter/nodejs_v24 -maxdepth 3 -name node -type f 2>/dev/null | head -1)" \
            "$(command -v node 2>/dev/null)"; do
    [ -x "$cand" ] && NODE="$cand" && break
done
[ -n "$NODE" ] || { echo "❌ 未找到 node (nodejs_v24 未安装?)"; exit 1; }
echo "==> node: $NODE"

# ---- 定位 dsh-client-connection/lib/index.js ----
CC_LIB=""
for cand in \
    /var/apps/dsh/target/server/node_modules/@deepseek-ai/dsh-client-connection/lib/index.js \
    /var/apps/dsh/server/node_modules/@deepseek-ai/dsh-client-connection/lib/index.js \
    /vol*/@appcenter/dsh/server/node_modules/@deepseek-ai/dsh-client-connection/lib/index.js \
    /vol*/@appcenter/deepseek-harness/server/node_modules/@deepseek-ai/dsh-client-connection/lib/index.js; do
    [ -f "$cand" ] && CC_LIB="$cand" && break
done
[ -n "$CC_LIB" ] || { echo "❌ 未找到 dsh-client-connection/lib/index.js — dsh fpk 未安装或布局异常"; exit 1; }
echo "==> 目标: $CC_LIB"

if grep -q "fnos-fpk: browser token auth off" "$CC_LIB" 2>/dev/null; then
    echo "✅ 补丁已在, 无需重复执行. 若仍 401, 请在 应用中心 重启 dsh 后再试."
    exit 0
fi

# ---- 打补丁 (4 个模式与 cmd/main 一致) ----
"$NODE" -e '
const fs = require("fs");
const p = process.argv[1];
let s = fs.readFileSync(p, "utf8"), changed = false;
const reps = [
  ["PRIVILEGED_METHODS.has(method) && !isTrustedApiRequest(request, []))",
   "PRIVILEGED_METHODS.has(method) && !isTrustedApiRequest(request, trustedHosts))"],
  ["if (interceptor.options.authority === \"loopback\" && !isTrustedApiRequest(request, []))",
   "if (interceptor.options.authority === \"loopback\" && !isTrustedApiRequest(request, this.trustedHosts))"],
  ["const trustedHosts = options.authority === \"loopback\" ? [] : this.trustedHosts;",
   "const trustedHosts = this.trustedHosts;"],
  ["isAuthenticated(request) {\n\t\tconst authority = requestAuthority(request.headers);",
   "isAuthenticated(request) {\n\t\treturn true; /* fnos-fpk: browser token auth off, host/origin trust fence is the gate */\n\t\tconst authority = requestAuthority(request.headers);"]
];
for (const [o, n] of reps) {
  if (s.includes(o) && !s.includes(n)) { s = s.split(o).join(n); changed = true; }
}
if (changed) { fs.writeFileSync(p, s); console.log("✅ 补丁已写入 (privileged-fence + browser-auth)"); }
else if (s.includes("fnos-fpk: browser token auth off")) { console.log("✅ 已打过, 无需重复"); }
else { console.log("⚠️ 未命中任何模式 — 上游代码结构可能已变化"); process.exit(2); }
' "$CC_LIB" || { echo "❌ 补丁写入失败 (权限?) — 试试加 sudo 重新运行"; exit 1; }

echo ""
echo "============== 完成 =============="
echo "下一步 (必做): 应用中心 → dsh → 重启 (运行中的进程仍带旧代码)"
echo "重启后浏览器打开桌面图标即可, 不再 401."
echo "验证: grep -c 'fnos-fpk: browser token auth off' '$CC_LIB'  → 应输出 1"
