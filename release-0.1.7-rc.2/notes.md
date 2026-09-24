## 🚀 DeepSeek Harness fnOS 0.1.7-rc.2

基于上游 [deepseek-ai/deepseek-harness](https://github.com/deepseek-ai/deepseek-harness) **v0.1.7-rc.2** 构建。

### ✨ 上游更新（rc.1 → rc.2）

- **定时任务与提醒**：启用后可创建/管理提醒、查看运行记录，重启后任务保留，最短每分钟重复一次
- **快捷键管理**：Web 支持查看、搜索、自定义与恢复快捷键，侧边栏同步显示当前键位
- **对话体验**：进行中的对话可直接使用新启用的工具，无需另开对话；自动审阅拒绝后可由用户决定是否继续
- **修复**：部分长对话持续无法发送消息；过长工具输出字符残缺并导致后续对话失败；应用异常退出后插件安装/配置保存持续失败
- **调整**：Web 默认关闭定时任务与时间上下文（需要时在设置中手动启用）；Inspector 不再默认提供

### 🛠️ fpk 变更（本地）

- **CI 自动发布上线**：打包完成后自动创建/补传 GitHub Release 资产（本次即为首次全自动验证）
- **面板热更新走 GitHub 直链**：0.1.7 起 fpk 约 116MB，超过 Gitee 附件 100MB 上限，Gitee Release 仅保留说明并指向 GitHub；面板下载源已切 GitHub 直链并修复 prerelease 语义与列表排序两处探测 bug
- Release 不再标记 prerelease，保证 [`/releases/latest`](https://github.com/techysy/deepseek-harness-fnos/releases/latest) 直链可用

### 🔧 既有补丁（0.1.7-rc.2 上沿用 rc.1 审计结论）

- 桌面 401 放行 / settings host-mode / `--trusted-host` 信任围栏 / 0.0.0.0 绑定 ✓
- 上游 0.1.7 系列新增插件运行时兼容性校验，不兼容插件可在 `:28001` 管理面板快速禁用

### 📝 升级注意

- 0.1.7-rc.1 用户的会话已完成 V4 迁移，本版无新增迁移
- 访问入口：dsh web `http://<NAS_IP>:28000/` ｜ 管理面板 `http://<NAS_IP>:28001/`

### 📦 下载

| 文件 | 架构 | 桌面模式 |
|------|------|---------|
| `dsh-0.1.7-rc.2-iframe-x86.fpk` | x86 | iframe（推荐） |
| `dsh-0.1.7-rc.2-x86.fpk` | x86 | 新标签页 |
| `dsh-0.1.7-rc.2-iframe-arm.fpk` | ARM | iframe（推荐） |
| `dsh-0.1.7-rc.2-arm.fpk` | ARM | 新标签页 |

> 离线打包（含 node_modules），安装免联网。需 fnOS 依赖应用 `nodejs_v24`（新装机会自动安装）。
> ⚠️ fpk 约 116MB（上游 LibreOffice WASM 等），Gitee 附件 100MB 上限不传包，请从此 GitHub Release 下载（国内推荐 IDM 多线程），或在 `:28001` 管理面板一键热更新。
