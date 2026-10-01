#!/usr/bin/env python3
"""dsh fnOS 统一网关代理.

监听 Unix socket (${TRIM_APPDEST}/target/app.sock, 由 fnOS 统一网关转发),
把 HTTP/WebSocket 请求反向代理到 127.0.0.1:DSH_PORT (dsh web).

说明: dsh web 现经 cordis.patch.yml 覆盖 webserver 绑 0.0.0.0:DSH_PORT,
局域网/Tailscale 可直接访问 NAS_IP:DSH_PORT; 本代理是可选的第二条入口,
供经 fnOS 官方统一网关 /app/dsh → app.sock → 本代理 → 127.0.0.1:dsh 访问.

重写 Host 头为 127.0.0.1:DSH_PORT, 规避 dsh web 的 browser-trust fence
(它检查 Host 防 DNS rebinding; 只信任回环地址和 --trusted-host).
"""
import http.client
import os
import re
import socket
import socketserver
import struct
import threading
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

DSH_PORT = int(os.environ.get("DSH_PORT", "28000"))
SOCK_PATH = os.environ.get("SOCK_PATH", "/tmp/dsh_app.sock")
BACKEND = ("127.0.0.1", DSH_PORT)

# WebSocket 帧编解码 (stdlib 手写, 反向代理用 - 透传)
def _ws_encode(data, opcode=0x1):
    header = bytearray([0x80 | opcode])
    length = len(data)
    if length < 126:
        header.append(length)
    elif length < 65536:
        header.append(126)
        header += struct.pack(">H", length)
    else:
        header.append(127)
        header += struct.pack(">Q", length)
    return bytes(header) + data


def _ws_read_frame(sock):
    head = _recv_exact(sock, 2)
    if len(head) < 2:
        return None
    b1, b2 = head[0], head[1]
    opcode = b1 & 0x0F
    masked = b2 & 0x80
    length = b2 & 0x7F
    if length == 126:
        length = struct.unpack(">H", _recv_exact(sock, 2))[0]
    elif length == 127:
        length = struct.unpack(">Q", _recv_exact(sock, 8))[0]
    mask = _recv_exact(sock, 4) if masked else None
    payload = _recv_exact(sock, length)
    if mask and len(mask) == 4:
        payload = bytes(b ^ mask[i % 4] for i, b in enumerate(payload))
    return (opcode, payload)


def _recv_exact(sock, n):
    data = b""
    while len(data) < n:
        chunk = sock.recv(n - len(data))
        if not chunk:
            break
        data += chunk
    return data


def _relay(sock_a, sock_b):
    """双向透传原始字节流 (WebSocket 已升级后)."""
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
    t1 = threading.Thread(target=pump, args=(sock_a, sock_b), daemon=True)
    t2 = threading.Thread(target=pump, args=(sock_b, sock_a), daemon=True)
    t1.start(); t2.start()
    t1.join(); t2.join()


# 统一网关前缀 (fnOS 以 /app/dsh 暴露, 需重写 HTML 里的绝对资源路径, 否则浏览器请求 /assets 丢前缀 404 → 空白页)
GATEWAY_PREFIX = os.environ.get("GATEWAY_PREFIX", "/app/dsh")

# 重写 HTML body: 把绝对资源路径 (/assets, /plugins, /manifest, /favicon) 加上统一网关前缀
# 否则经 fnOS 统一网关 /app/dsh 访问时, 浏览器按绝对路径请求 /assets/... 丢失前缀 → 404 空白页
def _rebase_origin(url: str, loopback: str) -> str:
    """把 Origin/Referer 头里的 scheme://host 部分替换为回环地址 (保留路径).

    dsh fence 校验 Origin.host === Host.host; Host 已改写为 127.0.0.1:DSH_PORT,
    Origin 若仍是 https://外部域名 就会 mismatch → 403. 这里统一 rebasing.
    """
    m = re.match(r"^(https?://[^/]+)(/.*)?$", url, re.I)
    if not m:
        return url
    return loopback + (m.group(2) or "")


def _rewrite_html(data: bytes) -> bytes:
    try:
        text = data.decode("utf-8")
    except UnicodeDecodeError:
        return data
    text = text.replace(
        'src="/assets/', f'src="{GATEWAY_PREFIX}/assets/'
    ).replace(
        'href="/assets/', f'href="{GATEWAY_PREFIX}/assets/'
    ).replace(
        'href="/plugins/', f'href="{GATEWAY_PREFIX}/plugins/'
    ).replace(
        'src="/plugins/', f'src="{GATEWAY_PREFIX}/plugins/'
    ).replace(
        'href="/manifest.webmanifest', f'href="{GATEWAY_PREFIX}/manifest.webmanifest'
    ).replace(
        'href="/favicon', f'href="{GATEWAY_PREFIX}/favicon'
    )
    # 注入 crypto.randomUUID polyfill (fnOS iframe 非安全上下文, 该 API 不可用)
    if text.startswith("<!doctype html") and "crypto.randomUUID" not in text:
        polyfill = (
            '<script>'
            'if(!crypto.randomUUID){'
            'crypto.randomUUID=function(){'
            'return"xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g,function(c){'
            'var r=Math.random()*16|0,v=c==="x"?r:(r&0x3|0x8);return v.toString(16);});};}'
            '</script>'
        )
        text = text.replace("<head>", f"<head>{polyfill}", 1)
    # 注入 <base> 兜底 (相对路径)
    if text.startswith("<!doctype html") and "<base" not in text:
        text = text.replace(
            "<head>",
            f"<head><base href=\"{GATEWAY_PREFIX}/\">", 1
        )
    return text.encode("utf-8")


