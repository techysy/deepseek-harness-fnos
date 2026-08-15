# DSH 前端网络回环限制（loopback restriction）详解

> 说明 DeepSeek Harness（dsh）的前端网络**回环（loopback）限制**机制：
> 为什么局域网 / FN Connect 域名访问时 API 会 403、插件/模型配置会空白，
> 以及 dsh-fnos 是如何解决这些问题的。

---

## 1. 概述

dsh（DeepSeek Harness）为安全考虑，其前端网络访问受**回环限制**约束：

- **browser-trust 围栏**：`/api/*` 只信任回环地址（loopback）或显式声明的 `--trusted-host`，否则返回 **HTTP 403**
- **settings 前端 memory 模式**：非回环访问时，`dsh-client-ui-settings` 用 `memory` 模式（进程内），导致**读不到服务器配置**，插件/模型配置页空白

这两个限制导致：**通过局域网 IP 或 FN Connect 域名访问 dsh 时，API 403、配置页空白**。

---

## 2. browser-trust 围栏（API 403）

### 2.1 机制

dsh 的 `/api` 请求会经过 **browser-trust fence** 检查（`dsh-client-connection`）：

```js
function isTrustedAuthority(hostUrl, trustedHosts) {
    return trustedHosts.some((entry) => {
        const entryUrl = parseAuthority(entry);
        if (entryUrl === void 0) return false;
        return canonicalAuthority(entry, entryUrl) === entryUrl.hostname
            ? entryUrl.hostname === hostUrl.hostname    // 精确匹配 hostname
            : entryUrl.host === hostUrl.host;
    });
}
```

**关键**：`/api/*` 的请求，只有满足以下之一才会放行：
1. **Host 是回环地址**（`127.0.0.1`、`localhost`）
2. **Host 在 `--trusted-host` 列表里**（精确匹配）

否则返回 **HTTP 403**。

### 2.2 现象

| 访问方式 | 结果 |
|---------|------|
| `http://127.0.0.1:28000`（NAS 本机） | ✅ 正常 |
| `http://<NAS_IP>:28000`（局域网直连） | ❌ API 403 |
| `http://<fnid>.fnos.net`（FN Connect 域名） | ❌ API 403 |

### 2.3 为什么 dsh 要这么做

- 防止 **DNS rebinding** 攻击（恶意网站让浏览器访问内网 dsh）
- 只信任回环 / 显式声明的来源

---

## 3. trusted-host 机制（`--trusted-host`）

dsh 启动时通过 `--trusted-host <host>` 声明额外信任的来源（可多个）。

```bash
# 声明信任 192.168.31.101 和 dsh.techysy.fnos.net
dsh web --port 28000 --trusted-host 192.168.31.101 --trusted-host dsh.techysy.fnos.net
```

**注意**：
- **精确匹配**，不支持通配符（`*.fnos.net` 不会匹配子域名）
- 一个 `--trusted-host` 声明一个 host，可重复声明多个

---

## 4. dsh-fnos 的 trusted-host 处理（cmd/main）

dsh-fnos 的 `cmd/main` 启动 dsh 时，**动态构建** `--trusted-host` 列表：

```bash
# 1) 动态探测本机所有非回环 IPv4 (局域网/Tailscale 等), 全部加入信任
LAN_IPS="$(ip -4 addr show 2>/dev/null | grep -oE 'inet [0-9.]+' | awk '{print $2}' | grep -v '^127\.' || true)"
for ip in ${LAN_IPS}; do
    TRUSTED_HOST_ARGS="${TRUSTED_HOST_ARGS} --trusted-host ${ip}"
done

# 2) 读取用户配置的 FN Connect 域名 (trusted_hosts.conf), 追加信任
if [ -f "${DSH_HOME}/trusted_hosts.conf" ]; then
    HOST_TRUSTED="$(head -1 "${DSH_HOME}/trusted_hosts.conf" | tr -d '[:space:]')"
    [ -n "${HOST_TRUSTED}" ] && TRUSTED_HOST_ARGS="${TRUSTED_HOST_ARGS} --trusted-host ${HOST_TRUSTED}"
fi
```

