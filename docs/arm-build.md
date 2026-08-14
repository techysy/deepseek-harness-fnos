# ARM 版本打包指南（在线包方案）

> 本文档说明如何为 ARM 架构（aarch64/arm64）的飞牛 fnOS 打包 DeepSeek Harness（dsh）。
> 当前只有 x86_64 构建环境时，无法产出 ARM 离线包，需改用**在线包**方案。

---

## 1. 背景与问题

dsh 的离线包依赖 `app/server/node_modules`，其中包含**平台相关的原生模块**：

- `node-pty`（伪终端）
- `sharp`（图像处理）
- `lightningcss` / `rolldown` / `oxc-parser`（编译/解析）

这些原生模块是**针对编译时的 CPU 架构生成的**。x86_64 编译的 `.node` 二进制无法在 ARM 上加载，会报 `cannot open shared object file` 或 `wrong ELF class`。

**结论**：ARM 离线包**必须在 ARM 机器上构建**。没有 ARM 构建环境时，只能改用**在线包**。

---

## 2. 方案：在线包（推荐，无 ARM 环境时唯一选择）

**核心思路**：fpk 的 `app/server` **不打包 node_modules**，只保留 `package.json` + `package-lock.json`。安装时由 `install_callback` 执行在线 `npm install @deepseek-ai/dsh`，让原生模块**针对当前 NAS 架构**现场编译。

**优点**
- 不依赖特定架构构建环境，x86 / ARM 都能安装
- 原生模块自动适配目标架构
- 安装包体积小（不含 346M node_modules）

**缺点**
- 安装需联网（违背"离线打包"初衷）
- 安装耗时（现场编译原生模块）
- 需 NAS 具备编译工具链（g++/make）

---

## 3. 前置条件

| 条件 | 说明 |
|------|------|
| **nodejs_v24** | `manifest` 的 `install_dep_apps = nodejs_v24`，安装时自动装 |
| **build-essential** | g++/make，编译 node-pty 等原生模块必需 |
| **联网** | 安装时从 npm registry 拉取 `@deepseek-ai/dsh` |

> 安装 `build-essential`：
> ```bash
> ssh 到 NAS 执行: sudo apt update && sudo apt install -y build-essential
> ```

---

## 4. 修改 `manifest`

```ini
# 原：arch = x86_64
arch = aarch64
```

> 注意：飞牛架构标识用 `aarch64`（应用商店前端 JS 已含 aarch64/arm64 枚举）。
>
> ⚠️ `arch = aarch64` 意味着**只有 ARM 机器能安装**。若需同时支持 x86 和 ARM，
> 需打两个 fpk（`arch = x86_64` 和 `arch = aarch64` 各一份），
> 或在 `install_dep_apps` / 打包脚本里按需处理。

---

## 5. 修改 `cmd/install_callback`（核心）

把当前"离线包缺失仅 WARN"改为"**离线缺失则在线安装兜底**"：

```bash
# 检查离线 dsh 包; 若无则在线安装 (针对当前架构编译原生模块)
if [ ! -f "${DSH_OFFLINE}" ]; then
    echo "[$(date '+%F %T')] offline dsh package not found; online install..." >> "${LOG}"
    NPM_BIN=""
    for cand in /vol4/@appcenter/nodejs_v24/bin/npm /var/apps/nodejs_v24/target/bin/npm /usr/bin/npm; do
        [ -x "$cand" ] && NPM_BIN="$cand" && break
    done
    if [ -n "${NPM_BIN}" ]; then
        ( cd "${APP_DIR}/server" && "${NPM_BIN}" install @deepseek-ai/dsh@^0.1.0-rc.6 >> "${LOG}" 2>&1 )
        echo "[$(date '+%F %T')] online install exit=$?" >> "${LOG}"
    else
        echo "[$(date '+%F %T')] ERROR: no npm found; cannot install dsh" >> "${LOG}"
    fi
fi
```

**顺序**：在线 `npm install` 必须**先于** settings 前端 patch（`patch_settings_memory.py`），
因为 patch 依赖已装好的 `node_modules/@deepseek-ai/dsh-client-ui-settings*/lib/client.js`。

---

## 6. 打包（fpk 不打包 node_modules）

### 6.1 清理 node_modules
```bash
cd repo
rm -rf app/server/node_modules   # 不打包进 fpk
```

### 6.2 打包
```bash
fnpack build
# 输出 dsh.fpk
```

### 6.3 验证 fpk 不含 node_modules
```bash
tar tzf dsh.fpk 2>/dev/null | grep -c "server/node_modules"   # 期望 0
```

---

## 7. 安装流程（ARM 机器上）

1. 飞牛应用中心手动安装 `dsh.fpk`（arch=aarch64 的版本）
2. 安装时 `install_callback` 检测无离线包 → 在线 `npm install @deepseek-ai/dsh`
3. 原生模块针对 ARM 现场编译
4. settings 前端 patch 自动应用
5. 安装完成，应用可启动

---

## 8. 注意事项

- **离线包 vs 在线包**：现有 x86_64 版本建议保留离线包（免联网、快）；ARM 在线包联网编译。
- **在线安装耗时**：原生模块（node-pty/sharp 等）编译可能 5~20 分钟，属正常。
- **依赖 nodejs_v24 的 arm 支持**：需确认飞牛应用商店的 `nodejs_v24` 是否有 aarch64 版本（在线安装依赖它）。若 nodejs_v24 只支持 x86，则 ARM 在线包也无法安装。
- **多架构发布**：若同时支持 x86 + ARM，需分别打包并各自 `arch` 字段，发布两个 fpk。
- **install_callback 兼容**：改造后，x86 离线包（有 node_modules）仍走离线路径，不受影响；只是多了一个"离线缺失时在线兜底"分支。

---

## 9. 相关文件

| 文件 | 说明 |
|------|------|
| `manifest` | `arch` 字段（x86_64 / aarch64） |
| `cmd/install_callback` | 在线安装兜底逻辑 |
| `cmd/patch_settings_memory.py` | settings 前端 patch（安装后自动应用） |
| `app/server/package.json` | 在线安装依赖声明 `@deepseek-ai/dsh: ^0.1.0-rc.6` |
