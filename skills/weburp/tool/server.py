#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Web Repeater 本地后端（见 SPEC.md §五）。stdlib 为主，h2 可选（HTTP/2）。"""

import argparse
import os
from weburp_paths import state_dir
import base64
import json
import re
import secrets
import socket
import ssl
import time
from datetime import datetime, timezone
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import urlparse, parse_qs

try:
    import h2.connection
    import h2.events
    H2_OK = True
except Exception:
    H2_OK = False

BASE = Path(__file__).resolve().parent
STATIC = BASE / "static"
EVIDENCE = state_dir()
ID_RE = re.compile(r"^[A-Za-z0-9_-]+$")
HDR_CAP = 64 * 1024
HISTORY_CAP = 50

TOKEN = ""  # main() 里赋值


def log(msg):
    print(f"[{datetime.now().strftime('%H:%M:%S')}] {msg}", flush=True)


def now_iso():
    return datetime.now(timezone.utc).isoformat(timespec="seconds")


# ---------------- 场景存储 ----------------

def scene_path(sid):
    if not sid or not ID_RE.match(sid):
        return None
    return EVIDENCE / f"{sid}.json"


def save_scene(data):
    sid = data.get("id")
    if not sid:
        sid = ("t-" if data.get("type") == "terminal" else "r-") + secrets.token_hex(3)
        data["id"] = sid
    if not ID_RE.match(sid):
        raise ValueError("非法场景 id")
    data.setdefault("created", now_iso())
    p = scene_path(sid)
    p.write_text(json.dumps(data, ensure_ascii=False, indent=2), encoding="utf-8")
    return sid


def load_scene(sid):
    p = scene_path(sid)
    if not p or not p.is_file():
        return None
    try:
        return json.loads(p.read_text(encoding="utf-8"))
    except Exception:
        return None


# ---------------- HTTP/1.x 读取辅助 ----------------

class WireReader:
    """带缓冲的 socket 读取器，保证响应头/body 分界不丢字节。"""

    def __init__(self, sock):
        self.sock = sock
        self.buf = bytearray()

    def fill(self, n=1):
        """保证 buf 至少 n 字节；EOF 返回 False。"""
        while len(self.buf) < n:
            chunk = self.sock.recv(65536)
            if not chunk:
                return False
            self.buf += chunk
        return True

    def read_head(self):
        """读到 \\r\\n\\r\\n 为止（上限 64KB），返回 head（含分隔符），多读的字节留在 buf。"""
        while True:
            i = self.buf.find(b"\r\n\r\n")
            if i >= 0:
                head = bytes(self.buf[: i + 4])
                del self.buf[: i + 4]
                return head
            if len(self.buf) > HDR_CAP:
                raise ValueError("响应头超过 64KB 上限")
            chunk = self.sock.recv(65536)
            if not chunk:
                raise ValueError("连接在响应头读完前关闭")
            self.buf += chunk

    def read_line(self):
        while True:
            i = self.buf.find(b"\r\n")
            if i >= 0:
                line = bytes(self.buf[: i + 2])
                del self.buf[: i + 2]
                return line
            if not self.fill():
                raise ValueError("连接意外关闭")

    def take(self, n):
        """精确取 n 字节。"""
        if not self.fill(n):
            raise ValueError("连接意外关闭")
        out = bytes(self.buf[:n])
        del self.buf[:n]
        return out

    def read_to_eof(self):
        out = bytes(self.buf)
        self.buf.clear()
        while True:
            try:
                chunk = self.sock.recv(65536)
            except socket.timeout:
                break  # keep-alive 下读不到 EOF 时按已有数据收尾
            if not chunk:
                break
            out += chunk
        return out


def parse_head(head_bytes):
    """解析状态行/请求行 + 头，返回 (首行str, [(k,v)...], {lower_k: v})。"""
    text = head_bytes.decode("latin-1")
    lines = text.split("\r\n")
    items = []
    for line in lines[1:]:
        if not line or ":" not in line:
            continue
        k, v = line.split(":", 1)
        items.append((k.strip(), v.strip()))
    return lines[0], items, {k.lower(): v for k, v in items}


def fix_content_length(raw):
    """有 body 且存在 Content-Length 头时，按实际 body 字节数重写该头的值。"""
    i = raw.find(b"\r\n\r\n")
    if i < 0:
        return raw
    head, body = raw[:i], raw[i + 4:]
    if not body:
        return raw
    lines = head.split(b"\r\n")
    for n, line in enumerate(lines):
        if line.lower().startswith(b"content-length:"):
            lines[n] = line.split(b":", 1)[0] + b": " + str(len(body)).encode()
            return b"\r\n".join(lines) + b"\r\n\r\n" + body
    return raw


