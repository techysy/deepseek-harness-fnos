<img width="1824" height="1080" alt="ScreenShot_2026-08-14_030331_743" src="https://github.com/user-attachments/assets/158168d3-e6a6-43ee-93c6-eab0ea46e44d" />

# 🐳 DeepSeek Harness for fnOS

[![上游版本](https://img.shields.io/badge/upstream-v0.1.0--rc.6-1E88E5?logo=deepseek&logoColor=white&label=DeepSeek%20Harness)](https://github.com/deepseek-ai/deepseek-harness)
[![fnOS 版本](https://img.shields.io/github/v/release/techysy/deepseek-harness-fnos?label=fnOS&color=0A5D9C)](https://github.com/techysy/deepseek-harness-fnos/releases)
[![离线打包](https://img.shields.io/badge/offline-免联网-2E7D32)](https://github.com/techysy/deepseek-harness-fnos)

DeepSeek Harness（dsh）— DeepSeek 官方 agent 框架的浏览器 UI，打包成飞牛 fnOS 应用。

- **上游项目**：[deepseek-ai/deepseek-harness](https://github.com/deepseek-ai/deepseek-harness)（DeepSeek 官方，v0.1.0-rc.6）
- **飞牛打包版**：[techysy/deepseek-harness-fnos](https://github.com/techysy/deepseek-harness-fnos)（v0.1.0-rc.6）

## 🏗️ 架构

```
fnOS
└── DeepSeek Harness (dsh)
    ├── dsh web (0.0.0.0:28000)   ← DeepSeek Harness 浏览器 UI (patch 覆盖 webserver 绑 0.0.0.0)
    └── proxy.py (app.sock)        ← 可选: 经 fnOS 统一网关 /app/dsh 转发到 127.0.0.1:28000
```

- **桌面图标 → 打开 DeepSeek Harness 浏览器 UI**（直连 `127.0.0.1:28000`）
- **局域网/Tailscale → 直接访问 `http://<NAS_IP>:28000`**
- **dsh 绑 0.0.0.0**：通过 `cordis.patch.yml` 覆盖 webserver 配置绕过 CLI 的 0.0.0.0 安全校验（dsh CLI `--host 0.0.0.0` 会被拒绝）
- **离线打包**：dsh（含 node_modules）随 fpk 内置在 `app/server`，安装免联网

## 🚀 安装

1. 从 [GitHub Release](https://github.com/techysy/deepseek-harness-fnos/releases) 下载 `dsh-<version>.fpk`
2. App Center 手动安装 `dsh-<version>.fpk`
3. 安装向导填 DeepSeek API Key（sk- 开头，可留空后配置）
4. 桌面打开 DSH 应用图标进入浏览器 UI

> 依赖：fnOS 应用中心需已安装 **Node.js 24**（nodejs_v24，App Center 会自动安装依赖）。
<img width="1802" height="1077" alt="ScreenShot_2026-08-14_024604_935" src="https://github.com/user-attachments/assets/42553a95-d341-4b7b-b8d9-a599fd4d6e29" />

## 🔧 配置

### DeepSeek API Key
- 安装向导填写，或编辑 `/vol4/@appdata/dsh/dsh_home/.env`：
  ```
  DEEPSEEK_API_KEY=sk-xxx
  ```
- 改后重启应用生效

### 端口
| 服务 | 端口/路径 | 说明 |
|------|-----------|------|
| dsh web | 0.0.0.0:28000 | DeepSeek Harness 浏览器 UI（局域网直连）|
| 桌面入口 | 127.0.0.1:28000 | fnOS 桌面图标（iframe 直连）|

## 🛠️ 从源码打包

`app/server/node_modules`（346M，含 node-pty 等原生模块）不在 git 仓库，需在 NAS 上重建后打包：

```bash
# 1. 重建 app/server node_modules（native 模块需在 NAS glibc 环境编译）
cd app/server
/vol4/@appcenter/nodejs_v24/bin/npm install   # 依赖 g++/make，见下方"前置要求"

# 2. 打包 fpk
cd .. && fnpack build
```
<img width="1763" height="1080" alt="ScreenShot_2026-08-14_030235_867" src="https://github.com/user-attachments/assets/30b6ab69-aa29-4c9f-875a-3e92b1a9a9d9" />

### 前置要求
- **nodejs_v24**（依赖 `install_dep_apps`）
- **build-essential**（g++/make，编译 node-pty 等原生模块）：
  ```bash
  sudo apt update && sudo apt install -y build-essential
  ```
  > install_callback 会在缺失 g++ 时于 install.log 给出提示。

## 📋 已知限制与安全

- **dsh 绑 0.0.0.0** 意味着局域网内都能访问 `http://<NAS_IP>:28000`，且 dsh 能执行代码——**注意网络安全**，必要时用 `trusted-host` 配置或防火墙限制网段
- `app/server/node_modules` 需在 **NAS 的 glibc 环境**编译（在 Arch/高版本 glibc 编译的原生模块不兼容 NAS，报 `GLIBC_2.42 not found`）
- 应用走 **fnOS 生命周期**管理（appcenter-cli / 应用中心以 `dsh` 用户调度），不要手动 `sudo node` 启动

## 📝 版本历史

见 [CHANGELOG.md](CHANGELOG.md)
