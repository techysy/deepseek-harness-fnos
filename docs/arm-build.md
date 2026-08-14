# ARM 版本打包指南

> 说明如何为 ARM / 多架构的飞牛 fnOS 打包 DeepSeek Harness（dsh）。
> 采用飞牛官方标准的 `platform` 字段，交付 x86 离线版 + all 在线版两个 fpk。

---

## 1. 背景与问题

dsh 的离线包依赖 `app/server/node_modules`，其中包含**平台相关的原生模块**：

- `node-pty`（伪终端）
- `sharp`（图像处理）
- `lightningcss` / `rolldown` / `oxc-parser`（编译/解析）

这些原生模块是**针对编译时的 CPU 架构生成的**。x86_64 编译的 `.node` 二进制无法在 ARM 上加载（报 `wrong ELF class` 或 `cannot open shared object file`）。

**结论**：
- **离线包**（含 node_modules）只能针对单一架构，需在对应架构机器上构建
- **在线包**（不含 node_modules）无特定架构二进制，装时现场编译，x86/ARM 通用

---

## 2. `platform` 字段（飞牛官方标准）

`manifest` 用 `platform` 声明支持的硬件架构（见 [官方文档](https://developer.fnnas.com/docs/core-concepts/manifest/)）：

| 值 | 含义 |
|----|------|
| `x86` | 仅 x86 设备 |
| `arm` | 仅 ARM 设备 |
| `all` | x86 + ARM 通用，**仅当包不含特定架构二进制时**（即在线包） |

> ⚠️ `platform = all` 但含 x86 的 node_modules → ARM 虽能安装，但原生模块加载失败，dsh 跑不起来。

---

## 3. 两个交付版本

| fpk | platform | 含 node_modules | 适用 |
|-----|----------|-----------------|------|
| `dsh-<ver>-x86.fpk` | `x86` | ✅ 含（离线） | x86 NAS，免联网快装 |
| `dsh-<ver>-all.fpk` | `all` | ❌ 不含（在线） | x86 / ARM 通用，装时在线编译 |

### 交付命名规则
```
dsh-<version>-x86.fpk    # 离线版（单架构）
dsh-<version>-all.fpk    # 在线版（多架构通用）
```

---

## 4. 前置条件

| 条件 | 说明 |
|------|------|
| **nodejs_v24** | `manifest` 的 `install_dep_apps = nodejs_v24`，安装时自动装 |
| **build-essential** | g++/make，编译 node-pty 等原生模块必需（在线版） |
| **联网** | 安装时从 npm registry 拉取 `@deepseek-ai/dsh`（在线版） |

> 安装 `build-essential`：
> ```bash
> ssh 到 NAS 执行: sudo apt update && sudo apt install -y build-essential
> ```

---

## 5. 打包 x86 离线版

`manifest`：
```ini
platform = x86
```

打包（含 node_modules）：
```bash
cd repo
fnpack build
mv dsh.fpk dsh-0.1.0-rc.6-x86.fpk
```

---

## 6. 打包 all 在线版

`manifest`：
```ini
platform = all
```

### 6.1 清理 node_modules（不打包）
```bash
cd repo
mv app/server/node_modules /tmp/node_modules_backup
```

### 6.2 打包
```bash
fnpack build
mv dsh.fpk dsh-0.1.0-rc.6-all.fpk
```

### 6.3 验证不含 node_modules
```bash
tar tzf dsh-0.1.0-rc.6-all.fpk 2>/dev/null | grep -c "server/node_modules"   # 期望 0
```

### 6.4 恢复工作区
```bash
mv /tmp/node_modules_backup app/server/node_modules
```

---

## 7. 在线安装逻辑（install_callback / upgrade_callback）

离线包缺失时自动在线安装（已在 `cmd/install_callback`、`cmd/upgrade_callback` 实现）：

```bash
if [ ! -f "${DSH_OFFLINE}" ]; then
    echo "offline dsh package not found; online npm install..."
    ( cd "${APP_DIR}/server" && "${NPM_BIN}" install @deepseek-ai/dsh@^0.1.0-rc.6 )
fi
```

**顺序**：在线 `npm install` 必须先于 settings 前端 patch（`patch_settings_memory.py`），
因为 patch 依赖已装好的 `node_modules`。

> 在线版通用：安装后无论 x86/ARM，`patch_settings_memory.py` 都会自动应用到
> `dsh-client-ui-settings*/lib/client.js`，修复域名访问时插件/模型配置空白页。

---

## 8. 安装流程

### x86 离线版（x86 NAS）
1. 应用中心安装 `dsh-<ver>-x86.fpk`
2. 直接使用（node_modules 已内置，免联网）

### all 在线版（x86 或 ARM NAS）
1. 应用中心安装 `dsh-<ver>-all.fpk`
2. `install_callback` 检测无离线包 → 在线 `npm install`（针对当前架构编译）
3. settings 前端 patch 自动应用
4. 安装完成

---

## 9. 注意事项

- **在线安装耗时**：原生模块（node-pty/sharp 等）编译可能 5~20 分钟，属正常。
- **依赖 nodejs_v24 的 arm 支持**：需确认飞牛应用商店的 `nodejs_v24` 是否有 arm64 版本（在线安装依赖它）。
- **install_callback 兼容**：x86 离线版（有 node_modules）走离线路径，不受在线兜底影响。
- **安全**：settings 前端 patch 解除上游 loopback-only 限制，建议配合 FN Connect 鉴权 / 网络访问控制。

---

## 10. 相关文件

| 文件 | 说明 |
|------|------|
| `manifest` | `platform` 字段（x86 / all） |
| `cmd/install_callback` | 在线安装兜底逻辑 |
| `cmd/upgrade_callback` | 升级在线兜底逻辑 |
| `cmd/patch_settings_memory.py` | settings 前端 patch（安装后自动应用） |
| `app/server/package.json` | 在线安装依赖声明 `@deepseek-ai/dsh: ^0.1.0-rc.6` |
