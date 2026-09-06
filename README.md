# 🚀 DeepSeek Harness for fnOS

[![GitHub release](https://img.shields.io/github/v/release/techysy/deepseek-harness-fnos?label=Latest&color=blue)](https://github.com/techysy/deepseek-harness-fnos/releases)
[![License: MIT](https://img.shields.io/badge/License-MIT-green.svg)](https://github.com/techysy/deepseek-harness-fnos/blob/main/LICENSE)
[![dsh](https://img.shields.io/badge/dsh-0.1.2--rc.1-blueviolet.svg)](https://github.com/deepseek-ai/deepseek-harness)
[![fnOS](https://img.shields.io/badge/fnOS-1.1.31xx+-orange.svg)](https://developer.fnnas.com/docs/guide)
[![Node.js](https://img.shields.io/badge/Node.js-v24-green.svg)]()
[![bun](https://img.shields.io/badge/bun-v1.3.9-black.svg)]()

DeepSeek 官方 Agent 浏览器 UI（一切皆插件）的 fnOS 快捷入口。

- 🎯 目标：https://www.deepseek.com/harness/（DeepSeek Harness 开发者预览版）
- 🐳 离线自托管：`@deepseek-ai/dsh`（含 node_modules）随 fpk 内置，安装免联网
- 🐋 图标：DeepSeek 官方黑色鲸鱼 logo

## 下载安装

从 [Releases](https://github.com/techysy/deepseek-harness-fnos/releases/latest) 下载 fpk，在 fnOS App Center 手动安装。

## 版本说明

当前版本：**0.1.2-rc.1**（升级上游 dsh 0.1.2-rc.1，修复桌面打开 401）

| 文件 | 架构 | 类型 | 说明 |
|------|------|------|------|
| `dsh-0.1.2-rc.1-iframe-x86.fpk` | x86 | iframe | 桌面窗口内打开（**推荐**） |
| `dsh-0.1.2-rc.1-x86.fpk` | x86 | url | 新标签页打开 |
| `dsh-0.1.2-rc.1-iframe-arm.fpk` | ARM | iframe | 桌面窗口内打开（**推荐**） |
| `dsh-0.1.2-rc.1-arm.fpk` | ARM | url | 新标签页打开 |

全部为**离线包**（含对应架构 node_modules），安装免联网。ARM 版在 manylinux_2_28 容器构建，兼容旧 glibc。

## 访问方式

dsh 以 fnOS 应用（`dsh` 用户常驻服务）运行，web 服务绑 `0.0.0.0:28000`，提供多条访问入口：

| 入口 | 地址 | 说明 |
|------|------|------|
| **fnOS 桌面图标** | `http://127.0.0.1:28000` | 桌面图标 iframe/url 直连，无需网关 |
| **局域网 / Tailscale** | `http://<NAS_IP>:28000` | 局域网设备直接访问 |
| **FN Connect** | `https://dsh.<FN_ID>.fnos.net` | FN 鉴权后公网直达（安装向导填 FN ID 自动配置信任域） |
| **fnOS 统一网关**（可选） | `/app/dsh` | 经 `app.sock` → proxy.py → 127.0.0.1:28000 |

**安全机制**（0.1.2-rc.1 现状）：

- **信任围栏**：`/api/*` 校验 Host/Origin，仅放行回环 + `--trusted-host` 列表（本机非回环 IP 自动探测 + `fnos.net` + `trusted_hosts.conf` 自定义域名），其余来源 403
- **桌面免 401**：上游 0.1.2 的浏览器 token 鉴权对静态桌面入口不可用，fpk 运行时补丁对围栏内请求放行（等效"围栏即认证"，请勿将 28000 端口暴露到不受信任网络）
- **0.0.0.0 绑定**：`cordis.patch.yml` 覆盖 webserver 配置（dsh CLI 层拒绝 `--host 0.0.0.0`）
- **设置页 host 模式**：构建期补丁使非 loopback 访问也能读写服务端配置

> 📖 围栏与回环限制详解：[docs/dsh-loopback-restriction.md](docs/dsh-loopback-restriction.md) · [docs/dsh-access-and-gateway.md](docs/dsh-access-and-gateway.md)

## 安装

1. App Center **手动安装**选下载的 fpk（推荐 iframe 版）
2. 安装向导填 **DeepSeek API Key**（`sk-` 开头，可留空后配置）与 **FN ID**（如 `techysy`，用于 FN Connect 信任域）
3. fnOS 桌面打开 **DeepSeek Harness** 图标进入 UI

> 依赖：fnOS 自动安装 **nodejs_v24** + **bunjs**（`install_dep_apps`），dsh 的 Agent 环境可直接使用 node/npm/pnpm/bun。

## 配置

### DeepSeek API Key

- 安装向导填写，或编辑数据区 `dsh_home/.env`：
  ```
  DEEPSEEK_API_KEY=sk-xxx
  ```
- 也可在 dsh 设置页内直接配置官方 / 自定义提供方的 API Key（改后重启应用生效）

### 端口

| 服务 | 端口/路径 | 说明 |
|------|-----------|------|
| dsh web | `0.0.0.0:28000` | DeepSeek Harness 浏览器 UI（局域网直连） |
| 桌面入口 | `127.0.0.1:28000` | fnOS 桌面图标直连 |
| 网关 socket | `app.sock` → proxy.py | 统一网关 `/app/dsh` 入口（可选） |

### 网络代理（可选）

向导或应用设置页填写代理，写入 `dsh_home/proxy.conf`（`PROXY=http://127.0.0.1:7890`），dsh 的出站请求（git/npm/API）走该代理；留空不走代理。上游 0.1.2 起也遵循启动环境的 `HTTP_PROXY`/`HTTPS_PROXY`/`ALL_PROXY`/`NO_PROXY`。

## 构建

两条打包路径（详见 [docs/packaging-fpk.md](docs/packaging-fpk.md)）：

**GitHub Actions 在线打包（推荐）** — 手动触发，产出到 artifacts：

```bash
gh workflow run build-fpk.yml -f arch=x86    # 或 -f arch=arm
gh run watch                                  # 下载: gh run download <run-id>
```

**离线脚本**（NAS 本机，x86 打包机 / ARM 详见 [docs/arm-build.md](docs/arm-build.md)）：

```bash
bash scripts/build-x86-offline.sh             # url 版 + iframe 版，交付到应用中心扫描目录
```

上游升级 SOP 与补丁核对：[docs/upstream-sync-checklist.md](docs/upstream-sync-checklist.md)。

## Agent 环境命令检查

安装后可在 dsh 的 Agent / bash 工具里直接使用以下命令（来自 fnOS 依赖应用，自动加入 PATH）：

| 命令 | 来源 | 版本验证 | 数据落点 |
|------|------|---------|---------|
| `node` | nodejs_v24 依赖 | `node -v` | — |
| `npm` / `npx` | nodejs_v24 | `npm -v` | 全局安装 → 数据区 `.npm-global` |
| `pnpm` / `yarn` | corepack（nodejs_v24） | `pnpm --version` | corepack 缓存 → 数据区 `.corepack` |
| `bun` | bunjs 依赖 | `bun --version` | — |
| `corepack` | nodejs_v24 | `corepack --version` | — |

```bash
# 一键验证全部命令
node -v && npm -v && pnpm --version && yarn --version && bun --version
```

## 文档

- [fpk 打包指南](docs/packaging-fpk.md) — 在线 Actions / 离线脚本双路径、版本号策略（跟随上游，本地修复不抬版）、升级 SOP
- [同步上游后检查清单](docs/upstream-sync-checklist.md) — 每次同步上游/重装后验证本地补丁是否还在
- [访问与网关](docs/dsh-access-and-gateway.md) — 多入口访问、proxy.py 网关细节
- [回环限制详解](docs/dsh-loopback-restriction.md) — 信任围栏 / trusted-host / settings host-mode
- [ARM 离线打包](docs/arm-build.md)
- [dsh Node.js 自托管](docs/dsh-nodejs.md) — node/npm 基础接入
- [dsh Agent 命令兼容矩阵](docs/dsh-nodejs-commands.md) — node/npm/npx/pnpm/yarn/bun/corepack 完整命令 + 数据区配置
