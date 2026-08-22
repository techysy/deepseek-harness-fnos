#!/usr/bin/env bash
# =============================================================================
# build-x86-offline.sh
# -----------------------------------------------------------------------------
# 在 x86 fnOS 打包机 (101) 上, 用 npm install 生成自包含 x86 node_modules,
# 打包 DeepSeek Harness 的 x86 离线安装版 fpk。
#
# 为什么用 npm install (而非 pnpm workspace)?
#   - npm 生成扁平自包含 node_modules (@deepseek-ai/dsh 为实体目录, 无 symlink)
#   - fnpack 不支持 symlink, 扁平布局可直接打包, 装完无需重建
#   - node-pty 等原生模块走 prebuild (prebuilds/linux-x64/pty.node), 无 glibc 编译问题
#   - fpk 约 48M (vs pnpm workspace 错误方式 394M)
#
# 用法 (在 x86 fnOS 打包机):
#   bash scripts/build-x86-offline.sh [--version <ver>]
#
# 产出:
#   dsh-<ver>-x86.fpk (url) + dsh-<ver>-iframe-x86.fpk (iframe)
#   交付到 /vol1/1000/fnOS App/fpk/dsh/
# =============================================================================
set -euo pipefail

# ---- 配置 (可按需修改) ----
REPO_URL="https://github.com/techysy/deepseek-harness-fnos.git"
BUILD_ROOT="${HOME}/build"
SRC_DIR="${BUILD_ROOT}/deepseek-harness-fnos"
# 交付目录 (fnOS 应用中心手动安装扫描此目录)
DELIVERY_NEW="/vol1/1000/fnOS App/fpk/dsh"
DELIVERY_OLD="/vol1/1000/fnOS App/old_fpk/dsh"
[ -d "/vol1" ] || DELIVERY_NEW="/vol4/1000/fnOS App/fpk/dsh"
[ -d "/vol1" ] || DELIVERY_OLD="/vol4/1000/fnOS App/old_fpk/dsh"
# nodejs_v24 自托管
NODE_DIR=""
for cand in /var/apps/nodejs_v24/target/bin "${APP_VOL:-}/@appcenter/nodejs_v24/bin"; do
  [ -x "${cand}/node" ] && NODE_DIR="${cand}" && break
done
[ -n "${NODE_DIR}" ] || { echo "错误: nodejs_v24 未找到" >&2; exit 1; }
export PATH="${NODE_DIR}:${PATH}"

# npm 堆内存 (dsh 依赖树大, 默认 1024 会 OOM)
export NODE_OPTIONS="${NODE_OPTIONS:---max-old-space-size=4096}"

command -v fnpack >/dev/null 2>&1 || { echo "错误: 未找到 fnpack (飞牛打包工具)" >&2; exit 1; }

# ---- 1. clone / 更新 fpk 源码 ----
echo "==> 更新 fpk 源码..."
mkdir -p "${BUILD_ROOT}"
if [ -d "${SRC_DIR}/.git" ]; then
  git -C "${SRC_DIR}" fetch --tags --force
  git -C "${SRC_DIR}" checkout main
  git -C "${SRC_DIR}" pull --ff-only
else
  git clone --depth 1 "${REPO_URL}" "${SRC_DIR}"
fi

cd "${SRC_DIR}"

# 读取版本号
VERSION="$(grep -E '^version[[:space:]]*=' manifest | head -1 | sed 's/.*=//;s/[[:space:]]//g')"
echo "==> 版本: ${VERSION}"

# ---- 2. npm install 生成 node_modules ----
echo "==> npm install (生成自包含 x86 node_modules)..."
cd app/server
rm -rf node_modules
npm install --no-audit --no-fund --ignore-engines
[ -f "node_modules/@deepseek-ai/dsh/lib/bin.js" ] || {
  echo "错误: npm install 后缺少 @deepseek-ai/dsh/lib/bin.js" >&2; exit 1; }
echo "==> node_modules 就位:"
du -sh node_modules

# ---- 3. 打补丁 (crypto polyfill + settings memory->host) ----
echo "==> 应用本地补丁..."
INDEX="node_modules/@deepseek-ai/dsh-web-frontend/dist/index.html"
[ -f "${INDEX}" ] && python3 "${SRC_DIR}/scripts/inject_crypto_polyfill.py" "${INDEX}"
python3 "${SRC_DIR}/cmd/patch_settings_memory.py" "node_modules/@deepseek-ai" || true

# ---- 4. 移除 .bin symlink (fnpack 不支持 symlink) + 权限修复 ----
echo "==> 移除 .bin symlink + 修复权限..."
find node_modules/.bin -type l 2>/dev/null | while read f; do unlink "${f}" 2>/dev/null; done || true
chmod -R a+rX node_modules/ 2>/dev/null || true

cd "${SRC_DIR}"

# ---- 5. fnpack build (url 版 + iframe 版) ----
# 命名规范: dsh-<ver>[-iframe]-x86.fpk
build_variant() {
  local type_val="$1"
  local suffix="$2"
  python3 -c "
import json
p='app/ui/config'
d=json.load(open(p))
d['.url']['dsh.Application']['type']='${type_val}'
json.dump(d,open(p,'w'),ensure_ascii=False,indent=2)
"
  rm -f dsh.fpk
  fnpack build -d .
  [ -f "dsh.fpk" ] || { echo "错误: fnpack build 未产出 dsh.fpk (${suffix})" >&2; exit 1; }
  mv dsh.fpk "dsh-${VERSION}${suffix}-x86.fpk"
  echo "==> 打包完成: dsh-${VERSION}${suffix}-x86.fpk"
  ls -lh "dsh-${VERSION}${suffix}-x86.fpk"
}

# 先 url 版
build_variant "url" ""

# 再 iframe 版
build_variant "iframe" "-iframe"

# 还原 config 为 iframe (仓库默认)
python3 -c "
import json
p='app/ui/config'
d=json.load(open(p))
d['.url']['dsh.Application']['type']='iframe'
json.dump(d,open(p,'w'),ensure_ascii=False,indent=2)
"

# ---- 6. 交付 ----
echo "==> 交付到 ${DELIVERY_NEW} ..."
mkdir -p "${DELIVERY_NEW}" "${DELIVERY_OLD}"
if compgen -G "${DELIVERY_NEW}/dsh-*-x86.fpk" >/dev/null 2>&1; then
  mv "${DELIVERY_NEW}"/dsh-*-x86.fpk "${DELIVERY_OLD}/" 2>/dev/null || true
fi
for f in dsh-${VERSION}-x86.fpk dsh-${VERSION}-iframe-x86.fpk; do
  [ -f "$f" ] && cp "$f" "${DELIVERY_NEW}/" && chmod 644 "${DELIVERY_NEW}/${f}"
done

echo ""
echo "==============================================================="
echo "✅ x86 离线安装包已生成并交付:"
echo "   ${DELIVERY_NEW}/dsh-${VERSION}-x86.fpk         (url 版)"
echo "   ${DELIVERY_NEW}/dsh-${VERSION}-iframe-x86.fpk  (iframe 版)"
echo "   部署: 应用中心 → 手动安装 → 选 dsh-${VERSION}-iframe-x86.fpk"
echo "==============================================================="
