#!/usr/bin/env python3
"""Create local credentials once; never rewrite existing configuration or state."""
import os
from pathlib import Path
import secrets
import sys


def create_private(path, content):
    try:
        fd = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
    except FileExistsError:
        return
    with os.fdopen(fd, 'wb') as stream:
        stream.write(content)


def initialize(root):
    root.mkdir(parents=True, exist_ok=True)
    state = root / 'state'
    state.mkdir(mode=0o700, exist_ok=True)
    (state / 'yak').mkdir(mode=0o700, exist_ok=True)
    create_private(root / '.env', (
        '# 本机私有配置；不提交到 Git\n'
        'COMPOSE_PROJECT_NAME=artex\n'
        'POSTGRES_USER=artex\n'
        f'POSTGRES_PASSWORD={secrets.token_hex(32)}\n'
        'POSTGRES_DB=artex\n'
        'ARTEX_PORT=8787\n'
        'ARTEX_PROXY_PORT=8788\n'
    ).encode())
    # ARTEX trims whitespace when loading a key. Hex keeps every random byte
    # significant and avoids a read-only key being mistaken for a short file.
    create_private(state / 'jwt.key', secrets.token_hex(32).encode())


if __name__ == '__main__':
    initialize(Path(sys.argv[1]) if len(sys.argv) > 1 else Path(__file__).resolve().parents[2])
