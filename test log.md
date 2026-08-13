# dsh-fnos 测试日志

> 记录开发/测试迭代的历史更新详情。正式功能点聚合见 `CHANGELOG.md` 的 `0.1.0-rc.6`。
> 以下为 v1.0.x 迭代阶段的详细记录（已迁移，版本号不再使用，Release/tag 已删除）。

## 1.0.14 (2026-08-14)
- **数据保护：卸载不再删除工作空间**：移除 uninstall_callback 对 `dsh_home` 的 `rm -rf`
- dsh_home 含工作空间（profiles/storages）、API Key（.env）、代理（proxy.conf）等用户数据，卸载/升级后全部保留
- 卸载只清理运行时日志/pid

## 1.0.13 (2026-08-14)
- **fnOS 应用设置页加网络代理入口**：应用中心 → dsh 应用设置可修改代理（写 `DSH_HOME/proxy.conf`）
- **更新逻辑**：设置页填写代理才更新 proxy.conf；**留空保留当前值**（不置空）
- 改后需重启 dsh 应用生效（fnOS 设置保存不自动重启）

## 1.0.12 (2026-08-14)
- **安装向导可填网络代理**：wizard 加"网络代理（可选）"输入项，填了会写入 `DSH_HOME/proxy.conf`，dsh 网络请求（git/npm/API）走该代理
- **默认不走代理**：proxy.conf 不存在时不设置代理，仅用户配置时才走代理
- 需代理时也可手动编辑 `/vol4/@appdata/dsh/dsh_home/proxy.conf`（`PROXY=http://127.0.0.1:7890`）

## 1.0.11 (2026-08-14)
- **开发者信息修正**：manifest maintainer 改为 **DeepSeek**（上游 deepseek-ai/deepseek-harness），distributor 保持 techysy/deepseek-harness-fnos

## 1.0.10 (2026-08-14)
- **修复设置页 API 403**：放宽 dsh 特权 API（settings.describe 等）回环钉扎，允许局域网可信来源访问模型/插件/Agent 预设配置
- 注意：飞牛移动 App 容器（WebView）有固有限制（SameSite cookie/localStorage/跨源），dsh 复杂前端建议用手机浏览器（Chrome/飞书）访问

## 1.0.9 (2026-08-14)
- **修复局域网 API 403**：cmd/main 启动 dsh 时动态探测局域网 IP 并加 `--trusted-host`，让 /api 浏览器信任围栏放行局域网访问（此前所有 API 403）
- **修复 /home/dsh ENOENT**：cmd/main 设置 HOME=DSH_HOME（数据区）+ 确保目录存在
- **修复 crypto.randomUUID is not a function**：前端 index.html + 39 个 client.js 注入 polyfill（非安全上下文可用）
- **内置 DeepSeek API Key 初始化提示**：首次需在安装向导或 .env 配置

## 1.0.8 (2026-08-14)
- **显示名修正**：app/ui/config 入口 title 从 "DSH" 改为 "DeepSeek Harness"（应用中心/桌面图标显示全名）

## 1.0.7 (2026-08-14)
- **图标改用 dsh 运行时 favicon**（http://<NAS_IP>:28000/favicon.svg，DeepSeek 官方黑色鲸鱼）

## 1.0.6 (2026-08-14)
- **桌面入口直接指向端口 28000**：app/ui/config 改为 `iframe + protocol http + port 28000`（不再用统一网关 /app/dsh），桌面图标直连
- **发布者信息修正**：manifest maintainer_url / distributor_url 改为 https://github.com/techysy/deepseek-harness-fnos

## 1.0.5 (2026-08-13)
- **局域网直连**：经 cordis.patch.yml 覆盖 webserver 绑 `0.0.0.0:28000`（绕过 CLI 0.0.0.0 安全校验），局域网/Tailscale 可直接访问 `NAS_IP:28000`
- **service_port 改为 28000**（统一 dsh web 端口，含 patch 层）
- **修复空白页**：proxy.py 重写 HTML 绝对资源路径 + 注入 `<base href="/app/dsh/">`，统一网关资源加载正常
- **图标换黑色**：DeepSeek 官方黑色鲸鱼图标

## 1.0.4 (2026-08-13)
- **修复 app/server native 模块兼容性**：在 NAS 上重新构建 app/server node_modules（node-pty/sharp/lightningcss/rolldown/oxc-parser 等原生模块改用 NAS glibc 2.36 环境 + g++ 现场编译），解决离线包在 Arch(glibc 2.42) 构建导致的 NAS 加载失败
- install_callback 增加 **g++/build-essential 检测**：缺失时在 install.log 给出清晰提示（避免"安装成功但 dsh 起不来"的困惑）

## 1.0.3 (2026-08-13)
- **离线打包**：dsh 随 fpk 内置（app/server/node_modules），NAS 安装免联网
- install_callback 改为离线模式（不再 npm install）

## 1.0.2 (2026-08-13)
- 应用名改为 **DeepSeek Harness**
- 图标换成 **DeepSeek 官方图标**
- 修复 node PATH（npm install 找不到 node）+ socket 目录

## 1.0.1 (2026-08-13)
修复"无效的包"：补齐 9 个 fnOS 生命周期脚本（config_init/callback、install_init、uninstall_init/callback、upgrade_init/callback），修复 config/resource 括号格式。

## 1.0.0 (2026-08-13)
首个版本：DeepSeek Harness (dsh) fnOS 应用包。
- **dsh web 常驻服务**：`dsh web` 绑 127.0.0.1:18080（DeepSeek Harness 浏览器 UI）
- **飞牛官方统一网关接入**：`/app/dsh`（gatewaySocket: app.sock + gatewayPrefix），桌面图标入口
- **统一网关代理**（proxy.py）：Unix socket → 127.0.0.1:18080，重写 Host 规避 dsh browser-trust
- **安装向导**：DeepSeek API Key 配置
- **依赖**：nodejs_v24 + `npm install -g @deepseek-ai/dsh`
