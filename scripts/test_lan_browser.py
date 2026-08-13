#!/usr/bin/env python3
"""
Drive the headless Chrome (remote debugging on :9222) via CDP to load dsh over
the LAN IP (non-secure context) and capture console errors / page exceptions.
Goal: confirm "crypto.randomUUID is not a function" no longer fires and the UI loads.
"""
import json
import time
import requests
from websocket import create_connection

CDP = "http://127.0.0.1:9222"

# 1. Create a new tab (target)
resp = requests.put(f"{CDP}/json/new?http://192.168.31.31:28000/").json()
ws_url = resp["webSocketDebuggerUrl"]
tab_id = resp["id"]
print("new tab:", tab_id)

ws = create_connection(ws_url, timeout=30)
msg_id = 0
events = []

def send(method, params=None):
    global msg_id
    msg_id += 1
    ws.send(json.dumps({"id": msg_id, "method": method, "params": params or {}}))
    # read until matching id
    while True:
        data = json.loads(ws.recv())
        if data.get("id") == msg_id:
            return data

# Enable console + runtime + page
send("Runtime.enable")
send("Page.enable")
send("Log.enable")
send("Page.navigate", {"url": "http://192.168.31.31:28000/"})

console_errors = []
exceptions = []
log_errors = []
end = time.time() + 30
while time.time() < end:
    try:
        ws.settimeout(1)
        data = json.loads(ws.recv())
    except Exception:
        continue
    method = data.get("method")
    if method == "Runtime.consoleAPICalled":
        args = data["params"]["args"]
        txt = " ".join(a.get("value", "") if isinstance(a.get("value"), str) else json.dumps(a.get("value", a.get("description", ""))) for a in args)
        if data["params"]["type"] in ("error", "warning"):
            console_errors.append(txt)
    elif method == "Runtime.exceptionThrown":
        exc = data["params"]["exceptionDetails"]
        desc = exc.get("exception", {}).get("description", exc.get("text", ""))
        exceptions.append(desc)
    elif method == "Log.entryAdded":
        entry = data["params"]["entry"]
        if entry.get("level") in ("error", "warning"):
            log_errors.append(entry.get("text", ""))
    elif method == "Page.loadEventFired":
        print("loadEventFired")

# Evaluate state
res = send("Runtime.evaluate", {"expression": "JSON.stringify({url: location.href, title: document.title, hasRoot: !!document.querySelector('#root'), rootChildren: (document.querySelector('#root')||{}).childElementCount||0, cryptoRandomUUID: typeof crypto.randomUUID})", "returnByValue": True})
state = res["result"]["result"]["value"]
print("PAGE STATE:", state)

# Verify randomUUID is now defined (polyfill active)
res = send("Runtime.evaluate", {"expression": "(function(){ try { return 'uuid=' + crypto.randomUUID(); } catch(e){ return 'ERR=' + e.message; } })()", "returnByValue": True})
print("RANDOMUUID TEST:", res["result"]["result"]["value"])

print("\n=== CONSOLE ERRORS (%d) ===" % len(console_errors))
for e in console_errors:
    print(" -", e[:300])
print("=== EXCEPTIONS (%d) ===" % len(exceptions))
for e in exceptions:
    print(" -", e[:300])
print("=== LOG ERRORS (%d) ===" % len(log_errors))
for e in log_errors:
    print(" -", e[:300])

crypto_err = any("crypto.randomUUID is not a function" in (c+e+l) for c, e, l in
                 [(c, "", "") for c in console_errors] +
                 [("", e, "") for e in exceptions] +
                 [("", "", l) for l in log_errors])
print("\nCRYPTO_RANDOMUUID_ERROR_PRESENT:", crypto_err)

ws.close()
