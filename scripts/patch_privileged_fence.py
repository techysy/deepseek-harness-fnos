#!/usr/bin/env python3
"""patch_privileged_fence.py — 放宽 dsh 特权 API (/api/settings.* 等) 的回环钉扎

根因: dsh-client-connection 对 PRIVILEGED_METHODS 硬编码 isTrustedApiRequest(request, []),
只信任回环 Host。局域网直接访问 NAS_IP:28000 时 API 全 403
("transport failure for /api/settings.describe: HTTP 403")。

修复: 让特权 API 的 fence 使用部署的 trustedHosts 列表 (CLI --trusted-host 传入的
LAN IP / FN Connect 域名), 而非空列表。幂等, 可重复执行。

用法: python3 patch_privileged_fence.py <node_modules>/@deepseek-ai/dsh-client-connection/lib/index.js
"""
import sys
import os

TARGET_PATTERN = os.path.join(
    "node_modules", "@deepseek-ai", "dsh-client-connection", "lib", "index.js"
)


def patch_file(path: str) -> bool:
    with open(path, "r", encoding="utf-8") as f:
        s = f.read()
    changed = False

    # 1. PRIVILEGED_METHODS fence: [] -> trustedHosts (核心修复)
    old1 = "PRIVILEGED_METHODS.has(method) && !isTrustedApiRequest(request, []))"
    new1 = "PRIVILEGED_METHODS.has(method) && !isTrustedApiRequest(request, trustedHosts))"
    if old1 in s and new1 not in s:
        s = s.replace(old1, new1)
        changed = True

    # 2. interceptor loopback fence: [] -> this.trustedHosts
    old2 = 'if (interceptor.options.authority === "loopback" && !isTrustedApiRequest(request, []))'
    new2 = 'if (interceptor.options.authority === "loopback" && !isTrustedApiRequest(request, this.trustedHosts))'
    if old2 in s and new2 not in s:
        s = s.replace(old2, new2)
        changed = True

    # 3. register() loopback authority: [] -> this.trustedHosts
    old3 = "const trustedHosts = options.authority === \"loopback\" ? [] : this.trustedHosts;"
    new3 = "const trustedHosts = this.trustedHosts;"
    if old3 in s and new3 not in s:
        s = s.replace(old3, new3)
        changed = True

    if changed:
        with open(path, "w", encoding="utf-8") as f:
            f.write(s)
    return changed


def main() -> None:
    if len(sys.argv) > 1:
        # 直接指定文件
        target = sys.argv[1]
    else:
        # 从当前目录查找
        base = os.path.dirname(os.path.abspath(__file__))
        target = os.path.join(base, TARGET_PATTERN)
    if not os.path.isfile(target):
        print(f"target not found: {target}")
        sys.exit(1)
    changed = patch_file(target)
    print(f"{'patched' if changed else 'already patched (idempotent)'}: {target}")


if __name__ == "__main__":
    main()
