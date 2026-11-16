"""从固定版本 npm 包与用户指定源码准备离线界面资源，不运行安装脚本。"""
import argparse
import hashlib
import json
from pathlib import Path, PurePosixPath
import tarfile

TOOL = Path(__file__).resolve().parents[1]
OUT = TOOL / "assets" / "yakit"
PACKAGES = {
    "monaco-editor-0.40.0.tgz": ("monaco", lambda p: p.startswith("min/vs/") and not p.endswith(".map") or p in ("LICENSE", "ThirdPartyNotices.txt")),
    "yakit-libs-color-1.4.1.tgz": ("color", lambda p: p.startswith("dist/") and p.endswith(".js") or p == "LICENSE"),
    "xterm-xterm-5.5.0.tgz": ("xterm", lambda p: p in ("lib/xterm.js", "css/xterm.css", "LICENSE")),
    "xterm-addon-fit-0.10.0.tgz": ("xterm-fit", lambda p: p in ("lib/addon-fit.js", "LICENSE")),
    "yakit-libs-yakit-ui-icons-0.2.9.tgz": ("icons-source", lambda p: p in ("LICENSE", "dist/index-CS16Uqfu.js")),
}

def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("reference", type=Path)
    args = parser.parse_args()
    src = args.reference / "app/renderer/src/main/src"
    OUT.mkdir(parents=True, exist_ok=True)
    provenance = {"reference_version": json.loads((args.reference / "package.json").read_text(encoding="utf-8"))["version"], "packages": {}}
    for archive_name, (folder, select) in PACKAGES.items():
        archive_path = TOOL / "_downloads" / archive_name
        provenance["packages"][archive_name] = hashlib.sha256(archive_path.read_bytes()).hexdigest()
        with tarfile.open(archive_path) as archive:
            for member in archive.getmembers():
                if not member.isfile() or not member.name.startswith("package/"):
                    continue
                relative = member.name[len("package/"):]
                if ".." in PurePosixPath(relative).parts or not select(relative):
                    continue
                dest = OUT / folder / relative
                dest.parent.mkdir(parents=True, exist_ok=True)
                dest.write_bytes(archive.extractfile(member).read())
    original = (src / "utils/monacoSpec/fuzzHTTPMonacoSpec.ts").read_text(encoding="utf-8")
    start = original.index("monaco.languages.setMonarchTokensProvider(")
    end = original.index("monaco.languages.registerHoverProvider(", start)
    tokenizer = original[start:end].replace("fuzzHTTPMonacoSpec", "'http'")
    (OUT / "http-language.js").write_text("// Adapted from Yakit; AGPL-3.0, see YAKIT-LICENSE.txt.\nmonaco.languages.register({id:'http'});\n" + tokenizer, encoding="utf-8")
    original = (src / "utils/monacoSpec/theme.ts").read_text(encoding="utf-8")
    theme = original[original.index("const defineMonacoTheme"):original.index("export { applyYakitMonacoTheme")]
    theme = theme.replace("(vars: CssVars, themeGlobal: Theme)", "(vars, themeGlobal)")
    theme = theme.replace(": Record<Theme, Record<string, string>>", "")
    theme = theme.replace("generatorColor(vars, themeGlobal)", "({selectionBackground: vars['--Colors-Use-Warning-Border']})")
    (OUT / "monaco-theme.js").write_text("// Adapted from Yakit; AGPL-3.0, see YAKIT-LICENSE.txt.\n" + theme + "\nwindow.applyYakitMonacoTheme = defineMonacoTheme;\n", encoding="utf-8")
    (OUT / "logo.png").write_bytes((src / "assets/yakitLogo.png").read_bytes())
    (OUT / "YAKIT-LICENSE.txt").write_bytes((args.reference / "LICENSE.md").read_bytes())
    (OUT / "PROVENANCE.json").write_text(json.dumps(provenance, ensure_ascii=False, indent=2), encoding="utf-8")
    with tarfile.open(TOOL / "_downloads/yakit-libs-yakit-ui-icons-0.2.9.tgz") as archive:
        matches = [m for m in archive.getmembers() if m.isfile() and ("ClockOutlined" in m.name or "ChevronDownOutlined" in m.name)]
        for member in matches[:2]:
            print(member.name)
            print(archive.extractfile(member).read().decode("utf-8")[:3000])
    print("离线资源已准备:", OUT)

if __name__ == "__main__":
    main()
