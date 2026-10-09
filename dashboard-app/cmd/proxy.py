#!/usr/bin/env python3
"""DSH 管理面板网关代理.

双向监听:
  1. fnOS 统一网关 Unix domain socket (${TRIM_APPDEST}/target/app.sock)
  2. 本地 TCP 端口 (默认 28003)

将请求转发至目标 DSH 管理面板 (默认 127.0.0.1:28001).
对于经过统一网关 /app/dsh-dashboard 的请求:
  1. 剥除请求路径中的 GATEWAY_PREFIX 前缀 (/app/dsh-dashboard)
  2. 重写 Host 头为目标地址 (127.0.0.1:28001), 顺利通过管理面板的本地信任围栏
  3. 当响应为 HTML 时, 重写内部的绝对 API 与资源引用, 补齐网关前缀
"""
import http.client
import os
import re
import socket
import struct
import threading
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer


LISTEN_PORT = int(os.environ.get("LISTEN_PORT", "28003"))
GATEWAY_PREFIX = os.environ.get("GATEWAY_PREFIX", "/app/dsh-dashboard")


def _resolve_conf_dir():
    candidates = []
    env_dir = os.environ.get("CONF_DIR", "").strip()
    if env_dir:
        candidates.append(env_dir)
    pkgvar = os.environ.get("TRIM_PKGVAR", "").strip()
    if pkgvar:
        candidates.append(pkgvar)
    app_name = os.environ.get("TRIM_APPNAME", "dsh-dashboard")
    if app_name:
        import glob
        for vol in glob.glob("/vol*/@appdata/" + app_name):
            candidates.append(vol)
        candidates.append(f"/vol1/@appdata/{app_name}")
        candidates.append(f"/vol4/@appdata/{app_name}")
    candidates.append(os.getcwd())
    candidates.append("/tmp/dsh-dashboard")

    for cand in candidates:
        conf = os.path.join(cand, "dashboard.conf")
        if os.path.isfile(conf):
            return cand
    for cand in candidates:
        if cand and os.path.isdir(cand):
            return cand
    return "/tmp/dsh-dashboard"


CONF_DIR = _resolve_conf_dir()
_CONF_FILE = os.path.join(CONF_DIR, "dashboard.conf")


def _load_target():
    ip, port = "127.0.0.1", 28001
    try:
        if os.path.isfile(_CONF_FILE):
            with open(_CONF_FILE, encoding="utf-8") as f:
                for line in f:
                    line = line.strip()
                    if line.startswith("TARGET_IP="):
                        v = line.split("=", 1)[1].strip()
                        if v:
                            ip = v
                    elif line.startswith("TARGET_PORT="):
                        v = line.split("=", 1)[1].strip()
                        if v.isdigit():
                            port = int(v)
    except OSError:
        pass
    return (ip, port)


def _resolve_sock_path():
    env_sock = os.environ.get("SOCK_PATH", "").strip()
    if env_sock:
        return env_sock
    app_dest = os.environ.get("TRIM_APPDEST", "").strip()
    if app_dest:
        return os.path.join(app_dest, "target", "app.sock")
    app_name = os.environ.get("TRIM_APPNAME", "dsh-dashboard")
    cand = f"/var/apps/{app_name}/target/app.sock"
    if os.path.isdir(os.path.dirname(cand)):
        return cand
    return os.path.join(CONF_DIR, "app.sock")


def _rebase_origin(url: str, loopback: str) -> str:
    m = re.match(r"^(https?://[^/]+)(/.*)?$", url, re.I)
    if not m:
        return url
    return loopback + (m.group(2) or "")


def _rewrite_html(data: bytes, prefix: str) -> bytes:
    try:
        text = data.decode("utf-8")
    except UnicodeDecodeError:
        return data

    # 替换绝对 API 路径与资源路径
    text = text.replace('"/api/', f'"{prefix}/api/')
    text = text.replace("'/api/", f"'{prefix}/api/")
    text = text.replace('src="/logo.png"', f'src="{prefix}/logo.png"')
    text = text.replace('href="/favicon', f'href="{prefix}/favicon')

    # 注入 <base> 标签以防万一
    if "<head>" in text and f'<base href="{prefix}/">' not in text:
        text = text.replace("<head>", f'<head><base href="{prefix}/">', 1)

    return text.encode("utf-8")


