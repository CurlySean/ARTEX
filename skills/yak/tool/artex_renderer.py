"""Use the local non-root browser container for evidence captures."""
import json
import os
import re
import tempfile
from pathlib import Path


def configure(controller):
    endpoint = "http://127.0.0.1:18777"
    def doctor(args):
        with controller.loopback_open(endpoint + "/health", timeout=10) as r:
            browser = json.load(r)["browser"]
        font = controller.bundled_font_status()
        print(json.dumps({"ok": font["ready"], "browser": browser, "font": font}, ensure_ascii=False))
        return 0 if font["ready"] else 1

    def shot(args):
        controller.scene_url(args.url)
        size = re.fullmatch(r"(\d{2,4})x(\d{2,4})", args.size)
        if not size:
            raise ValueError("截图尺寸无效")
        data = json.dumps({"url": args.url, "size": args.size, "budget": args.budget}).encode()
        dest = Path(args.out).expanduser().absolute()
        dest.parent.mkdir(parents=True, exist_ok=True)
        with tempfile.TemporaryDirectory(dir=dest.parent) as directory:
            temp = Path(directory) / "evidence.png"
            with controller.loopback_open(endpoint + "/render", timeout=150, headers={"Content-Type": "application/json"}, data=data) as r:
                temp.write_bytes(r.read())
            controller.validate_png(temp, int(size[1]), int(size[2]))
            os.replace(temp, dest)
        print(dest)
        return 0

    controller.cmd_doctor = doctor
    controller.cmd_shot = shot
