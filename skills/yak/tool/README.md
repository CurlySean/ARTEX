# Yak local HTTP API

Yak provides a local Yakit-style HTTP request editor, raw HTTP sender, terminal transcript renderer, and evidence screenshot tool. It runs only on loopback and protects every page and API route with a token.

## Start and inspect

```bash
python yak.py start                     # default: 127.0.0.1:8777
python yak.py status --json
python yak.py api GET /api/health
python yak.py stop
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
python yak.py api POST /api/scene --data-file scene.json
python yak.py api POST /api/send --data-file send.json
python yak.py api DELETE /api/scene/r-123abc
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
python yak.py capture repeater --request req.txt --response resp.txt --out shot.png --host 127.0.0.1 --port 8080
python yak.py capture terminal --out term.png --shell bash --entry '/tmp|||whoami|||analyst|||0'
python yak.py shot 'http://127.0.0.1:8777/repeater?scene=<id>&token=<token>&zoom=1.6' out.png
```

If `capture repeater` omits `--response`, the page sends the request once before capture. If a response is supplied, it only renders the saved evidence.

## Configuration

- `YAK_STATE_DIR` — absolute state directory; default `~/.yak`.
- `YAK_TOKEN` — optional fixed URL-safe token.
- `YAK_BROWSER` — Chrome, Edge, or Chromium executable.
- `YAK_UPSTREAM_PROXY` — optional HTTP proxy at `127.0.0.1` or `localhost` for non-loopback outbound connections.

Run `python yak.py doctor` to verify the browser and bundled CJK font. Install the Python `h2` package to enable HTTP/2; all HTTP/1.x features use the standard library.

## 新增 Yakit 风格

Yak 入口默认使用 Yakit 模式，复用同版本 Monaco 0.40.0、Yakit 默认配色与原版 SVG 图标，并使用 xterm 5.5.0 渲染终端记录。所有前端资源均在本机，不依赖 CDN。

```bat
cd /d <skill_dir>\tool
python yak.py doctor
python yak.py start --style yakit
```

启动命令输出带 Token 的 Yakit 风格页面地址。运行中的同一服务也可访问：

- `/yakit?token=...&scene=<id>`：Web Fuzzer 风格的请求重放页面。
- `/yakit/terminal?token=...&scene=<id>&cursor=0`：终端记录页面。
- `theme=light|dark`：浅色或深色，默认浅色。
- `zoom=1`：默认 100% 页面缩放。截图对齐时应固定窗口尺寸、系统 DPI 和浏览器版本。
- `config=1`：初始展开高级配置，默认折叠，与参考源码一致。
- `view=raw|pretty|hex|render`：响应的初始视图。
- `send=1`：页面加载后发送一次。只有发送成功并完成字体加载后才标记截图就绪。

### 功能

- 原始请求编辑；响应文本、美化、Hex 和隔离 HTML 预览。
- 高级配置支持独立的实际连接 Host/端口、HTTPS、HTTP/2、超时与 Content-Length 修复。
- 请求未编辑时保留原字节；只编辑请求头时不转码未改动的二进制请求体。
- 美化与 Hex 只改变显示，不修改保存的原始响应。
- 保存场景、加载场景、回放历史。服务端历史仍最多 50 条。
- `Ctrl+R` / `Ctrl+Enter` 发送，`Ctrl+S` 保存，`Esc` 关闭提示与历史列表。
- 终端只渲染传入记录，不执行命令；可显示 ANSI 颜色。

### 截图

已有请求与响应，只渲染、不重发：

```bat
python yak.py capture repeater --style yakit --request request.txt --response response.txt --name "Web Fuzzer-[1]" --zoom 1 --size 1440x900 --out yakit.png
```

只提供请求时会真实发送一次，因此目标必须已经获得授权：

```bat
python yak.py capture repeater --style yakit --request request.txt --host 127.0.0.1 --port 8080 --out yakit-live.png
```

终端记录：

```bat
python yak.py capture terminal --style yakit --shell ps --entries-file entries.json --name "终端记录" --zoom 1 --size 1100x650 --out terminal.png
```

深色界面追加 `--theme dark`。`yak.py` 默认使用 Yakit 模式和缩放 1。

### 验证与本机示例

```bat
node --test tests\http_bytes.test.cjs
python -m unittest discover -s tests -p test_yakit.py -v
```

`scripts\preview_yakit.py` 可创建独立的 `_verification\state` 目录并启动本机验收服务及受控目标，打印真实页面地址。
保持它运行时，在另一终端运行 `scripts\capture_yakit_samples.py` 可验证“保存响应渲染、终端记录、真实重放”三种截图流程。
该脚本启动的验收服务与用户默认的 `~/.yak` 数据隔离；不应对其使用默认状态目录的 stop 命令。

### 一致性与证据边界

这是一套 Yakit 风格的 Yak 适配界面，不是通过真实 Yakit / Yak 引擎操作后生成的截图。HTTP 页复用隔离原版导出的静态结构、生产 CSS 和 SVG，再将编辑器及发送动作接到 Yak。终端页按原版默认 Console 独立浮窗展示全幅终端，不附加 Web Fuzzer 工具栏；只渲染记录，不执行输入。未接入的插件、扫描器、热加载或完整 Fuzz 引擎不作为可用能力提供。

截图校验仅证明页面已渲染、中文字体校验通过、PNG 完整且尺寸正确；不证明导入的终端文字或响应实际发生过。应保留真实原始记录，并在报告中说明截图的生成方式。

已取得原版真实请求/响应截图和 Console 浮窗对照，并使用同一 Electron 27 / Chromium 118、DPR 1.5 核对：HTTP 页 11 个核心布局节点的位置、宽高差均为 0；终端字体及网格也与原版一致。但 HTTP 全图未掩码像素比较仍为 `NOT_IDENTICAL`（约 1.10% 像素不同），不能据此称为“完全一致”。真实连接状态、引擎元数据、原始响应头顺序及动画仍有差别；不会为了抹平差异而伪造状态或改变保存的原始字节。CLI 截图采用本机 Chrome，不同浏览器版本也可能影响栅格化。证据与限制见 `_verification/REPORT.md`、`_verification/VISUAL_DIFF.json`。

本次交付的用户已明确接受上述已记录的视觉差异，验收确认见 `_verification/USER_ACCEPTANCE.md`。该确认不代表技术上已达到逐像素完全一致。

资源来源、原版代码适配位置及许可证见 `assets/yakit/THIRD_PARTY.md`，Yakit 派生资源应遵守仓库附带的 AGPL-3.0。
