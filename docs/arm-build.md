# ARM 版本打包指南

> 说明如何为 ARM / 多架构的飞牛 fnOS 打包 DeepSeek Harness（dsh）。
> 采用飞牛官方标准的 `platform` 字段，交付 x86 离线版 + all 在线版两个 fpk。
>
> ⚠️ dsh 应用自托管 nodejs（依赖 nodejs_v24）的细节，见 **[dsh-nodejs.md](dsh-nodejs.md)**。

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
| **nodejs_v24** | `manifest` 的 `install_dep_apps = nodejs_v24`，安装时自动装（接入见 dsh-nodejs.md） |
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
mv dsh.fpk dsh-0.1.0-rc.7-x86.fpk
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
mv dsh.fpk dsh-0.1.0-rc.7-all.fpk
```

### 6.3 验证不含 node_modules
```bash
tar tzf dsh-0.1.0-rc.7-all.fpk 2>/dev/null | grep -c "server/node_modules"   # 期望 0
```

### 6.4 恢复工作区
```bash
mv /tmp/node_modules_backup app/server/node_modules
```

---

## 7. 在线安装流程

离线包缺失时，`install_callback` / `upgrade_callback` 自动在线安装
（node 自托管、防 OOM 等细节见 **[dsh-nodejs.md](dsh-nodejs.md)**）：

```bash
if [ ! -f "${DSH_OFFLINE}" ]; then
    ( cd "${APP_DIR}/server" && npm install @deepseek-ai/dsh@^0.1.0-rc.7 )
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
- **低内存设备**：在线安装设置 `NODE_OPTIONS=--max-old-space-size=512`、`npm_config_jobs=1` 防 OOM。
- **安全**：settings 前端 patch 解除上游 loopback-only 限制，建议配合 FN Connect 鉴权 / 网络访问控制。

---

## 10. 相关文件

| 文件 | 说明 |
|------|------|
| `manifest` | `platform` 字段（x86 / all） |
| `cmd/install_callback` | 在线安装兜底逻辑 |
| `cmd/upgrade_callback` | 升级在线兜底逻辑 |
| `cmd/patch_settings_memory.py` | settings 前端 patch（安装后自动应用） |
| `app/server/package.json` | 在线安装依赖声明 `@deepseek-ai/dsh: ^0.1.0-rc.7` |

---

## 11. ARM 离线版（新增，2026-08）: GitHub Actions + manylinux 编译

> 目标: 产出 **ARM 离线包** `dsh-<ver>-arm.fpk`（内置 ARM64 node_modules, 免联网）。
> 相比 `all` 在线版（装时联网编译 5~20 分钟）, ARM 离线版装完即用。

### 为什么需要 manylinux_2_28 容器

目标 fnOS ARM 设备（如 R2S）是 Debian 12, glibc **2.36**。
直接在 GitHub Actions `ubuntu-24.04-arm`（glibc 2.39）编译 node-pty 等原生模块,
产物可能引用 GLIBC_2.37+ 符号, 在 glibc 2.36 设备上报 `GLIBC_2.3x not found`。

manylinux_2_28 容器内 glibc = **2.28**, 在此编译 → 产物 GLIBC 要求 ≤ 2.28 < 2.36,
任何 glibc ≥ 2.28 的环境都能跑。

### 流程

```
[GitHub Actions: ubuntu-24.04-arm (免费, 原生 aarch64)]
  ├─ manylinux_2_28_aarch64 容器内
  │    ├─ 装 Node 24 官方 aarch64 二进制 (需 glibc≥2.28, 正好匹配)
  │    └─ npm install @deepseek-ai/dsh@^0.1.0-rc.7
  │        → node-pty 用容器内 gcc (glibc 2.28) 编译
  │        → sharp 等用预编译 ARM 二进制
  ├─ readelf 校验所有 .node 的 GLIBC 要求 ≤ 2.28
  └─ 产出 node_modules-arm64.tar.gz (artifact)
        │
        ▼ 下载
[101 (x86 fnOS)]
  └─ package-arm-offline.sh:
       ├─ 解压到 app/server/node_modules
       ├─ manifest: platform = arm
       ├─ fnpack build → dsh-<ver>-arm.fpk
       └─ 交付到 /vol1/1000/fnOS App/fpk/deepseek-harness/
```

### 文件

| 文件 | 说明 |
|------|------|
| `.github/workflows/build-arm-node-modules.yml` | CI: ARM64 runner 编译 ARM node_modules |
| `scripts/build-arm-node-modules.sh` | manylinux 容器内 npm install + glibc 校验 |
| `scripts/package-arm-offline.sh` | 101 上打 `-arm.fpk` 并交付 |

### 用法

1. 在 `deepseek-harness-fnos` 仓库 Actions → **Build ARM node_modules** → Run workflow
2. 下载 artifact `node_modules-arm64-<sha>.tar.gz`
3. 上传到 101, 运行:
   ```bash
   bash scripts/package-arm-offline.sh node_modules-arm64-<sha>.tar.gz
   ```
4. 产物 `dsh-<ver>-arm.fpk` 自动交付到 `/vol1/1000/fnOS App/fpk/deepseek-harness/`

### 注意

- 原生模块真正需编译的只有 **node-pty**; sharp 等自带预编译 ARM 二进制。
- 若目标设备 glibc 更老 (< 2.28), 需改用更老的 manylinux 镜像, 或本地编译。