# ---------------- 发包引擎 ----------------

def resolve_target(params, headers):
    """目标解析：显式 target > Host 头(可带端口)；tls 缺省 target.tls，否则端口 443→true。"""
    target = params.get("target") or {}
    host_h = headers.get("host", "")
    hh, hp = host_h, None
    if hh.startswith("[") and "]" in hh:  # [::1]:80
        end = hh.index("]")
        hh, rest = hh[1:end], hh[end + 1:]
        if rest.startswith(":") and rest[1:].isdigit():
            hp = int(rest[1:])
    elif ":" in hh:
        maybe_h, maybe_p = hh.rsplit(":", 1)
        if maybe_p.isdigit():
            hh, hp = maybe_h, int(maybe_p)
    host = target.get("host") or hh
    if not host:
        raise ValueError("无法确定目标主机（缺 target 且无 Host 头）")
    tls_ov = params.get("tls")
    if tls_ov is not None:
        tls = bool(tls_ov)
    elif target.get("tls") is not None:
        tls = bool(target.get("tls"))
    else:
        p = target.get("port") or hp
        tls = (p == 443)
    port = target.get("port") or hp or (443 if tls else 80)
    return host, int(port), tls


def upstream_proxy_url(environ=None):
    env = os.environ if environ is None else environ
    raw = (env.get("WEBURP_UPSTREAM_PROXY") or "").strip()
    if raw.startswith("http://127.0.0.1:") or raw.startswith("http://localhost:"):
        parsed = urlparse(raw)
        if parsed.hostname and parsed.port:
            return parsed
    return None


def connect_via_http_proxy(proxy_host, proxy_port, host, port, timeout):
    sock = socket.create_connection((proxy_host, int(proxy_port)), timeout=timeout)
    sock.settimeout(timeout)
    target = "%s:%d" % (host, int(port))
    sock.sendall(("CONNECT %s HTTP/1.1\r\nHost: %s\r\n\r\n" % (target, target)).encode("ascii"))
    buf = b""
    while b"\r\n\r\n" not in buf and len(buf) < 8192:
        chunk = sock.recv(1024)
        if not chunk:
            raise OSError("upstream proxy closed during CONNECT")
        buf += chunk
    status = buf.split(b"\r\n", 1)[0]
    if b" 200 " not in status:
        raise OSError("upstream proxy CONNECT failed via=proxy status=%s" % status.decode("latin-1", "replace")[:80])
    return sock


def open_socket(host, port, tls, sni, http2, timeout):
    proxy = upstream_proxy_url()
    loopback = host in ("127.0.0.1", "localhost", "::1")
    if proxy and not loopback:
        sock = connect_via_http_proxy(proxy.hostname, proxy.port, host, port, timeout)
    else:
        sock = socket.create_connection((host, port), timeout=timeout)
    sock.settimeout(timeout)
    alpn = None
    if tls:
        ctx = ssl.create_default_context()
        ctx.check_hostname = False
        ctx.verify_mode = ssl.CERT_NONE
        protos = ["http/1.1"] if (http2 == "never" or not H2_OK) else ["h2", "http/1.1"]
        ctx.set_alpn_protocols(protos)
        sock = ctx.wrap_socket(sock, server_hostname=sni or host)
        alpn = sock.selected_alpn_protocol()
    return sock, alpn


def send_http1(sock, raw, is_ws):
    sock.sendall(raw)
    rd = WireReader(sock)
    head = rd.read_head()
    status_line, _, headers = parse_head(head)

    m = re.match(r"HTTP/\S+\s+(\d+)", status_line)
    status = int(m.group(1)) if m else 0
    # WebSocket 握手成功 / 无 body 状态码：到头部为止
    if (is_ws and status == 101) or status < 200 or status in (204, 304):
        return head, status

    body = bytearray()
    te = headers.get("transfer-encoding", "").lower()
    cl = headers.get("content-length", "")
    if "chunked" in te:
        while True:
            line = rd.read_line()
            body += line
            size = int(line.strip().split(b";", 1)[0], 16)
            if size == 0:
                while True:  # trailer 直到空行
                    t = rd.read_line()
                    body += t
                    if t == b"\r\n":
                        break
                break
            body += rd.take(size + 2)  # 数据 + CRLF
    elif cl.isdigit():
        body += rd.take(int(cl))
    else:  # Connection: close 语义，读到 EOF
        body += rd.read_to_eof()
    return head + bytes(body), status


