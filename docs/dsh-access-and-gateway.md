# dsh 访问方式说明 & 统一网关 /app/dsh 不可行

> 说明 dsh（DeepSeek Harness）fnOS 应用的**正式访问方式**，以及为何
> **fnOS 统一网关 `/app/dsh` 方案不可行**（已调查并放弃）。

---

## 1. dsh 的正式访问方式

dsh 使用 **`28000` 端口**作为唯一 Web 入口，支持两种访问：

| 方式 | 地址 | 说明 |
|------|------|------|
| **局域网直连** | `http://<NAS_IP>:28000` | 局域网 / Tailscale 直接访问 |
| **FN Connect 域名** | `http://dsh.<FN_ID>.fnos.net` | 外网远程访问（需在设置页配 FN Connect 域名） |

> dsh web 绑定 `0.0.0.0:28000`（经 `cordis.patch.yml` 覆盖 webserver 配置）。
> 这两种方式是**正式、已验证可用**的入口。

---

## 2. 统一网关 /app/dsh 方案不可行

### 2.1 现象
尝试让 dsh 通过 **fnOS 统一网关**（`http://<NAS>:5666/app/dsh`）访问，但**登录后返回 Not Found**。

### 2.2 根因（已通过 PostgreSQL 确认）
fnOS 统一网关路由 `/app/<appname>` → 应用 `gateway_socket`，依赖应用中心数据库的
`gateway_socket` / `gateway_prefix` 字段。查询 `appcenter` 数据库：

```sql
SELECT a.app_name, s.gateway_socket, s.gateway_prefix, a.micro_app
FROM app a JOIN app_service s ON s.app_id = a.id
WHERE a.app_name = 'dsh';
```

结果：
```
app_name | gateway_socket | gateway_prefix | micro_app
dsh      | (空)           | (空)           | t
```

- **`micro_app = true` 已设置**，但 **`gateway_socket` 和 `gateway_prefix` 为空**
- **`micro_app` 不会自动填充 `gateway_socket`**
- 网关不知道 `/app/dsh` 转发到哪个 socket → 登录后 Not Found

### 2.3 对比正常应用
正常接入统一网关的应用（如 fygo-browser）：
```
gateway_socket = /var/apps/fygo-browser/target/app.sock
gateway_prefix = /app/fygo-browser
```

需要**手动设置** `gateway_socket` 和 `gateway_prefix` 才能生效。

### 2.4 手动设置后仍不可行
手动更新数据库设置 `gateway_socket` / `gateway_prefix` 并重启网关后，
**登录后仍 Not Found**（涉及 fnOS 网关更深层的应用接入机制，未完整打通）。

### 2.5 结论
- **`/app/dsh` 统一网关方案放弃**
- dsh 保持 **局域网直连 28000** + **FN Connect 域名** 作为正式访问方式
- 这些方式已验证可用，无需统一网关

---

## 3. 相关配置

| 文件 | 说明 |
|------|------|
| `cordis.patch.yml` | 覆盖 webserver 绑 `0.0.0.0:28000` |
| `trusted_hosts.conf` | FN Connect 域名（browser-trust 信任） |
| `cmd/proxy.py` | 统一网关代理（`/app/dsh` → 127.0.0.1:28000，方案放弃后保留为可选） |

> ⚠️ `cmd/proxy.py` 虽保留，但**统一网关路由未打通**，`/app/dsh` 不保证可用。
> 正式访问请用 28000 直连或 FN Connect 域名。

---

## 4. 回环限制参考

若遇到 `/api` 403 或插件/模型配置空白页，见 [`dsh-loopback-restriction.md`](./dsh-loopback-restriction.md)。
