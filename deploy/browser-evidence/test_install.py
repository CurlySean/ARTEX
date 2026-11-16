import importlib.util
from pathlib import Path
import unittest


spec = importlib.util.spec_from_file_location("browser_evidence_install", Path(__file__).with_name("install.py"))
install = importlib.util.module_from_spec(spec)
spec.loader.exec_module(install)


class ExistingPromptUpgradeTest(unittest.TestCase):
    def test_yakit_upgrade_preserves_custom_reporter_text(self):
        old = "自定义报告规则\n\n━━ 写报告时生成关键报文截图（Weburp）━━\n" \
              "python3 /app/skills/weburp/tool/weburp.py capture repeater --request a --response b\n"
        new = install.upgrade_yakit_prompt(old)
        self.assertIn("自定义报告规则", new)
        self.assertIn("━━ 写报告时生成关键报文截图（Yakit 风格 Weburp）━━", new)
        self.assertIn("capture repeater --style yakit --request", new)
        self.assertEqual(install.upgrade_yakit_prompt(new), new)

    def test_yakit_upgrade_handles_existing_capture_options(self):
        old = "━━ 写报告时生成关键报文截图（Weburp）━━\n" \
              "python3 /app/skills/weburp/tool/weburp.py capture repeater --size 1920x1080 --request a --response b\n"
        new = install.upgrade_yakit_prompt(old)
        self.assertIn("capture repeater --style yakit --size 1920x1080 --request", new)

    def test_yakit_upgrade_replaces_explicit_burp_style_on_continuation(self):
        old = "━━ 写报告时生成关键报文截图（Weburp）━━\n" \
              "python3 /app/skills/weburp/tool/weburp.py capture repeater --size 1920x1080 \\\n" \
              "  --style burp --request a --response b\n"
        new = install.upgrade_yakit_prompt(old)
        self.assertIn("--style yakit", new)
        self.assertNotIn("--style burp", new)
        self.assertEqual(new.count("--style yakit"), 1)


if __name__ == "__main__":
    unittest.main()
