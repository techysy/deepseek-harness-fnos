# CHANGELOG

## 1.0.2 (2026-08-13)
- 应用名改为 **DeepSeek Harness**
- 图标换成 **DeepSeek 官方图标**
- 修复 node PATH（npm install 找不到 node）+ socket 目录

## 1.0.1 (2026-08-13)
修复"无效的包"：补齐 9 个 fnOS 生命周期脚本（config_init/callback、install_init、uninstall_init/callback、upgrade_init/callback），修复 config/resource 括号格式。

## 1.0.0 (2026-08-13)
首个版本：DeepSeek Harness (dsh) fnOS 应用包。

- **dsh web 常驻服务**：`dsh web` 绑 127.0.0.1:18080（DeepSeek Harness 浏览器 UI）
- **飞牛官方统一网关接入**：`/app/dsh`（gatewaySocket: app.sock + gatewayPrefix），桌面图标入口
- **统一网关代理**（proxy.py）：Unix socket → 127.0.0.1:18080，重写 Host 规避 dsh browser-trust
- **安装向导**：DeepSeek API Key 配置
- **依赖**：nodejs_v24 + `npm install -g @deepseek-ai/dsh`
