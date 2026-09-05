#!/usr/bin/env python3
"""
Patch dsh settings frontend so plugin/model configuration works over non-loopback
(FN Connect domain) access.

Why:
  dsh's `dsh-client-ui-settings` frontend picks the settings persistence mode from
  whether the server connection is loopback:

      0.1.1-rc.2:  connection.isLoopback ? "host" : "memory"
      0.1.2-rc.1:  ctx.remote.$host.isLoopback ? "host" : "memory"

  - loopback  (127.0.0.1)      -> "host"   -> reads server settings  -> config OK
  - non-loopback (domain/remote)-> "memory" -> process-local only, settings RPC is
    loopback-only by design, so plugin/model config comes back empty (blank page).

  This patch pins the mode to "host" so non-loopback (FN Connect) access also reads
  server settings. NOTE: this lifts dsh's intentional loopback-only guard on config
  RPC; combine with FN Connect authentication / network access control.

  (0.1.2-rc.1 起 `dsh-client-ui-settings-models` 不再含该三元表达式, 无需补丁)

Usage:
  python3 patch_settings_memory.py [--dry-run] [TARGET_ROOT]
  TARGET_ROOT defaults to <script>/../app/server/node_modules/@deepseek-ai
  (install_callback passes <APP_DIR>/server/node_modules/@deepseek-ai)
"""
import glob
import os
import re
import sys

# 匹配任意接收者的 isLoopback 三元表达式 (connection. / ctx.remote.$host. / 未来变更),
# 整体替换为字面量 "host". 仅处理字面格式 (bundle 固定带空格), 不做激进正则.
TERNARY = re.compile(r'[\w.$]+\.isLoopback \? "host" : "memory"')
NEW = '"host"'

MARKER = "/* dsh-fnos: settings host-mode patch */"


def find_targets(root):
    """Return the client.js files that contain the loopback/memory ternary."""
    targets = []
    for pattern in (
        "dsh-client-ui-settings/lib/client.js",
        "dsh-client-ui-settings-models/lib/client.js",
    ):
        for path in glob.glob(os.path.join(root, pattern)):
            targets.append(path)
    return sorted(targets)


def main():
    args = sys.argv[1:]
    dry_run = "--dry-run" in args
    args = [a for a in args if a != "--dry-run"]
    if args:
        root = args[0]
    else:
        root = os.path.normpath(
            os.path.join(os.path.dirname(os.path.abspath(__file__)),
                         "..", "app", "server", "node_modules", "@deepseek-ai")
        )
    if not os.path.isdir(root):
        print(f"ERROR: target root not found: {root}")
        sys.exit(1)

    targets = find_targets(root)
    if not targets:
        print(f"ERROR: no settings client.js found under {root} (包结构变化?)")
        sys.exit(1)

    modified, skipped = [], []
    for path in targets:
        with open(path, "r", encoding="utf-8") as fh:
            content = fh.read()
        if MARKER in content:
            skipped.append(path)
            continue
        if not TERNARY.search(content):
            print(f"WARN: isLoopback ternary not found (上游已修复或改写?): {path}")
            skipped.append(path)
            continue
        new_content = TERNARY.sub(NEW, content)
        # Add a marker comment at the top so re-runs are idempotent.
        if new_content.startswith("window.__ModuleLoader__"):
            new_content = "/* dsh-fnos: settings host-mode patch */\n" + new_content
        if dry_run:
            modified.append(path)
            continue
        with open(path, "w", encoding="utf-8") as fh:
            fh.write(new_content)
        modified.append(path)

    print(f"scanned: {len(targets)}")
    print(f"patched: {len(modified)}")
    print(f"skipped: {len(skipped)}")
    for p in modified:
        print("  +", p)
    for p in skipped:
        print("  = (skipped)", p)
    # settings 主包必须命中, 否则 LAN 访问设置页空白
    if not modified and not any(MARKER in open(p, encoding="utf-8").read() for p in targets):
        sys.exit(1)


if __name__ == "__main__":
    main()
