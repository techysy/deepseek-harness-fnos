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

## 0.1.2-rc.1 同步验证结果（2026-09-06）

> 对 `@deepseek-ai/dsh@0.1.2-rc.1`（npm `latest`）逐个核对了本地补丁，结论如下：

| # | 补丁 | 0.1.2-rc.1 状态 | 处理 |
|---|------|----------------|------|
| 1 | crypto.randomUUID polyfill（index.html） | **不再需要**：前端 `dsh-web-frontend/dist`、所有 `client-ui-*` 的 client.js 均零引用 `randomUUID`（只剩 server 端 `dsh-client-connection` 使用） | 保留注入（无害幂等），文档标注过时 |
| 2 | 特权 API fence 放宽（client-connection） | **上游已原生修复**：`requestRejection()` 统一走 `isTrustedApiRequest(request, this.trustedHosts)`，`[]` 钉扎已移除；`--trusted-host` 原生生效 | 运行时 patch 无命中自动跳过（日志提示 native） |
| 3 | settings memory→host | **仍必需，模式已变**：三元表达式接收者 `connection.` → `ctx.remote.$host.`；`dsh-client-ui-settings-models` 不再含此模式 | `patch_settings_memory.py` 已改为正则匹配（兼容新旧两版），settings 主包未命中即 exit 1 |
| 4 | `--trusted-host` CLI | 仍在 `dsh-web-app`（`--trusted-host <authority...>` variadic 不变） | 无需改动 |
| 5 | cordis.patch.yml 绑 0.0.0.0 | CLI 仍拒绝 `--host 0.0.0.0`（intentional for safety）；patch 机制仍在；**新增**：绑 0.0.0.0 时上游原生派生 LAN IP 信任（`resolveLanTrust`） | 机制仍必要且有效 |
| 6 | 浏览器鉴权放行（client-connection `isAuthenticated` 早返回） | **本地补丁覆盖（不抬 fpk 版本号）**：上游 0.1.2 加浏览器 token 鉴权（launch token → 30 天 authority 绑定 cookie），静态桌面入口裸 `/` 会 401 | cmd/main 运行时 patch 幂等注入；信任面 = Host/Origin 围栏 + `--trusted-host`；另落盘 `dsh-web-url.txt` 备用 |

### 0.1.2+ 的构建后校验命令

```bash
# [3] settings host-mode 补丁 (新版唯一仍需的构建期补丁)
grep -c 'dsh-fnos: settings host-mode patch' \
  app/server/node_modules/@deepseek-ai/dsh-client-ui-settings/lib/client.js   # 期望 ≥1
# 旧三元表达式应清零
grep -c 'isLoopback ? "host" : "memory"' \
  app/server/node_modules/@deepseek-ai/dsh-client-ui-settings/lib/client.js   # 期望 0

# [2] fence 已原生 (informational, 0.1.2+ 期望命中)
grep -c 'isTrustedApiRequest(request, this.trustedHosts)' \
  app/server/node_modules/@deepseek-ai/dsh-client-connection/lib/index.js     # 期望 ≥1

# [1] polyfill (0.1.2+ 不再需要, 可选)
grep -c 'randomUUID' app/server/node_modules/@deepseek-ai/dsh-web-frontend/dist/index.html
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

## 现场排障：桌面打开 401（"dsh web authentication required; reopen the URL printed by dsh web"）

上游 0.1.2+ 的浏览器 token 鉴权 + 静态桌面入口冲突（详见 CHANGELOG 0.1.2-rc.1 条目）。fpk 靠 `cmd/main` 启动时运行时补丁放行；**同版本包有人复现 401 = 他机器上补丁没打上**，按序排查：

```bash
# 1. 版本应 >= 0.1.2-rc.1 (0.1.0/0.1.1 上游无此鉴权, 不会报这个错)
grep '^version' /var/apps/dsh/manifest

# 2. 补丁标记 (1=在; 0=没打上 → 看第 3 步)
grep -c 'fnos-fpk: browser token auth off'   /vol*/@appcenter/dsh/server/node_modules/@deepseek-ai/dsh-client-connection/lib/index.js

# 3. 没打上的常见根因: /usr/bin/python3 缺失 (cmd/main 补丁脚本依赖, 部分 fnOS 无)
ls /usr/bin/python3 || echo "python3 缺失 → 根因确认"

# 4. 立即热修 (不依赖 python3, 用 node; 从 Gitee raw 拉, 国内快):
curl -sL https://gitee.com/techysy/deepseek-harness-fnos/raw/main/scripts/fix-browser-auth-401.sh | sudo bash

# 5. 打完必须 应用中心 → dsh → 重启 (运行中进程仍带旧代码)
```

> cmd/main 已加双重防御（commit 835d3fe：python3 失败自动 node 兜底；ecb5e60：补丁结果落 app.log `privileged-fence patch:` 行）——两者随下一个上游版本的 fpk 生效，老 fpk 用户用上面第 4 步热修。

## 现场排障：升级后 webui 崩溃循环（第三方插件不兼容）

**症状**：升级 fpk 后 dsh web 反复崩溃重启（守护脚本/cron 每 60s 拉起），端口 28000 起后又消失；页面无法访问。日志可见插件树加载失败 → 进程退出。

**根因**：跨大版本升级（如 0.1.2→0.1.5）插件 API 有破坏性变更（SessionHandle / session V3 / 默认工具调整），用户装过的第三方插件加载即崩。**fpk 本身无问题**——纯净安装不受影响，装了插件才会踩。

**现场案例**：2026-09-12 朋友 NAS（FN ID howeverme，0.1.2→0.1.5），4 个不兼容插件崩溃循环，其 dsh agent 自诊断锁定插件名单。

**处理流程**：

```bash
# 1. 停掉守护 cron (它每分钟拉起注定崩溃的进程, 干扰排查)
crontab -l | grep -i dsh   # 找到后注释掉

# 2. 从启动日志锁定加载失败的插件 (dsh 日志/插件目录按实际布局)
#    (dsh 自身 agent 也能自诊断: 问它"为什么 webui 起不来"即可锁定名单)

# 3. 把不兼容插件移出插件目录 → 启动 dsh web 验证恢复

# 4. 逐个恢复插件:
#    - 有兼容新版本 → 升级插件
#    - 没有 → 用 oh-my-dsh 迁移 skill 适配:
#      https://github.com/oh-my-dsh/dsh-plugin-upgrade-skill
#      (上游官方 notes 推荐, 帮插件作者适配 DSH 版本升级)
```

> 发布侧已配套：GitHub/Gitee Release notes「升级注意」明确警告第三方插件用户。
> 相关：升级前先记录已装插件名单，升级后崩溃时可快速比对。
