---
name: weburp
description: Operate a local Web Repeater and terminal-evidence service through its loopback HTTP API. Use for authorized HTTP request replay, raw request/response visualization, terminal transcript rendering, and evidence screenshots; do not use for targets without explicit permission.
---

# Weburp

Weburp is a cross-platform local service that provides a Burp-style Repeater page, a terminal transcript page, a byte-preserving HTTP sender, scene storage, and verified browser screenshots.

The implementation is in this skill directory:

```text
<skill_dir>/tool/
├── server.py
├── weburp.py
├── weburp_paths.py
├── static/
└── assets/
```

Resolve `<skill_dir>` from the loaded skill. Do not assume the skill is installed under a particular home directory.

## Safety boundary

Use request replay only when the user owns the target or has explicitly confirmed authorization. Keep the Weburp service bound to loopback. Do not expose its port or token to a LAN or public interface.

## API-first workflow

Use the controller to start the service and call its HTTP API at `http://127.0.0.1:<port>`:

```bash
PYTHON=python3                       # Windows commonly uses: python
"$PYTHON" <skill_dir>/tool/weburp.py start
"$PYTHON" <skill_dir>/tool/weburp.py status --json
"$PYTHON" <skill_dir>/tool/weburp.py api GET /api/health
```

`start` is idempotent. `status --json` returns the active base URL, port, token, process id, and Repeater URL. The `api` command reads the local token and sends an authenticated request to the loopback service without using system HTTP proxies.

For JSON request bodies, write a temporary JSON file in the current workspace and call:

```bash
"$PYTHON" <skill_dir>/tool/weburp.py api POST /api/scene --data-file scene.json
"$PYTHON" <skill_dir>/tool/weburp.py api POST /api/send --data-file send.json
```

Direct HTTP clients may instead use `Authorization: Bearer <token>`. Never send the token to a non-loopback address.

## Main API

Read `tool/README.md` when the API schema or URL parameters are needed.

- `GET /api/health` — service health.
- `POST /api/scene` — save a Repeater or terminal scene.
- `GET /api/scene` and `GET /api/scene/<id>` — list or read scenes.
- `DELETE /api/scene/<id>` — delete a scene.
- `POST /api/send` — send raw HTTP bytes and return raw response bytes.

Use base64 fields for byte-exact content:

```json
{
  "request_b64": "...",
  "target": {"host": "127.0.0.1", "port": 8080, "tls": false},
  "http2": "auto",
  "timeout": 30,
  "update_content_length": true
}
```

If `target` is omitted, Weburp infers it from the `Host` header. A `scene_id` writes a successful response back to that scene and appends its history.

## Evidence screenshots

Prefer `capture` for the common case because it starts the service, creates the scene, waits for rendering, and verifies the PNG:

```bash
# Existing request and response: render only; do not resend.
"$PYTHON" <skill_dir>/tool/weburp.py capture repeater \
  --request request.txt --response response.txt \
  --out /absolute/path/evidence.png --host 127.0.0.1 --port 8080

# Request only: Weburp sends it once before capture.
"$PYTHON" <skill_dir>/tool/weburp.py capture repeater \
  --request request.txt --out /absolute/path/evidence.png \
  --host 127.0.0.1 --port 8080

# Terminal transcript.
"$PYTHON" <skill_dir>/tool/weburp.py capture terminal \
  --out /absolute/path/terminal.png --shell bash \
  --entry '/tmp|||whoami|||analyst|||0'
```

For multiple terminal entries, use `--entries-file` with a JSON array containing `cwd`, `cmd`, `output`, and `exit`.

Use `shot` only when a scene already exists and custom URL parameters or dimensions are needed. Screenshots accept only local Weburp scene URLs.

## Runtime notes

- Default listener: `127.0.0.1:8777`.
- Default state directory: `~/.weburp`; override with an absolute `WEBURP_STATE_DIR`.
- Optional outbound proxy: set `WEBURP_UPSTREAM_PROXY` to an HTTP proxy on `127.0.0.1` or `localhost`.
- Optional browser path: set `WEBURP_BROWSER`.
- HTTP/2 requires the Python `h2` package; HTTP/1.x works without it.
- Run `weburp.py doctor` to verify the browser and bundled CJK font.
- Stop the local service with `weburp.py stop` when it is no longer needed.

## ARTEX 本机部署

在 ARTEX 的 Bash 工具中运行 `python3 /app/skills/weburp/tool/weburp.py`。例如，`api GET /api/health` 会按需启动并验证服务。使用 `capture repeater` 或 `capture terminal` 时，把 `--out` 设为当前任务工作目录中的 PNG 路径。该命令通过容器内回环接口调用非 root Chromium 渲染器；HTTP 重放仍由 ARTEX 容器内的 Weburp 服务发出。