def _relay(sock_a, sock_b):
    def pump(src, dst):
        try:
            while True:
                data = src.recv(65536)
                if not data:
                    break
                dst.sendall(data)
        except Exception:
            pass
        finally:
            try:
                dst.shutdown(socket.SHUT_WR)
            except Exception:
                pass
            try:
                src.close()
            except Exception:
                pass

    t1 = threading.Thread(target=pump, args=(sock_a, sock_b), daemon=True)
    t2 = threading.Thread(target=pump, args=(sock_b, sock_a), daemon=True)
    t1.start()
    t2.start()
    t1.join()
    t2.join()
    for s in (sock_a, sock_b):
        try:
            s.close()
        except Exception:
            pass


class ProxyHandler(BaseHTTPRequestHandler):
    protocol_version = "HTTP/1.1"

    def _proxy(self):
        backend = _load_target()
        path = self.path
        is_gateway = False

        if path == GATEWAY_PREFIX:
            path = "/"
            is_gateway = True
        elif path.startswith(GATEWAY_PREFIX + "/"):
            path = path[len(GATEWAY_PREFIX):]
            is_gateway = True
        elif path.startswith(GATEWAY_PREFIX):
            path = path[len(GATEWAY_PREFIX):] or "/"
            is_gateway = True

        if not path.startswith("/"):
            path = "/" + path

        if (self.headers.get("Upgrade") or "").lower() == "websocket":
            return self._ws_proxy(path, backend)

        conn = None
        try:
            conn = http.client.HTTPConnection(backend[0], backend[1], timeout=30)
            body = None
            length = self.headers.get("Content-Length")
            if length and length.isdigit():
                body = self.rfile.read(int(length))

            headers = {
                k: v for k, v in self.headers.items()
                if k.lower() not in ("host", "connection", "accept-encoding")
            }
            # 始终将 Host 头重写为目标服务地址, 规避管理面板的 403 信任围栏拦截
            headers["Host"] = f"{backend[0]}:{backend[1]}"
            loopback = f"http://{backend[0]}:{backend[1]}"
            for h in ("Origin", "Referer"):
                v = headers.get(h)
                if v:
                    headers[h] = _rebase_origin(v, loopback)

            conn.request(self.command, path, body=body, headers=headers)
            resp = conn.getresponse()

            self.send_response(resp.status)
            for k, v in resp.getheaders():
                if k.lower() not in ("transfer-encoding", "connection", "content-length"):
                    self.send_header(k, v)

            data = resp.read()
            ctype = resp.getheader("Content-Type", "").lower()
            if "text/html" in ctype and is_gateway:
                data = _rewrite_html(data, GATEWAY_PREFIX)

            self.send_header("Content-Length", str(len(data)))
            self.end_headers()
            self.wfile.write(data)
        except Exception as e:
            try:
                self.send_response(502)
                self.send_header("Content-Type", "text/plain; charset=utf-8")
                self.end_headers()
                self.wfile.write(f"Bad Gateway: {e}".encode("utf-8"))
            except Exception:
                pass
        finally:
            if conn:
                try:
                    conn.close()
                except Exception:
                    pass

    def _ws_proxy(self, path, backend):
        backend_sock = None
        code = 502
        try:
            backend_sock = socket.create_connection(backend, timeout=30)
            lines = [f"{self.command} {path} HTTP/1.1"]
            loopback = f"http://{backend[0]}:{backend[1]}"
            for k, v in self.headers.items():
                if k.lower() in ("host", "connection", "upgrade", "content-length"):
                    continue
                if k.lower() in ("origin", "referer"):
                    v = _rebase_origin(v, loopback)
                lines.append(f"{k}: {v}")
            lines.append(f"Host: {backend[0]}:{backend[1]}")
            lines.append("Connection: Upgrade")
            lines.append(f"Upgrade: {self.headers.get('Upgrade')}")
            backend_sock.sendall(("\r\n".join(lines) + "\r\n\r\n").encode("latin1"))

            buf = b""
            while b"\r\n\r\n" not in buf:
                chunk = backend_sock.recv(4096)
                if not chunk:
                    break
                buf += chunk
            head, _, rest = buf.partition(b"\r\n\r\n")
            head_lines = head.split(b"\r\n")
            status_line = head_lines[0].decode("latin1")
            parts = status_line.split(" ", 2)
            code = int(parts[1]) if len(parts) > 1 and parts[1].isdigit() else 502
            self.send_response(code, parts[2] if len(parts) > 2 else "")
            for h in head_lines[1:]:
                k, _, v = h.partition(b":")
                self.send_header(k.decode("latin1").strip(), v.decode("latin1").strip())
            self.end_headers()

            if code == 101:
                if rest:
                    self.wfile.write(rest)
                self.close_connection = True
                _relay(self.connection, backend_sock)
            else:
                if rest:
                    self.wfile.write(rest)
        except Exception as e:
            try:
                self.send_response(502)
                self.send_header("Content-Type", "text/plain; charset=utf-8")
                self.end_headers()
                self.wfile.write(f"WebSocket Proxy Error: {e}".encode("utf-8"))
            except Exception:
                pass
        finally:
            if backend_sock and code != 101:
                try:
                    backend_sock.close()
                except Exception:
                    pass

    def do_GET(self):  # noqa: N802
        self._proxy()

    def do_POST(self):  # noqa: N802
        self._proxy()

    def do_PUT(self):  # noqa: N802
        self._proxy()

    def do_DELETE(self):  # noqa: N802
        self._proxy()

    def do_OPTIONS(self):  # noqa: N802
        self._proxy()

    def do_HEAD(self):  # noqa: N802
        self._proxy()

    def log_message(self, *args):
        pass


