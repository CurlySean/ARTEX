# Weburp local HTTP API

Weburp is a local Burp-style Repeater, raw HTTP sender, terminal transcript renderer, and evidence screenshot tool. It runs only on loopback and protects every page and API route with a token.

## Start and inspect

```bash
python weburp.py start                     # default: 127.0.0.1:8777
python weburp.py status --json
python weburp.py api GET /api/health
python weburp.py stop
```

`status --json` returns values similar to:

```json
{
  "ok": true,
  "running": true,
  "base_url": "http://127.0.0.1:8777",
  "url": "http://127.0.0.1:8777/repeater?token=...",
  "port": 8777,
  "token": "...",
  "pid": 12345
}
```

The controller's `api` subcommand automatically reads the token and calls the local HTTP endpoint without using system proxies:

```bash
python weburp.py api POST /api/scene --data-file scene.json
python weburp.py api POST /api/send --data-file send.json
python weburp.py api DELETE /api/scene/r-123abc
```

A direct HTTP client can use `Authorization: Bearer <token>` or the `?token=<token>` query parameter. Never send the token to a non-loopback host.

## Pages

- `/repeater` — Burp-style Repeater page.
  - `scene=<id>` loads a scene.
  - `view=raw|pretty|hex` selects the initial view.
  - `zoom=1.6` scales the page.
  - `send=1` sends the request after loading and waits for the response before marking the page ready.
  - `ai=0|1` hides or shows the optional analysis sidebar.
- `/terminal` — terminal transcript page.
  - `shell=cmd|ps|bash`, `scene=<id>`, `zoom=<n>`, `cursor=0|1`.

Both pages set `window.__ready = true` after their scene and bundled font finish rendering.

## Scene API

All bodies are JSON.

### Create a Repeater scene

`POST /api/scene`

```json
{
  "type": "repeater",
  "name": "example",
  "target": {"host": "127.0.0.1", "port": 8080, "tls": false},
  "request_b64": "R0VUIC8gSFRUUC8xLjENCkhvc3Q6IDEyNy4wLjAuMTo4MDgwDQoNCg==",
  "response_b64": "SFRUUC8xLjEgMjAwIE9LDQpDb250ZW50LUxlbmd0aDogMA0KDQo=",
  "view": "raw",
  "ai": [{"kind": "action", "text": "Replay request"}]
}
```

Response: `{"ok":true,"id":"r-xxxxxx"}`.

### Create a terminal scene

`POST /api/scene`

```json
{
  "type": "terminal",
  "name": "verification",
  "shell": "bash",
  "banner": true,
  "entries": [
    {"cwd": "/tmp", "cmd": "whoami", "output": "analyst\n", "exit": 0}
  ]
}
```

### Read or delete scenes

- `GET /api/scene` — list scenes.
- `GET /api/scene/<id>` — read a scene.
- `DELETE /api/scene/<id>` — delete a scene.

Scenes are stored as JSON under the private state directory.

## Raw send API

`POST /api/send`

```json
{
  "request_b64": "...",
  "target": {"host": "example.test", "port": 443, "tls": true},
  "http2": "auto",
  "timeout": 30,
  "update_content_length": true,
  "scene_id": "r-xxxxxx"
}
```

Response:

```json
{
  "ok": true,
  "response_b64": "...",
  "http_version": "1.1",
  "elapsed_ms": 123,
  "peer": "203.0.113.10:443",
  "error": null
}
```

Notes:

- `request_b64` preserves exact bytes; `request` is a UTF-8 convenience field.
- `target` is optional when the request contains a `Host` header.
- Connection target and `Host` may differ for virtual-host or origin testing.
- `http2` accepts `auto`, `never`, or `force`.
- `update_content_length` defaults to `true`; set it to `false` only when exact malformed framing is intentional.
- Supplying `scene_id` writes a successful response back into the scene and appends history.
- WebSocket support stops after a successful HTTP 101 handshake; frame exchange is not implemented.
- HTTP/3 is not supported.

## Capture commands

```bash
python weburp.py capture repeater --request req.txt --response resp.txt --out shot.png --host 127.0.0.1 --port 8080
python weburp.py capture terminal --out term.png --shell bash --entry '/tmp|||whoami|||analyst|||0'
python weburp.py shot 'http://127.0.0.1:8777/repeater?scene=<id>&token=<token>&zoom=1.6' out.png
```

If `capture repeater` omits `--response`, the page sends the request once before capture. If a response is supplied, it only renders the saved evidence.

## Configuration

- `WEBURP_STATE_DIR` — absolute state directory; default `~/.weburp`.
- `WEBURP_TOKEN` — optional fixed URL-safe token.
- `WEBURP_BROWSER` — Chrome, Edge, or Chromium executable.
- `WEBURP_UPSTREAM_PROXY` — optional HTTP proxy at `127.0.0.1` or `localhost` for non-loopback outbound connections.

Run `python weburp.py doctor` to verify the browser and bundled CJK font. Install the Python `h2` package to enable HTTP/2; all HTTP/1.x features use the standard library.
