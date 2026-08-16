#!/usr/bin/env bash
# =============================================================================
# build-arm-node-modules.sh
# -----------------------------------------------------------------------------
# 在 manylinux_2_28_aarch64 容器内编译 glibc 兼容的 ARM64 node_modules。
#
# 为什么用 manylinux_2_28 容器？
#   - 目标 fnOS ARM 设备 (如 R2S) 是 Debian 12, glibc = 2.36。
#   - 直接在现代发行版 (ubuntu-24.04 = glibc 2.39) 编译 node-pty 等原生模块,
#     产物可能引用 GLIBC_2.37/2.38/2.39 符号, 在 glibc 2.36 设备上
#     报 "GLIBC_2.3x not found"。
#   - manylinux_2_28 容器 glibc = 2.28 (非常老), 在此编译原生模块 →
#     产物 GLIBC 要求 ≤ 2.28 < 2.36, 任何 glibc ≥ 2.28 的环境都能跑。
#
# 用法 (在 ubuntu-24.04-arm 的 GitHub Actions runner 上):
#   bash scripts/build-arm-node-modules.sh <app-server-dir>
#
# 产出:
#   在 <app-server-dir>/ 生成完整 node_modules (ARM64, glibc 兼容)
#   + 一个 node_modules-arm64.tar.gz 归档
# =============================================================================
set -euo pipefail

# 目标 Node 大版本 (dsh 依赖 Node 24)
NODE_MAJOR="${NODE_MAJOR:-24}"
NODE_FULL="${NODE_FULL:-v24.19.0}"          # 精确版本, 见 nodejs.org/dist/
MANYLINUX_IMAGE="quay.io/pypa/manylinux_2_28_aarch64"
# 最小目标 glibc (manylinux_2_28 = glibc 2.28)
GLIBC_MIN="${GLIBC_MIN:-2.28}"

APP_SERVER_DIR="${1:?用法: build-arm-node-modules.sh <app-server-dir>}"
APP_SERVER_DIR="$(realpath "${APP_SERVER_DIR}")"

# 校验输入目录
[ -f "${APP_SERVER_DIR}/package.json" ] || {
  echo "错误: ${APP_SERVER_DIR}/package.json 不存在" >&2
  exit 1
}

echo "==> 目标 app/server: ${APP_SERVER_DIR}"
echo "==> manylinux 镜像: ${MANYLINUX_IMAGE}"
echo "==> 目标 Node: ${NODE_FULL}"

# 临时工作区 (放 Node 二进制)
WORKDIR="$(mktemp -d)"
trap 'rm -rf "${WORKDIR}"' EXIT

# --- 下载 Node aarch64 官方二进制 ---
NODE_TAR="node-${NODE_FULL}-linux-arm64.tar.xz"
NODE_URL="https://nodejs.org/dist/${NODE_FULL}/${NODE_TAR}"
echo "==> 下载 ${NODE_URL}"
if ! curl -fsSL --retry 3 -o "${WORKDIR}/${NODE_TAR}" "${NODE_URL}"; then
  echo "错误: Node 二进制下载失败 (版本 ${NODE_FULL} 是否存在? 见 nodejs.org/dist/)" >&2
  exit 1
fi

# --- 在 manylinux 容器内编译 node_modules ---
echo "==> 在 ${MANYLINUX_IMAGE} 容器内 npm install..."
docker run --rm \
  -v "${APP_SERVER_DIR}:/work/server" \
  -v "${WORKDIR}:/opt/node-tar:ro" \
  -w /work/server \
  -e NODE_MAJOR \
  -e npm_config_jobs=2 \
  -e npm_config_cache=/tmp/npm-cache \
  "${MANYLINUX_IMAGE}" \
  bash -euxo pipefail -c '
    set -euo pipefail
    # 解压 Node 二进制
    tar -xf /opt/node-tar/node-'"${NODE_FULL}"'-linux-arm64.tar.xz -C /opt
    export PATH="/opt/node-'"${NODE_FULL}"'-linux-arm64/bin:${PATH}"
    node --version
    npm --version

    # 清理旧的 node_modules (避免残留 x86 二进制)
    rm -rf node_modules
    mkdir -p node_modules

    # npm install (native 模块在此 glibc 2.28 环境下编译)
    # npm cache 放容器内 /tmp, 避免落到宿主管控目录 (root 归属, 宿主无法清理)
    npm install --no-audit --no-fund --ignore-engines

    # 将产物改为宿主可读可删 (node_modules 由 root 创建, 确保宿主能接管)
    chown -R "$(stat -c %u:%g /work/server)" node_modules 2>/dev/null || true

    # 输出原生模块信息
    echo "--- 原生模块列表 ---"
    find node_modules -name "*.node" -type f 2>/dev/null | head -50
  '

echo "==> npm install 完成"

# --- 校验所有 .node 原生模块的 GLIBC 要求 ≤ 目标 ---
echo "==> 校验 GLIBC 要求 ≤ ${GLIBC_MIN} ..."
MAX_GLIBC="0"
FAIL=0
while IFS= read -r node_file; do
  req="$(readelf --version-info "${node_file}" 2>/dev/null \
         | sed -n 's/.*Name: GLIBC_\([0-9.]*\).*/\1/p' \
         | sort -V | tail -1 || true)"
  if [ -z "${req}" ]; then
    continue  # 无 GLIBC 依赖 跳过
  fi
  echo "  ${node_file##*node_modules/}: GLIBC_${req}"
  if [ "$(printf '%s\n%s\n' "${req}" "${GLIBC_MIN}" | sort -V | tail -1)" != "${GLIBC_MIN}" ]; then
    echo "    !! 需要 GLIBC_${req} > 目标 ${GLIBC_MIN} (在目标设备可能报 not found)" >&2
    FAIL=1
  fi
  if [ "$(printf '%s\n%s\n' "${req}" "${MAX_GLIBC}" | sort -V | tail -1)" != "${MAX_GLIBC}" ]; then
    MAX_GLIBC="${req}"
  fi
done < <(find "${APP_SERVER_DIR}/node_modules" -name "*.node" -type f 2>/dev/null)

echo "==> 全部 .node 模块最高 GLIBC 要求: ${MAX_GLIBC}"
if [ "${FAIL}" = "1" ]; then
  echo "错误: 存在超过 GLIBC_${GLIBC_MIN} 的原生模块, 需处理 (见上)" >&2
  exit 1
fi

# --- 打包归档 (不含 .npm-cache) ---
echo "==> 打包 node_modules-arm64.tar.gz ..."
cd "${APP_SERVER_DIR}"
rm -rf .npm-cache 2>/dev/null || true
tar -czf node_modules-arm64.tar.gz \
  package.json package-lock.json node_modules
echo "==> 完成! 归档: ${APP_SERVER_DIR}/node_modules-arm64.tar.gz"
echo "==> 最高 GLIBC 要求: ${MAX_GLIBC} (目标设备需 ≥ 该版本)"
