# DeepSeek Harness for fnOS

DeepSeek 官方 Agent 浏览器 UI（一切皆插件）的 fnOS 快捷入口。

- 目标：https://www.deepseek.com/harness/（DeepSeek Harness 开发者预览版）
- 纯空壳：不运行后端，桌面图标打开 DeepSeek Harness。
- 图标：DeepSeek 官方黑色鲸鱼 logo。

## 下载安装

从 [Releases](https://github.com/techysy/deepseek-harness-fnos/releases/latest) 下载 fpk，在 fnOS App Center 手动安装。

## 版本说明

当前版本：**0.1.0-rc.7**（含 ARM/x86 离线包 + 在线通用包）

| 文件 | 架构 | 类型 | 说明 |
|------|------|------|------|
| `dsh-0.1.0-rc.7-all.fpk` | 通用 | url | 在线版，新标签页打开，x86/ARM 通用 |
| `dsh-0.1.0-rc.7-iframe-all.fpk` | 通用 | iframe | 在线版，桌面窗口内打开 |
| `dsh-0.1.0-rc.7-x86.fpk` | x86 | url | 离线版（含 x86 原生模块），新标签页打开 |
| `dsh-0.1.0-rc.7-iframe-x86.fpk` | x86 | iframe | 离线版（含 x86 原生模块），桌面窗口内打开 |

**推荐**：一般用户选 `all` 通用版即可；需要离线/原生模块支持的选 `x86` 版。

## 构建

```bash
bash scripts/build.sh            # url 版 + iframe 版，交付到 fpk/deepseek-harness/
bash scripts/build.sh --formal   # 正式版
```

## 安装

fnOS 应用中心手动安装 `dsh-*.fpk`。
