#!/usr/bin/env python3
"""
Inject a crypto.randomUUID polyfill at the very beginning of every browser-side
dsh client.js file under app/server/node_modules/@deepseek-ai/*/lib/client.js.

Why:
  crypto.randomUUID() is only available in secure contexts. When dsh is accessed
  over a LAN IP (non-secure context, e.g. http://192.168.x.x:28000), the browser
  throws "crypto.randomUUID is not a function". We prepend a global polyfill so it
  is defined before any bundle code runs. The polyfill is idempotent (it only
  defines randomUUID when missing) and uses crypto.getRandomValues (available in
  non-secure contexts) for real v4 UUIDs, with a Math.random fallback.

Usage:
  python3 inject_randomuuid_polyfill.py [--dry-run]
"""
import glob
import os
import sys

POLYFILL = r"""/* dsh-fnos: crypto.randomUUID polyfill (non-secure context / LAN IP fix) */
(function () {
  var g = (typeof globalThis !== "undefined") ? globalThis : window;
  var c = g.crypto || (g.crypto = {});
  if (typeof c.randomUUID !== "function") {
    if (typeof c.getRandomValues === "function") {
      c.randomUUID = function () {
        var b = new Uint8Array(16);
        c.getRandomValues(b);
        b[6] = (b[6] & 0x0f) | 0x40; /* version 4 */
        b[8] = (b[8] & 0x3f) | 0x80; /* variant 10 */
        var hex = "";
        for (var i = 0; i < 16; i++) {
          hex += ("0" + b[i].toString(16)).slice(-2);
        }
        return hex.slice(0, 8) + "-" + hex.slice(8, 12) + "-" + hex.slice(12, 16) + "-" + hex.slice(16, 20) + "-" + hex.slice(20);
      };
    } else {
      c.randomUUID = function () {
        return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, function (ch) {
          var r = Math.random() * 16 | 0;
          var v = ch === "x" ? r : (r & 0x3 | 0x8);
          return v.toString(16);
        });
      };
    }
  }
})();
"""

MARKER = "/* dsh-fnos: crypto.randomUUID polyfill"


def target_files():
    root = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "app", "server", "node_modules", "@deepseek-ai")
    files = sorted(glob.glob(os.path.join(root, "*", "lib", "client.js")))
    return files


def main():
    dry_run = "--dry-run" in sys.argv
    files = target_files()
    modified, skipped = [], []
    for path in files:
        with open(path, "r", encoding="utf-8") as fh:
            content = fh.read()
        if MARKER in content[:500]:
            skipped.append(path)
            continue
        if not content.startswith("window.__ModuleLoader__.load"):
            print(f"WARN: unexpected header, still prepending: {path}")
        new_content = POLYFILL + "\n" + content
        if dry_run:
            modified.append(path)
            continue
        with open(path, "w", encoding="utf-8") as fh:
            fh.write(new_content)
        modified.append(path)

    print(f"files scanned: {len(files)}")
    print(f"injected:      {len(modified)}")
    print(f"skipped(dup):  {len(skipped)}")
    for p in modified:
        print("  +", os.path.relpath(p, os.path.join(os.path.dirname(os.path.abspath(__file__)), "..")))
    for p in skipped:
        print("  = (already injected)", os.path.relpath(p, os.path.join(os.path.dirname(os.path.abspath(__file__)), "..")))


if __name__ == "__main__":
    main()
