#!/bin/bash
set -euo pipefail
exec "$(dirname "$0")/artex-stack.sh" start --open
