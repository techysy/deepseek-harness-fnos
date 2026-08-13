# 🐳 【应用分享】DeepSeek Harness 官方 Agent 框架，一键装进你的飞牛 NAS

> **DeepSeek 官方 agent 框架（DeepSeek Harness）的浏览器 UI，现已打包成 fnOS 应用，离线安装免联网。**

[![上游版本](https://img.shields.io/badge/upstream-v0.1.0--rc.6-1E88E5?logo=deepseek&logoColor=white&label=DeepSeek%20Harness)](https://github.com/deepseek-ai/deepseek-harness)
[![fnOS 版本](https://img.shields.io/github/v/release/techysy/deepseek-harness-fnos?label=fnOS&color=0A5D9C)](https://github.com/techysy/deepseek-harness-fnos/releases)
[![离线打包](https://img.shields.io/badge/offline-免联网-2E7D32)](https://github.com/techysy/deepseek-harness-fnos)

---

## 🖼️ 应用预览

> **[在这里插入应用界面预览图 / 截图]**

---

## 📖 这是什么？

**DeepSeek Harness（简称 dsh）** 是 DeepSeek 官方开源的 **AI Agent 框架**，浏览器操作界面，功能强大（everything is a plugin）。

简单说：**装到 NAS 后，局域网内任何设备都能通过浏览器打开一个 DeepSeek 的 Agent 工作台**——不只是聊天，还能在你指定的工作空间里自主执行任务（写代码、跑命令、分析文件、操作系统等），配置模型、插件、Agent 预设都在网页里完成。

> 本次打包的是官方 **v0.1.0-rc.6** 版本。

## ✨ 亮点

- 🐳 **DeepSeek 官方**框架，非第三方魔改
- 📦 **离线打包**：dsh 及依赖随安装包内置，**安装免联网**，装完即用
- 🖥️ **桌面图标直达**：装好点图标就进浏览器 UI
- 🌐 **局域网 / Tailscale 直连**：`http://<NAS_IP>:28000` 随时访问
- 🔌 **可选统一网关**：也能经 fnOS `/app/dsh` 网关访问
- 🔐 **数据保留**：升级/重装不丢工作空间、会话、API Key

## 🚀 安装步骤

1. 到 [GitHub Release](https://github.com/techysy/deepseek-harness-fnos/releases) 下载 `dsh-<version>.fpk`
2. 打开 **fnOS 应用中心**，手动安装该 `.fpk` 文件
3. 安装向导里填 **DeepSeek API Key**（`sk-` 开头；也可留空，之后在应用里配置）
4. 装好后，桌面点击 **DeepSeek Harness** 图标进入浏览器 UI

> ⚠️ 依赖：应用中心需已装 **Node.js 24**（`nodejs_v24`），App Center 会自动安装依赖，无需手动处理。

## 🔧 配置 DeepSeek API Key

- 安装时填写，或安装后编辑数据区 `/vol4/@appdata/dsh/dsh_home/.env`：
  ```
  DEEPSEEK_API_KEY=sk-xxx
  ```
- **改完记得重启应用**才会生效

## 🔌 需要联网代理？

如果你访问 GitHub / 外部 API 超时，安装向导或应用设置页都能填 **代理 IP + 端口**（例如 `127.0.0.1` + `7890`），会写入 `proxy.conf`，dsh 的网络请求（git/npm/API）都会走代理。

## ⚠️ 安全提醒（务必看）

- 应用默认绑定 `0.0.0.0:28000`，**局域网内所有设备都能访问**，且 dsh 能**执行代码**。
- 请务必注意网络安全：建议限制访问网段或配合防火墙，**不要暴露到公网**。

## 🗂️ 相关链接

- 📦 应用仓库：[techysy/deepseek-harness-fnos](https://github.com/techysy/deepseek-harness-fnos)
- 🐳 上游项目：[deepseek-ai/deepseek-harness](https://github.com/deepseek-ai/deepseek-harness)
- 📝 更新日志：[CHANGELOG.md](https://github.com/techysy/deepseek-harness-fnos/blob/main/CHANGELOG.md)

---

## 💬 加入交流 / 使用建议

- **使用问题、反馈、需求**：欢迎加入交流群
  > **[在这里插入飞书群二维码 / 群链接]**
- 手机浏览器（Chrome / 飞书）访问效果更好；飞牛移动 App 内置 WebView 有 cookie/localStorage 限制，复杂前端可能体验不佳。
- 首次使用需要有效的 DeepSeek API Key 才能对话。
- 如果觉得好用，欢迎到 [GitHub](https://github.com/techysy/deepseek-harness-fnos) 点个 ⭐ 支持一下！
