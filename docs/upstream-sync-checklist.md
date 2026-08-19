# 🔁 同步上游后检查清单（dsh）

> **目的**：每次同步上游（`@deepseek-ai/dsh` 升级 / 重装 fpk / npm install 覆盖 node_modules）后，
> 逐项核对本地增强是否还在。上游升级会覆盖 node_modules 与前端产物，**所有 patch 都可能被冲掉**，
> 按此清单验证可避免「老问题复发」。

## 背景

本项目对上游 dsh 有多处**本地补丁**，它们不在上游仓库里，npm install 或同步上游后默认丢失：

| # | 补丁 | 位置 | 失效症状 |
|---|------|------|---------|
| 1 | `crypto.randomUUID` polyfill | `dsh-web-frontend/dist/index.html` `<head>` | `crypto.randomUUID is not a function`，页面白屏/报错 |
| 2 | 特权 API 403 fence 放宽 | `dsh-client-connection/lib/index.js`（3 处 `[]`→trustedHosts） | `transport failure for /api/settings.describe: HTTP 403` |
| 3 | `--trusted-host` 默认加 `fnos.net` | `cmd/main` | FN Connect 域名访问 API 403 |
| 4 | `trusted_hosts.conf` 自动清理非法格式 | `cmd/main` | 带 `http://`/尾斜杠条目致整个信任列表加载失败 → 全 403 |
| 5 | 局域网直连：`--trusted-host <LAN IP>` | `cmd/main` | 局域网访问 API 403 |

## 同步上游后检查项

### 1. 检查补丁是否丢失（构建目录）

```bash
cd '/vol1/1000/fnOS App/build/dsh-fnos/app/server/node_modules/'

# [1] crypto polyfill
grep -c 'randomUUID' @deepseek-ai/dsh-web-frontend/dist/index.html    # 期望 ≥1

# [2] 特权 API fence
grep -c 'isTrustedApiRequest(request, trustedHosts)' @deepseek-ai/dsh-client-connection/lib/index.js   # 期望 ≥1
grep -c 'isTrustedApiRequest(request, \[\]))' @deepseek-ai/dsh-client-connection/lib/index.js          # 期望 0（残留旧钉扎）
```

### 2. 重建（幂等补丁自动应用）

`cmd/main` 的 `start_dsh()` 已在启动前**幂等**应用补丁 #2/#4。构建 fpk 前再显式跑一次：

```bash
cd '/vol1/1000/fnOS App/build/dsh-fnos/'
python3 scripts/patch_privileged_fence.py \
  app/server/node_modules/@deepseek-ai/dsh-client-connection/lib/index.js
python3 scripts/inject_crypto_polyfill.py \
  app/server/node_modules/@deepseek-ai/dsh-web-frontend/dist/index.html
```

### 3. 端到端验证（安装后）

```bash
# 3a. crypto polyfill 已注入（页面源码含 polyfill）
curl -s http://<NAS_IP>:28000/ | grep -c randomUUID          # 期望 ≥1

# 3b. 特权 API 不再 403（局域网 Host + Origin 模拟浏览器）
curl -s -o /dev/null -w '%{http_code}\n' \
  -H 'Host: <NAS_IP>:28000' -H 'Origin: http://<NAS_IP>:28000' \
  -H 'sec-fetch-site: same-origin' -H 'Content-Type: application/json' -d '{}' \
  -X POST http://127.0.0.1:28000/api/settings.describe       # 期望 200（不是 403）

# 3c. trusted-host 列表含 LAN IP + fnos.net (注意: 现在用单个 --trusted-host flag 拼所有值,
#     因为 dsh 的 --trusted-host <authority...> 是 variadic, 重复 flag 只保留最后一个)
ps aux | grep 'dsh.*web' | grep -v grep | grep -oE 'trusted-host .*' | head -1
# 期望单条 trusted-host 后跟所有值: <LAN IP> ... fnos.net ... dsh.<FNID>.fnos.net

# 3d. WebSocket 握手验证 (公网/FN ID 域访问不再 403)
#     期望 101 (不是 403): dsh.<FNID>.fnos.net
curl -s -o /dev/null -w '%{http_code}\n' -m 5 \
  -H 'Host: dsh.<FNID>.fnos.net' -H 'Connection: Upgrade' -H 'Upgrade: websocket' \
  -H 'Sec-WebSocket-Version: 13' -H 'Sec-WebSocket-Key: x3JJHMbDL1EzLkh9GBhXDw==' \
  http://127.0.0.1:28000/api/events.mux

# 3e. 浏览器实测: 打开 http://<NAS_IP>:28000, 设置页能加载模型/插件配置 (不白屏)
```

