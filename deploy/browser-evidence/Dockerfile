FROM node:22-bookworm-slim
ARG DEBIAN_MIRROR=http://deb.debian.org
# node:slim includes Node's Mozilla roots but no system CA bundle for apt HTTPS.
RUN mkdir -p /etc/ssl/certs && node -p "require('node:tls').rootCertificates.join('\n')" > /etc/ssl/certs/ca-certificates.crt \
    && sed -i "s|http://deb.debian.org|$DEBIAN_MIRROR|g" /etc/apt/sources.list.d/debian.sources \
    && apt-get update && apt-get install -y --no-install-recommends \
      ca-certificates chromium chromium-sandbox libnss3-tools fonts-dejavu-core fonts-noto-cjk python3 procps \
    && rm -rf /var/lib/apt/lists/*
WORKDIR /opt/playwright-mcp
COPY package.json package-lock.json exclusive-evidence.cjs ./
RUN npm ci --ignore-scripts --omit=dev && node exclusive-evidence.cjs && npm cache clean --force
COPY renderer.py /opt/yak/renderer.py
COPY entrypoint.sh /usr/local/bin/start-browser
ENV HOME=/tmp/browser-home PYTHONDONTWRITEBYTECODE=1
USER 65534:65534
WORKDIR /evidence
ENTRYPOINT ["/usr/local/bin/start-browser"]
