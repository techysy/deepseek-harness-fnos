# 🐳 【应用分享】DeepSeek Harness 官方 Agent 框架，一键装进你的飞牛 NAS

> **DeepSeek 官方 agent 框架（DeepSeek Harness）的浏览器 UI，现已打包成 fnOS 应用，离线安装免联网。**

[![上游版本](https://img.shields.io/badge/upstream-v0.2.2--rc.3-1E88E5?logo=deepseek&logoColor=white&label=DeepSeek%20Harness)](https://github.com/deepseek-ai/deepseek-harness)
[![fnOS 版本](https://img.shields.io/github/v/release/techysy/deepseek-harness-fnos?label=fnOS&color=0A5D9C)](https://github.com/techysy/deepseek-harness-fnos/releases)
[![离线打包](https://img.shields.io/badge/offline-免联网-2E7D32)](https://github.com/techysy/deepseek-harness-fnos)

---

## 🖼️ 应用预览

> **[在这里插入应用界面预览图 / 截图]**

---

## 📖 这是什么？

**DeepSeek Harness（简称 dsh）** 是 DeepSeek 官方开源的 AI Agent 框架，浏览器操作界面，功能强大（everything is a plugin）。

简单说：**装到 NAS 后，局域网内任何设备都能通过浏览器打开一个 DeepSeek 的 Agent 工作台**，配置模型、插件、Agent 预设都在网页里完成。

> 本次打包的是官方 **v0.2.2-rc.3** 版本。

## ✨ 亮点

- 🐳 **DeepSeek 官方**框架，非第三方魔改
- 📦 **离线打包**：dsh 及依赖随安装包内置，**安装免联网**，装完即用
- 🖥️ **桌面图标直达**：装好点图标就进浏览器 UI
- 🌐 **局域网 / Tailscale 直连**：`http://<NAS_IP>:28000` 随时访问
- 🔌 **可选统一网关**：也能经 fnOS `/app/dsh` 网关访问

## 🚀 安装步骤

1. 到 [GitHub Release](https://github.com/techysy/deepseek-harness-fnos/releases) 下载 `dsh-<version>.fpk`
2. 打开 **fnOS 应用中心**，手动安装该 `.fpk` 文件
3. 安装向导里填 **DeepSeek API Key**（`sk-` 开头；也可留空，之后在应用里配置）
4. 装好后，桌面点击 **DeepSeek Harness** 图标进入浏览器 UI
