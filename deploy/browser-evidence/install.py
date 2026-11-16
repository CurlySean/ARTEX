#!/usr/bin/env python3
"""Install browser evidence for the current ARTEX Compose project."""
import getpass
import json
import os
from pathlib import Path
import re
import subprocess
import sys
import time
from urllib.error import HTTPError, URLError
from urllib.request import ProxyHandler, Request, build_opener

HERE = Path(__file__).resolve().parent
ROOT = HERE.parents[1]
MCP_URL = "http://artex-browser:8931/mcp"
OPENER = build_opener(ProxyHandler({}))


def compose(*args, capture=False):
    return subprocess.run(["docker", "compose", *args], cwd=ROOT, check=True,
                          stdout=subprocess.PIPE if capture else None, text=True).stdout


def wait_for(check, what, seconds=75):
    deadline = time.monotonic() + seconds
    while True:
        try:
            if check():
                return
        except (OSError, URLError, RuntimeError):
            pass
        if time.monotonic() >= deadline:
            raise RuntimeError(f"等待超时：{what}")
        time.sleep(1)


class API:
    def __init__(self, port):
        self.base = f"http://127.0.0.1:{port}/api/"
        self.token = ""

    def call(self, method, path, body=None):
        headers = {"Content-Type": "application/json"}
        if self.token:
            headers["Authorization"] = "Bearer " + self.token
        data = json.dumps(body).encode() if body is not None else None
        request = Request(self.base + path, method=method, headers=headers, data=data)
        try:
            with OPENER.open(request, timeout=60) as response:
                return json.load(response)
        except HTTPError as error:
            raise RuntimeError(f"{method} {path} 返回 HTTP {error.code}") from error


def upgrade_yakit_prompt(prompt):
    replacements = {
        "━━ 写报告时生成关键报文截图（Weburp）━━": "━━ 写报告时生成关键报文截图（Yakit 风格 Weburp）━━",
        "这是已有流量的 Weburp 渲染。": "这是已有流量的 Yakit 风格 Weburp 渲染，不声称真实 Yak 引擎执行。",
        "按前述 Weburp 工作流": "按前述 Yakit 风格 Weburp 工作流",
    }
    for old, new in replacements.items():
        prompt = prompt.replace(old, new)

    def set_style(match):
        command = match.group()
        style = r"--style(?:[ \t]+|=)(?:burp|yakit)\b"
        if re.search(style, command):
            return re.sub(style, "--style yakit", command)
        return re.sub(r"\bcapture[ \t]+repeater\b", "capture repeater --style yakit", command, count=1)

    return re.sub(r"weburp\.py[ \t]+capture[ \t]+repeater(?:[^\n\\]|\\[^\n]|\\\n)*", set_style, prompt)


def upgrade_yak_prompt(prompt):
    prompt = upgrade_yakit_prompt(prompt)
    replacements = {
        "━━ 写报告时生成关键报文截图（Yakit 风格 Weburp）━━": "━━ 写报告时生成关键报文截图（Yak）━━",
        "加载 weburp Skill": "加载 yak Skill",
        "/app/skills/weburp/tool/weburp.py": "/app/skills/yak/tool/yak.py",
        "这是已有流量的 Yakit 风格 Weburp 渲染，不声称真实 Yak 引擎执行。": "这是已有流量在 Yak 界面的渲染，不代表重新发送。",
        "按前述 Yakit 风格 Weburp 工作流": "按前述 Yak 截图工作流",
        "带 token 的 Weburp 页面地址": "带 token 的本机页面地址",
    }
    for old, new in replacements.items():
        prompt = prompt.replace(old, new)
    return prompt


def migrate_yak_visibility(visibility):
    skills = ["yak" if name == "weburp" else name for name in (visibility.get("skill") or [])]
    return {"mcp": list(visibility.get("mcp") or []), "skill": list(dict.fromkeys(skills))}


def install_prompt(api, role, mid):
    path = "agents/" + role
    snapshot = (HERE / "prompts" / (role + ".md")).read_text(encoding="utf-8").rstrip()
    current = api.call("GET", path)["prompt"].rstrip()
    sections = re.split(r"(?=^━━ )", snapshot, flags=re.MULTILINE)
    headings = ("━━ Playwright 网页取证", "━━ 写报告时生成关键报文截图", "━━ 引用验证现场")
    additions = [section.rstrip() for section in sections if section.startswith(headings)]
    base = "".join(section for section in sections if not section.startswith(headings)).rstrip()
    if base == current:
        updated = snapshot
    else:
        upgraded = upgrade_yak_prompt(current)
        missing = [s for s in additions if s.splitlines()[0] not in upgraded.splitlines()]
        updated = "\n\n".join([upgraded, *missing])
    if updated != current:
        preview = api.call("POST", path + "/prompt/preview", {"template": updated})
        if preview.get("error") or not preview.get("rendered"):
            raise RuntimeError(f"{role} 提示词预览失败")
        api.call("PUT", path + "/prompt", {"template": updated, "note": "安装浏览器和 Yak 报告取证"})
    visibility = api.call("GET", path + "/visibility")
    bindings = migrate_yak_visibility(visibility)
    if mid not in bindings["mcp"]:
        bindings["mcp"].append(mid)
    if "yak" not in bindings["skill"]:
        bindings["skill"].append("yak")
    if bindings != {"mcp": visibility.get("mcp") or [], "skill": visibility.get("skill") or []}:
        api.call("PUT", path + "/visibility", bindings)
    actual = api.call("GET", path + "/visibility")
    if (api.call("GET", path)["prompt"].rstrip() != updated
            or any(set(actual[key]) != set(values) for key, values in bindings.items())):
        raise RuntimeError(f"{role} 配置回读不一致")
    print(f"{role} 提示词和工具绑定已核验")


