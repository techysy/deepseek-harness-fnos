# 🚀 DeepSeek Harness for fnOS

[![GitHub release](https://img.shields.io/github/v/release/techysy/deepseek-harness-fnos?label=Latest&color=blue)](https://github.com/techysy/deepseek-harness-fnos/releases)
[![License: MIT](https://img.shields.io/badge/License-MIT-green.svg)](https://github.com/techysy/deepseek-harness-fnos/blob/main/LICENSE)
[![dsh](https://img.shields.io/badge/dsh-0.1.0--rc.7-blueviolet.svg)](https://github.com/deepseek-ai/deepseek-harness)
[![fnOS](https://img.shields.io/badge/fnOS-1.1.31xx+-orange.svg)](https://developer.fnnas.com/docs/guide)
[![Node.js](https://img.shields.io/badge/Node.js-v24-green.svg)]()
[![bun](https://img.shields.io/badge/bun-v1.3.9-black.svg)]()

DeepSeek 官方 Agent 浏览器 UI（一切皆插件）的 fnOS 快捷入口。

- 🎯 目标：https://www.deepseek.com/harness/（DeepSeek Harness 开发者预览版）
- 🐳 纯空壳：不运行后端，桌面图标打开 DeepSeek Harness。
- 🐋 图标：DeepSeek 官方黑色鲸鱼 logo。

## 下载安装

从 [Releases](https://github.com/techysy/deepseek-harness-fnos/releases/latest) 下载 fpk，在 fnOS App Center 手动安装。

## 版本说明

当前版本：**0.1.1-rc.2**（x86 离线包）

| 文件 | 架构 | 类型 | 说明 |
|------|------|------|------|
| `dsh-0.1.1-rc.2-x86.fpk` | x86 | url | 离线版（含 x86 原生模块），新标签页打开 |
| `dsh-0.1.1-rc.2-iframe-x86.fpk` | x86 | iframe | 离线版（含 x86 原生模块），桌面窗口内打开 |

**推荐**：选 `iframe` 版桌面窗口内打开（或 `url` 版新标签页）。当前打包为 x86 离线版（含 node_modules），安装免联网。

## 构建

```bash
bash scripts/build.sh            # url 版 + iframe 版，交付到 fpk/deepseek-harness/
bash scripts/build.sh --formal   # 正式版
```

## 安装

fnOS 应用中心手动安装 `dsh-*.fpk`。

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

> 依赖声明：`install_dep_apps = nodejs_v24:bunjs`，安装 dsh 时 fnOS 自动启用 node + bun。

## 文档

- [同步上游后检查清单](docs/upstream-sync-checklist.md) — 每次同步上游/重装后验证本地补丁（crypto polyfill、特权 API 403、trusted-host、命令可用性）是否还在
- [ARM 离线打包](docs/arm-build.md)
- [dsh Node.js 自托管](docs/dsh-nodejs.md) — node/npm 基础接入
- [dsh Agent 命令兼容矩阵](docs/dsh-nodejs-commands.md) — **最新** node/npm/npx/pnpm/yarn/bun/corepack 完整命令 + 数据区配置
