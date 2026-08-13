# DSH for fnOS

DeepSeek Harness（dsh）— DeepSeek 官方 agent 框架的浏览器 UI，打包成飞牛 fnOS 应用。本地常驻服务，经飞牛官方统一网关接入。

## 🏗️ 架构

```
fnOS
└── DSH
    ├── dsh web (127.0.0.1:18080)  ← DeepSeek Harness 浏览器 UI (只绑回环, 安全)
    └── 统一网关代理 (app.sock)      ← Python proxy, 把 /app/dsh 转发到 127.0.0.1:18080
```

- **桌面图标 → 打开 DeepSeek Harness 浏览器 UI**（官方统一网关 `/app/dsh`）
- **dsh web 只绑 127.0.0.1**（dsh 安全限制：拒绝 0.0.0.0，防远程代码执行暴露）
- **飞牛官方统一网关**：`gatewaySocket: app.sock` + `gatewayPrefix: /app/dsh`，fnOS 校验会话 + 转发到 Unix socket，Python proxy 再转发到 dsh web
- **离线打包**：dsh（含 node_modules）随 fpk 内置在 `app/server`，安装免联网

## 🚀 安装

1. 从 [GitHub Release](https://github.com/techysy/deepseek-harness-fnos/releases) 下载 `dsh-<version>.fpk`
2. App Center 手动安装 `dsh-<version>.fpk`
3. 安装向导填 DeepSeek API Key（sk- 开头，可留空后配置）
4. 桌面打开 DSH 应用图标进入浏览器 UI

> 依赖：fnOS 应用中心需已安装 **Node.js 24**（nodejs_v24，App Center 会自动安装依赖）。

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
| dsh web | 127.0.0.1:18080 | DeepSeek Harness 浏览器 UI（只回环）|
| 统一网关 | /app/dsh | fnOS 桌面图标入口 |

## 🛠️ 从源码打包

`app/server/node_modules`（346M，含 node-pty 等原生模块）不在 git 仓库，需在 NAS 上重建后打包：

```bash
# 1. 重建 app/server node_modules（native 模块需在 NAS glibc 环境编译）
cd app/server
/vol4/@appcenter/nodejs_v24/bin/npm install   # 依赖 g++/make，见下方"前置要求"

# 2. 打包 fpk
cd .. && fnpack build
```

### 前置要求
- **nodejs_v24**（依赖 `install_dep_apps`）
- **build-essential**（g++/make，编译 node-pty 等原生模块）：
  ```bash
  sudo apt update && sudo apt install -y build-essential
  ```
  > install_callback 会在缺失 g++ 时于 install.log 给出提示。

## 📋 已知限制

- dsh web 只能绑 127.0.0.1（官方安全限制），因此只能经官方统一网关访问，不能直接用 IP:端口
- `app/server/node_modules` 需在 **NAS 的 glibc 环境**编译（在 Arch/高版本 glibc 编译的原生模块不兼容 NAS，报 `GLIBC_2.42 not found`）