class Handler(BaseHTTPRequestHandler):
    protocol_version = "HTTP/1.1"

    def _proxy(self):
        """把请求转发到后端 127.0.0.1:DSH_PORT."""
        try:
            path = self.path
            if path == GATEWAY_PREFIX:
                path = "/"
            elif path.startswith(GATEWAY_PREFIX + "/"):
                path = path[len(GATEWAY_PREFIX):]
            # WebSocket 升级请求走原始 socket 直通: http.client 对 101 的处理
            # 不可靠, 且必须保留 Connection: Upgrade / Upgrade 头才能让 Node 后端
            # 进入升级分支 (此前 Connection 被剥掉 → dsh 当普通 GET 回 404)
            if (self.headers.get("Upgrade") or "").lower() == "websocket":
                return self._ws_proxy(path)
            conn = http.client.HTTPConnection(*BACKEND, timeout=30)
            # 重写 Host 头为回环地址 (规避 dsh browser-trust fence);
            # Origin/Referer 同步改写 — dsh 的 isTrustedApiRequest 要求 Origin.host
            # 与 Host 一致, 否则经网关的 POST (带 Origin) 会被 fence 403.
            body = None
            length = self.headers.get("Content-Length")
            if length and length.isdigit():
                body = self.rfile.read(int(length))
            headers = {k: v for k, v in self.headers.items() if k.lower() not in ("host", "connection")}
            headers["Host"] = f"127.0.0.1:{DSH_PORT}"
            loopback = f"http://127.0.0.1:{DSH_PORT}"
            for h in ("Origin", "Referer"):
                v = headers.get(h)
                if v:
                    headers[h] = _rebase_origin(v, loopback)
            conn.request(self.command, path, body=body, headers=headers)
            resp = conn.getresponse()
            # 转发状态行 + 响应头
            self.send_response(resp.status)
            for k, v in resp.getheaders():
                if k.lower() not in ("transfer-encoding", "connection", "content-length"):
                    self.send_header(k, v)
            # 常规响应: 转发 body
            data = resp.read()
            # 若是 HTML, 重写绝对资源路径 (加统一网关前缀), 避免空白页
            ctype = resp.getheader("Content-Type", "").lower()
            if "text/html" in ctype:
                data = _rewrite_html(data)
            self.send_header("Content-Length", str(len(data)))
            self.end_headers()
            self.wfile.write(data)
            conn.close()
        except Exception as e:
            try:
                self.send_response(502)
                self.send_header("Content-Type", "text/plain")
                self.end_headers()
                self.wfile.write(str(e).encode())
            except Exception:
                pass

    def _ws_proxy(self, path):
        """WebSocket 升级请求: 原始 socket 直通后端, 不经 http.client.

        手工组转发请求 (剥网关前缀, Host 改写回环, Connection/Upgrade 原样保留),
        透传后端 101 响应后进入双向字节流中继; 非 101 (如 404) 原样转发给客户端.
        """
        backend = None
        try:
            backend = socket.create_connection(BACKEND, timeout=30)
            lines = [f"{self.command} {path} HTTP/1.1"]
            loopback = f"http://127.0.0.1:{DSH_PORT}"
            for k, v in self.headers.items():
                if k.lower() in ("host", "connection", "upgrade", "content-length"):
                    continue
                if k.lower() in ("origin", "referer"):
                    v = _rebase_origin(v, loopback)
                lines.append(f"{k}: {v}")
            lines.append(f"Host: 127.0.0.1:{DSH_PORT}")
            lines.append("Connection: Upgrade")
            lines.append(f"Upgrade: {self.headers.get('Upgrade')}")
            backend.sendall(("\r\n".join(lines) + "\r\n\r\n").encode("latin1"))
            # 读后端响应头 (逐字节兜底, 不多读 body)
            buf = b""
            while b"\r\n\r\n" not in buf:
                chunk = backend.recv(4096)
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
                _relay(self.connection, backend)
            else:
                if rest:
                    self.wfile.write(rest)
        except Exception as e:
            try:
                self.send_response(502)
                self.send_header("Content-Type", "text/plain")
                self.end_headers()
                self.wfile.write(str(e).encode())
            except Exception:
                pass
        finally:
            try:
                if backend and code != 101:
                    backend.close()
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


def main():
    if os.path.exists(SOCK_PATH):
        os.remove(SOCK_PATH)
    server = UnixServer(SOCK_PATH, Handler)
    print(f"dsh proxy: {SOCK_PATH} -> 127.0.0.1:{DSH_PORT}")
    server.serve_forever()


if __name__ == "__main__":
    main()
