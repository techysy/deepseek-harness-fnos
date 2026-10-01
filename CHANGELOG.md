# CHANGELOG

## 🚀 0.2.0-rc.2.4 (2026-10-01)

> 修复图片输入在 `@appshare` 工作区因 EACCES 权限错误被误报 `session/agent-busy`（#9）。上游不变（0.2.0-rc.2），fpk 版本 = 上游 + 构建段 4。

### 🐛 修复

- **图片上传/持久化在共享工作区报 EACCES 权限错误（#9）**：上游 `dsh-attachment-local` 的 `ensureDurableHome` 默认向上遍历同步父目录到文件系统根目录（`parse(home).root`），在共享工作区（`/vol<N>/@appshare/dsh/dsh_home`）下会尝试 open 祖先目录 `/vol<N>/@appshare`，而 fnOS 共享根目录普通应用账户无权读取触发 `EACCES`，进而被包装为误导性的 `prompt rejected (session/agent-busy)`。在 `cmd/main` 增加运行时幂等兼容补丁，将向上同步边界限制在 `dsh_home` 内部，防止越界访问系统目录。

## 🚀 0.2.0-rc.2.3 (2026-10-01)

> 面板下载体验完善（真机使用反馈）。上游不变（0.2.0-rc.2），fpk 版本 = 上游 + 构建段 3。

### ✨ 变更

- **停止下载**：进度条旁新增停止按钮；后端 destroy 进行中的请求并清理半成品
- **复制下载直链**：版本卡片新增「复制直链」按钮，按本机架构返回 Release 直链 —— 用户可用 IDM 等工具全速下载，再经飞牛文件管理器/SMB 把 fpk 放进共享区 update 目录，面板「安装更新」识别安装
- **`.part` 临时文件**：下载先写 `<dest>.part`，完成后改名 —— 中断/取消/失败不再残留可被误装的损坏 fpk（此前直接写最终名）
- **下载超时 30s → 120s**：慢代理 CONNECT 建链超 30s 即误报"下载失败: timeout"（真机两次复现），放宽后首连成功

## 🚀 0.2.0-rc.2.2 (2026-10-01)

> **打通 fnOS 统一网关 `/app/dsh`** —— DDNS / 自定义域名 HTTPS 场景的正解入口。此前文档结论"统一网关不可行"系误判：网关路由一直是通的，是 `cmd/proxy.py` 从不剥离 `/app/dsh` 前缀，dsh 对该路径返回 SPA 404 被误读为路由失败。

### ✨ 变更

- **统一网关入口**：`https://<fnOS访问域名>/app/dsh/`（fnOS 登录保护、HTTPS 同源、无混合内容、免暴露 28000）—— 适用于局域网 5666/5667、DDNS 自定义域名、FN Connect 全部场景
- **桌面入口改走网关**：`app/ui/config` 增加 `microApp` / `gatewaySocket` / `gatewayPrefix` 声明（对齐官方微应用 fygo-browser 的接入方式），fnOS 桌面图标经 `/app/dsh/` 加载；manifest 声明 `micro_app = true`，安装时 appcenter 自动注册网关路由
- `cmd/proxy.py`：剥离 `/app/dsh` 前缀后转发；`Origin`/`Referer` 头同步 rebasing 为回环地址（dsh fence 校验 `Origin.host === Host`，不改写则网关侧 POST 全 403）；**WebSocket 升级走原始 socket 直通**（`Connection: Upgrade` 必须保留才能进后端升级分支，http.client 对 101 处理不可靠 —— 之前 RPC 的 `remote.mux` 连不上即此因）

### 📌 访问方式（本版起）

| 场景 | 入口 |
|------|------|
| 局域网直连 | `http://<NAS_IP>:28000`（不变） |
| fnOS 网页内 | 桌面图标（走网关，与访问 fnOS 的域名/协议无关） |
| DDNS / FN Connect 远程 | 登录 fnOS 后访问 `/app/dsh/` 或点桌面图标 |

28000 直连入口保留，但远程场景推荐网关入口。

## 🚀 0.2.0-rc.2.1 (2026-10-01)

> 处理 0.2.0-rc.2 后提交的 issue：#2 / #5 / #7（已真机验证）；#3 核查后确认修法不成立，保持打开（见下）。**本版起 fpk 版本 = 上游版本 + 纯数字构建段**（`0.2.0-rc.2.1` = 上游 rc.2 + 第 1 次本地修复发布），旧"同版本号重打包"策略废止 —— 同版本号会让 `install-fpk` 静默跳过、面板热更新误判最新（详见 [docs/packaging-fpk.md](docs/packaging-fpk.md) §1）。已装 `v0.2.0-rc.2` 的用户可经面板一键更新升级。

