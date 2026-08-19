# dsh Agent 环境 node 原生命令兼容矩阵（最新）

> 说明 dsh 的 Agent / bash 工具环境里，**可用的全部 node 生态原生命令**（node / npm / npx / pnpm / yarn / bun / corepack），以及数据区配置。
>
> 这是 **dsh-nodejs.md**（只讲 node/npm 基础接入）的**升级版**：覆盖后续加入的 pnpm/yarn/bun/corepack 与数据区持久化。

---

## 1. 命令速查表

安装后可在 dsh 的 Agent / bash 工具里直接使用：

| 命令 | 来源 | 版本（实测） | 数据落点 |
|------|------|-------------|---------|
| `node` | nodejs_v24 依赖 | v24.15.0 | - |
| `npm` | nodejs_v24 依赖 | 11.12.1 | `DSH_HOME/.npm-global`（全局）|
| `npx` | nodejs_v24 依赖 | 11.12.1 | - |
| `pnpm` | corepack（nodejs_v24） | 11.22.0 | `DSH_HOME/.corepack` |
| `yarn` | corepack（nodejs_v24） | 1.22.22 | `DSH_HOME/.corepack` |
| `bun` | bunjs 依赖应用 | 1.3.9 | - |
| `corepack` | nodejs_v24 依赖 | 0.34.6 | - |

> **版本号实测**（101 实体机）：node v24.15.0 / npm 11.12.1 / npx 11.12.1 / pnpm 11.22.0 / yarn 1.22.22 / bun 1.3.9 / corepack 0.34.6

---

## 2. PATH 组装（cmd/main）

dsh 启动时按顺序把下列目录加入 PATH：

```bash
# 1. nodejs_v24 原生 bin (node/npm/npx/corepack)
NODE_BIN_DIR="$(dirname "$(readlink -f /var/apps/nodejs_v24/target/bin/node)")"
# 2. corepack shims (pnpm/yarn 的可执行 shim)
COREPACK_SHIMS="$(dirname "$NODE_BIN_DIR")/lib/node_modules/corepack/shims"
# 3. bunjs 依赖应用 bin (bun)
BUN_BIN_DIR="/var/apps/bunjs/target/bin"
export PATH="${NODE_BIN_DIR}:${COREPACK_SHIMS}:${BUN_BIN_DIR}:${PATH}"
```

最终 Agent 环境 PATH：
```
/var/apps/nodejs_v24/target/bin
/var/apps/nodejs_v24/target/lib/node_modules/corepack/shims
/var/apps/bunjs/target/bin
/usr/local/bin:/usr/bin:/bin
```

---

## 3. 依赖应用声明（manifest）

```ini
install_dep_apps = nodejs_v24:bunjs
```

- `nodejs_v24` → node / npm / npx / corepack / pnpm / yarn
- `bunjs` → bun
- 用 `:` 分隔多个依赖应用

---

## 4. 数据区持久化（npm/pnpm/yarn 缓存落数据盘）

为**避免占用系统盘**、并**避免读到 `/home/<user>/.npmrc` 的 prefix 冲突**，全部全局缓存/全局安装落数据区：

```bash
export COREPACK_HOME="${DSH_HOME}/.corepack"     # pnpm/yarn 版本缓存
export npm_config_prefix="${DSH_HOME}/.npm-global"  # npm 全局安装目录
export npm_config_cache="${DSH_HOME}/.npm"        # npm 缓存
export HOME="${DSH_HOME}"
```

> **npm prefix warning 说明**：若出现
> `config prefix cannot be changed from project config: /home/<user>/.npmrc`
> 是**无害**的 —— 它只是提示「忽略系统用户 npmrc 里的 prefix」，实际 prefix 已正确指向数据区（`npm config get prefix` 可验证）。
> 彻底消除需改 `/home/<user>/.npmrc`（会影响该 NAS 用户本人），不建议。

**验证**：
```bash
npm config get prefix     # 应显示 DSH_HOME/.npm-global
npm i -g <pkg>            # 全局安装应落在数据区
```

---

## 5. 验证命令

在 dsh Agent 里执行，确认全部命令可用：

```bash
node -v && npm -v && npx --version && pnpm --version && yarn --version && bun --version && corepack --version
```

期望输出（对应第 1 节版本表）。

---

## 6. 涉及文件

| 文件 | 说明 |
|------|------|
| `cmd/main` | PATH 组装（node + corepack shims + bunjs）+ 数据区环境变量 |
| `manifest` | `install_dep_apps = nodejs_v24:bunjs` 声明依赖 |
| `docs/upstream-sync-checklist.md` | 同步上游后验证这些命令的检查项 |

---

## 7. 常见问题排查

- **`pnpm: command not found`**：corepack shims 目录未加 PATH。检查
  `/var/apps/nodejs_v24/target/lib/node_modules/corepack/shims` 是否存在。
- **`bun: command not found`**：bunjs 依赖未装或未加 PATH。确认 `manifest` 声明
  `install_dep_apps = nodejs_v24:bunjs`，且 `/var/apps/bunjs/target/bin/bun` 存在。
- **npm 全局装到 `/home/<user>`**：`npm_config_prefix` 未设置。确认指向
  `DSH_HOME/.npm-global`。
- **pnpm/yarn 每次重新下载**：`COREPACK_HOME` 未持久化。确认指向 `DSH_HOME/.corepack`。
