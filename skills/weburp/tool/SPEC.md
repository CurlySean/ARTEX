# Web Repeater 项目规格（内部自用工具）

目标：像素级复刻 Burp Suite 2026 Repeater 页面（Light 主题、中文 UI）+ 一个模拟终端页（cmd/powershell/bash），由本地 Python 后端驱动，供 AI 自动化发包、灌数据、截图取证。

## 项目结构

```
D:\tmp\kimi\repeater\
├── server.py            # 后端（stdlib 为主，h2 可选，用 .venv 运行）
├── static\
│   ├── repeater.html    # Burp Repeater 复刻页（单文件，无外部依赖）
│   └── terminal.html    # 终端页（单文件，无外部依赖）
├── evidence\            # 场景存储 *.json
├── assets\theme\        # 从 Burp jar 解出的主题文件（参考用，运行时不需要）
├── .venv\               # python 3.13 + pillow + h2
└── SPEC.md
```

## 一、配色（全部来自 Burp 官方 LightTheme.json + 截图像素验证）

### 基础
- 页面/面板背景：`#FFFFFF`（bg.1）
- 次级背景（底部栏、顶部标签条）：`#FBFBFB`（bg.2）
- 悬停/胶囊背景：`#EEEEEE`（bg.3）
- 边框/分隔线：`#DFDFDF`（mono.4）；搜索框等输入边框：`#C9C9C9`（mono.5 偏浅时可用 #DFDFDF）
- 正文文本：`#2B2B2B`（text.body）；标题/悬停文本：`#000000`；禁用文本：`#4B4B4B`→实际视觉用 `#787878`
- 图标默认：`#2B2B2B`；图标悬停 `#000000`；图标禁用/非激活 `#B0AFAF`

### 主色
- 主橙（发送按钮 bg、消息 tab 下划线）：`#DB612F`（primary.2，已像素验证）
- 品牌橙（顶部 Repeater 标签条激活下划线）：`#FF6633`（primary.core，已像素验证）
- 按钮悬停橙：`#AD5B28`（primary.1）
- 蓝（选中态按钮 bg，如布局切换/Inspector 图标）：`#26649D`（secondary.core，已像素验证）
- 选择区背景：`#CADAF0`（secondary.6），选择区文字 `#FFFFFF`

### 编辑器语法色（message editor）
- 普通文本：`#141414`
- 首行（请求行/状态行）：`#141414`
- Header 名：`#000075`；Header 值：`#202020`
- 参数名：`#0000C0`；参数值：`#A01010`
- 行号：`#787878`；行号栏右边框：`#DDDDDD`
- 当前行背景：`#F0F0F0`（横跨行号栏+文本区）
- 字符串 `#008000`、数字 `#0000FF`、布尔 `#000075`、注释 `#005A00`、标签名 `#B000C0`（美化视图用）

## 二、字体

- UI 字体：`"Segoe UI", "Microsoft YaHei", sans-serif`，Burp 12pt = **CSS 16px**（100% 缩放基准）。按钮文字 bold。
- 编辑器字体：用户 Burp 实配 = **黑体 12pt** → CSS `"SimHei", monospace` 16px，行高 ~21px。
- 面板标题（"请求"/"响应"）：bold，~16px。
- 支持 `?zoom=1.5` 参数：对整页 `zoom` 缩放，校准用户 Burp 显示缩放（截图参考≈1.6x）。

## 三、布局结构（/repeater 页）

自上而下：
1. **顶部标签条**（高 ~31px，bg #FBFBFB，底部 1px #DFDFDF 分隔线）：Repeater 场景标签，胶囊样式（圆角 ~8px，未选中 bg #EEEEEE，选中 bg #FFFFFF + 底部 3px #FF6633 下划线），标签文字小（~13px #2B2B2B），最后一个 "+" 添加标签。标签名 = 场景 name。
2. **工具栏**（bg #FFFFFF，padding ~8px 12px，高约 48px）：
   - `[发送]` 主按钮：bg #DB612F，白字 bold，圆角 ~6px，padding 6px 18px，无边框
   - 齿轮图标按钮：bg #EEEEEE 圆角（截图中常态带灰底），深灰齿轮 SVG
   - `[取消]`：bg #FFFFFF，1px #C9C9C9 边框，#2B2B2B bold 字，圆角 6px
   - 历史 split 按钮组：`[<]` `[∨]` 与 `[>]` `[∨]`，白底灰边圆角，深色 chevron
   - **不做** Burp AI 按钮
