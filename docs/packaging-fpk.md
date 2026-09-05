# 📦 fpk 打包指南（dsh）

> DeepSeek Harness for fnOS 的两条打包路径：**GitHub Actions 在线打包**（推荐，无需本地构建机）
> 和 **离线脚本**（NAS / 容器本机构建）。两者产出一致的 fpk（url 版 + iframe 版）。
>
> 相关文档：[arm-build.md](arm-build.md)（ARM 多架构细节）、[upstream-sync-checklist.md](upstream-sync-checklist.md)（同步上游后补丁核对）。

---

## 1. 产物命名与变体

### 版本号策略

**fpk 版本号跟随上游发行版（`@deepseek-ai/dsh`），本地修复不单独抬版**。dsh 这个项目的特殊性：
本地对上游只有补丁覆盖（运行时 patch + 构建期注入），不 fork、不改上游发行版本号，
所以 `manifest.version` 始终等于所打包的上游版本（如 `0.1.2-rc.1`）。

- 上游升级 → fpk 版本跟着变（如 0.1.1-rc.2 → 0.1.2-rc.1）
- 本地补丁/修复 → **不改版本号**，同一版本号重新打包覆盖，变更记入 CHANGELOG 对应上游版本的条目（条目内标注"本地补丁覆盖"）
- README 的 **dsh 徽章**显示上游版本；「当前版本」与 fpk 文件名显示 fpk 版本（二者通常一致）

每次打包产出两个变体（`<ver>` 取自 `manifest` 的 `version`）：

| 文件 | 打开方式 | 用途 |
|------|---------|------|
| `dsh-<ver>-<arch>.fpk` | url（新标签页） | 桌面图标 → 浏览器新标签打开 |
| `dsh-<ver>-iframe-<arch>.fpk` | iframe（桌面窗口内） | 桌面窗口内嵌打开（推荐） |

`<arch>`：`x86`（Actions x86 路径 / 离线脚本）或 `arm`（Actions ARM 路径）。
离线包含 `app/server/node_modules`（npm install 扁平自包含布局，无 symlink），安装免联网。

---

## 2. 在线打包（GitHub Actions，推荐）

**Workflow**：[`.github/workflows/build-fpk.yml`](../.github/workflows/build-fpk.yml)（手动触发 `workflow_dispatch`）

### 触发方式

- **网页**：Actions → Build dsh fpk (在线打包) → Run workflow → 选参数
- **CLI**：

```bash
# x86
gh workflow run build-fpk.yml --ref main -f arch=x86
# ARM (glibc 兼容模式默认开, manylinux_2_28 容器保证旧 glibc 可用)
gh workflow run build-fpk.yml --ref main -f arch=arm
# 临时指定上游 dsh 版本 (留空用 app/server/package.json 声明)
gh workflow run build-fpk.yml -f arch=x86 -f dsh_version=0.1.2-rc.1
```

### 输入参数

| 参数 | 说明 | 默认 |
|------|------|------|
| `arch` | `arm` / `x86`（每次一个架构，两个架构跑两次） | `arm` |
| `dsh_version` | 覆盖 `@deepseek-ai/dsh` 版本；留空用 package.json | 空 |
| `glibc_compat` | ARM 是否用 manylinux_2_28 容器构建（仅 arm 生效） | `true` |

### 流程与产物

1. checkout → npm install（arm 走 manylinux 容器 / x86 runner 原生）
2. **注入本地补丁**（与离线脚本一致，见 §4）
3. 下载 fnpack 1.2.1（飞牛官方，可 `FNPACK_URL` secret 覆盖）
4. 移除 symlink（fnpack 不支持）→ 设置 `manifest.platform` → fnpack build × 2（url/iframe）
5. 上传 artifacts：`dsh-fpk-<arch>-<sha>`（保留 14 天），Step Summary 有产物路径

下载：`gh run download <run-id> -n dsh-fpk-x86-<sha>` 或 Actions 页面。

### 运行时补丁（不进 fpk，安装后由 cmd/main 处理）

`cmd/main` 启动时幂等完成：写 `cordis.patch.yml` 覆盖 webserver 绑 0.0.0.0、拼装
`--trusted-host`（LAN IP + fnos.net + trusted_hosts.conf）、privileged-fence 检查/补丁、
corepack/bun/npm prefix 数据区指向。**改 host/信任逻辑只动 cmd/main，无需重新打包。**

---

## 3. 离线脚本（本机构建）

