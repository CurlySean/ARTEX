#!/usr/bin/env bash
set -euo pipefail
export PATH="/usr/local/bin:/opt/homebrew/bin:/Applications/Docker.app/Contents/Resources/bin:$PATH"
cd "$(dirname "$0")"
export COMPOSE_FILE="$PWD/compose.unified.yaml"
compose=(docker compose)

ensure_docker() {
    command -v docker >/dev/null || { echo '请先安装 Docker 和 Compose v2。' >&2; exit 1; }
    if ! docker info >/dev/null 2>&1; then
        if [[ "$(uname -s)" != Darwin ]]; then
            echo '请先启动 Docker Engine。' >&2
            exit 1
        fi
        echo '正在启动 Docker Desktop…'
        open -a Docker
        for ((i=0; i<120; i++)); do
            if docker info >/dev/null 2>&1; then break; fi
            sleep 1
        done
        docker info >/dev/null
    fi
    docker compose version >/dev/null
}

verify() {
    "${compose[@]}" exec -T artex python3 - < deploy/browser-evidence/verify.py
}

install_stack() {
    for tool in python3 go node npm rsync; do
        command -v "$tool" >/dev/null || { echo "首次安装需要 $tool；参见 deploy/unified/README.md。" >&2; exit 1; }
    done
    ./deploy/browser-evidence/build-app.sh
    python3 deploy/browser-evidence/install.py
    "${compose[@]}" up -d --wait --wait-timeout 180
    verify
    touch state/.unified-installed
}

case "${1:-start}" in
    start|install)
        ensure_docker
        python3 deploy/unified/init-local.py
        "${compose[@]}" config --quiet
        if [[ "${1:-start}" == install || ! -f state/.unified-installed ]]; then
            install_stack
        else
            "${compose[@]}" up -d --wait --wait-timeout 180
        fi
        port=$("${compose[@]}" port artex 8787 | head -1)
        url="http://127.0.0.1:${port##*:}"
        echo "ARTEX、数据库、Playwright 和 Yak 已启动：$url"
        if [[ "${2:-}" == --open && "$(uname -s)" == Darwin ]]; then open "$url"; fi
        ;;
    stop)
        "${compose[@]}" stop
        echo 'ARTEX 整组已停止，数据库和任务文件已保留。'
        ;;
    status) "${compose[@]}" ps ;;
    verify) verify ;;
    *) echo '用法：./artex-stack.sh [start|stop|status|install|verify]' >&2; exit 2 ;;
esac