3. **主区**：左右两栏，中间 1px #DFDFDF 分隔条（可拖拽，拖拽柄 ~6px 命中区）。左"请求"，右"响应"。每栏结构相同：
   - 标题行：`请求` / `响应`（bold，padding ~12px 12px 6px）
   - tab 行（bg #FFFFFF）：左 tabs `美化` `Raw` `Hex`（响应多 `页面渲染`）；tab padding ~10px 15px，选中：文字 #000 bold + 底部 3px #DB612F 下划线；未选中 #2B2B2B。tab 行底部通栏 1px #DFDFDF。
   - tab 行右侧图标（请求栏）：眼睛-斜杠（灰 #B0AFAF）、蓝色圆角方块 Inspector 图标（bg #26649D 白色glyph）、`\n` 换行切换（深色文字图标）、☰ 汉堡菜单。响应栏同左三个 + 最右**布局切换三段钮**（选中段 bg #26649D 白 glyph，未选 bg #DFDFDF 深色 glyph，圆角端头；三段=左右分栏/上下分栏/单栏）。
   - 编辑器区：行号栏 ~30px 宽（行号右对齐 #787878，右边框 1px #DDDDDD），文本区 padding-left ~8px。当前行整行 bg #F0F0F0。语法高亮按上表。请求栏可编辑，响应栏只读。
   - **底部栏**（bg #FBFBFB，顶部 1px #DFDFDF，高 ~42px）：`?` 圆圈帮助图标、齿轮、`←` `→`（白底灰边圆角小按钮）、搜索框（白底、#C9C9C9 边、圆角 8px、placeholder "Search" 灰字、右侧放大镜图标、flex 撑满）、`0高亮` 文本（#2B2B2B，搜索时显示 N高亮）。
4. 响应栏右上的布局三段钮在**请求栏没有**。

### 各视图行为
- **Raw**：原始报文 + 上述语法着色（首行、header 名/值、query 参数名/值着色；其余 #141414）。
- **美化**：headers 原样 + body 若是 JSON/XML 则格式化缩进显示，应用对应语法色。
- **Hex**：hex dump（offset | 16字节hex | ascii），等宽字体。
- **页面渲染**（仅响应）：sandbox iframe 渲染 body HTML。
- 编辑器实现：**自绘 textarea-overlay**（透明 textarea 盖在高亮 pre 上，滚动同步），不引外部库。请求可编辑（编辑触发重高亮、当前行跟踪、撤销交给 textarea 原生），响应只读用 pre。
- 发送：编辑区内容 +（可选自动更新 Content-Length，默认开）→ `POST /api/send` → 响应回显到响应栏；发送中 `发送` 变灰，`取消` 可用。
- 历史：每次发送入历史栈，工具栏 `<` `>` 切换。
- 搜索：输入即高亮全部匹配（bg #FFFF00），右侧显示 `N高亮`，`←` `→` 跳转到上/下一个（当前匹配 bg #FFAFAF）。
- `\n` 按钮：切换自动换行。
- 加载场景：`?scene=<id>&token=<t>&view=raw&zoom=1.6`，渲染完成后 `window.__ready = true`。
- `&send=1`：加载后自动发送一次，响应到达后才置 `__ready`（自动化截图一次成型）。
- AI 侧栏：场景 JSON 带 `ai` 字段（`[{"text":"...","kind":"action|success|fail"}]`，kind 可省；纯字符串视为一条分析）时，页面左侧显示 "Burp AI" 侧栏（320px，紫色 #4B44AE 主题，气泡 #F4F3FF/#DBD9FC，底部装饰输入框），用于模拟 AI 自主攻击的动作与结果分析；`&ai=0/1` 强制隐藏/显示；上下分栏布局下自动隐藏。
- 无场景参数时显示内置 demo 场景（与参考截图同内容：SQL 注入 GET + 505 响应）。

## 四、终端页（/terminal）

- 主题 `?shell=cmd|ps|bash`：
  - **cmd**：黑底 #0C0C0C，白字 #CCCCCC，`Consolas, "新宋体", monospace` 16px；首行 banner `Microsoft Windows [版本 10.0.22631.4037]` + `(c) Microsoft Corporation。保留所有权利。` + 空行；提示符 `C:\Users\Administrator>`。
  - **ps**：蓝底 #012456，白字；提示符 `PS C:\Users\Administrator>`。
  - **bash**：黑底 #0C0C0C；提示符 `root@target:~#`（绿字 `root@target` + `:` + 蓝字 `~` + `#`）。