def migrate_other_agent_skills(api):
    for agent in api.call("GET", "agents")["agents"]:
        role = agent["key"]
        if role in ("worker", "pentest", "reporter"):
            continue
        path = "agents/" + role
        current_prompt = api.call("GET", path)["prompt"]
        updated_prompt = upgrade_yak_prompt(current_prompt)
        if updated_prompt != current_prompt:
            preview = api.call("POST", path + "/prompt/preview", {"template": updated_prompt})
            if preview.get("error") or not preview.get("rendered"):
                raise RuntimeError(f"{role} 提示词预览失败")
            api.call("PUT", path + "/prompt", {"template": updated_prompt, "note": "迁移 Yak Skill"})
        visibility_path = path + "/visibility"
        current = api.call("GET", visibility_path)
        updated = migrate_yak_visibility(current)
        if updated != {"mcp": current.get("mcp") or [], "skill": current.get("skill") or []}:
            api.call("PUT", visibility_path, updated)


def install_retester_bindings(api, mid):
    # Older installations may not have the optional retester agent yet.
    if not any(a["key"] == "retester" for a in api.call("GET", "agents")["agents"]):
        return
    path = "agents/retester/visibility"
    current = api.call("GET", path)
    updated = migrate_yak_visibility(current)
    if mid not in updated["mcp"]:
        updated["mcp"].append(mid)
    if "yak" not in updated["skill"]:
        updated["skill"].append("yak")
    if updated != {"mcp": current.get("mcp") or [], "skill": current.get("skill") or []}:
        api.call("PUT", path, updated)
    actual = api.call("GET", path)
    if any(set(actual[key] or []) != set(values) for key, values in updated.items()):
        raise RuntimeError("retester 工具绑定回读不一致")


def configure_mcp(api):
    existing = next((s for s in api.call("GET", "mcp")["servers"]
                     if s["name"] == "browser-evidence"), None)
    if existing and (existing["url"] != MCP_URL or existing["transport"] != "http"):
        raise RuntimeError("已有同名 browser-evidence 指向其他端点，请在 MCP 配置中核对")
    if existing and existing["enabled"]:
        mid = existing["id"]
    else:
        server = existing or {"name": "browser-evidence", "transport": "http", "url": MCP_URL}
        mid = api.call("POST", "mcp", {**server, "enabled": True})["id"]
    tools = api.call("POST", f"mcp/{mid}/refresh", {})["tools"]
    names = {tool["name"].split("__")[-1] for tool in tools}
    if not {"browser_navigate", "browser_click", "browser_take_screenshot"} <= names:
        raise RuntimeError("MCP 工具发现缺少导航、点击或截图能力")
    for role in ("worker", "pentest", "reporter"):
        install_prompt(api, role, mid)
    migrate_other_agent_skills(api)
    install_retester_bindings(api, mid)


def remove_legacy_renderer():
    project = json.loads(compose("config", "--format", "json", capture=True))["name"]
    ids = subprocess.check_output([
        "docker", "ps", "-aq",
        "--filter", f"label=com.docker.compose.project={project}",
        "--filter", "label=com.docker.compose.service=weburp-renderer",
    ], text=True).splitlines()
    for container_id in ids:
        subprocess.run(["docker", "rm", "-f", container_id], check=True, stdout=subprocess.DEVNULL)


def main():
    os.environ.setdefault("COMPOSE_FILE", "docker-compose.yml:docker-compose.evidence.yml")
    compose("build", "artex-browser")
    compose("up", "-d", "artex")
    port = compose("port", "artex", "8787", capture=True).splitlines()[0].rsplit(":", 1)[1]
    api = API(port)
    wait_for(lambda: api.call("GET", "health").get("ok"), "ARTEX")
    api.token = os.environ.get("ARTEX_TOKEN", "")
    if not api.token:
        initialized = api.call("GET", "auth/status")["initialized"]
        password = getpass.getpass("ARTEX 管理员密码：" if initialized else "设置新 ARTEX 管理员密码：")
        if not initialized and password != getpass.getpass("再次输入新密码："):
            raise RuntimeError("两次输入的密码不同")
        api.token = api.call("POST", "auth/login" if initialized else "auth/init",
                             {"username": "ARTEX", "password": password})["token"]
    settings = api.call("GET", "settings")
    required = {"traffic_capture": True, "agent_traffic_binding": True}
    if any(settings.get(k) != v for k, v in required.items()):
        api.call("PUT", "settings", required)
    # Set ownership from inside Docker so rootless UID mappings also apply.
    compose("exec", "-T", "artex", "install", "-d", "-o", "65534", "-g", "65534",
            "-m", "0755", "/app/data/browser-evidence")
    ca = ROOT / "data/traffic/_ca/mitmproxy-ca-cert.pem"
    wait_for(lambda: ca.is_file() and ca.stat().st_size, "ARTEX 流量代理 CA")
    compose("up", "-d", "--no-build", "--wait", "artex-browser", "yak-renderer")
    remove_legacy_renderer()
    configure_mcp(api)
    compose("exec", "-T", "artex", "python3", "/app/skills/yak/tool/yak.py", "doctor")


if __name__ == "__main__":
    try:
        main()
    except (RuntimeError, OSError, subprocess.CalledProcessError) as error:
        sys.exit(str(error))
