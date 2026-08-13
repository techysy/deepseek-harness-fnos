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

## 🚀 安装

1. App Center 手动安装 `dsh-<version>.fpk`
2. 安装向导填 DeepSeek API Key（sk- 开头，可留空后配置）
3. 首次安装会 `npm install -g @deepseek-ai/dsh`（需联网 1-2 分钟）
4. 桌面打开 DSH 应用图标进入浏览器 UI

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

## 🛠️ 开发

- `manifest`：dsh 1.0.0（独立版本号，不随上游同步）
- `cmd/main`：dsh 生命周期（start/stop/status/restart）
- `cmd/proxy.py`：统一网关代理（Unix socket → 127.0.0.1:18080，重写 Host 规避 dsh browser-trust）
- `cmd/install_callback`：npm 安装 dsh + 配置 DSH_HOME
- 依赖：nodejs_v24（`npm install -g @deepseek-ai/dsh`）

## 📋 已知限制

- dsh web 只能绑 127.0.0.1（官方安全限制），因此只能经官方统一网关访问，不能直接用 IP:端口
- 首次安装需联网（npm 下载 532 个包）
