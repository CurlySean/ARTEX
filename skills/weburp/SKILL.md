---
name: weburp
description: 通过仅本机 HTTP API 操作 Weburp，默认使用 Yakit 模式完成授权的 HTTP 请求重放、原始请求/响应展示、终端记录渲染及证据截图。仅在用户明确要求时切换 Burp 模式，不用于未授权目标。
---

# Weburp

Weburp 是跨平台本地服务，提供请求重放、终端记录展示、保留原始字节的 HTTP 发送、场景存储及经校验的浏览器截图。本 skill 默认选择 Yakit 风格界面，同时保留 Burp 兼容模式。

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

## 默认界面

- 用户未指定风格时，`start`、`capture repeater` 和 `capture terminal` 必须显式传入 `--style yakit`，默认使用 Yakit 模式。
- 只有用户明确要求 Burp 风格时，才改用 `--style burp`。CLI 为兼容旧用法仍默认 Burp，因此不能省略 `--style` 并假定它会使用 Yakit。
- 页面地址使用 `start --style yakit` 的输出；请求/响应页面为 `/yakit`，终端记录页面为 `/yakit/terminal`。两者沿用相同的 Token 鉴权与场景 API。
- 未指定主题与缩放时，使用 Yakit 的浅色主题和缩放 1；用户指定的主题、缩放或截图尺寸优先。

## API-first workflow

Use the controller to start the service and call its HTTP API at `http://127.0.0.1:<port>`:

```bash
PYTHON=python3                       # Windows commonly uses: python
"$PYTHON" <skill_dir>/tool/weburp.py start --style yakit
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
"$PYTHON" <skill_dir>/tool/weburp.py capture repeater --style yakit \
  --request request.txt --response response.txt \
  --out /absolute/path/evidence.png --host 127.0.0.1 --port 8080

# Request only: Weburp sends it once before capture.
"$PYTHON" <skill_dir>/tool/weburp.py capture repeater --style yakit \
  --request request.txt --out /absolute/path/evidence.png \
  --host 127.0.0.1 --port 8080

# Terminal transcript.
"$PYTHON" <skill_dir>/tool/weburp.py capture terminal --style yakit \
  --out /absolute/path/terminal.png --shell bash \
  --entry '/tmp|||whoami|||analyst|||0'
```

For multiple terminal entries, use `--entries-file` with a JSON array containing `cwd`, `cmd`, `output`, and `exit`.

仅在场景已经存在、需要自定义 URL 参数或尺寸时使用 `shot`。默认向它传入本机 `/yakit` 或 `/yakit/terminal` 场景 URL；`shot` 不接受 `--style`，风格由 URL 路径决定。截图仅接受本机 Weburp 场景地址。

## Runtime notes

- Default listener: `127.0.0.1:8777`.
- Default state directory: `~/.weburp`; override with an absolute `WEBURP_STATE_DIR`.
- Optional outbound proxy: set `WEBURP_UPSTREAM_PROXY` to an HTTP proxy on `127.0.0.1` or `localhost`.
- Optional browser path: set `WEBURP_BROWSER`.
- HTTP/2 requires the Python `h2` package; HTTP/1.x works without it.
- Run `weburp.py doctor` to verify the browser and bundled CJK font.
- Stop the local service with `weburp.py stop` when it is no longer needed.

## Yakit 风格界面

- `python weburp.py start --style yakit`：启动或复用同一服务并输出 Yakit 风格地址。
- 页面为 `/yakit` 和 `/yakit/terminal`，鉴权、场景 API 和仅本机监听的边界不变。
- 本 skill 的所有 `capture` 截图默认显式使用 `--style yakit`；可追加 `--theme light|dark`。Yakit 模式默认缩放 1，显式选择的 Burp 模式仍默认缩放 1.6。
- 提供 `--response` 时只渲染，省略时会向授权目标真实发送一次。
- 终端条目只被渲染，不执行。截图应标注为工具渲染结果，不能据此声称已在真实 Yakit 或终端中完成操作。
- 没有真实基准截图时，不得声称与手动截取的 Yakit 完全一致；字体、DPI、窗口尺寸和面板状态均影响对齐。
- 详细用法与许可边界见 `tool/README.md` 和 `tool/assets/yakit/THIRD_PARTY.md`。

## ARTEX 本机部署

在 ARTEX 的 Bash 工具中运行 `python3 /app/skills/weburp/tool/weburp.py`。报告截图显式使用 `capture repeater --style yakit --request ... --response ... --out ...`，只渲染已保存的请求和响应。截图通过容器内回环接口交给独立的 Chromium 渲染器，历史 `weburp` Skill 绑定和证据路径继续可用。