### 🐛 修复

- **`cordis.patch.yml` 启动被覆盖导致 UI 配置丢失（#5）**：`cmd/main` 原来每次 start 都整文件覆盖该文件，而 0.1.7+ 起 UI 设置也写入这里，导致重启即丢。改为**幂等 upsert** —— 只增改 `webserver` 的 `host`/`port`，其余插件配置、注释与空行原样保留；python3 不可用时回退原整文件写入
- **共享布局下的三处落点修正（#2 真机验证中发现）**：① `cordis.patch.yml` 的 upsert 原写在数据区 `DSH_HOME`，而共享布局下 dsh 读的是 `@appshare` 的 HOME —— 绑定配置会被 dsh 判为缺失并以空模板重建，`0.0.0.0` 随之失效，现改写实际生效的 `HOME_DIR`；② upsert 把 `port` 写成带引号字符串（`port: "28000"`），dsh 0.2.0 schema 校验 `$.port expected number` 直接拒绝，webserver 插件激活失败、整个 web 起不来 —— 现按类型写入（host 带引号 / port 裸数字）；③ 新装机时 dsh 会直接在共享 HOME 里现生成 `.credentials.yaml`，启动时自动归位数据区并软链回去，保证凭据始终不落共享目录
- **飞牛 `5ddd.com` 域名无法打开（#7）**：`fnos.net` / `5ddd.com` 两条后缀均内置进信任列表（`cmd/main` 的 `--trusted-host` + 28001 面板围栏），子域自动匹配，用户无需手填

### ✨ 变更

