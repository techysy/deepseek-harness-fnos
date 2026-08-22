# dsh-fnos 测试日志

> 记录开发/测试迭代的历史更新详情。正式功能点聚合见 `CHANGELOG.md`。

## 0.1.1-rc.2 (2026-08-22)

> 升级上游 `@deepseek-ai/dsh` 到 0.1.1-rc.2。回归历史 `npm install` 打包方式（自包含 node_modules，无 symlink）。

### 测试报告

**安装方式**：fnOS App Center 手动安装 `dsh-0.1.1-rc.2-iframe-x86.fpk`

**验证项**：

| 检查项 | 结果 |
|--------|------|
| 服务启动 | ✅ `dsh web started 0.0.0.0:28000`，health OK |
| HTTP 访问 | ✅ `http://127.0.0.1:28000/` → 200 |
| offline 包识别 | ✅ `offline dsh package OK: .../node_modules/@deepseek-ai/dsh/lib/bin.js`（免联网） |
| 0.0.0.0 绑定 | ✅ cordis.patch.yml 覆盖 webserver host |
| trusted-host | ✅ LAN IP + fnos.net + `techysy.fnos.net` + `dsh.techysy.fnos.net` |
| 数据迁移 | ✅ 3 工作空间（test 14 / fnOS App 7 / hermes 3 会话） |
| crypto polyfill | ✅ 服务端 index.html 含 |
| settings memory→host 补丁 | ✅ client.js 含 |
| node_modules 自包含 | ✅ `@deepseek-ai/dsh` 为实体目录（非 symlink） |

### 关键回归：打包方式

**问题**：v0.1.1-rc.2 曾误用 pnpm workspace 源码构建，node_modules 全是 symlink，导致：
1. fnpack 打包 `copy_file_range: is a directory` 报错
2. 安装后依赖链断裂（js-yaml 找不到、bin.js 找不到、dsh not found）

**回归方案**：改用历史 `npm install @deepseek-ai/dsh@0.1.1-rc.2` 方式
- `app/server/package.json` 只声明 `{"dependencies": {"@deepseek-ai/dsh": "0.1.1-rc.2"}}`
- `npm install` 生成**扁平自包含 node_modules**（283M，fpk 压缩后 48M）
- 无 symlink，打包/安装无需任何特殊处理
- node-pty 等原生模块走 prebuild（`prebuilds/linux-x64/pty.node`），无 glibc 编译问题

**补丁**（对 npm 安装后的 node_modules）：
- `scripts/inject_crypto_polyfill.py` → 注入 index.html（crypto.randomUUID）
- `cmd/patch_settings_memory.py` → client.js `memory→host`（非 loopback 配置可读）
- 0.0.0.0 绑定 → cmd/main 写 cordis.patch.yml 覆盖（不依赖源码补丁）

### 关键坑记录

1. **npm install 在 NAS 上慢**：dsh 依赖树大，解析要 10+ 分钟。需 `NODE_OPTIONS=--max-old-space-size=4096`（默认 1024 会 OOM）。
2. **install_callback 的 patch 目标路径**：fnOS 安装时 APP_DIR 指向 `/vol4/appcenter-downloads/...-tpk`（临时解压目录），patch_settings_memory.py 找不到 node_modules → 打印 `target root not found`。但补丁已打进 fpk（server 里已补好），安装后无需再打，该 warning 无害。
3. **fpk 大小**：npm 方式 48M vs 错误 pnpm 方式 394M。历史 0.1.0-rc.7 也是 ~53M，印证 npm 方式正确。
4. **.bin symlink**：npm 布局下 `node_modules/.bin/` 有命令 symlink，fnpack 打包前需移除（指向文件，但保险起见 unlink）。

### 补丁脚本（幂等，随 fpk 携带）
- `scripts/inject_crypto_polyfill.py`：注入 crypto.randomUUID polyfill 到 `dsh-web-frontend/dist/index.html`
- `cmd/patch_settings_memory.py`：`connection.isLoopback ? "host" : "memory"` → `"host"`（dsh-client-ui-settings）

---

## 历史条目

## 0.0.15 (2026-08-14)
- **数据保护：卸载不再删除工作空间**：移除 uninstall_callback 对 `dsh_home` 的 `rm -rf`
- dsh_home 含工作空间（profiles/storages）、API Key（.env）、代理（proxy.conf）等用户数据，卸载/升级后全部保留
- 卸载只清理运行时日志/pid

## 0.0.14 (2026-08-14)
- **fnOS 应用设置页加网络代理入口**：应用中心 → dsh 应用设置可修改代理（写 `DSH_HOME/proxy.conf`）
- **更新逻辑**：设置页填写代理才更新 proxy.conf；**留空保留当前值**（不置空）
- 改后需重启 dsh 应用生效（fnOS 设置保存不自动重启）

## 0.0.13 (2026-08-14)
- **安装向导可填网络代理**：wizard 加"网络代理（可选）"输入项，填了会写入 `DSH_HOME/proxy.conf`，dsh 网络请求（git/npm/API）走该代理
- **默认不走代理**：proxy.conf 不存在时不设置代理，仅用户配置时才走代理
- 需代理时也可手动编辑 `/vol4/@appdata/dsh/dsh_home/proxy.conf`（`PROXY=http://127.0.0.1:7890`）
