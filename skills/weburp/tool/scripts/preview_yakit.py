"""启动只监听本机的验收环境；真实请求与记录供浏览器检查和截图。"""
import base64
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
import json
import os
from pathlib import Path
import secrets
import subprocess
import sys
import threading

TOOL = Path(__file__).resolve().parents[1]
ROOT = TOOL / "_verification"
ROOT.mkdir(exist_ok=True)
os.environ["WEBURP_STATE_DIR"] = str(ROOT / "state")
os.environ["WEBURP_INSTANCE_ID"] = secrets.token_hex(16)
sys.path.insert(0, str(TOOL))
import server
import weburp

class Fixture(BaseHTTPRequestHandler):
    protocol_version = "HTTP/1.1"
    def do_POST(self):
        body = self.rfile.read(int(self.headers.get("Content-Length", "0")))
        payload = json.dumps({"ok": True, "message": "本机请求重放验证成功", "path": self.path,
                              "received": json.loads(body)}, ensure_ascii=False, indent=2).encode()
        self.send_response(200)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(payload)))
        self.send_header("X-Verification", "loopback-fixture")
        self.end_headers()
        self.wfile.write(payload)
    def log_message(self, *args):
        pass

def main():
    previous = weburp.load_state()
    if weburp.health(previous):
        raise SystemExit("已有验收环境正在运行，请先检查原任务，不重复启动。")
    server.TOKEN = secrets.token_urlsafe(24)
    http = ThreadingHTTPServer(("127.0.0.1", 0), server.Handler)
    http.daemon_threads = True
    fixture = ThreadingHTTPServer(("127.0.0.1", 0), Fixture)
    fixture.daemon_threads = True
    thread = threading.Thread(target=fixture.serve_forever, daemon=True)
    thread.start()
    body = json.dumps({"project": "Weburp", "text": "你好，Yakit"}, ensure_ascii=False).encode()
    raw = ("POST /api/echo?mode=replay HTTP/1.1\r\nHost: 127.0.0.1:%d\r\nUser-Agent: Weburp-Local-Verification\r\nContent-Type: application/json; charset=utf-8\r\nContent-Length: %d\r\nConnection: close\r\n\r\n" % (fixture.server_port, len(body))).encode() + body
    result = server.do_send({"request_b64":base64.b64encode(raw).decode(), "http2":"never"})
    if not result["ok"]:
        raise SystemExit(result["error"])
    sid = server.save_scene({"type":"repeater", "name":"Web Fuzzer-[1]", "request_b64":base64.b64encode(raw).decode(),
        "response_b64":result["response_b64"], "view":"raw",
        "target":{"host":"127.0.0.1","port":fixture.server_port,"tls":False},"meta":result})
    server.writeback_scene(sid, raw, result)
    version = subprocess.run([sys.executable,"--version"],capture_output=True,text=True,check=True)
    tid = server.save_scene({"type":"terminal","name":"终端记录","shell":"ps","banner":False,"entries":[
        {"cwd":str(TOOL),"cmd":"python --version","output":version.stdout.strip(),"exit":version.returncode}
    ]})
    base = "http://127.0.0.1:%d" % http.server_port
    st = {"port":http.server_port,"token":server.TOKEN,"pid":os.getpid(),"instance":os.environ["WEBURP_INSTANCE_ID"],
          "url":base+"/repeater?token="+server.TOKEN,"upstream_proxy":""}
    weburp.write_state(st)
    config = {"base_url":base,"request_scene":sid,"terminal_scene":tid,"target_port":fixture.server_port,
              "url":base+"/yakit?token="+server.TOKEN+"&scene="+sid,
              "terminal_url":base+"/yakit/terminal?token="+server.TOKEN+"&scene="+tid+"&cursor=0"}
    (ROOT/"preview.json").write_text(json.dumps(config,ensure_ascii=False,indent=2),encoding="utf-8")
    samples = ROOT/"samples"; samples.mkdir(exist_ok=True)
    (samples/"request.txt").write_bytes(raw)
    (samples/"response.txt").write_bytes(base64.b64decode(result["response_b64"]))
    (samples/"terminal.json").write_text(json.dumps(server.load_scene(tid)["entries"],ensure_ascii=False,indent=2),encoding="utf-8")
    print(json.dumps(config,ensure_ascii=False),flush=True)
    try:
        http.serve_forever()
    finally:
        fixture.shutdown(); fixture.server_close(); http.server_close()

if __name__ == "__main__":
    main()
