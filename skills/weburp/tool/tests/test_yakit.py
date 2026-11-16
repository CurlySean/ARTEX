"""仅本机测试：新旧路由、资源鉴权、真实发包和截图命令兼容性。"""
import argparse
import base64
import contextlib
import http.client
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
import json
import os
from pathlib import Path
import sys
import tempfile
import threading
import unittest
from unittest.mock import patch

TOOL = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(TOOL))
STATE = tempfile.TemporaryDirectory(prefix="weburp-yakit-tests-")
os.environ["WEBURP_STATE_DIR"] = STATE.name
import server
import weburp

class Echo(BaseHTTPRequestHandler):
    protocol_version = "HTTP/1.1"
    def do_POST(self):
        body = self.rfile.read(int(self.headers.get("Content-Length", "0")))
        result = json.dumps({"message": "本机重放成功", "host": self.headers["Host"],
                             "body_b64": base64.b64encode(body).decode()}, ensure_ascii=False).encode()
        self.send_response(200)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(result)))
        self.end_headers()
        self.wfile.write(result)
    def log_message(self, *args):
        pass

class YakitRoutes(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        server.TOKEN = "local_yakit_regression_test"
        cls.http = ThreadingHTTPServer(("127.0.0.1", 0), server.Handler)
        cls.http.daemon_threads = True
        cls.thread = threading.Thread(target=cls.http.serve_forever, daemon=True)
        cls.thread.start()
        cls.echo = ThreadingHTTPServer(("127.0.0.1", 0), Echo)
        cls.echo.daemon_threads = True
        cls.echo_thread = threading.Thread(target=cls.echo.serve_forever, daemon=True)
        cls.echo_thread.start()
    @classmethod
    def tearDownClass(cls):
        cls.http.shutdown(); cls.http.server_close(); cls.thread.join()
        cls.echo.shutdown(); cls.echo.server_close(); cls.echo_thread.join()
    def request(self, path, method="GET", body=None, token=True, host=None):
        connection = http.client.HTTPConnection("127.0.0.1", self.http.server_port, timeout=5)
        headers = {}
        if token: headers["Authorization"] = "Bearer " + server.TOKEN
        if host: headers["Host"] = host
        if body is not None:
            body = json.dumps(body).encode()
            headers["Content-Type"] = "application/json"
        connection.request(method, path, body, headers)
        response = connection.getresponse()
        result = (response.status, response.getheader("Content-Type"), response.read())
        connection.close()
        return result
    def test_new_and_existing_pages(self):
        for path in ("/repeater", "/terminal", "/yakit", "/yakit/terminal"):
            with self.subTest(path=path):
                self.assertEqual(self.request(path)[0], 200)
                self.assertEqual(self.request(path, token=False)[0], 401)
    def test_relative_asset_prefix_requires_token(self):
        prefix = "/assets/yakit/" + server.TOKEN + "/"
        for resource in ("app.js", "app.css", "theme.css", "icons.js", "monaco/min/vs/loader.js",
                         "monaco/min/vs/editor/editor.main.js", "xterm/lib/xterm.js", "xterm-fit/lib/addon-fit.js"):
            with self.subTest(resource=resource):
                status, mime, body = self.request(prefix+resource, token=False)
                self.assertEqual(status, 200)
                self.assertTrue(body)
                if resource.endswith(".js"): self.assertIn("javascript", mime)
        self.assertEqual(self.request("/assets/yakit/wrong/app.js", token=False)[0], 401)
        self.assertEqual(self.request(prefix+"../server.py", token=False)[0], 404)
        self.assertEqual(self.request(prefix+"%2e%2e/server.py", token=False)[0], 404)
        self.assertEqual(self.request(prefix+"app.js", token=False, host="untrusted.test")[0], 403)
    def test_real_replay_bytes_target_and_history(self):
        raw = b"POST / HTTP/1.1\r\nHost: virtual.test\r\nContent-Length: 1\r\nConnection: close\r\n\r\n" + bytes([0,255,128])
        status, _, data = self.request("/api/scene", "POST", {"type":"repeater", "name":"本机回归", "request_b64":base64.b64encode(raw).decode()})
        self.assertEqual(status, 200)
        sid = json.loads(data)["id"]
        status, _, data = self.request("/api/send", "POST", {
            "request_b64":base64.b64encode(raw).decode(), "target":{"host":"127.0.0.1","port":self.echo.server_port,"tls":False},
            "http2":"never", "scene_id":sid, "update_content_length":True
        })
        result = json.loads(data)
        self.assertTrue(result["ok"], result)
        response = base64.b64decode(result["response_b64"])
        echoed = json.loads(response.split(b"\r\n\r\n",1)[1])
        self.assertEqual(echoed["host"], "virtual.test")
        self.assertEqual(base64.b64decode(echoed["body_b64"]), bytes([0,255,128]))
        saved = json.loads(self.request("/api/scene/"+sid)[2])
        self.assertEqual(len(saved["history"]),1)
        self.assertIn(b"Content-Length: 3",base64.b64decode(saved["request_b64"]))
    def test_capture_styles_and_url_validation(self):
        st = {"port":8777,"token":"test"}
        for style, kind, page, zoom in (
            ("burp","repeater","/repeater","1.6"),("burp","terminal","/terminal","1.6"),
            ("yakit","repeater","/yakit","1"),("yakit","terminal","/yakit/terminal","1")):
            with self.subTest(style=style, kind=kind), tempfile.TemporaryDirectory() as directory:
                req = Path(directory)/"request.txt"; req.write_bytes(b"GET / HTTP/1.1\r\nHost: localhost\r\n\r\n")
                resp = Path(directory)/"response.txt"; resp.write_bytes(b"HTTP/1.1 204 No Content\r\n\r\n")
                args = argparse.Namespace(style=style,theme="dark",kind=kind,ai_action=None,ai_note=None,ai_success=None,
                    request=str(req),response=str(resp),host=None,port=None,tls=False,name=None,entries_file=None,
                    entry=["/tmp|||python --version|||Python 3.11|||0"],shell="bash",zoom=None,size=None,budget=None,out="out.png")
                captured=[]
                with patch.object(weburp,"ensure_started",return_value=st), patch.object(weburp,"post_scene",return_value="r-test"), patch.object(weburp,"cmd_shot",side_effect=lambda a:captured.append(a) or 0):
                    self.assertEqual(weburp.cmd_capture(args),0)
                self.assertEqual(weburp.scene_url(captured[0].url).path,page)
                self.assertIn("zoom="+zoom,captured[0].url)
                self.assertNotIn("send=1",captured[0].url)
        for url in ("http://external.test/yakit?scene=r-test","http://127.0.0.1:8777/admin?scene=r-test"):
            with self.assertRaises(ValueError): weburp.scene_url(url)

if __name__ == "__main__":
    try:
        unittest.main(verbosity=2)
    finally:
        STATE.cleanup()
