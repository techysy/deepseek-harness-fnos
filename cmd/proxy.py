#!/usr/bin/env python3
"""dsh fnOS 统一网关代理.

监听 Unix socket (${TRIM_APPDEST}/target/app.sock, 由 fnOS 统一网关转发),
把 HTTP/WebSocket 请求反向代理到 127.0.0.1:DSH_PORT (dsh web).

关键: dsh web 只绑 127.0.0.1 且拒绝 0.0.0.0 (安全: 防远程代码执行暴露).
经 fnOS 官方统一网关 /app/dsh → app.sock → 本代理 → 127.0.0.1:dsh 访问.

重写 Host 头为 127.0.0.1:DSH_PORT, 规避 dsh web 的 browser-trust fence
(它检查 Host 防 DNS rebinding; 只信任回环地址和 --trusted-host).
"""
import http.client
import os
import socket
import socketserver
import struct
import threading
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

DSH_PORT = int(os.environ.get("DSH_PORT", "18080"))
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
            conn = http.client.HTTPConnection(*BACKEND, timeout=30)
            # 重写 Host 头为回环地址 (规避 dsh browser-trust)
            body = None
            length = self.headers.get("Content-Length")
            if length and length.isdigit():
                body = self.rfile.read(int(length))
            headers = {k: v for k, v in self.headers.items() if k.lower() not in ("host", "connection")}
            headers["Host"] = f"127.0.0.1:{DSH_PORT}"
            conn.request(self.command, self.path, body=body, headers=headers)
            resp = conn.getresponse()
            # 转发状态行 + 响应头
            self.send_response(resp.status)
            for k, v in resp.getheaders():
                if k.lower() not in ("transfer-encoding", "connection", "content-length"):
                    self.send_header(k, v)
            # 若是 WebSocket 升级, 特殊处理
            if resp.status == 101 and resp.getheader("Upgrade", "").lower() == "websocket":
                self.end_headers()
                _relay(self.connection, resp.fp.raw._sock if hasattr(resp.fp.raw, "_sock") else resp.fp.raw)
                return
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
