# 🐳 DeepSeek Harness 上架飞牛 fnOS 应用中心

> **DeepSeek Harness（dsh）**—— DeepSeek 官方 agent 框架的浏览器 UI，现已打包成飞牛 fnOS 应用，**离线安装、免联网**。

![上游版本](https://img.shields.io/badge/upstream-v0.2.2--rc.3-1E88E5)
![fnOS 版本](https://img.shields.io/github/v/release/techysy/deepseek-harness-fnos?label=fnOS&color=0A5D9C)

---

## ✨ 这是什么？

**DeepSeek Harness** 是 DeepSeek 官方推出的 **AI agent 框架**。不只是聊天——它能在你指定的工作空间里**自主执行任务**（写代码、跑命令、分析文件、操作系统等）。

本应用把它做成了飞牛 fnOS 应用：

- ✅ **离线打包**：整个 DeepSeek Harness 已内置在安装包里，NAS 安装**免联网**、免配置
- ✅ **局域网直连**：装完直接用手机/电脑浏览器访问 `http://<NAS_IP>:28000`
- ✅ **桌面图标**：fnOS 桌面上直接点开即可用
- ✅ **自带网络代理**：访问 GitHub 等超时时，可在安装向导/应用设置里填代理（IP + 端口）解决
- ✅ **数据保留**：升级/重装不丢你的工作空间、会话、API Key

---

## 📦 安装

1. 在 **飞牛应用中心** 搜索 `DeepSeek Harness`，或从项目 [GitHub Release](https://github.com/techysy/deepseek-harness-fnos/releases) 下载 `dsh-0.2.2-rc.3.fpk` 手动安装
2. 安装向导填 **DeepSeek API Key**（`sk-` 开头，可从 [platform.deepseek.com](https://platform.deepseek.com) 获取；**可留空**，之后在应用内配置）
3. 装完在桌面上点开 DSH 图标，或手机/电脑浏览器访问 `http://<NAS_IP>:28000`

> 依赖：应用中心会自动安装 **Node.js 24**，无需手动处理。
