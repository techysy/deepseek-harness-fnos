# CHANGELOG

## 0.1.1-rc.2 (2026-08-22)

> 升级上游 `@deepseek-ai/dsh` 到 0.1.1-rc.2。本地 3 处源码补丁 + polyfill 注入，pnpm monorepo 离线打包。

### 升级 / 新增
- **上游升级**：deepseek-ai/deepseek-harness 0.1.0-rc.7 → 0.1.1-rc.2（pnpm install + pnpm build 重编译，含客户端 `pnpm run build:lib:client`）
- **`--host 0.0.0.0` 补丁**：`packages/bundle/web-app/src/startup.ts` 放开 CLI 层拦截，允许全接口绑定（上游仍拒绝 0.0.0.0）
- **PRIVILEGED_METHODS trustedHosts 补丁**：`packages/client/connection/src/index.ts` 空信任列表改 `trustedHosts`，LAN 访问 settings API 不再 403
- **isLoopback → host mode 补丁**：`packages/client/ui-settings/src/client/index.ts` + `settings-scope.ts` 两处，设置页非 loopback 也读服务器配置
- **crypto.randomUUID polyfill**：注入所有 `@deepseek-ai/*/lib/client.js`（LAN IP 非安全上下文修复）

### 打包流程修复
- **fnpack 不支持 symlink**：打包前 `find . -type l | unlink` 移除，打包后恢复（详见 `docs/fnpack-symlink.md`）
- **pnpm workspace symlink 手动创建**：pnpm 在 NAS 不自动创建，含 `vendor/*` `packages/*/*` `apps/*`（dsh CLI 在 apps/cli）
- **node_modules 权限修复**：`chmod -R a+rX node_modules/`（pnpm 创建的 600 权限文件导致 fnpack/运行失败）
- **cmd/main / upgrade_callback 路径修复**：DSH_JS/CC_LIB/DSH_OFFLINE 加 `target/server/` 路径
- **install/upgrade callback 加 workspace symlink 创建**（幂等，含 apps glob）
- **install_callback 加数据迁移**：从旧路径（`/vol4/@appdata/dsh/` 等）复制 dsh_home 用户数据
- **appname = dsh**：FN Connect 域名自动 `dsh.<user>.fnos.net`

## 0.1.0-rc.7 (2026-08-20)

> 本日小版本更新：trusted-host 修复 + 自定义域名（DDNS）支持。

### 修复 / 新增
- **FN ID 字段名修正**：安装向导 / 设置页统一用 FN ID（`wizard_fnos_id` / `fnos_id`，只填 ID 如 `techysy`），回调自动拼 `<id>.fnos.net`、`dsh.<id>.fnos.net`、`fnos.net` 三个信任域写入 `trusted_hosts.conf`。修复先前字段名不一致导致向导填的域名未写入的问题。
- **新增自定义域名（DDNS）字段**：部分用户用自己的域名做 DDNS 远程访问（非 FN Connect），新增 `wizard_custom_domain` / `custom_domain` 字段，完整域名追加到 `trusted_hosts.conf`，dsh 启动时一并加入 `--trusted-host`，域名访问 API 不再 403。
- **cmd/main trusted-host 完善**：支持 `trusted_hosts.conf` 多行读取（每行一个 hostname，`#` 注释，自动清理 `http(s)://` 前缀与结尾 `/`），内置 `fnos.net` + 本机非回环 IP，避免非法条目导致整个 trustedHosts 加载失败。
- **variadic trusted-host**：改用单个 `--trusted-host` flag 拼所有值（空格分隔），避免 commander 后者覆盖只保留最后一个。

## 0.1.0-rc.7 (2026-08-14)

> 版本号对齐官方 `@deepseek-ai/dsh`（deepseek-ai/deepseek-harness 0.1.0-rc.7）。历史迭代详情（0.0.1~0.0.15，原始 1.0.0~1.0.14）见 `test log.md`。

### 核心功能
- **dsh web 常驻服务**：`dsh web` 局域网直连 `0.0.0.0:28000`（经 cordis.patch.yml 覆盖，绕过 CLI 0.0.0.0 校验）
- **离线打包**：dsh 随 fpk 内置（app/server/node_modules），NAS 安装免联网
- **桌面入口直连端口**：app/ui/config 用 iframe + http + port 28000（不用统一网关 /app/dsh）
- **统一网关代理**（proxy.py）：Unix socket → 127.0.0.1:28000，重写 HTML 资源路径 + Host

### 问题修复
- **局域网 API 403**：cmd/main 动态探测局域网 IP 并加 `--trusted-host`，/api 浏览器信任围栏放行局域网访问
- **设置页 API 403**：放宽 dsh 特权 API（settings.describe 等）回环钉扎，允许局域网配置模型/插件/Agent 预设
- **crypto.randomUUID 不可用**：前端 index.html + 39 个 client.js 注入 polyfill（非安全上下文可用）
- **/home/dsh ENOENT**：cmd/main 设置 HOME=DSH_HOME（数据区）+ 确保目录存在
- **空白页**：proxy.py 重写 HTML 绝对资源路径 + 注入 `<base href="/app/dsh/">`
- **native 模块兼容**：app/server node_modules 在 NAS（glibc 2.36 + g++）重编译，解决离线包加载失败
- **显示名修正**：应用中心/桌面显示 **DeepSeek Harness**（非 DSH）

### 配置与代理
- **安装向导可填 DeepSeek API Key + 网络代理**（代理为 **IP + 端口** 两个输入框，避免冒号输错）
- **fnOS 应用设置页可改代理**（IP + 端口两个输入框；留空保留当前值，不置空；改后重启生效）
- **默认不走代理**：proxy.conf 不存在时不设置；需代理时由用户配置（写入 `DSH_HOME/proxy.conf`，`PROXY=http://IP:端口`）
- dsh 网络请求（git/npm/API）经 HTTP_PROXY/HTTPS_PROXY 走代理

### FN Connect 远程访问
- **FN Connect 域名（FN ID）配置**：安装向导 / 设置页可填，写入 `DSH_HOME/trusted_hosts.conf`（单域名），dsh 启动时加入 `--trusted-host`，域名远程访问 API 不再 403
- **修复 settings 前端空白**：非 loopback（FN Connect 域名）访问时，settings 前端改用 host 模式读服务器配置（patch_settings_memory.py），修复插件配置 / 模型配置空白页（上游 loopback-only 设计限制）

### 数据与元数据
- **数据保护**：卸载不再删除工作空间（保留 dsh_home 的 profiles/storages、API Key、代理），只清运行时日志/pid
- **开发者信息**：maintainer = **DeepSeek**（deepseek-ai/deepseek-harness），distributor = techysy/deepseek-harness-fnos
- **图标**：DeepSeek 官方黑色鲸鱼
- **依赖**：nodejs_v24

### 已知限制
- 飞牛移动 App 容器（WebView）有固有限制（SameSite cookie/localStorage/跨源），dsh 复杂前端建议用手机浏览器（Chrome/飞书）访问