**效果**：
- **局域网直连**：本机 IP 已自动加入信任 → 局域网访问 `/api` 不再 403
- **FN Connect 域名**：用户在安装向导 / 设置页填写的域名，写入 `trusted_hosts.conf`，启动时加入信任 → 域名访问不再 403

---

## 5. FN Connect 域名配置

每个用户的 FN Connect 域名不同（如 `dsh.techysy.fnos.net`），需**在 dsh 设置页配置**：

| 配置项 | 说明 |
|--------|------|
| **FN Connect 域名** | 填写你的 dsh 远程访问域名（只填域名，不带 `https://` 或路径） |
| 保存位置 | `${DSH_HOME}/trusted_hosts.conf`（单行一个域名） |

**注意**：因为 dsh 的 trusted-host 是**精确匹配**，必须填**完整的子域名**（如 `dsh.techysy.fnos.net`），不能只填父域名 `techysy.fnos.net`（那无法匹配子域名）。

---

## 6. settings 前端回环限制（插件/模型配置空白）

### 6.1 机制

即使 `/api` 403 解决了，还有**第二个回环限制**：settings 前端。

`dsh-client-ui-settings` 和 `dsh-client-ui-settings-models` 前端，根据连接是否回环选择配置持久化模式：

```js
new SettingsScopeController(api, spec, connection.isLoopback ? "host" : "memory")
```

- **loopback**（127.0.0.1）→ `"host"` → 读服务器配置 → 插件/模型配置正常
- **非 loopback**（域名/远程）→ `"memory"` → 进程内，**读不到服务器配置** → 插件/模型配置**空白页**

> 上游 `.d.ts` 注释：*"remote browsers remain process-local because settings RPCs are loopback-only"* —— 这是上游的设计限制。

### 6.2 现象

通过 FN Connect 域名（非 loopback）访问时，**插件配置页、模型配置页空白**（即使 /api 已放行）。

### 6.3 解决办法（dsh-fnos 的 patch）

dsh-fnos 的 `cmd/patch_settings_memory.py` 在安装/升级时，把 settings 前端的模式**固定为 `"host"`**：

```bash
# install_callback / upgrade_callback 调用
python3 "${APP_DIR}/cmd/patch_settings_memory.py"
```

脚本将 `connection.isLoopback ? "host" : "memory"` 替换为 `"host"`（幂等，带 marker）：

```js
// patch 后
new SettingsScopeController(api, spec, "host")
```

这样**非 loopback（FN Connect 域名）访问时，也能读服务器配置**，插件/模型配置不再空白。

> ⚠️ **安全提示**：此 patch 解除了上游 loopback-only 的配置读限，建议配合 FN Connect 鉴权 / 网络访问控制使用。

---

## 7. 总结

| 限制 | 现象 | 解决办法 |
|------|------|---------|
| **browser-trust 围栏** | `/api` 403（非回环） | 动态探测局域网 IP + `trusted_hosts.conf` 域名 → `--trusted-host` |
| **settings 前端 memory 模式** | 插件/模型配置空白（非回环） | `patch_settings_memory.py` 固定为 `"host"` 模式 |

**dsh-fnos 已内置这两个解决机制**，安装后：
- 局域网直连：自动放行
- FN Connect 域名：在设置页填域名后放行，且插件/模型配置正常

---

## 8. 相关文件

| 文件 | 说明 |
|------|------|
| `cmd/main` | 动态构建 `--trusted-host`（局域网 IP + trusted_hosts.conf） |
| `cmd/patch_settings_memory.py` | settings 前端 `memory→host` patch（安装/升级时自动应用） |
| `cmd/install_callback` | 保存 trusted_hosts.conf + 调用 patch |
| `cmd/config_callback` | 设置页保存 FN Connect 域名到 trusted_hosts.conf |
| `wizard/install` / `wizard/config` | FN Connect 域名输入项 |
