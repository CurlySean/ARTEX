import sys
import unittest
from pathlib import Path
from http.server import ThreadingHTTPServer
import json
import threading
import urllib.request
from unittest.mock import patch
import os

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import yak
import server


class YakEntrypointTest(unittest.TestCase):
    def test_capture_defaults_to_yakit(self):
        args = yak.yakit_args(["capture", "repeater", "--request", "a", "--response", "b", "--out", "c"])
        self.assertEqual(args[-2:], ["--style", "yakit"])

    def test_old_burp_style_is_replaced(self):
        args = yak.yakit_args(["capture", "repeater", "--style", "burp", "--request", "a"])
        self.assertEqual(args.count("--style"), 1)
        self.assertNotIn("burp", args)
        self.assertIn("yakit", args)

    def test_yak_environment_aliases_configure_backend(self):
        with patch.dict(os.environ, {"YAK_STATE_DIR": "/tmp/yak-state", "YAK_TOKEN": "test-token"}, clear=True):
            yak.configure_env()
            self.assertEqual(os.environ["WEBURP_STATE_DIR"], "/tmp/yak-state")
            self.assertEqual(os.environ["WEBURP_TOKEN"], "test-token")

    def test_health_identifies_yak_service(self):
        server.TOKEN = "yak-local-test"
        http = ThreadingHTTPServer(("127.0.0.1", 0), server.Handler)
        worker = threading.Thread(target=http.serve_forever, daemon=True)
        worker.start()
        try:
            req = urllib.request.Request(
                f"http://127.0.0.1:{http.server_port}/api/health",
                headers={"Authorization": "Bearer yak-local-test"},
            )
            with urllib.request.urlopen(req) as response:
                self.assertEqual(json.load(response)["service"], "yak")
        finally:
            http.shutdown()
            http.server_close()
            worker.join()


if __name__ == "__main__":
    unittest.main()
