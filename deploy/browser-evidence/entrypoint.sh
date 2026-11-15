#!/bin/sh
set -eu
mkdir -p "$HOME/.pki/nssdb" "$HOME/.local/share/pki"
ln -sfn "$HOME/.pki/nssdb" "$HOME/.local/share/pki/nssdb"
certutil -N -d "sql:$HOME/.pki/nssdb" --empty-password
certutil -A -d "sql:$HOME/.pki/nssdb" -n "ARTEX traffic" -t "C,," -i /etc/artex/traffic-ca.pem
if [ "$ARTEX_CAPTURE" = true ]; then
    set -- --proxy-server "$ARTEX_BROWSER_PROXY" --proxy-bypass "$ARTEX_BROWSER_BYPASS"
else
    set --
fi
exec node /opt/playwright-mcp/node_modules/@playwright/mcp/cli.js \
  --host 0.0.0.0 --port 8931 --allowed-hosts artex-browser:8931,localhost:8931,127.0.0.1:8931 \
  --isolated --headless --sandbox --executable-path /usr/bin/chromium --ignore-roots \
  --output-dir /evidence --viewport-size 1365x900 --no-webmcp "$@"
