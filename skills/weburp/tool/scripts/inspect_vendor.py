"""读取原版图标工厂和用到的组件。"""
import tarfile
from pathlib import Path
root = Path(__file__).resolve().parents[1]
with tarfile.open(root / "_downloads/yakit-libs-yakit-ui-icons-0.2.9.tgz") as archive:
    for name in ("package/dist/createIcon-CNgBwNTZ.js", "package/dist/index-CS16Uqfu.js"):
        value = archive.extractfile(name).read().decode("utf-8")
        print(name, "\n", value[:4200])
        at = value.find("ClockOutlined")
        if at >= 0:
            print(value[max(0, at - 300):at + 1600])
