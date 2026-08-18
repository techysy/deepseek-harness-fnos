# dsh 自托管 nodejs（fnOS 依赖应用接入）

> 说明 dsh 应用以 `dsh` 用户运行时，如何正确自托管使用 fnOS 的依赖应用 **nodejs_v24**（node/npm）。

---

## 1. 背景

dsh 是 Node.js 应用，依赖 fnOS 的 **nodejs_v24**（在 `manifest` 里通过 `install_dep_apps = nodejs_v24` 声明）。

dsh 应用以 **`dsh` 用户**运行，但：
- fnOS **不会自动**把 nodejs 加入 `dsh` 用户的系统 PATH
- dsh 应用必须**自托管** node（自行定位 node 并加入 PATH）

若不处理，会出现：
- `node: No such file or directory`（npm 脚本找不到 node）
- dsh agent 执行命令时找不到 `node`/`npm`

---

## 2. fnOS 依赖应用的标准接入

fnOS 为每个依赖应用提供**标准软链**：

```
/var/apps/<依赖应用名>/target  ->  实际安装目录
```

例如 nodejs_v24：

```
/var/apps/nodejs_v24/target  ->  /vol*/@appcenter/nodejs_v24
/var/apps/nodejs_v24/target/bin/node
/var/apps/nodejs_v24/target/bin/npm
```

**无论应用装在哪个卷（/vol1 /vol4 /vol2...），`/var/apps/nodejs_v24/target` 都保证存在**。
这是 dsh 定位 node 的**首选路径**。

---

## 3. 动态定位 node（不写死卷路径）

脚本从数据目录提取应用卷，作为 fallback（避免写死 /vol1 /vol4）：

```bash
# 从 TRIM_PKGVAR (数据目录) 提取应用卷, 如 /vol4/@appdata/dsh -> /vol4
APP_VOL="$(printf '%s' "${DATA_DIR}" | sed -n 's#^\(/vol[^/]*\)/.*#\1#p')"

# 定位 node: 优先 fnOS 标准软链, fallback 应用卷
NODE_BIN=""
for cand in /var/apps/nodejs_v24/target/bin/node "${APP_VOL}/@appcenter/nodejs_v24/bin/node" /usr/bin/node; do
    [ -x "$cand" ] && NODE_BIN="$cand" && break
done
```

> 不写死 `/vol1`/`/vol4`，避免撞到其他存储空间。
> 优先 `/var/apps/<dep>/target` 软链（无论卷保证存在）。

---

## 4. dsh 启动时自托管 node

`cmd/main` 启动 dsh 前，把 node 的 bin 目录加入 PATH，
使 **dsh 进程及其 agent 子进程**都能直接调用 `node`/`npm`：

```bash
# 在 start_dsh 里, 启动 dsh 前
if [ -n "${NODE_BIN}" ]; then
    NODE_BIN_DIR="$(dirname "${NODE_BIN}")"
    export PATH="${NODE_BIN_DIR}:${PATH}"
    log "dsh self-hosting node via: ${NODE_BIN}"
fi

# 用 node 运行 dsh 的 bin.js (无 bin 链接兜底)
DSH_HOME="${DSH_HOME}" nohup "${DSH_BIN}" ${DSH_ARGS:-} web --port "${DSH_PORT}" ${TRUSTED_HOST_ARGS} \
    >> "${DSH_LOG}" 2>&1 &
```

---

## 5. 在线安装时自托管 node

`install_callback` / `upgrade_callback` 在线 `npm install` 时，同样定位 node 并加入 PATH，
同时设置 HOME 和限制内存（防 OOM）：

```bash
# 定位 nodejs_v24 并加入 PATH
NODE_DIR=""
for cand in /var/apps/nodejs_v24/target/bin "${APP_VOL}/@appcenter/nodejs_v24/bin"; do
    [ -x "$cand/node" ] && NODE_DIR="$cand" && break
done
export PATH="${NODE_DIR}:${PATH}"

# 低内存设备 (R2S 等 1GB) 防 OOM: 单线程编译 + 限制 node 堆内存
export npm_config_jobs=1
export NODE_OPTIONS="--max-old-space-size=512"

# HOME 改到数据区 (部分用户 /home/<user> 不存在导致 EACCES)
mkdir -p "${DATA_DIR}/.npm"
export HOME="${DATA_DIR}"

( cd "${APP_DIR}/server" && npm install @deepseek-ai/dsh@^0.1.0-rc.7 )
```

> **HOME 陷阱**：若用户主目录不存在（如 `/home/admin`），npm 写缓存会报 `EACCES`。
> 必须把 `HOME` 指到数据区可写目录。

---

## 6. 涉及文件

| 文件 | 说明 |
|------|------|
| `cmd/main` | 启动 dsh 时定位 node + 加入 PATH（自托管） |
| `cmd/install_callback` | 在线安装时定位 node + PATH/HOME/防OOM |
| `cmd/upgrade_callback` | 升级在线兜底（同上） |
| `manifest` | `install_dep_apps = nodejs_v24` 声明依赖 |

---

## 7. 常见问题排查

- **`node: No such file or directory`**：node 未加入 PATH。检查 `NODE_DIR` 定位是否成功
  （确认 `/var/apps/nodejs_v24/target/bin/node` 存在）。
- **`EACCES: /home/<user>`**：`HOME` 指向不存在目录。确认脚本把 `HOME` 设到数据区。
- **安装时系统卡死 / OOM**：低内存设备（1GB）编译原生模块内存不足。
  已通过 `NODE_OPTIONS=--max-old-space-size=512`、`npm_config_jobs=1` 缓解；
  必要时加 swap（`dd if=/dev/zero of=/vol*/swapfile bs=1M count=2048 && mkswap && swapon`）。