| 脚本 | 平台 | 说明 |
|------|------|------|
| `scripts/build-x86-offline.sh` | x86 NAS（如打包机 101） | clone 本仓库 → npm install → 补丁 → fnpack → 交付到应用中心扫描目录 |
| `scripts/package-arm-offline.sh` + `scripts/build-arm-node-modules.sh` | ARM NAS / x86 交叉 | ARM node_modules 构建与打包（详见 [arm-build.md](arm-build.md)） |

```bash
bash scripts/build-x86-offline.sh              # url + iframe 两个 fpk
```

依赖：nodejs_v24（fnOS 依赖应用）、fnpack、python3。npm 堆内存已内置 `--max-old-space-size=4096`（依赖树大，默认 1024 会 OOM）。

> 历史：0.1.1-rc.2 曾误用 pnpm workspace 源码构建，node_modules 全 symlink 导致
> fnpack `copy_file_range` 报错、安装后依赖链断裂（fpk 394M）。**统一回归 npm install
> 扁平布局**（fpk ~48M，`@deepseek-ai/dsh` 为实体目录）。

---

## 4. 本地补丁清单（构建期注入 fpk）

> 同步上游后**必须**逐项核对（详见 [upstream-sync-checklist.md](upstream-sync-checklist.md)），
> npm install 会覆盖 node_modules 冲掉全部补丁。

| # | 补丁 | 脚本 | 0.1.2-rc.1 适用性 |
|---|------|------|------------------|
| 1 | crypto.randomUUID polyfill → `dsh-web-frontend/dist/index.html` | `scripts/inject_crypto_polyfill.py` | ⚠️ **已过时**（前端零引用 randomUUID），保留无害 |
| 2 | settings memory→host → `dsh-client-ui-settings/lib/client.js` | `cmd/patch_settings_memory.py` | ✅ **仍必需**；0.1.2 起模式改为 `ctx.remote.$host.isLoopback`，脚本已用正则兼容新旧版，主包未命中 exit 1 |
| 3 | privileged-fence 放宽 → `dsh-client-connection/lib/index.js` | `cmd/main` 内联 PATCHPY / `scripts/patch_privileged_fence.py` | ⚠️ **上游已原生修复**（requestRejection 统一 trustedHosts），patch 自动跳过 |

### Actions 与离线脚本的补丁对齐

两条路径的构建期补丁必须一致（当前：polyfill + settings memory→host）：

- **build-x86-offline.sh**：`inject_crypto_polyfill.py` + `patch_settings_memory.py`
- **build-fpk.yml**：`注入 crypto.randomUUID polyfill` + `应用 settings memory→host 补丁` 两个 step（settings 步骤含硬校验，脚本 exit 1 会红灯）

若新增补丁，**两处同步加**，并在 upstream-sync-checklist.md 登记。

---

## 5. 版本升级 SOP（上游发新版）

1. **核对上游**：npm `dist-tags`（`npm view @deepseek-ai/dsh dist-tags`）+ GitHub Releases 说明；
   alpha / 有已知回退的版本跳过，等 rc
2. **本地改版本（仅上游升级时）**：`app/server/package.json` → `npm install --package-lock-only` 重新生成 lock →
   `VERSION` / `manifest`（version+desc+changelog）/ `README.md` / `CHANGELOG.md`
   **本地修复不改版本号**：直接改补丁/cmd 脚本 → CHANGELOG 并入当前上游版本的条目（标注"本地补丁覆盖"）→ 同版本号重新打包
3. **补丁核对**：按 [upstream-sync-checklist.md](upstream-sync-checklist.md) 对每个补丁的目标模式做包内 grep
   （拉对应版本 tarball 验证，或装完后核）
4. **提交推送** → 触发 Actions `build-fpk.yml`（x86；有 ARM 需求再跑 arm）
5. **安装验证**：应用中心装 iframe 版 → 按 checklist §3 端到端验证（LAN API 200、设置页可读、
   polyfill/randomUUID 视版本）→ 写测试报告到 `test log.md`
6. **发 Release**：传两个 fpk + 更新 README 徽章/版本表

## 6. 常见坑

- **package-lock.json 版本漂移**：改 package.json 后务必 `npm install --package-lock-only` 同步 lock
  （0.1.1-rc.2 曾锁在 0.1.0-rc.7 半年未发现）
- **fnpack 不支持 symlink**：打包前 `find . -type l -delete`（脚本已内置）
- **npm install 在 NAS 慢**：解析 10+ 分钟，必须大堆内存；Actions runner 更快，优先在线打包
- **补丁静默失效**：`patch_settings_memory.py` 对「目标存在但模式不匹配」会 WARN 跳过；
  0.1.2-rc.1 起主包未命中直接 exit 1，CI 红灯即可发现
