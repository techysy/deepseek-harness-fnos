# dsh 访问方式说明 & 统一网关 /app/dsh（已打通）

> 说明 dsh（DeepSeek Harness）fnOS 应用的**正式访问方式**，以及统一网关
> `/app/dsh` 的**打通过程** —— 2026-10 起 DDNS / 自定义域名 HTTPS 场景的正解入口。

---

## 1. dsh 的正式访问方式

| 方式 | 地址 | 说明 |
|------|------|------|
| **局域网直连** | `http://<NAS_IP>:28000` | 局域网 / Tailscale 直接访问 |
| **FN Connect 域名** | `https://dsh.<FN_ID>.fnos.net` 或走 fnOS 网页 | 远程访问 |
| **统一网关（推荐）** | fnOS 网页内的**桌面图标**，或 `https://<访问域名>/app/dsh/` | 与访问 fnOS 的域名/协议同源；DDNS 自定义域名场景的正解 |

> dsh web 绑定 `0.0.0.0:28000`（经 `cordis.patch.yml` 覆盖）供局域网直连；
> 统一网关入口由 fnOS HTTPS 终结 + fnOS 登录保护，**无需对外暴露 28000**。

---

## 2. 统一网关打通过程（2026-10-01）

### 2.1 曾经的误判

早期调查结论是"统一网关不可行"：`/app/dsh` 登录后返回 Not Found，手动在
appcenter 数据库补 `gateway_socket` / `gateway_prefix` 后仍 Not Found，遂放弃。

**实际根因**：网关路由**一直是通的** —— "Not Found" 是 dsh 对 `/app/dsh/...`
路径返回的 SPA 404（body 恰为 "not found"），因为 `cmd/proxy.py` 收到网关
转发来的带前缀请求后**原样转发**，从不剥离 `/app/dsh` 前缀。

### 2.2 正确的接入方式（对齐官方微应用 fygo-browser）

1. `manifest` 声明 `micro_app = true` → appcenter 安装时自动填充数据库
   `gateway_socket = /var/apps/<app>/target/app.sock` 与 `gateway_prefix = /app/<appname>`
   （2026-10 前的版本缺这一条，数据库字段为空 → 网关确实无路由）
2. `app/ui/config` 声明 `"microApp": true` + `"gatewaySocket": "app.sock"` +
   `"gatewayPrefix": "/app/dsh"` + `"url": "/app/dsh/"` → 桌面图标经网关加载
3. `cmd/proxy.py` 两处修复：
   - **剥离 `/app/dsh` 前缀**再转发（此前缺失，是"Not Found"的直接原因）
   - **`Origin` / `Referer` 头同步改写为回环地址** —— dsh fence 校验
     `Origin.host === Host`，Host 已改写为 `127.0.0.1:28000`，不改写 Origin
     则经网关的 POST（浏览器带 Origin）全部 403

### 2.3 验证

- socket 直连 `/app/dsh/` → 200 + 完整页面（剥前缀生效）
- 网关 `https://<NAS>:5667/app/dsh/` 与桌面图标 → UI 完整加载，未登录时
  返回 fnOS 登录门（与官方微应用 fygo-browser 行为一致）

### 2.4 顺带收益

- **DDNS / 自定义域名**：`https://你的域名` 登录 fnOS 后 `/app/dsh/` 同源可用，
  不受浏览器混合内容限制，也**无需在路由器暴露 28000**
- **多一层安全边界**：网关入口有 fnOS 登录保护（28000 直连入口仅有信任围栏）
- 授权目录选择（开放平台 JS SDK）的 redirectUri 依赖同源网关 —— 本修复同时
  为后续接入铺了路

---

## 3. 相关配置

| 文件 | 说明 |
|------|------|
| `cordis.patch.yml` | 覆盖 webserver 绑 `0.0.0.0:28000`（局域网直连入口） |
| `trusted_hosts.conf` | FN Connect / 自定义域名（28000 直连的信任面） |
| `manifest` | `micro_app = true`（网关注册前提） |
| `app/ui/config` | 桌面入口网关声明（`gatewaySocket` / `gatewayPrefix`） |
| `cmd/proxy.py` | 网关代理：剥前缀 + Origin 改写 + WebSocket 透传 + HTML 路径重写 |

---

## 4. 回环限制参考

若遇到 `/api` 403 或插件/模型配置空白页，见 [`dsh-loopback-restriction.md`](./dsh-loopback-restriction.md)。
