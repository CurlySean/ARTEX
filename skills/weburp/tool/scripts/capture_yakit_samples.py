"""对本机验收环境执行实际截图，遇到失败即停止，不重发未知结果。"""
import json
import os
from pathlib import Path
import subprocess
import sys

TOOL = Path(__file__).resolve().parents[1]
ROOT = TOOL / "_verification"
env = dict(os.environ, WEBURP_STATE_DIR=str(ROOT/"state"), PYTHONUTF8="1", PYTHONIOENCODING="utf-8")
out = ROOT/"screenshots"; out.mkdir(exist_ok=True)
samples=ROOT/"samples"

def capture(name, arguments):
    command=[sys.executable,str(TOOL/"weburp.py"),"capture",*arguments,"--out",str(out/name)]
    result=subprocess.run(command,env=env,cwd=TOOL,capture_output=True,text=True,encoding="utf-8",timeout=180)
    print(json.dumps({"file":name,"exit":result.returncode,"stdout":result.stdout,"stderr":result.stderr},ensure_ascii=True),flush=True)
    if result.returncode:
        raise SystemExit(result.returncode)

capture("yakit-request-response.png",[
    "repeater","--style","yakit","--request",str(samples/"request.txt"),"--response",str(samples/"response.txt"),
    "--size","1440x900","--zoom","1"
])
capture("yakit-terminal.png",[
    "terminal","--style","yakit","--shell","ps","--entries-file",str(samples/"terminal.json"),
    "--size","1100x650","--zoom","1"
])
if "--render-only" not in sys.argv:
    capture("yakit-live-replay.png",[
        "repeater","--style","yakit","--request",str(samples/"request.txt"),
        "--size","1440x900","--zoom","1"
    ])