class UnixServer(ThreadingHTTPServer):
    address_family = socket.AF_UNIX
    allow_reuse_address = True


def _bind_unix(sock_path):
    """绑定统一网关 socket; 开机阶段目录/文件系统可能尚未就绪, 带退避重试."""
    import time
    last_err = None
    for attempt in range(4):
        try:
            parent_dir = os.path.dirname(sock_path)
            if not os.path.exists(parent_dir):
                os.makedirs(parent_dir, exist_ok=True)
            if os.path.exists(sock_path):
                try:
                    os.unlink(sock_path)
                except OSError as e:
                    # 陈旧 socket 属主是别的账号时 unlink 会 EACCES/EPERM;
                    # 记录后继续尝试绑定
                    last_err = e
            unix_server = UnixServer(sock_path, ProxyHandler)
            try:
                os.chmod(sock_path, 0o660)
            except OSError:
                pass
            return unix_server, last_err
        except Exception as e:
            last_err = e
            time.sleep(1 + attempt)
    raise RuntimeError(f"bind unix socket failed: {last_err}")


def main():
    servers = []

    # 1. 先绑定 fnOS 统一网关 app.sock — 桌面窗口的唯一入口.
    #    网关连不上 app.sock 时由 fnOS 直接回 "Bad Gateway", 因此 sock 绑定
    #    失败必须视为致命 (TCP 端口通着也没用), 非 0 退出让 cmd/main 重启重试.
    sock_path = _resolve_sock_path()
    if sock_path:
        try:
            unix_server, warn = _bind_unix(sock_path)
            if warn:
                print(f"[proxy] NOTE: stale socket cleanup warning: {warn}", flush=True)
            servers.append((unix_server, f"unix:{sock_path}"))
        except Exception as e:
            print(f"[proxy] FATAL: failed to bind unix socket {sock_path}: {e}", flush=True)
            raise SystemExit(1)

    # 2. 监听 TCP 端口 (局域网直连的次要入口, 失败不致命)
    try:
        tcp_server = ThreadingHTTPServer(("0.0.0.0", LISTEN_PORT), ProxyHandler)
        servers.append((tcp_server, f"0.0.0.0:{LISTEN_PORT}"))
    except Exception as e:
        print(f"[proxy] WARN: failed to bind TCP port {LISTEN_PORT}: {e}", flush=True)

    if not servers:
        # 无任何可监听端点: 非 0 退出, 让 cmd/main 的健康检查触发重启重试,
        # 避免"进程活着但哪儿都不通"的僵尸状态骗过 pid 判活
        print("[proxy] FATAL: no listen endpoint available, exiting", flush=True)
        raise SystemExit(1)

    target_ip, target_port = _load_target()
    endpoints = " + ".join([lbl for _, lbl in servers])
    print(
        f"[dsh-dashboard proxy] listening on [{endpoints}] -> {target_ip}:{target_port} (conf={_CONF_FILE})",
        flush=True,
    )

    threads = []
    for srv, lbl in servers:
        t = threading.Thread(target=srv.serve_forever, daemon=True)
        t.start()
        threads.append(t)

    for t in threads:
        t.join()


if __name__ == "__main__":
    main()