- **版本号策略修订（docs/packaging-fpk.md §1）**：fpk 版本 = 上游版本 + 纯数字本地构建段。首次打包用上游原样号；本地修复重发布追加递增构建段（`0.2.0-rc.2` → `0.2.0-rc.2.1`）；上游升级后构建段清零。替代旧的"同版本号重打包"策略 —— 同版本号会让 fnOS `install-fpk` 静默跳过、面板热更新误判"已是最新"（2026-10-01 实测）。构建段必须用纯数字以保证全场景 SemVer 排序正确；面板上游对比逻辑已兼容构建段
- **管理面板 UI/UX 重构（#4 / #8）**：设计语言对齐 [CreditDaddy](https://github.com/techysy/CreditDaddy) 面板 —— 视图导航（总览/插件/日志）、panel+toolbar 布局、统计摘要行、卡片式插件列表、胶囊状态徽章、Feather 风格内联 SVG 图标、主 logo 换 dsh 应用图标（`/logo.png` 路由）、亮暗双主题与中英双语保留
- **热更新链路体验（#4）**：
  - **下载进度条**：后端记录 received/total/速度，前端 1s 轮询渲染（百分比 + 已下载/总大小 + 速度 + 剩余时间），页面重开自动恢复进度，完成/失败状态明确
  - **sudo 授权文案修正**：「一次性授权」误导 → 改为「一次配置永久生效」并标注白名单边界（仅允许安装所选目录内的 fpk）；授权命令一键复制；`sudo -n -l` 探测并显示已授权/未授权状态
  - **出站代理**：面板可配置 GitHub/Gitee 代理（HTTP CONNECT 隧道，零依赖自实现），与 dsh 主进程共用 `proxy.conf`；仅代理公网地址，回环/局域网直连；面板立即生效，dsh 重启后生效
  - **下载目录可选**：对接 [fnOS 开放平台 API](https://developer.fnnas.com/api/overview/)（`trim.file.getSharedAccessibleFolders`，unix socket + `TRIM_API_TOKEN`），`config/resource` 声明 `api-scope: ["trim.file.sharedAccess"]`；管理员在「应用设置 → 授权目录」添加目录后即可在面板选用，sudo 白名单提示跟随所选目录生成；老版本 fnOS 无开放 API 时优雅回退默认目录
- **插件管理增强（#8 P1）**：数据源合并 `bundles ∪ dependencies`（官方实验性插件此前只在 bundles、表格不可见），版本从 `node_modules/<name>/package.json` 读取，第三方/官方实验性分组展示；安装 `@deepseek-ai/*` 前明示钉版确认 + 安装 loading 态；pnpm 失败按网络/版本/pnpm 缺失给出可操作建议；官方插件与 dsh 版本一致性检查（不一致警示 + 升级路径提示）
- **可观测性（#8 P2）**：fpk 升级后首访显示更新横幅（附 Release 链接）；已下载 fpk 显示大小/时间并支持删除；状态页新增磁盘占用（数据区 + 语音模型缓存，du 结果 10 分钟缓存）；日志关键字一键过滤（error / EADDRINUSE / patch / share:）
- **403 页面引导（#8 P3）**：裸 403 改为说明页 —— 列出信任面、回显被拒 Host、指引到应用设置添加信任域
- **默认工作空间改到共享目录（#2）**：工作空间与会话迁至 `/vol<N>/@appshare/dsh/dsh_home`（飞牛文件管理器可见、可 SMB、**卸载不删**），凭据（`.env` / `.credentials.yaml` / `proxy.conf` / `trusted_hosts.conf`）留在 `@appdata/dsh/dsh_home` 以软链接入 HOME，避免密钥落在共享位置
- 老版本首次启动**自动迁移**：逐文件比对大小校验，任一文件缺失/大小不符即整体回退旧布局且**不动源数据**，下次启动重试（已用真实文件系统验证成功 / 幂等 / 失败回退三条路径）
- 面板与 npm/corepack 缓存、`update/` 热更新目录随工作空间落到共享目录；卸载后工作空间保留，凭据随应用清理（重装重填）

### ✅ 真机验证（2026-10-01，x86 NAS，0.2.0-rc.2）

- **#2 迁移实测通过**：老布局首次启动自动迁移，`app.log` 依次输出 `迁移 dsh_home → @appshare` → `迁移完成`，凭据留数据区并软链入共享 HOME，dsh 正常启动
- **#5 实测通过**：手工写入的 `cordis.patch.yml`（webserver + 第三方模型目录 + 默认模型）跨多次重启完整保留，upsert 只增改 webserver 的 host/port
- **#7 实测通过**：`trusted-host` 启动行包含 `fnos.net 5ddd.com`，飞牛双后缀域名免配置
- **#3 核查结论（未修复，需补充现场）**：依据 issue 报告反推的替换模式**在真实 `dsh-host-webserver/lib/index.js` 中不存在**——该文件只做路由分发，非回环拒绝发生在 `dsh-client-connection` 的 `requestRejection`（403，且已正确使用 `trustedHosts`）；issue 中的空响应体 400 来自 webserver 对插件 handler **异常的兜底 catch**，属插件侧错误而非第二道信任门。报告中的 `no pattern matched` 日志验证了此结论，投机补丁已移除，**#3 保持打开**，需要报告者提供：哪个插件、哪个 URL、回环与非回环各自的状态码

## 🚀 0.2.0-rc.2 (2026-09-30)

> 升级上游 `@deepseek-ai/dsh` 到 0.2.0-rc.2（跨 minor 版本，汇总 0.2.0-rc.1 + rc.2）。**官方语音输入插件兼容落地**：面板放行官方实验性插件 + 安装自动钉 dsh 版本，实测模型经代理下载全链路可用。三处本地补丁已对 0.2.0-rc.2 逐项重新审计。

### ✨ 上游变更（0.1.7-rc.2 → 0.2.0-rc.2）

- **桌面端命令与插件管理**：macOS/Windows 桌面端菜单栏可管理 dsh 命令与插件，无需另装 Node/pnpm（Web 端不涉及）
- **插件管理**：安装引导精简，区分已安装、不兼容和内置插件的升级提示；插件配置保存等待优化
- **模型选择器**：模型较多时提供搜索，支持模糊匹配与键盘选择；第三方模型目录升至 pi-ai 0.87.1（**部分旧模型 ID 移除**，已保存选择可能需重选）
- **修复**：工具调度异常后对话无法继续（未知副作用先核实再重试）；Safari 刷新后恢复回复；计划审阅打不开；PowerShell 完成状态识别；Linux 缺可选原生预构建包时 npm 安装失败
- **实验性**：异步问答模式（需手动开启，等待超时后 Agent 可继续独立工作）；自动化任务改由可选插件包提供
- **体验**：对话实时动画/用时信息优化；无标题历史会话统一「未命名」；侧栏文件页本地应用打开；深色主题开关与样式优化

### 🛠️ fpk 变更（本地）

- **官方语音输入插件兼容**（实测通过）：面板插件管理放行官方实验性插件 `@deepseek-ai/dsh-experimental-*`（此前被归为核心 bundles 不可禁用/删除）；面板安装官方插件自动钉到已装 dsh 版本（该作用域 npm `latest` 标签指向 alpha）+ 默认源失败回退 npmmirror；新增 [语音输入插件兼容指南](docs/dsh-voice-input.md)
- **补丁审计（0.2.0-rc.2 逐项核对）**：settings memory→host 三元表达式 `X.isLoopback ? "host" : "memory"` 仍命中 ✓；特权 API fence 上游原生 ✓；桌面 401 绕过补丁 `isAuthenticated` 模式仍命中（本版出现 2 处，replace 全量覆盖）✓；`--trusted-host` / `--port` CLI 参数不变 ✓；crypto polyfill 继续注入（上游仍无引用，无害）
- package-lock 继续锁定 npmjs 官方源（607 条 resolved）

### ⚠️ 升级注意

- **第三方插件崩溃循环风险**（跨 minor 版本，参考 0.1.2→0.1.5 先例）：升级后 webui 反复重启时，到 `:28001` 管理面板禁用不兼容插件；语音输入插件需**升级到 0.2.0-rc.2 配套版本**（模型缓存保留，无需重下）
- **旧模型 ID 移除**：上游模型目录升级，已保存的第三方模型选择可能需要重选
- **自动化任务**：改由可选插件包提供，升级后需在插件页确认已启用
- 会话数据与 `dsh_home` 升级保留；0.1.7-rc.1 用户若遗留 Web 终端 nologin 问题，本版起安装脚本自动修正服务账号 shell

## 🚀 0.1.7-rc.2 (2026-09-25)

> 升级上游 `@deepseek-ai/dsh` 到 0.1.7-rc.2（npm `next` 标签；rc.1→rc.2 为功能补充与修复批）。**本版起 CI 打包完成后自动上传 fpk 到 GitHub Release**（`release_tag` 输入触发），面板热更新下载走 GitHub 直链（0.1.7 起 fpk 超 Gitee 附件 100MB 上限，Gitee 仅保留 Release 说明）。

### ✨ 上游变更（rc.1 → rc.2）
- **定时任务与提醒**：启用后可创建提醒、查看运行记录，重启后任务保留，最短每分钟重复
- **快捷键管理**：Web/桌面支持查看、搜索、自定义与恢复快捷键
- **对话与审阅**：进行中的对话可直接使用新启用的工具；自动审阅拒绝后可由用户决定是否继续
- **修复**：部分长对话持续无法发送消息；过长工具输出字符残缺导致后续对话失败；应用异常退出后插件安装/配置保存持续失败
- **调整**：Web 默认关闭定时任务与时间上下文（需要时手动启用）；Inspector 不再默认提供；账号任务与 API Key 任务使用独立模型入口

### 🛠️ fpk 变更（本地）
- **CI 自动发布**：`build-fpk.yml` 新增 `release_tag` 输入，打包完成自动创建/补传 GitHub Release 资产（`--clobber` 幂等，双架构共用同一 Release）
- **面板热更新适配**：下载源 Gitee→GitHub 直链优先（含 prerelease 语义与 Gitee 升序列表两处修复），体积提示更新为约 120MB
- **官方语音输入插件兼容**（实测通过）：面板插件管理放行官方实验性插件 `@deepseek-ai/dsh-experimental-*`（此前被归为核心 bundles 不可禁用/删除）；面板安装官方插件自动钉到已装 dsh 版本（该作用域 npm `latest` 标签指向 alpha，直接装会版本错配）+ 默认源失败回退 npmmirror；模型下载经 `proxy.conf` 代理实测可过（插件全局 fetch 走 dsh 的 undici 全局 dispatcher）；新增 [语音输入插件兼容指南](docs/dsh-voice-input.md)（安装 / 模型代理与离线部署 / 麦克风安全上下文 / 故障排查）
- Release 不再标记 prerelease，保证 `/releases/latest` 直链可用（0.1.7-rc.1 已回溯修正）

### ⚠️ 升级注意
- 0.1.7-rc.1 用户的会话已迁移到 V4，本版无新增迁移
- 上游默认关闭定时任务与时间上下文，如需使用请在设置中手动启用

## 🚀 0.1.7-rc.1 (2026-09-24)

> 升级上游 `@deepseek-ai/dsh` 到 0.1.7-rc.1（npm `next` 标签；汇总自 v0.1.5-rc.3 以来的主要功能与重构）。打包方式：GitHub Actions 在线 CI（arm / x86 双架构）+ 离线依赖。fpk 版本号严格跟随上游发行版。

### ✨ 上游主要变更（0.1.5-rc.3 → 0.1.7-rc.1）
- **Web 侧边栏终端**：新增终端，支持多标签、Shell 选择与刷新后恢复
- **管理会话归档**：支持置顶、筛选、恢复，归档运行中会话时确认受影响任务
- **会话文件改动审阅**：卡片与侧边栏支持逐行/左右分栏/高亮/同步滚动/悬停预览，改善明暗配色
- **Office / 多格式预览**：侧边栏预览 Word、Excel（支持工作表、公式与复制）、PPT、CSV、TSV
- **插件管理全面强化**：支持安装、配置、启停与运行时卸载；安装源支持官方源、国内镜像及自定义源
- **MCP 升级至官方 SDK v2**：支持协议协商、工具分页、资源发现与 URI 模板，新增实验性 Playwright MCP / Chrome DevTools MCP
- **Headless 与 Subagent 增强**：支持 stdin 接收任务、`--session-id` 继续会话、`--json` 输出运行事件；侧边栏支持打开 Subagent 会话与浏览器模式
- **体验与性能优化**：首次启动自动创建默认工作区与空白会话；长会话初始化与轮次跳转优化；长时间命令/工作流转入后台任务面板

### 🛠️ fpk 本地特性与自愈加固
- **28001 管理面板**：日夜主题切换、中英双语 i18n、GitHub Release Tag 探测、Scoped 插件禁用正则修复、友好模态弹窗、CI 构建产物一键热更新
- **启动环境自愈**：启动前强制修正 `.credentials.yaml` / `.env` 为 600 权限（防 dsh 安全断言报错）；清理残留占用进程（防 EADDRINUSE）；纠正 `.gitconfig` 权限（防 chokidar EACCES）
- **离线依赖安全**：锁定 npmjs 官方源 package-lock.json，manifest 必需依赖（`nodejs_v24:bunjs`）硬校验

### ⚠️ 升级注意（补丁兼容性审计结论）
- **settings memory→host 补丁**：`ctx.remote.$host.isLoopback ? "host" : "memory"` 逐字节完全匹配，补丁顺利生效 ✓
- **桌面 401 鉴权绕过**：`isAuthenticated(request) {\n\t\tconst authority = requestAuthority(request.headers);` 模式完全命中，桌面入口依然免密直连 ✓
- **Session 格式升级为 V4**：老用户历史会话自动触发升级迁移，保留原始会话记录

## 🚀 0.1.5-rc.2 (2026-09-12)

> 升级上游 `@deepseek-ai/dsh` 到 0.1.5-rc.2（npm `next` 标签；rc.1→rc.2 为小幅体验优化）。**本版起新装机自动安装/启用 nodejs_v24 + bunjs**（恢复被误删的 `install_dep_apps` 声明），并内置 28001 管理面板。

### 🛠️ fpk 新增（本地）
- **28001 管理面板**（`cmd/dashboard.js`，零依赖 node）：服务状态 / dsh 日志查看（app/dsh/dashboard 三通道 tail+自动刷新）/ 插件管理（profile bundles 禁用/启用/删除/安装）/ 版本检查（上游 npm latest + 本项目 Release）/ 一键重启 dsh。信任面与 dsh 一致（回环/本机 IP/fnos.net/trusted_hosts.conf，围栏外 403）。访问 `http://NAS_IP:28001/`
- **恢复 `install_dep_apps = nodejs_v24:bunjs`**（3937309 误删，8/22–9/11 的包新装机不自动装 node；4a7ce62 恢复）
- 补丁加固：browser-auth/privileged-fence 补丁 python3 不可用时 **node 兜底**（朋友环境实证），结果落 app.log 可远程诊断
- 新增 `scripts/fix-browser-auth-401.sh`：401 现场热修脚本（Gitee raw 一条命令）

### ✨ 上游变更（rc.1 → rc.2）
- 反馈提交体验：点赞/点踩弹窗确认，失败保留已填内容
- 交付文件卡片排版与对话间距优化，代码文件图标更新

### 📦 打包链路防护（两条路径）
- CI：manifest 必需字段硬校验（install_dep_apps / appname=dsh / version）
- NAS 脚本：fnpack 版本守卫（1.2.4 拒预发布版本号自动切 1.2.1）+ 自动删构建目录 lock

## 🚀 0.1.5-rc.1 (2026-09-10)

> 升级上游 `@deepseek-ai/dsh` 到 0.1.5-rc.1（npm `latest`，跨 0.1.3/0.1.4 两系列的汇总 rc）。打包方式不变：CI 在线构建（x86 + ARM）+ 补丁注入。fpk 版本号跟随上游、本地修复不抬版。

### ✨ 上游主要变更（0.1.2-rc.1 → 0.1.5-rc.1）
- **新模型**：DeepSeek 适配器新增 `DeepSeek-V41-Flash`（新会话默认模型）
- **通用文件上传**：Web 支持任意类型文件，与图片同预览区混排、后台上传进度/取消/续显
- **Sidebar 多标签**：右侧面板支持多标签/分栏/全屏，Markdown/代码/HTML/PDF/图片预览；Detail 面板移除
- **性能**：改善长会话打开/恢复/持续对话卡顿，降低内存占用（0.1.3-alpha.1 的回退在 0.1.3-alpha.2 修复并延续）
- **子代理消息**：排队/编辑/删除/Steer/停止，发送中状态提示
- **修复**：Web 断线自动恢复、暂停目标立即终止模型轮次、流式工具调用空值覆盖 ID/名称
- **破坏性变更（仅插件/SDK 开发者）**：会话数据格式 V3（旧日志自动迁移保留原文件，不支持降级读取）、SessionHandle 生命周期、默认工具调整（SDK/Headless/ACP 用 read/write/edit）

### ⚠️ 升级注意（补丁核对结论，详见 docs/upstream-sync-checklist.md）
- **settings memory→host 补丁**：目标模式 `ctx.remote.$host.isLoopback ? "host" : "memory"` 在 0.1.5-rc.1 原样保留 ✓；settings-models 仍无此模式
- **privileged-fence**：上游保持原生修复（`requestRejection` 走 `trustedHosts`），patch 自动跳过 ✓
- **桌面 401 补丁**：`isAuthenticated` old4 模式逐字节精确命中 ✓（调用点仍为 GET / 与 requestRejection 401 两个浏览器侧入口）
- **`--trusted-host` CLI（variadic）/ cordis.patch.yml 0.0.0.0 绑定 / CLI 拒绝 `--host 0.0.0.0`** 均不变 ✓
- **crypto polyfill**：前端 `dist/index.html` 存在但 randomUUID 仍零引用，注入保留无害
- 老用户升级后首次打开触发 session V2→V3 迁移（保留原文件），留意迁移耗时

## 🚀 0.1.2-rc.1 (2026-09-06)

> 升级上游 `@deepseek-ai/dsh` 到 0.1.2-rc.1（npm `latest` 标签，0.1.3-alpha.1 未上 npm 且含已知性能回退，暂不跟进）。打包方式不变：x86 npm install 离线打包 + polyfill/补丁注入。同步修正 package-lock.json（此前仍锁在 0.1.0-rc.7）。
>
> 本地修复以补丁覆盖上游发行版，**fpk 版本号跟随上游、不单独抬版**（见 docs/packaging-fpk.md 版本号策略）；下列修复均包含在 0.1.2-rc.1 的 fpk 内。

### 🐛 根因修复：桌面打开 401 `authentication required; reopen the URL printed by dsh web`

上游 0.1.2 给 dsh web 加了浏览器鉴权：每次进程启动铸一次性 launch token（打印在启动日志的 URL 里），浏览器凭 `GET /?token=…` 换 30 天 authority 绑定 cookie，之后裸开 `/` 靠 cookie 通过。fpk 桌面入口是静态 URL（裸 `/`），cookie 一旦过期/换浏览器/换访问地址（IP ↔ fnos.net ↔ Tailscale，cookie 按主机名+端口绑定）就 401，且用户无从拿到新 token。

修复（cmd/main 运行时 patch，幂等）：

- **browser-auth 放行**：`dsh-client-connection` 的 `isAuthenticated()` 早返回 true。安全性由既有的 Host/Origin 信任围栏承担——该检查（403）在鉴权（401）**之前**执行，能走到鉴权的请求必然已属于 loopback / `--trusted-host` 白名单，与特权 API 放行是同一信任决策。副作用：带旧 token 的书签 URL 会被 303 到干净的 `/`（不再 401）。
- **启动 URL 落盘**：启动后台抓取日志中最新一条 `dsh web: …?token=…` 写入 `${DATA_DIR}/dsh-web-url.txt`，作为参考/应急入口（如需在围栏外访问时可手动关掉 patch 用真鉴权）。
- **信任面说明**：此补丁等效于"浏览器免密"，访问控制完全依赖 `--trusted-host` 列表（本机非回环 IP + fnos.net + `trusted_hosts.conf` 自定义条目）。请勿把 28000 端口暴露到不受信任的网络。

### ✨ 上游主要变更（0.1.1-rc.2 → 0.1.2-rc.1）
- **会话流改进**：已完成回答前过程内容默认折叠（含 System prompt）、正文宽度自适应/拖拽调整、回合导航支持预览跳转未载入轮次、回答末尾显示 token 用量与耗时
- **界面**：统一次级文字层级、会话流字号调节、Markdown 表格随字号缩放、支持第三方语言
- **子代理模型选择**：Agent 可在授权范围内自主选择，调用方可指定提供方/模型/推理力度；可为 Claude Code、Codex 配置模型
- **连接稳定性**：界面显示连接状态，支持连接中断自动重试/立即重连；网关 WebSocket 心跳避免空闲断连
- **修复 Node.js 24.0–24.11.1 启动可能失败且 HMR 失效的问题**（与 fnOS nodejs_v24 依赖相关）
- **实验性功能**：Inspector 工具、Web Preview
- **文件/图片**：图片发送后立即显示，压缩上传后台继续；上下文压缩计入图片占用
- 上游 0.1.2 系列破坏性变更（SessionHandle / session v2 格式）仅影响插件与 SDK 开发者，老会话日志自动迁移

### ⚠️ 升级注意（补丁核对结论，详见 docs/upstream-sync-checklist.md）
- **privileged-fence 补丁不再需要**：0.1.2 上游已原生修复（`requestRejection` 统一 `trustedHosts`），`--trusted-host` 原生生效；运行时 patch 自动跳过
- **crypto polyfill 不再需要**：0.1.2 前端 bundle 零引用 `randomUUID`（注入保留，无害幂等）
- **settings memory→host 补丁仍必需且已适配**：三元表达式接收者 `connection.` → `ctx.remote.$host.`，`patch_settings_memory.py` 改正则匹配兼容新旧版，主包未命中 exit 1
- `--trusted-host` CLI（variadic 不变）、cordis.patch.yml 绑 0.0.0.0（CLI 仍拒绝 0.0.0.0）机制均验证有效；新版绑 0.0.0.0 时上游原生派生 LAN IP 信任（resolveLanTrust）
- 老用户升级后首次打开会触发 session v2 迁移，留意历史会话加载速度

## 🚀 0.1.1-rc.2 (2026-08-22)

> 升级上游 `@deepseek-ai/dsh` 到 0.1.1-rc.2。本地 3 处源码补丁 + polyfill 注入，pnpm monorepo 离线打包。

### ✨ 升级 / 新增
- **上游升级**：deepseek-ai/deepseek-harness 0.1.0-rc.7 → 0.1.1-rc.2（pnpm install + pnpm build 重编译，含客户端 `pnpm run build:lib:client`）
- **`--host 0.0.0.0` 补丁**：`packages/bundle/web-app/src/startup.ts` 放开 CLI 层拦截，允许全接口绑定（上游仍拒绝 0.0.0.0）
- **PRIVILEGED_METHODS trustedHosts 补丁**：`packages/client/connection/src/index.ts` 空信任列表改 `trustedHosts`，LAN 访问 settings API 不再 403
- **isLoopback → host mode 补丁**：`packages/client/ui-settings/src/client/index.ts` + `settings-scope.ts` 两处，设置页非 loopback 也读服务器配置
- **crypto.randomUUID polyfill**：注入所有 `@deepseek-ai/*/lib/client.js`（LAN IP 非安全上下文修复）

### 📦 打包流程修复
- **fnpack 不支持 symlink**：打包前 `find . -type l | unlink` 移除，打包后恢复（详见 `docs/fnpack-symlink.md`）
- **pnpm workspace symlink 手动创建**：pnpm 在 NAS 不自动创建，含 `vendor/*` `packages/*/*` `apps/*`（dsh CLI 在 apps/cli）
- **node_modules 权限修复**：`chmod -R a+rX node_modules/`（pnpm 创建的 600 权限文件导致 fnpack/运行失败）
- **cmd/main / upgrade_callback 路径修复**：DSH_JS/CC_LIB/DSH_OFFLINE 加 `target/server/` 路径
- **install/upgrade callback 加 workspace symlink 创建**（幂等，含 apps glob）
- **install_callback 加数据迁移**：从旧路径（`/vol4/@appdata/dsh/` 等）复制 dsh_home 用户数据
- **appname = dsh**：FN Connect 域名自动 `dsh.<user>.fnos.net`

## 🚀 0.1.0-rc.7 (2026-08-20)

> 本日小版本更新：trusted-host 修复 + 自定义域名（DDNS）支持。

### 🔧 修复 / 新增
- **FN ID 字段名修正**：安装向导 / 设置页统一用 FN ID（`wizard_fnos_id` / `fnos_id`，只填 ID 如 `techysy`），回调自动拼 `<id>.fnos.net`、`dsh.<id>.fnos.net`、`fnos.net` 三个信任域写入 `trusted_hosts.conf`。修复先前字段名不一致导致向导填的域名未写入的问题。
- **新增自定义域名（DDNS）字段**：部分用户用自己的域名做 DDNS 远程访问（非 FN Connect），新增 `wizard_custom_domain` / `custom_domain` 字段，完整域名追加到 `trusted_hosts.conf`，dsh 启动时一并加入 `--trusted-host`，域名访问 API 不再 403。
- **cmd/main trusted-host 完善**：支持 `trusted_hosts.conf` 多行读取（每行一个 hostname，`#` 注释，自动清理 `http(s)://` 前缀与结尾 `/`），内置 `fnos.net` + 本机非回环 IP，避免非法条目导致整个 trustedHosts 加载失败。
- **variadic trusted-host**：改用单个 `--trusted-host` flag 拼所有值（空格分隔），避免 commander 后者覆盖只保留最后一个。

## 🚀 0.1.0-rc.7 (2026-08-14)

> 版本号对齐官方 `@deepseek-ai/dsh`（deepseek-ai/deepseek-harness 0.1.0-rc.7）。历史迭代详情（0.0.1~0.0.15，原始 1.0.0~1.0.14）见 `test log.md`。

### ✨ 核心功能
- **dsh web 常驻服务**：`dsh web` 局域网直连 `0.0.0.0:28000`（经 cordis.patch.yml 覆盖，绕过 CLI 0.0.0.0 校验）
- **离线打包**：dsh 随 fpk 内置（app/server/node_modules），NAS 安装免联网
- **桌面入口直连端口**：app/ui/config 用 iframe + http + port 28000（不用统一网关 /app/dsh）
- **统一网关代理**（proxy.py）：Unix socket → 127.0.0.1:28000，重写 HTML 资源路径 + Host

### 🐛 问题修复
- **局域网 API 403**：cmd/main 动态探测局域网 IP 并加 `--trusted-host`，/api 浏览器信任围栏放行局域网访问
- **设置页 API 403**：放宽 dsh 特权 API（settings.describe 等）回环钉扎，允许局域网配置模型/插件/Agent 预设
- **crypto.randomUUID 不可用**：前端 index.html + 39 个 client.js 注入 polyfill（非安全上下文可用）
- **/home/dsh ENOENT**：cmd/main 设置 HOME=DSH_HOME（数据区）+ 确保目录存在
- **空白页**：proxy.py 重写 HTML 绝对资源路径 + 注入 `<base href="/app/dsh/">`
- **native 模块兼容**：app/server node_modules 在 NAS（glibc 2.36 + g++）重编译，解决离线包加载失败
- **显示名修正**：应用中心/桌面显示 **DeepSeek Harness**（非 DSH）

### 🔧 配置与代理
- **安装向导可填 DeepSeek API Key + 网络代理**（代理为 **IP + 端口** 两个输入框，避免冒号输错）
- **fnOS 应用设置页可改代理**（IP + 端口两个输入框；留空保留当前值，不置空；改后重启生效）
- **默认不走代理**：proxy.conf 不存在时不设置；需代理时由用户配置（写入 `DSH_HOME/proxy.conf`，`PROXY=http://IP:端口`）
- dsh 网络请求（git/npm/API）经 HTTP_PROXY/HTTPS_PROXY 走代理

### 🌐 FN Connect 远程访问
- **FN Connect 域名（FN ID）配置**：安装向导 / 设置页可填，写入 `DSH_HOME/trusted_hosts.conf`（单域名），dsh 启动时加入 `--trusted-host`，域名远程访问 API 不再 403
- **修复 settings 前端空白**：非 loopback（FN Connect 域名）访问时，settings 前端改用 host 模式读服务器配置（patch_settings_memory.py），修复插件配置 / 模型配置空白页（上游 loopback-only 设计限制）

### 📦 数据与元数据
- **数据保护**：卸载不再删除工作空间（保留 dsh_home 的 profiles/storages、API Key、代理），只清运行时日志/pid
- **开发者信息**：maintainer = **DeepSeek**（deepseek-ai/deepseek-harness），distributor = techysy/deepseek-harness-fnos
- **图标**：DeepSeek 官方黑色鲸鱼
- **依赖**：nodejs_v24

### ⚠️ 已知限制
- 飞牛移动 App 容器（WebView）有固有限制（SameSite cookie/localStorage/跨源），dsh 复杂前端建议用手机浏览器（Chrome/飞书）访问
