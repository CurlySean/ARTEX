import importlib.util
from pathlib import Path
import unittest
from unittest.mock import patch


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

    def test_yak_upgrade_replaces_old_skill_and_command(self):
        old = "加载 weburp Skill。\n━━ 写报告时生成关键报文截图（Yakit 风格 Weburp）━━\n" \
              "python3 /app/skills/weburp/tool/weburp.py capture repeater --style yakit --request a --response b\n"
        new = install.upgrade_yak_prompt(old)
        self.assertIn("加载 yak Skill", new)
        self.assertIn("━━ 写报告时生成关键报文截图（Yak）━━", new)
        self.assertIn("/app/skills/yak/tool/yak.py capture repeater --style yakit", new)
        self.assertNotIn("/app/skills/weburp", new)
        self.assertEqual(install.upgrade_yak_prompt(new), new)

    def test_yak_binding_migration_keeps_other_visibility(self):
        old = {"mcp": [7], "skill": ["api-recon", "weburp"]}
        new = install.migrate_yak_visibility(old)
        self.assertEqual(new, {"mcp": [7], "skill": ["api-recon", "yak"]})

    def test_custom_agent_is_migrated_without_changing_other_tools(self):
        class API:
            prompt = "Use /app/skills/weburp/tool/weburp.py for screenshots"
            visibility = {"mcp": [7], "skill": ["api-recon", "weburp"]}

            def call(self, method, path, body=None):
                if path == "agents":
                    return {"agents": [{"key": "worker"}, {"key": "custom_reviewer"}]}
                if path == "agents/custom_reviewer":
                    return {"prompt": self.prompt}
                if path == "agents/custom_reviewer/prompt/preview":
                    return {"rendered": "ok"}
                if path == "agents/custom_reviewer/prompt" and method == "PUT":
                    self.prompt = body["template"]
                    return {"ok": True}
                if path == "agents/custom_reviewer/visibility":
                    if method == "PUT":
                        self.visibility = body
                    return self.visibility
                raise AssertionError((method, path))

        api = API()
        install.migrate_other_agent_skills(api)
        self.assertIn("/app/skills/yak/tool/yak.py", api.prompt)
        self.assertEqual(api.visibility, {"mcp": [7], "skill": ["api-recon", "yak"]})

    def test_retester_browser_binding_preserves_custom_tools(self):
        class API:
            visibility = {"mcp": [7], "skill": ["custom-check", "yak"]}
            def call(self, method, path, body=None):
                if path == "agents":
                    return {"agents": [{"key": "retester"}]}
                if path == "agents/retester/visibility":
                    if method == "PUT":
                        self.visibility = body
                    return self.visibility
                raise AssertionError((method, path))
        api = API()
        install.install_retester_bindings(api, 31)
        install.install_retester_bindings(api, 31)
        self.assertEqual(api.visibility, {"mcp": [7, 31], "skill": ["custom-check", "yak"]})

    def test_removes_only_legacy_renderer_from_current_compose_project(self):
        with patch.object(install, "compose", return_value='{"name":"my-artex"}'), \
             patch.object(install.subprocess, "check_output", return_value="old-container\n") as listed, \
             patch.object(install.subprocess, "run") as removed:
            install.remove_legacy_renderer()
        self.assertIn("label=com.docker.compose.project=my-artex", listed.call_args.args[0])
        self.assertIn("label=com.docker.compose.service=weburp-renderer", listed.call_args.args[0])
        self.assertEqual(removed.call_args.args[0][:3], ["docker", "rm", "-f"])


if __name__ == "__main__":
    unittest.main()
