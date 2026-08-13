# 🐳 DeepSeek Harness 上架飞牛 fnOS 应用中心

> **DeepSeek Harness（dsh）**—— DeepSeek 官方 agent 框架的浏览器 UI，现已打包成飞牛 fnOS 应用，**离线安装、免联网**。

![上游版本](https://img.shields.io/badge/upstream-v0.1.0--rc.6-1E88E5)
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

1. 在 **飞牛应用中心** 搜索 `DeepSeek Harness`，或从项目 [GitHub Release](https://github.com/techysy/deepseek-harness-fnos/releases) 下载 `dsh-0.1.0-rc.6.fpk` 手动安装
2. 安装向导填 **DeepSeek API Key**（`sk-` 开头，可从 [platform.deepseek.com](https://platform.deepseek.com) 获取；**可留空**，之后在应用内配置）
3. 装完在桌面上点开 DSH 图标，或手机/电脑浏览器访问 `http://<NAS_IP>:28000`

> 依赖：应用中心会自动安装 **Node.js 24**，无需手动处理。

---

## 🚀 使用

### 首次配置 API Key
- 安装向导填了就直接用
- 没填的话，编辑 `/vol4/@appdata/dsh/dsh_home/.env`，写入 `DEEPSEEK_API_KEY=sk-xxx`，重启应用生效

### 局域网/远程访问
| 方式 | 地址 |
|------|------|
| 桌面图标 | fnOS 桌面直接点开 |
| 局域网 | `http://192.168.31.101:28000`（换成你的 NAS IP）|
| Tailscale | `http://<tailscale-ip>:28000` |

### 网络代理（可选）
如果 DeepSeek Harness 访问 GitHub 或外部接口**超时**，可以在**安装向导**或**应用设置**里填代理（IP + 端口，如 `127.0.0.1` + `7890`）。留空默认不走代理。

---

## ⚠️ 注意事项

- **API Key 必填才能对话**：dsh 需要 DeepSeek API Key（可稍后配置）
- **端口 28000** 局域网内可访问，且 dsh 能执行代码——**注意网络安全**，建议用防火墙限制网段或用 `trusted-host` 配置
- **移动端建议用浏览器**：飞牛移动 App 内置容器（WebView）对这类复杂前端有兼容限制，建议用手机浏览器（Chrome/飞书）打开
- **升级/卸载不丢数据**：工作空间、会话、API Key、代理配置都会保留

---

## 🔗 相关链接

- **上游项目**：[deepseek-ai/deepseek-harness](https://github.com/deepseek-ai/deepseek-harness)（DeepSeek 官方）
- **飞牛打包版**：[techysy/deepseek-harness-fnos](https://github.com/techysy/deepseek-harness-fnos)
- **发布下载**：[GitHub Releases](https://github.com/techysy/deepseek-harness-fnos/releases)

---

*如果你觉得好用，欢迎到 [GitHub](https://github.com/techysy/deepseek-harness-fnos) 点个 ⭐ 支持一下！*
