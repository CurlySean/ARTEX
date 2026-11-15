"""Shared private runtime directory; scene data stays outside the skill source."""
import os
from pathlib import Path


def state_dir():
    override = os.environ.get('WEBURP_STATE_DIR')
    base = Path(override).expanduser() if override else Path.home() / '.weburp'
    if not base.is_absolute():
        raise ValueError('WEBURP_STATE_DIR must be an absolute path')
    if base.is_symlink():
        raise ValueError('weburp state directory must not be a symlink')
    base.mkdir(mode=0o700, parents=True, exist_ok=True)
    return base
