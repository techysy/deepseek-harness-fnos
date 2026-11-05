## 🚀 DeepSeek Harness fnOS 0.2.2-rc.1

基于上游 [deepseek-ai/deepseek-harness](https://github.com/deepseek-ai/deepseek-harness) **v0.2.2-rc.1** 构建（0.2.2 系列首个 RC，大版本）；含管理面板更新下载修复 (#11)。

### ✨ 上游主要特性（0.2.1-rc.5 → 0.2.2-rc.1）

- **移动端全面适配**：软键盘交互、导航与窄屏布局优化，菜单与操作入口在手机上保持可用。
- **工作台交互增强**：
  - 统一右键与键盘菜单，覆盖会话、工作区与侧边栏，并支持开发者扩展；
  - 文件预览支持常驻目录树与文件定位；
  - 支持将聊天文本作为引用插入输入框；完整历史会话可复制为 Markdown；
  - 工作步骤收起后保留全部助手文字回复，可切换「仅最终回答」。
- **多语言界面**：新增日语、西班牙语、法语、德语、俄语、巴西葡萄牙语文案与界面配置。
- **插件管理增强**：插件详情支持富文本展示；支持更新第三方插件包，热更新失败时自动回退旧版本。
- **新增实验性能力**：`subagent_oar`（把独立任务交给本机 Codex/Claude CLI）、个性化推荐、开发者工具-统计、变更请求与工作树（独立 Git 工作树 + 逐文件差异与 PR 状态查看）。
- **新工具**：默认关闭的 `apply_patch`，一次完成多文件新增、编辑、删除和移动。
- **问题修复**：AGENTS.md 预算隔离、子代理/会话分支识别、历史会话无法打开、Web Fetch 编码、Markdown 与 Math 渲染、Trajectory 工具输出展示等大量修复。

### ⚠️ 不兼容变更（升级前请阅读）

- **Node.js 最低版本提高至 24.9**：上游 `package.json` 新增 `engines: node >=24.9.0`。本包已在 CI（Node 24）完成构建与补丁验证；若 NAS 上 `node -v` 低于 24.9，请先在应用中心升级 `nodejs_v24` 依赖应用。
- **PTC 架构调整**：原生与 PTC 工具执行拆分为按 Agent 作用域选择的插件，PTC 改由配置 overlay 启用；旧 `tools.mode` 与 `DSH_TOOLS_MODE` 需迁移。SSH helper 协议由 2 升至 3。
- **自定义插件需迁移**：异步会话投影句柄、`tools.resolve/executable`、提示词组装接口均有变更。
- **「Git 工作树」入口合并**：此前启用过独立插件的用户，需手动从 profile 的 `dsh.profile.bundles` 移除 `@deepseek-ai/dsh-experimental-tool-worktree`。

### 🔧 本地补丁适配（已对 0.2.2-rc.1 产物逐一实测）

| 补丁 | 状态 | 说明 |
|---|---|---|
| 特权 API 回环钉扎 | ✅ 上游原生修复 | 0.2.2 重写为统一 `isTrusted()`，不再有 `PRIVILEGED_METHODS` 硬钉回环；旧补丁目标消失属预期，运行时自动识别「已原生修复」，局域网访问不再 403 |
| 浏览器鉴权绕过 | ✅ 继续生效 | `isAuthenticated()` 结构未变（403 信任围栏仍在其之前），fnOS 桌面图标免密直连保持 |
| 附件 @appshare EACCES (#9) | ✅ 继续生效 | `ensureDurableDirectory(home, parse(home).root)` 目标串仍精确存在 |
| crypto.randomUUID polyfill | ✅ 继续生效 | 局域网 HTTP 非安全上下文注入成功 |
| Settings 宿主模式 | ✅ 自动跳过 | 上游 0.2.1+ 已原生支持非回环访问，补丁识别新架构后平滑跳过 |
| web `0.0.0.0` 局域网绑定 | ✅ 运行时机制 | `cmd/main` 启动时写 `cordis.patch.yml` 覆盖 webserver host，与构建无关 |

### 🛠 管理面板修复 (#11)

- **更新下载卡死**：60 秒停滞看门狗，半死连接自动中止并提示「下载停滞 (60 秒无数据)， 已中止」，不再永久转圈；
- **停止按钮全阶段生效**：建连与 302 跳转阶段也能立即取消，销毁全部在途连接；
- **Promise 防悬挂 + 按钮状态由服务端驱动**，`.part` 残留照常清理。

### ⚠️ 其他升级注意

- **数据保留**：会话、API Key、代理配置、信任域名均完整保留。
- **第三方插件兼容性**：0.2.2 插件接口有重构，个别第三方插件可能需要更新后才能加载；如遇异常，可在 `:28001` 管理面板禁用后升级。
- **伴生桌面管理面板应用**：如需独立桌面窗口入口，可配合安装资产中的 `dsh-dashboard-v1.0.2.fpk`。

### 📦 下载

| 文件 | 架构 | 桌面模式 |
|------|------|---------|
| `dsh-0.2.2-rc.1-iframe-x86.fpk` | x86 | iframe（推荐） |
| `dsh-0.2.2-rc.1-x86.fpk` | x86 | 新标签页 |
| `dsh-0.2.2-rc.1-iframe-arm.fpk` | ARM | iframe（推荐） |
| `dsh-0.2.2-rc.1-arm.fpk` | ARM | 新标签页 |
| `dsh-dashboard-v1.0.2.fpk` | 通用 (x86/ARM) | 伴生桌面管理面板独立窗口应用 |

### 🔗 访问

- dsh web: `http://<NAS_IP>:28000/`
- 管理面板: `http://<NAS_IP>:28001/`
- FN Connect: `https://dsh.<FN_ID>.fnos.net`（需在应用设置 → 访问权限开启远程访问）
- fnOS 统一网关入口: `https://<fnOS访问域名>/app/dsh/`