def _hb(x):
    """h2 事件里的 header 名/值兼容 str/bytes，统一成 bytes。"""
    return x if isinstance(x, bytes) else x.encode("utf-8", "surrogateescape")


def send_http2(sock, raw, tls):
    i = raw.find(b"\r\n\r\n")
    head, body = (raw[:i], raw[i + 4:]) if i >= 0 else (raw, b"")
    req_line, items, headers = parse_head(head + b"\r\n\r\n")
    parts = req_line.split()
    method, path = parts[0], parts[1] if len(parts) > 1 else "/"
    authority = headers.get("host", "")
    if path.startswith("http://") or path.startswith("https://"):  # absolute-form
        u = urlparse(path)
        authority = authority or u.netloc
        path = u.path or "/"
        if u.query:
            path += "?" + u.query
    skip = {"host", "connection", "keep-alive", "proxy-connection", "transfer-encoding", "upgrade"}
    h2_headers = [
        (":method", method),
        (":scheme", "https" if tls else "http"),
        (":authority", authority),
        (":path", path),
    ] + [(k.lower(), v) for k, v in items if k.lower() not in skip]

    conn = h2.connection.H2Connection()
    conn.initiate_connection()
    sock.sendall(conn.data_to_send())
    conn.send_headers(1, h2_headers, end_stream=not body)
    if body:
        conn.send_data(1, body, end_stream=True)
    sock.sendall(conn.data_to_send())

    status, resp_headers, resp_body = 0, [], bytearray()
    ended = False
    while not ended:
        data = sock.recv(65536)
        if not data:
            break
        for ev in conn.receive_data(data):
            if isinstance(ev, h2.events.ResponseReceived):
                for k, v in ev.headers:
                    if _hb(k) == b":status":
                        status = int(_hb(v))
                    else:
                        resp_headers.append((_hb(k), _hb(v)))
            elif isinstance(ev, h2.events.DataReceived):
                resp_body += ev.data
                conn.acknowledge_received_data(ev.flow_controlled_length, ev.stream_id)
            elif isinstance(ev, (h2.events.StreamEnded, h2.events.ConnectionTerminated)):
                ended = True
        out = conn.data_to_send()
        if out:
            sock.sendall(out)
    text = b"".join(k + b": " + v + b"\r\n" for k, v in resp_headers)
    return f"HTTP/2 {status}\r\n".encode() + text + b"\r\n" + bytes(resp_body), status


CN_ERR = [
    (socket.gaierror, "DNS 解析失败"),
    (ConnectionRefusedError, "连接被拒绝"),
    (socket.timeout, "连接或读取超时"),
    (TimeoutError, "连接或读取超时"),
    (ssl.SSLError, "TLS 错误"),
]


def do_send(params):
    """执行一次发包，返回 /api/send 的响应 dict。"""
    if "request_b64" in params and params["request_b64"] is not None:
        raw = base64.b64decode(params["request_b64"])
    else:
        raw = (params.get("request") or "").encode("utf-8")
    if not raw:
        return {"ok": False, "error": "请求内容为空"}
    if params.get("update_content_length", True):
        raw = fix_content_length(raw)

    http2 = params.get("http2") or "auto"
    timeout = float(params.get("timeout") or 30)
    if http2 == "force" and not H2_OK:
        return {"ok": False, "error": "http2=force 但 h2 库不可用"}

    _, items, headers = parse_head(raw[: raw.find(b"\r\n\r\n") + 4] if b"\r\n\r\n" in raw else raw + b"\r\n\r\n")
    is_ws = headers.get("upgrade", "").lower() == "websocket"

    try:
        host, port, tls = resolve_target(params, headers)
    except ValueError as e:
        return {"ok": False, "error": str(e)}
    sni = (params.get("target") or {}).get("host") or headers.get("host", "").split(":")[0].strip("[]")

    sock = None
    t0 = time.perf_counter()
    try:
        sock, alpn = open_socket(host, port, tls, sni, http2, timeout)
        use_h2 = H2_OK and (http2 == "force" or (alpn == "h2" and http2 != "never"))
        if use_h2:
            resp, status = send_http2(sock, raw, tls)
            ver = "2"
        else:
            resp, status = send_http1(sock, raw, is_ws)
            m = re.match(rb"HTTP/(\d+(?:\.\d+)?)", resp)
            ver = m.group(1).decode() if m else "1.1"
        elapsed = round((time.perf_counter() - t0) * 1000)
        peer = f"{sock.getpeername()[0]}:{sock.getpeername()[1]}"
        log(f"发送 → {host}:{port} tls={tls} {len(raw)}B → HTTP/{ver} {status} {elapsed}ms")
        return {
            "ok": True,
            "response_b64": base64.b64encode(resp).decode(),
            "http_version": ver,
            "elapsed_ms": elapsed,
            "peer": peer,
            "error": None,
        }
    except Exception as e:
        elapsed = round((time.perf_counter() - t0) * 1000)
        cn = next((c for t, c in CN_ERR if isinstance(e, t)), "发送失败")
        via = "direct" if host in ("127.0.0.1", "localhost", "::1") or not upstream_proxy_url() else "proxy"
        log(f"发送 → {host}:{port} tls={tls} {len(raw)}B → 错误({cn}) {elapsed}ms via={via}")
        return {"ok": False, "error": f"{cn}: {e} via={via}"}
    finally:
        if sock:
            try:
                sock.close()
            except Exception:
                pass


