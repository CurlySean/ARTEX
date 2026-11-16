"""Yak entrypoint for the bundled Yakit-style HTTP evidence tool."""

import os
import sys
from pathlib import Path


def yakit_args(args):
    args = list(args)
    if not args or args[0] not in {"start", "capture"}:
        return args
    for index, value in enumerate(args):
        if value == "--style" and index + 1 < len(args):
            args[index + 1] = "yakit"
            return args
        if value.startswith("--style="):
            args[index] = "--style=yakit"
            return args
    return [*args, "--style", "yakit"]


def configure_env():
    aliases = {
        "YAK_TOKEN": "WEBURP_TOKEN",
        "YAK_BROWSER": "WEBURP_BROWSER",
        "YAK_UPSTREAM_PROXY": "WEBURP_UPSTREAM_PROXY",
    }
    for public, internal in aliases.items():
        if public in os.environ:
            os.environ.setdefault(internal, os.environ[public])
    os.environ.setdefault("WEBURP_STATE_DIR", os.environ.get("YAK_STATE_DIR", str(Path.home() / ".yak")))


def main():
    configure_env()
    sys.argv[1:] = yakit_args(sys.argv[1:])
    import weburp

    if os.environ.get("ARTEX_YAK_RENDERER") == "1" or (Path("/app/artex").exists() and (Path(__file__).with_name("artex_renderer.py")).exists()):
        from artex_renderer import configure
        configure(weburp)
    return weburp.main()


if __name__ == "__main__":
    sys.exit(main())
