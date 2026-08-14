<img width="1824" height="1080" alt="ScreenShot_2026-08-14_030331_743" src="https://github.com/user-attachments/assets/158168d3-e6a6-43ee-93c6-eab0ea46e44d" />

# 🐳 DeepSeek Harness for fnOS

[![上游版本](https://img.shields.io/badge/upstream-v0.1.0--rc.6-1E88E5?logo=deepseek&logoColor=white&label=DeepSeek%20Harness)](https://github.com/deepseek-ai/deepseek-harness)
[![fnOS 版本](https://img.shields.io/github/v/release/techysy/deepseek-harness-fnos?label=fnOS&color=0A5D9C)](https://github.com/techysy/deepseek-harness-fnos/releases)
[![离线打包](https://img.shields.io/badge/offline-免联网-2E7D32)](https://github.com/techysy/deepseek-harness-fnos)

DeepSeek Harness（dsh）— DeepSeek 官方 agent 框架的浏览器 UI，打包成飞牛 fnOS 应用。
基于上游 [deepseek-ai/deepseek-harness](https://github.com/deepseek-ai/deepseek-harness)（v0.1.0-rc.6）。

## 🏗️ 架构

dsh 打包为 fnOS 应用（`dsh` 用户常驻服务），提供多条访问入口，后端统一由 DeepSeek Harness web（dsh web）服务：

```
fnOS（飞牛私有云）
│
├─ 访问入口（三选一）
│  ├─ ① fnOS 桌面图标（iframe）
│  │     └─ http://127.0.0.1:28000 （直连，无需网关）
│  ├─ ② 局域网 / Tailscale 浏览器
│  │     └─ http://<NAS_IP>:28000 （dsh 绑 0.0.0.0）
│  └─ ③ fnOS 统一网关（可选）
│        └─ /app/dsh → app.sock （proxy.py）
│
├─ proxy.py（Unix socket 代理，可选）
│  └─ app.sock → 127.0.0.1:28000
│      · 重写 Host 规避 browser-trust
│      · 重写 HTML 资源路径 + 注入 <base>
│
├─ dsh web（DeepSeek Harness 浏览器 UI）
│  ├─ 0.0.0.0:28000（cordis.patch.yml 覆盖 webserver）
│  └─ --trusted-host 放行局域网/回环（browser-trust 围栏）
│
└─ 数据区 /vol4/@appdata/dsh/dsh_home
   ├─ profiles/web（cordis.patch.yml）
   ├─ logs
   ├─ .env（DEEPSEEK_API_KEY）
   └─ proxy.conf（可选代理）
```

### 访问入口

| 入口 | 路径/地址 | 说明 |
|------|-----------|------|
| **桌面图标** | `http://127.0.0.1:28000` | fnOS 桌面图标经 iframe 直连，无需网关 |
| **局域网 / Tailscale** | `http://<NAS_IP>:28000` | dsh 绑 0.0.0.0，可直接访问 |
| **fnOS 统一网关**（可选） | `/app/dsh` | 经 `app.sock` → proxy.py → 127.0.0.1:28000 |
| **FN Connect** | `http://dsh.teshysy.fnos.net` | teshysy是我的fnid， fn鉴权后直接访问 |

### 关键机制

- **dsh 绑 0.0.0.0**：通过 `cordis.patch.yml` 覆盖 webserver 配置，绕过 CLI 的 `--host 0.0.0.0` 安全校验（dsh CLI 会拒绝 0.0.0.0）
- **browser-trust 围栏**：dsh 只信任回环地址或 `--trusted-host` 声明的来源访问 `/api/*`，否则返回 **HTTP 403**。`cmd/main` 启动时动态探测本机局域网 IP 并加入 `--trusted-host`
- **统一网关代理（proxy.py）**：可选第二入口，转发并重写 Host 头规避 browser-trust，同时重写 HTML 绝对资源路径 + 注入 `<base>`，保证经 `/app/dsh` 访问资源不丢前缀
- **FN Connect**：`http://dsh.<FN_ID>.fnos.net` 直接访问 （fn鉴权）
- **离线打包**：dsh（含 node_modules）随 fpk 内置在 `app/server`，安装免联网

## 🚀 安装

从 [GitHub Release](https://github.com/techysy/deepseek-harness-fnos/releases) 下载 fpk（选对应架构）：

| 版本 | 适用 | 说明 |
|------|------|------|
| `dsh-<version>-x86.fpk` | x86 NAS | 离线包（含 node_modules），安装免联网 |
| `dsh-<version>-all.fpk` | x86 / ARM NAS | 在线包，安装时联网编译原生模块（耗时较长） |

1. App Center **手动安装** 选下载的 fpk
2. 安装向导填 DeepSeek API Key（sk- 开头，可留空后配置）
3. 桌面打开 DSH 应用图标进入浏览器 UI

> 依赖：fnOS 应用中心需已安装 **Node.js 24**（nodejs_v24，App Center 会自动安装依赖）。
<img width="1802" height="1077" alt="ScreenShot_2026-08-14_024604_935" src="https://github.com/user-attachments/assets/42553a95-d341-4b7b-b8d9-a599fd4d6e29" />

## 🔧 配置

### DeepSeek API Key
- 安装向导填写，或编辑 `/@appdata/dsh/dsh_home/.env`：
  ```
  DEEPSEEK_API_KEY=sk-xxx
  ```
- 改后重启应用生效
- 当然也支持 应用内直接配置 官方或者自定义提供方的 API key
<img width="1977" height="1164" alt="382fa5ba1eb85be13ed70580d38654ea" src="https://github.com/user-attachments/assets/6e48d940-c2a7-4f07-9340-afa3c9efbd5b" />

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
/var/apps/nodejs_v24/target/bin/npm install   # 依赖 g++/make，见下方"前置要求"

# 2. 打包 fpk（x86 离线版, platform=x86）
cd .. && fnpack build
mv dsh.fpk dsh-<version>-x86.fpk
```

> **ARM / 多架构（all 在线版）**：不含 node_modules（装时在线编译）。打包前先
> `mv app/server/node_modules /tmp/nm_backup`，改 manifest `platform = all` 再 `fnpack build`，
> 得 `dsh-<version>-all.fpk`，完成后恢复 node_modules。详见 [`docs/arm-build.md`](docs/arm-build.md)。

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

<img width="1763" height="1080" alt="ScreenShot_2026-08-14_030235_867" src="https://github.com/user-attachments/assets/30b6ab69-aa29-4c9f-875a-3e92b1a9a9d9" />

## 📝 版本历史

见 [CHANGELOG.md](CHANGELOG.md)

## 📄 许可证

本项目基于 [MIT License](LICENSE) 发布。

```
MIT License

Copyright (c) 2026 techysy（洋芋 / YangYu）

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```

> 上游 [deepseek-ai/deepseek-harness](https://github.com/deepseek-ai/deepseek-harness) 版权归其原作者所有；本仓库仅负责 fnOS 打包与集成。

### 上游协议

本仓库所集成的上游 [deepseek-ai/deepseek-harness](https://github.com/deepseek-ai/deepseek-harness)（DeepSeek 官方，v0.1.0-rc.6）同样基于 **MIT License**：

```
MIT License

Copyright (c) 2026 DeepSeek

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```

> 版权归属说明：本仓库 fnOS 打包层的代码与适配归 [techysy（洋芋 / YangYu）](LICENSE) 所有；上游 `deepseek-ai/deepseek-harness` 代码版权归 **DeepSeek** 所有。
