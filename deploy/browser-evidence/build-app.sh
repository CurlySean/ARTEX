#!/bin/sh
set -eu
cd "$(dirname "$0")/../.."
case "$(docker info --format '{{.Architecture}}')" in
    aarch64|arm64) arch=arm64 ;;
    x86_64|amd64) arch=amd64 ;;
    *) echo "需要 Linux amd64 或 arm64 Docker 引擎" >&2; exit 1 ;;
esac
ARTEX_OUTPUT="dist/$arch/artex" ./build.sh --target "linux/$arch" --no-compress
docker build --build-arg "DEBIAN_MIRROR=${DEBIAN_MIRROR:-http://deb.debian.org}" --platform "linux/$arch" -t artex-branch-evidence:local .
