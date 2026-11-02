## 🚀 DeepSeek Harness fnOS 0.2.1-rc.5

基于上游 [deepseek-ai/deepseek-harness](https://github.com/deepseek-ai/deepseek-harness) **v0.2.1-rc.5** 构建（汇总 0.2.1-rc.3 / rc.4 / rc.5 变更）；修复管理面板「一键下载到 NAS」卡死与停止无效 (#11)。

### ✨ 上游变更（0.2.1-rc.2 → 0.2.1-rc.5，增量较小）

- **0.2.1-rc.3**：
  - 左侧栏、会话视图与右侧栏新增「更多」菜单，方便浏览和创建插件；
  - 修复切换会话后点击「新会话」找不回未发送草稿的问题；
  - DeepSeek API Key 适配器的模型列表更新方式与账号登录模式对齐。
- **0.2.1-rc.4**：修复 ACP 模式下诊断输出混入 stdout 的问题。
- **0.2.1-rc.5**：优化对话中思考内容的展示效果。

### 🛠 面板修复：更新下载卡死与停止无效 (#11)

- **卡死根因**：GitHub 直链常见「半死连接」——TCP 不断、偶尔吐几 KB，每次都重置 120s socket 空闲超时，下载 Promise 永不 settle，进度条永久卡死，只能重启面板进程恢复（且留下 100MB+ `.part` 残留）。
- **60 秒停滞看门狗**：收到字节即刷新 `lastDataAt`，每 5s 检查一次，60 秒无新字节自动中止连接并提示「下载停滞 (60 秒无数据)， 已中止」；慢但持续有字节的下载不会被误杀。
- **停止全阶段生效**：原实现在建连/302 跳转阶段 `req` 尚未就位，停止接口直接返回「无进行中的下载」；现改为先置 `cancelling` 标志，再逐个销毁全部在途连接（含 302 跳转链的旧连接），任意阶段点「停止」都能立即生效。
- **Promise 悬挂防护**：`downloadToFile` 收敛为单次 settle，监听 req `close` 事件兜底，连接销毁后 Promise 保证返回，`.part` 残留照常清理。
- **按钮状态**：停止按钮的禁用态改由服务端 `cancelling` 状态驱动（不再被每秒进度重绘覆盖），接口失败时自动复位。

### 🔧 本地打包与补丁适配

- `crypto.randomUUID` polyfill 继续生效（局域网 HTTP 非安全上下文）；
- Settings 宿主模式补丁：上游 0.2.1+ 已原生支持非回环访问，补丁自动识别新架构并平滑跳过历史替换；
- web `0.0.0.0` 局域网绑定：`cmd/main` 运行时写入 `cordis.patch.yml` 覆盖 webserver host，绕过 CLI 校验（运行时机制，与构建无关）；
- `package-lock.json` 保持锁定 npmjs 官方源。

### ⚠️ 升级注意

- **升级路径**：0.2.1-rc.2 及更早版本可直接升级；如遇 fnOS 同版本号静默跳过，使用管理面板「强制覆盖热安装」或「重新下载」。
- **数据保留**：会话、API Key、代理配置、信任域名均完整保留。
- **伴生桌面管理面板应用**：如需独立桌面窗口入口，可配合安装资产中的 `dsh-dashboard-v1.0.2.fpk`。

### 📦 下载

| 文件 | 架构 | 桌面模式 |
|------|------|---------|
| `dsh-0.2.1-rc.5-iframe-x86.fpk` | x86 | iframe（推荐） |
| `dsh-0.2.1-rc.5-x86.fpk` | x86 | 新标签页 |
| `dsh-0.2.1-rc.5-iframe-arm.fpk` | ARM | iframe（推荐） |
| `dsh-0.2.1-rc.5-arm.fpk` | ARM | 新标签页 |
| `dsh-dashboard-v1.0.2.fpk` | 通用 (x86/ARM) | 伴生桌面管理面板独立窗口应用 |

### 🔗 访问

- dsh web: `http://<NAS_IP>:28000/`
- 管理面板: `http://<NAS_IP>:28001/`
- FN Connect: `https://dsh.<FN_ID>.fnos.net`（需在应用设置 → 访问权限开启远程访问）
- fnOS 统一网关入口: `https://<fnOS访问域名>/app/dsh/`
