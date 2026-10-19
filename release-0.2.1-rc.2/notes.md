## 🚀 DeepSeek Harness fnOS 0.2.1-rc.2

基于上游 [deepseek-ai/deepseek-harness](https://github.com/deepseek-ai/deepseek-harness) **v0.2.1-rc.2** 构建（汇总 0.2.1-rc.1 与 rc.2 变更）。

### ✨ 上游主要特性（0.2.0-rc.2 → 0.2.1-rc.2）

- **模型与搜索能力增强**：
  - 适配 **DeepSeek-V4.1-Flash-1017** 上线；
  - 适配 DeepSeek 官方 **Search 与 Fetch API**，可在网页搜索设置中直接开启；
  - 自定义模型 API 支持在 Web UI 中直接配置各模型的推理等级（无需手写配置文件）；
  - `pi-ai` 路由更新至 1.0.2，支持会话中动态工具扩展与系统提示词更新。
- **插件生态全生命周期管理**：
  - 允许用户从「**自定义插件索引源**」发现并安装插件；
  - 插件管理页新增「让 Agent 创建插件」入口，保留草稿进入创造模式；
  - 完整支持插件的启用、停用、卸载及更新后依赖同步；启用热重载时，可替换插件免重启生效。
- **全新实验性组合包**：
  - 官方开发者工具 DevTools 组合包（原始会话日志、双向定位、内嵌 Node 调试器）；
  - 思考过程机器翻译插件（可在插件页启用，选择 Bing、Google 或付费 DeepSeek Flash）；
  - Git Worktrees 插件（可在插件页启用，由 Agent 创建并进入独立 Git checkout）。
- **极简模式与交互优化**：
  - 极简模式支持读取图片与自动压缩长对话，支持 `/compact` 手动压缩命令；
  - Web 版支持在局域网/本机 HTTP 访问时直接登录 DeepSeek 账号；
  - 自动识别已发送消息中的密钥和令牌，并默认脱敏按需查看；
  - 大量 Web 终端、布局、命令交界处输入、历史会话兼容性 bug 修复。

### 🔧 本地打包与补丁适配

- **放宽 0.0.0.0 局域网绑定限制**：上游 0.2.1-rc.2 在 `dsh-host-webserver` 引入了 `isWildcardAddress` 校验，强制拒绝 `0.0.0.0` 绑定配置；`cmd/main` 增加运行时补丁放宽该限制，确保局域网直接访问 28000 端口。
- **桌面 401 鉴权绕过补丁升级**：上游重构了鉴权拦截层（签名变更为 `isAuthenticated(request, secure = false)`），本地补丁同步更新匹配规则，确保 fnOS 桌面图标无感免密直连。
- **Settings 宿主模式补丁升级**：上游 0.2.1+ 原生重构了 Settings 模式，彻底解除了非回环访问限制，补丁识别新架构并平滑跳过历史替换。
- **既有补丁审计**：
  - `--trusted-host` 围栏放行机制保持有效；
  - 附件 `@appshare` 跨目录同步边界补丁（issue #9）继续生效；
  - `package-lock.json` 保持锁定 npmjs 官方源（683 项依赖）。

### ⚠️ 升级注意

- **第三方插件与组合包**：由于上游插件系统重构与兼容性检查（优先读取 `engines.dsh`），升级后如遇到个别第三方插件加载异常，建议在 `:28001` 管理面板禁用后升级更新。
- **伴生桌面管理面板应用**：若需要独立的桌面管理面板窗口入口，可配合安装资产中的 `dsh-dashboard-v1.0.2.fpk`。
- **数据保留**：会话、API Key、代理配置、信任域名均完整保留。

### 📦 下载

| 文件 | 架构 | 桌面模式 |
|------|------|---------|
| `dsh-0.2.1-rc.2-iframe-x86.fpk` | x86 | iframe（推荐） |
| `dsh-0.2.1-rc.2-x86.fpk` | x86 | 新标签页 |
| `dsh-0.2.1-rc.2-iframe-arm.fpk` | ARM | iframe（推荐） |
| `dsh-0.2.1-rc.2-arm.fpk` | ARM | 新标签页 |
| `dsh-dashboard-v1.0.2.fpk` | 通用 (x86/ARM) | 伴生桌面管理面板独立窗口应用 |

### 🔗 访问

- dsh web: `http://<NAS_IP>:28000/`
- 管理面板: `http://<NAS_IP>:28001/`
- FN Connect: `https://dsh.<FN_ID>.fnos.net`（需在应用设置 → 访问权限开启远程访问）
- fnOS 统一网关入口: `https://<fnOS访问域名>/app/dsh/`
