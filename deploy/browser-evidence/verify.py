"""Run inside the ARTEX container through compose exec -T artex python3 -."""
import json
import shutil
import struct
import subprocess
import tempfile
import uuid
from pathlib import Path
from urllib.request import ProxyHandler, Request, build_opener

endpoint = "http://artex-browser:8931/mcp"
http = build_opener(ProxyHandler({}))
headers = {"Content-Type": "application/json", "Accept": "application/json, text/event-stream"}


def rpc(method, params, seq=None):
    message = {"jsonrpc": "2.0", "method": method, "params": params}
    if seq is not None:
        message["id"] = seq
    request = Request(endpoint, data=json.dumps(message).encode(), headers=headers)
    with http.open(request, timeout=45) as response:
        if method == "initialize":
            headers["Mcp-Session-Id"] = response.headers["Mcp-Session-Id"]
        raw = response.read().decode()
    if seq is None:
        return
    payload = next((line[6:] for line in raw.splitlines() if line.startswith("data: ")), raw)
    result = json.loads(payload)
    if "error" in result or result["result"].get("isError"):
        raise RuntimeError(f"{method}: {result}")
    return result["result"]


def png(path):
    with path.open("rb") as f:
        header = f.read(24)
    if header[:8] != b"\x89PNG\r\n\x1a\n":
        raise RuntimeError(f"无效 PNG：{path}")
    print(path.name, *struct.unpack(">II", header[16:24]), sep=" ")


data = Path("/app/data/browser-evidence")
# The app and restricted browser run as different UIDs. The parent is owned by
# the browser UID, which creates and writes the PNG in its own unique subfolder.
relative = Path("verify-" + uuid.uuid4().hex)
try:
    rpc("initialize", {"protocolVersion": "2025-03-26", "capabilities": {},
                       "clientInfo": {"name": "artex-evidence-check", "version": "1"}}, 1)
    rpc("notifications/initialized", {})
    rpc("tools/call", {"name": "browser_navigate", "arguments": {"url": "http://artex:8787/"}}, 2)
    rpc("tools/call", {"name": "browser_take_screenshot", "arguments": {
        "type": "png", "filename": str(relative / "browser.png")}}, 3)
    png(data / relative / "browser.png")
finally:
    if headers.get("Mcp-Session-Id"):
        http.open(Request(endpoint, method="DELETE", headers=headers), timeout=10).close()
    if (data / relative).is_dir():
        shutil.rmtree(data / relative)

with tempfile.TemporaryDirectory() as folder:
    root = Path(folder)
    (root / "request").write_bytes(b"GET /verify HTTP/1.1\r\nHost: fixture.invalid\r\n\r\n")
    (root / "response").write_bytes(b"HTTP/1.1 200 OK\r\nContent-Type: text/plain\r\n\r\nARTEX evidence check")
    subprocess.run(["python3", "/app/skills/yak/tool/yak.py", "capture", "repeater",
                    "--style", "yakit",
                    "--request", str(root / "request"), "--response", str(root / "response"),
                    "--out", str(root / "yak.png")], check=True, stdout=subprocess.DEVNULL)
    png(root / "yak.png")