### 4. 版本号对齐

```bash
grep '^version' manifest                    # fpk 版本
grep '"version"' app/server/node_modules/@deepseek-ai/dsh/package.json   # 上游 dsh 版本
# 二者应一致 (如 0.1.0-rc.7)
```

## 常见坑

- **npm install 会覆盖 node_modules**：升级 dsh 后必须重跑补丁 #1/#2，再打包
- **fpk 重装会重写前端产物**：补丁必须内嵌进 fpk（patch 脚本随包携带），不能只改运行实例
- **trusted_hosts.conf 里写了 `http://域名/`**：必须去掉 scheme 和尾斜杠，否则整个信任列表加载失败（404 秒杀现象 = 全 API 403）
- **先看运行实例还是构建目录**：改完要分别确认 `/vol4/@appcenter/<app>/server/node_modules/`（运行）与构建目录 `app/server/node_modules/`（打包源）两处

## pnpm 集成（Agent 环境）

nodejs_v24 自带 corepack，dsh 的 agent 环境（bash 工具）应能用 `pnpm`/`yarn`/`bun` 跑项目/装依赖。cmd/main 启动时把 corepack shims + bunjs bin 加入 PATH 并设 `COREPACK_HOME` 到数据区。

依赖声明：`manifest` 的 `install_dep_apps = nodejs_v24:bunjs`（fnOS 自动装/启用 node + bun）。

验证（安装后）：
```bash
# 在 dsh agent 的 bash 里
node -v && npm -v && pnpm --version && yarn --version && bun --version
```

同步上游后检查：
```bash
grep -c 'corepack' cmd/main        # 期望 ≥1 (pnpm/yarn shims)
grep -c 'bunjs' cmd/main           # 期望 ≥1 (bun PATH)
grep 'install_dep_apps' manifest   # 期望 nodejs_v24:bunjs
```

## FN Connect ID 信任域（设置页）

设置页只填 **FN ID**（如 `techysy`），回调自动拼成两个信任域写入 `trusted_hosts.conf`：
- `https://<id>.fnos.net/` → `<id>.fnos.net`
- `https://fnos.net/<id>` → `fnos.net`
- `https://dsh.<id>.fnos.net/` → `dsh.<id>.fnos.net`（FN Connect 应用子域，实际访问入口）

验证：
```bash
cat ${DSH_HOME}/trusted_hosts.conf   # 期望三行: <id>.fnos.net + dsh.<id>.fnos.net + fnos.net
ps aux | grep 'dsh.*web' | grep -v grep | grep -o 'trusted-host fnos.net'  # 默认已加
```

同步上游后检查：`grep -c 'fnos_id' cmd/config_callback` 应 ≥1（FN ID 机制仍在）。

> 注意：`fnos.net` 是精确 hostname 匹配，**匹配不了子域**（`dsh.<id>.fnos.net` 需显式加入）。
> FN Connect 应用子域 `dsh.<id>.fnos.net` 若外部访问 403，先确认 FN Connect 后台已发布该应用，
> 而非 dsh 问题（nginx 网关 403 ≠ dsh fence 403）。
