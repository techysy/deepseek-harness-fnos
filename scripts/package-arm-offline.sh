#!/usr/bin/env bash
# =============================================================================
# package-arm-offline.sh
# -----------------------------------------------------------------------------
# 在 101 (x86 fnOS) 打包机 上, 用 GitHub Actions 产出的 ARM64 node_modules,
# 打包 DeepSeek Harness 的 ARM 离线安装版 fpk。
#
# 用法:
#   bash scripts/package-arm-offline.sh <node_modules-arm64.tar.gz>
#
# 前置:
#   - 本机已安装 fnpack (飞牛官方打包工具)
#   - 本机能访问 GitHub (clone techysy/deepseek-harness-fnos)
#
# 流程:
#   1. clone/更新 deepseek-harness-fnos (fpk 源码)
#   2. 解压 ARM64 node_modules 到 app/server/node_modules
#   3. manifest: platform = arm
#   4. fnpack build → dsh-<ver>-arm.fpk
#   5. 按交付规范复制到 /vol1/1000/fnOS App/fpk/deepseek-harness/
# =============================================================================
set -euo pipefail

NM_TAR="${1:?用法: package-arm-offline.sh <node_modules-arm64.tar.gz>}"
NM_TAR="$(realpath "${NM_TAR}")"

[ -f "${NM_TAR}" ] || { echo "错误: ${NM_TAR} 不存在" >&2; exit 1; }

# ---- 配置 (可按需修改) ----
REPO_URL="https://github.com/techysy/deepseek-harness-fnos.git"
BUILD_ROOT="${HOME}/build"
SRC_DIR="${BUILD_ROOT}/deepseek-harness-fnos"
# 交付目录 (fnOS 应用中心手动安装扫描此目录)
# 注意: 101 上 dsh 的交付子目录名是 "deepseek-harness" (非 "dsh")
DELIVERY_NEW="/vol1/1000/fnOS App/fpk/deepseek-harness"
DELIVERY_OLD="/vol1/1000/fnOS App/old_fpk/deepseek-harness"
# 数据卷路径按实际调整: 若 /vol1 不在, 回退到 /vol4
[ -d "/vol1" ] || DELIVERY_NEW="/vol4/1000/fnOS App/fpk/deepseek-harness"
[ -d "/vol1" ] || DELIVERY_OLD="/vol4/1000/fnOS App/old_fpk/deepseek-harness"

command -v fnpack >/dev/null 2>&1 || { echo "错误: 未找到 fnpack (飞牛打包工具)" >&2; exit 1; }

echo "==> ARM node_modules 归档: ${NM_TAR}"
echo "==> 构建目录: ${SRC_DIR}"

# ---- 1. clone / 更新 fpk 源码 ----
mkdir -p "${BUILD_ROOT}"
if [ -d "${SRC_DIR}/.git" ]; then
  echo "==> 更新已有仓库..."
  git -C "${SRC_DIR}" fetch --tags --force
  git -C "${SRC_DIR}" checkout main
  git -C "${SRC_DIR}" pull --ff-only
else
  echo "==> clone 仓库..."
  git clone --depth 1 "${REPO_URL}" "${SRC_DIR}"
fi

cd "${SRC_DIR}"

# 读取版本号 (manifest 里 version=xxx)
VERSION="$(grep -E '^version[[:space:]]*=' manifest | head -1 | sed 's/.*=//;s/[[:space:]]//g')"
echo "==> 版本: ${VERSION}"

# ---- 2. 替换 app/server/node_modules 为 ARM64 版 ----
echo "==> 解压 ARM64 node_modules 到 app/server/ ..."
rm -rf app/server/node_modules
tar -xzf "${NM_TAR}" -C app/server/
[ -f "app/server/node_modules/@deepseek-ai/dsh/lib/bin.js" ] || {
  echo "错误: 解压后缺少 @deepseek-ai/dsh/lib/bin.js, 归档可能不对" >&2; exit 1; }
echo "==> node_modules 就位:"
ls -d app/server/node_modules/@deepseek-ai/dsh 2>/dev/null

# ---- 3. manifest: platform = arm ----
echo "==> manifest platform → arm ..."
if grep -qE '^platform[[:space:]]*=' manifest; then
  sed -i 's/^platform[[:space:]]*=.*/platform               = arm/' manifest
else
  echo "platform               = arm" >> manifest
fi
grep -E '^(platform|appname|version)[[:space:]]*=' manifest

# ---- 4. fnpack build (url 版 + iframe 版两个变体) ----
# 命名规范: dsh-<ver>[-iframe]-arm.fpk
#   - url 版    → dsh-<ver>-arm.fpk
#   - iframe 版 → dsh-<ver>-iframe-arm.fpk
build_variant() {
  local variant="$1"   # "" 或 "iframe"
  local type_val="$2"  # "url" 或 "iframe"
  local suffix="$3"    # "" 或 "-iframe"

  # 切换 app/ui/config 的 type
  sed -i "s/\"type\": \"[a-z]*\"/\"type\": \"${type_val}\"/" app/ui/config
  echo "==> app/ui/config type = ${type_val}"

  rm -f dsh.fpk
  fnpack build -d .
  [ -f "dsh.fpk" ] || { echo "错误: fnpack build 未产出 dsh.fpk (${variant})" >&2; exit 1; }

  local fpk="dsh-${VERSION}${suffix}-arm.fpk"
  mv dsh.fpk "${fpk}"
  echo "==> 打包完成: ${SRC_DIR}/${fpk}"
  ls -lh "${fpk}"
  FPK="${fpk}"
}

# 备份原始 config
cp app/ui/config "${WORKSPACE_BAK:-/tmp/dsh-ui-config.bak}"

# 先打 url 版
build_variant "url" "url" ""

# 再打 iframe 版
build_variant "iframe" "iframe" "-iframe"

# 还原原始 config
cp "${WORKSPACE_BAK:-/tmp/dsh-ui-config.bak}" app/ui/config

# ---- 5. 复制到交付目录 (chmod 644) ----
echo "==> 交付到 ${DELIVERY_NEW} ..."
mkdir -p "${DELIVERY_NEW}" "${DELIVERY_OLD}"
# 移走旧 ARM fpk 到历史
if compgen -G "${DELIVERY_NEW}/dsh-*-arm.fpk" >/dev/null 2>&1; then
  mv "${DELIVERY_NEW}"/dsh-*-arm.fpk "${DELIVERY_OLD}/" 2>/dev/null || true
fi
# 复制本批两个变体
for f in dsh-${VERSION}-arm.fpk dsh-${VERSION}-iframe-arm.fpk; do
  [ -f "$f" ] || { echo "警告: $f 不存在, 跳过交付" >&2; continue; }
  cp "$f" "${DELIVERY_NEW}/"
  chmod 644 "${DELIVERY_NEW}/${f}"
done

echo ""
echo "==============================================================="
echo "✅ ARM 离线安装包已生成并交付:"
echo "   ${DELIVERY_NEW}/dsh-${VERSION}-arm.fpk         (url 版)"
echo "   ${DELIVERY_NEW}/dsh-${VERSION}-iframe-arm.fpk  (iframe 版)"
echo ""
echo "   部署到 ARM fnOS 设备: 应用中心 → 手动安装 → 选对应架构 fpk"
echo "   说明: 内置 ARM64 node_modules (glibc≤2.28 兼容), 免联网"
echo "==============================================================="
