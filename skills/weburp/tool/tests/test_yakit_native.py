"""原版静态外壳回归：资源受鉴权、路径本地化、模板不含执行代码或基准报文。"""
from html.parser import HTMLParser
from http.server import ThreadingHTTPServer
import json
import re
import threading
import unittest

# 复用已有测试的私有临时目录和 HTTP 请求助手，不写入用户实例。
import test_yakit as fixtures

TOOL, server = fixtures.TOOL, fixtures.server


class TemplateAudit(HTMLParser):
    def __init__(self):
        super().__init__()
        self.unsafe = []
        self.ids = []
        self.editors = 0

    def handle_starttag(self, tag, attrs):
        if tag in {"script", "iframe", "object", "embed"}:
            self.unsafe.append(tag)
        for key, value in attrs:
            if key.lower().startswith("on"):
                self.unsafe.append(key)
            if key in {"src", "href"} and value and re.match(
                r"(?:https?:|javascript:|file:|//)", value, re.I
            ):
                self.unsafe.append(value)
            if key == "id":
                self.ids.append(value)
            if key == "class" and value and "monaco-editor" in value.split():
                self.editors += 1


class NativeShell(unittest.TestCase):
    request = fixtures.YakitRoutes.request

    @classmethod
    def setUpClass(cls):
        server.TOKEN = "local_native_resource_test"
        cls.http = ThreadingHTTPServer(("127.0.0.1", 0), server.Handler)
        cls.http.daemon_threads = True
        cls.thread = threading.Thread(target=cls.http.serve_forever, daemon=True)
        cls.thread.start()

    @classmethod
    def tearDownClass(cls):
        cls.http.shutdown()
        cls.http.server_close()
        cls.thread.join()

    def test_native_assets_authentication(self):
        native = TOOL / "assets" / "yakit" / "native"
        provenance = json.loads((native / "PROVENANCE.json").read_text(encoding="utf-8"))
        resources = ["native/layout.json", *provenance["stylesheetFiles"]]
        resources += ["native/" + item for item in provenance["resourceFiles"]]
        for resource in resources:
            with self.subTest(resource=resource):
                status, _, body = self.request(
                    "/assets/yakit/" + server.TOKEN + "/" + resource, token=False
                )
                self.assertEqual(status, 200)
                self.assertTrue(body)
        for resource in ["native/layout.json", "native/inline.css", "native/" + provenance["resourceFiles"][2]]:
            with self.subTest(denied=resource):
                self.assertEqual(self.request("/assets/yakit/wrong/" + resource, token=False)[0], 401)
                self.assertEqual(self.request("/assets/yakit/" + server.TOKEN + "/" + resource,
                                             token=False, host="untrusted.test")[0], 403)
        self.assertEqual(self.request("/assets/yakit/" + server.TOKEN +
                                      "/native/%2e%2e/%2e%2e/server.py", token=False)[0], 404)

    def test_template_is_inert_and_cleared(self):
        data = json.loads((TOOL / "assets/yakit/native/layout.json").read_text(encoding="utf-8"))
        audit = TemplateAudit()
        audit.feed(data["html"])
        self.assertEqual(audit.unsafe, [])
        self.assertEqual(audit.editors, 0)
        self.assertEqual(len(audit.ids), len(set(audit.ids)))
        for required in ["requestEditor", "responseEditor", "send", "themeToggle", "nativeMenu"]:
            self.assertIn(required, audit.ids)
        for removed in ["51975", "original-reference", "本机重放验证成功", "命名管道", "/baseline?"]:
            self.assertNotIn(removed, data["html"])

    def test_styles_use_existing_local_resources(self):
        assets = TOOL / "assets/yakit"
        data = json.loads((assets / "native/layout.json").read_text(encoding="utf-8"))
        for resource in data["styles"]:
            style = assets / resource
            self.assertTrue(style.is_file())
            for match in re.finditer(r"""url\(\s*["']?([^)\"']+)""", style.read_text(encoding="utf-8")):
                url = match[1].strip()
                self.assertFalse(url.startswith(("http:", "https:", "//")), url)
                if not url.startswith(("data:", "#")):
                    resolved = (style.parent / url.split("?", 1)[0].split("#", 1)[0]).resolve()
                    self.assertTrue(resolved.is_relative_to(assets.resolve()), url)
                    self.assertTrue(resolved.is_file(), url)


if __name__ == "__main__":
    unittest.main(verbosity=2)