def writeback_scene(sid, raw, result):
    """发送成功后把 request/response 写回场景并追加 history（上限 50 条）。"""
    if not result.get("ok"):
        return
    data = load_scene(sid)
    if not data:
        return
    req_b64 = base64.b64encode(raw if isinstance(raw, bytes) else raw.encode()).decode()
    data["request_b64"] = req_b64
    data["response_b64"] = result["response_b64"]
    data.pop("request", None)
    data.pop("response", None)
    hist = data.setdefault("history", [])
    hist.append({
        "ts": now_iso(),
        "request_b64": req_b64,
        "response_b64": result["response_b64"],
        "elapsed_ms": result["elapsed_ms"],
    })
    del hist[:-HISTORY_CAP]
    p = scene_path(sid)
    if p:
        p.write_text(json.dumps(data, ensure_ascii=False, indent=2), encoding="utf-8")


# ---------------- HTTP 服务 ----------------

class Handler(BaseHTTPRequestHandler):
    protocol_version = "HTTP/1.1"
    server_version = "Repeater/1.0"

    def log_message(self, *a):
        pass

    # ---- 基础设施 ----
    def _reply(self, status, body=b"", ctype="text/plain; charset=utf-8", extra=None):
        if isinstance(body, str):
            body = body.encode("utf-8")
        try:
            self.send_response(status)
            self.send_header("Content-Type", ctype)
            self.send_header("Content-Length", str(len(body)))
            for k, v in (extra or {}).items():
                self.send_header(k, v)
            self.end_headers()
            if body:
                self.wfile.write(body)
        except (BrokenPipeError, ConnectionResetError):
            pass  # 客户端中断（如取消发包），静默清理
        safe_path = re.sub(r"([?&]token=)[^&]*", r"\1[redacted]", self.path)
        log(f"{self.command} {safe_path} → {status}")

    def _json(self, obj, status=200):
        self._reply(status, json.dumps(obj, ensure_ascii=False), "application/json; charset=utf-8")

    def _auth(self):
        """Host 头校验（防 DNS rebinding）+ token 校验。通过返回 True。"""
        host_h = self.headers.get("Host", "")
        name = host_h.rsplit(":", 1)[0] if ":" in host_h and not host_h.startswith("[") else host_h
        if name not in ("127.0.0.1", "localhost"):
            self._reply(403, "Forbidden: bad Host")
            return False
        q = parse_qs(urlparse(self.path).query)
        auth = self.headers.get("Authorization", "")
        tok = q.get("token", [None])[0]
        if tok is None and auth.startswith("Bearer "):
            tok = auth[7:]
        if not tok or not secrets.compare_digest(tok, TOKEN):
            self._reply(401, "Unauthorized: token required")
            return False
        return True

    def _body(self):
        try:
            n = int(self.headers.get("Content-Length", 0))
        except ValueError:
            n = 0
        return self.rfile.read(min(n, 16 * 1024 * 1024)) if n > 0 else b""

    # ---- 路由 ----
    def do_GET(self):
        if not self._auth():
            return
        u = urlparse(self.path)
        path = u.path
        if path == "/":
            tok = parse_qs(u.query).get("token", [TOKEN])[0]
            self._reply(302, b"", extra={"Location": f"/repeater?token={tok}"})
        elif path in ("/repeater", "/terminal"):
            f = STATIC / (path[1:] + ".html")
            if f.is_file():
                self._reply(200, f.read_bytes(), "text/html; charset=utf-8")
            else:
                self._reply(404, f"not found: {f.name}")
        elif path in ("/assets/evidence-render.js", "/assets/fonts/NotoSansCJKsc-Regular.otf"):
            # Keep the same Host/token gate as scenes; no generic filesystem route.
            font = path.endswith('.otf')
            f = STATIC.parent / 'assets/fonts/NotoSansCJKsc-Regular.otf' if font else STATIC / 'evidence-render.js'
            if not f.is_file() or f.is_symlink():
                self._reply(404, 'bundled render asset missing')
            else:
                self._reply(200, f.read_bytes(), 'font/otf' if font else 'application/javascript; charset=utf-8',
                            {'X-Content-Type-Options':'nosniff', 'Cache-Control':'private, max-age=3600'})
        elif path == "/api/health":
            self._json({"ok": True, "service": "weburp", "pid": os.getpid(), "instance": os.environ.get("WEBURP_INSTANCE_ID", "")})
        elif path == "/api/scene":
            scenes = []
            for f in sorted(EVIDENCE.glob("*.json")):
                d = load_scene(f.stem)
                if d and d.get("id") == f.stem and d.get("type") in ("repeater", "terminal"):
                    scenes.append({k: d.get(k) for k in ("id", "name", "type", "created")})
            self._json({"ok": True, "scenes": scenes})
        elif path.startswith("/api/scene/"):
            d = load_scene(path.rsplit("/", 1)[1])
            if d:
                self._json(d)
            else:
                self._json({"ok": False, "error": "场景不存在"}, 404)
        else:
            self._reply(404, "not found")

    def do_POST(self):
        if not self._auth():
            return
        u = urlparse(self.path)
        try:
            params = json.loads(self._body() or b"{}")
        except Exception as e:
            self._json({"ok": False, "error": f"JSON 解析失败: {e}"}, 400)
            return
        if u.path == "/api/scene":
            try:
                sid = save_scene(params)
                self._json({"ok": True, "id": sid})
            except ValueError as e:
                self._json({"ok": False, "error": str(e)}, 400)
        elif u.path == "/api/send":
            result = do_send(params)
            sid = params.get("scene_id")
            if sid and result.get("ok"):
                try:
                    req_raw = base64.b64decode(params["request_b64"]) if params.get("request_b64") is not None else (params.get("request") or "").encode("utf-8")
                    if params.get("update_content_length", True):
                        req_raw = fix_content_length(req_raw)  # 与实际发送的字节保持一致
                    writeback_scene(sid, req_raw, result)
                except Exception as e:
                    log(f"场景写回失败 {sid}: {e}")
            self._json(result)
        elif u.path == "/api/cancel":
            self._json({"ok": True})  # 同步模式：取消靠客户端断开连接
        else:
            self._reply(404, "not found")

    def do_DELETE(self):
        if not self._auth():
            return
        u = urlparse(self.path)
        if u.path.startswith("/api/scene/"):
            p = scene_path(u.path.rsplit("/", 1)[1])
            if p and p.is_file():
                p.unlink()
                self._json({"ok": True})
            else:
                self._json({"ok": False, "error": "场景不存在"}, 404)
        else:
            self._reply(404, "not found")


def main():
    global TOKEN
    ap = argparse.ArgumentParser(description="Web Repeater 本地后端")
    ap.add_argument("--port", type=int, default=8777)
    ap.add_argument("--token", default=None)
    ap.add_argument("--no-open", action="store_true", help="保留参数：不自动打开浏览器（默认就不开）")
    args = ap.parse_args()

    TOKEN = args.token or os.environ.get("WEBURP_TOKEN") or secrets.token_urlsafe(16)
    EVIDENCE.mkdir(exist_ok=True)
    url = f"http://127.0.0.1:{args.port}/repeater?token={TOKEN}"
    print(f"Web Repeater 后端已启动: {url}", flush=True)
    print(f"HTTP/2 支持: {'h2 已加载' if H2_OK else 'h2 不可用（http2=force 将报错，其余功能正常）'}", flush=True)
    srv = ThreadingHTTPServer(("127.0.0.1", args.port), Handler)
    srv.daemon_threads = True
    try:
        srv.serve_forever()
    except KeyboardInterrupt:
        pass


if __name__ == "__main__":
    main()
