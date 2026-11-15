"""Render authenticated Weburp pages in sandboxed, non-root Chromium."""
import json
import subprocess
import tempfile
from argparse import Namespace
from http.server import BaseHTTPRequestHandler, HTTPServer
from pathlib import Path
from urllib.parse import parse_qs
from urllib.error import HTTPError

import weburp


class Handler(BaseHTTPRequestHandler):
    def log_message(self, fmt, *args):
        pass  # Scene URLs contain a private token.

    def reply(self, content, content_type):
        self.send_response(200)
        self.send_header("Content-Type", content_type)
        self.send_header("Content-Length", str(len(content)))
        self.end_headers()
        self.wfile.write(content)

    def do_GET(self):
        if self.path != "/health":
            return self.send_error(404)
        version = subprocess.check_output(["chromium", "--version"], text=True).strip()
        self.reply(json.dumps({"browser": version}).encode(), "application/json")

    def do_POST(self):
        if self.path != "/render" or self.headers.get_content_type() != "application/json":
            return self.send_error(400)
        try:
            length = int(self.headers.get("Content-Length", 0))
            if not 0 < length < 32768:
                return self.send_error(413)
            options = json.loads(self.rfile.read(length))
            url = options["url"]
            scene = weburp.scene_url(url)
            if scene.scheme != "http" or scene.port != 8777:
                return self.send_error(403)
            token = parse_qs(scene.query)["token"][0]
            with weburp.loopback_open("http://127.0.0.1:8777/api/health", headers={"Authorization": "Bearer " + token}) as r:
                if json.load(r).get("service") != "weburp":
                    return self.send_error(403)
            with tempfile.TemporaryDirectory() as work:
                out = Path(work) / "evidence.png"
                weburp.cmd_shot(Namespace(url=url, size=options["size"], budget=int(options["budget"]), out=out))
                self.reply(out.read_bytes(), "image/png")
        except HTTPError:
            self.send_error(403)
        except (KeyError, ValueError, OSError, subprocess.SubprocessError) as error:
            # Never send an exception containing a URL or token.
            print("Capture failed:", type(error).__name__, flush=True)
            self.send_error(422)


HTTPServer(("127.0.0.1", 18777), Handler).serve_forever()
