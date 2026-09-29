## 🚀 DeepSeek Harness fnOS 0.2.0-rc.2

基于上游 [deepseek-ai/deepseek-harness](https://github.com/deepseek-ai/deepseek-harness) **v0.2.0-rc.2** 构建（跨 minor 版本，汇总 0.2.0-rc.1 + rc.2 变更）。

### ✨ 上游主要变更（0.1.7-rc.2 → 0.2.0-rc.2）

- **桌面端命令与插件管理**：macOS/Windows 桌面端可在菜单栏中管理 dsh 命令与插件，无需另装 Node/pnpm
- **插件管理**：安装引导精简，区分已安装、不兼容和内置插件的升级提示；插件配置保存等待优化
- **模型选择器**：模型较多时提供搜索（模糊匹配 + 键盘选择）；第三方模型目录升至 pi-ai 0.87.1，**部分旧模型 ID 移除**
- **修复**：工具调度异常后对话无法继续；Safari 刷新后无法恢复回复；计划审阅打不开；PowerShell 完成状态识别；Linux 缺可选原生预构建包时 npm 安装失败等
- **实验性**：异步问答模式（需手动开启）；自动化任务改由可选插件包提供
- **体验**：对话实时动画与用时信息优化、无标题历史会话统一「未命名」、侧栏文件页本地应用打开、深色主题优化

### 🎙️ 官方语音输入插件兼容（本地新增，实测通过）

- 面板插件管理放行官方实验性插件 `@deepseek-ai/dsh-experimental-*`：可禁用 / 启用 / 删除（此前被归为核心 bundles 不可管理）
- 面板安装官方插件**自动钉到已装 dsh 版本**（该作用域 npm `latest` 标签指向 alpha，裸装会版本错配）；默认源失败自动回退 npmmirror
- 实测：`proxy.conf` 代理下 SenseVoice INT8 模型（239MB）下载 / 校验 / 加载全链路可用；兼容指南见 [docs/dsh-voice-input.md](../docs/dsh-voice-input.md)
- 麦克风提示：浏览器只在 HTTPS（FN Connect 入口）或本机回环开放录音；局域网 HTTP 需 Chrome flag 或走 FN Connect 外网，详见指南

### 🔧 既有补丁（0.2.0-rc.2 逐项审计核对）

- **settings host-mode 补丁**：`X.isLoopback ? "host" : "memory"` 模式仍命中，非回环访问设置页正常 ✓
- **桌面 401 鉴权绕过**：`isAuthenticated()` 模式仍命中（本版 2 处，全量替换），桌面入口免密直达 ✓
- **特权 API fence**：上游原生支持，运行时补丁自动跳过 ✓
- **信任围栏 / 0.0.0.0 绑定**：`--trusted-host` / `--port` CLI 参数不变，`cordis.patch.yml` 机制不变 ✓
- package-lock 继续锁定 npmjs 官方源

### ⚠️ 升级注意

- **第三方插件用户**：跨 minor 版本升级，若升级后 webui 反复崩溃重启，到 `:28001` 管理面板禁用不兼容插件后逐个升级恢复
- **语音输入插件**：升级后请把 `@deepseek-ai/dsh-experimental-voice-input-bundle` 升到 0.2.0-rc.2 配套版本（模型缓存保留，无需重新下载）
- **旧模型 ID 移除**：已保存的第三方模型选择可能需要重选
- 数据区（会话 / API Key / 代理 / 信任域 / 插件）升级保留

### 📦 下载

| 文件 | 架构 | 桌面模式 |
|------|------|---------|
| `dsh-0.2.0-rc.2-iframe-x86.fpk` | x86 | iframe（推荐） |
| `dsh-0.2.0-rc.2-x86.fpk` | x86 | 新标签页 |
| `dsh-0.2.0-rc.2-iframe-arm.fpk` | ARM | iframe（推荐） |
| `dsh-0.2.0-rc.2-arm.fpk` | ARM | 新标签页 |

### 🔗 访问

- dsh web: `http://<NAS_IP>:28000/`
- 管理面板: `http://<NAS_IP>:28001/`
- FN Connect: `https://dsh.<FN_ID>.fnos.net`（需在应用设置 → 访问权限开启远程访问）