- 内容来自场景 `entries[]`：`{cwd, cmd, output, exit}`，逐条渲染 `提示符+命令` 换行 `输出`。最后一条后显示当前提示符 + 闪烁方块光标（截图前 __ready 时可选择隐藏光标：`&cursor=0`）。
- 渲染完成 `window.__ready = true`。

## 五、后端 server.py

用项目 `.venv`（python 3.13，已装 h2；pillow 仅构建期用）。

### 静态与页面
- `GET /repeater` → static/repeater.html；`GET /terminal` → static/terminal.html；`GET /` → 302 /repeater?token=...
- 所有请求（含静态）校验 `?token=` 或 `Authorization: Bearer`；启动时生成随机 token 并打印完整 URL。
- 仅监听 127.0.0.1（默认 port 8777，`--port` 可改）；校验 Host 头为 127.0.0.1/localhost 防 DNS rebinding。

### 场景 API（私有状态目录中的 *.json）
- `POST /api/scene` body=场景JSON（无 id 则生成）→ 保存返回 `{"id": ...}`
- `GET /api/scene/<id>` → 场景JSON；`GET /api/scene` → 列表（id+name+type+created）
- `DELETE /api/scene/<id>`

场景格式：
```json
{
  "id": "r-9f3a2c", "type": "repeater", "name": "1", "created": "iso8601",
  "target": {"host": "192.0.2.66", "port": 8009, "tls": false},
  "request_b64": "...", "response_b64": "...",
  "request": "...(文本，与 _b64 二选一)", "response": "...",
  "view": "raw",
  "history": []
}
```
终端场景：`{"id":"t-xxx","type":"terminal","name":"shell","shell":"cmd","banner":true,"entries":[{"cwd":"C:\\Users\\Administrator","cmd":"whoami","output":"...","exit":0}]}`

原始字节一律可 base64 传输（byte-exact）；纯文本字段为便捷入口。

### 发包 API
- `POST /api/send`：
  ```json
  {"request_b64": "...", 或 "request": "...",
   "target": {"host":"x","port":443,"tls":true},   // 可选；缺省从 Host 头解析，端口默认 80/443
   "tls": null,            // 可选覆盖
   "http2": "auto",        // auto|never|force（force 用 h2 ALPN）
   "timeout": 30,
   "update_content_length": true,
   "scene_id": "r-xxx"     // 可选，发送后把 request/response 写回该场景并追加 history
  }
  ```
  返回：`{"ok":true,"response_b64":"...","http_version":"1.1","elapsed_ms":123,"peer":"1.2.3.4:80","error":null}`
- `POST /api/cancel` `{"send_id":"..."}`（/api/send 异步模式可选；简单实现：同步 send + 客户端 AbortController，服务端收到连接断开即关闭 socket）

### 发包引擎要求（核心！）
1. **HTTP/1.x**：裸 socket 逐字节发送编辑器原文（CRLF 原样），不改任何字节；TLS 用 `ssl.create_default_context()` + `check_hostname=False` + `verify_mode=CERT_NONE`，SNI=Host 头值（可被 target.host 覆盖）。
2. 响应读取：按 Content-Length / chunked / 连接关闭三种方式读完；**返回原始字节**（不解压，前端 Raw 显示原始报文；美化视图前端自行解码 gzip/deflate/br）。
3. **HTTP/2**（`http2=force` 或 TLS ALPN 协商到 h2）：用 `h2` 库把请求翻译成 h2 帧（:method/:path/:authority 从请求行+Host 推导），收响应后**翻译回 HTTP/1.1 风格文本**回显。
4. **WebSocket**：请求含 `Upgrade: websocket` 时，完成握手后返回握手响应；帧交互二期。
5. 目标与 Host 头解耦：可连 A 地址但 Host/SNI 写 B。
6. 错误（连接失败/超时/TLS 错误）返回 `{"ok":false,"error":"..."}`，前端在响应栏显示错误文本。

### CLI
`python server.py [--port 8777] [--token xxx] [--no-open]`：打印 `http://127.0.0.1:8777/repeater?token=xxx`，默认不自动开浏览器（AI 用 CDP/headless 截图）。

## 六、验收

1. `POST /api/scene` 灌入 demo → headless chrome `--screenshot --window-size=1920,1080` 截 `/repeater?scene=...&token=...` → 与 Burp 参考截图并排对比。
2. 本地起测试 HTTP 服务，`/api/send` 发原始包，验证响应 byte-exact 回显。
3. 终端页三主题各截一张。
