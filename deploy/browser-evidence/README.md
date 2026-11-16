# 在另一台机器启用报告截图

新机器推荐使用 [统一部署入口](../unified/README.md)，它包含四个服务的 Compose 配置和启动、停止脚本。下列步骤保留为手动安装方式。

使用本分支的 ARTEX 镜像、PostgreSQL 和两个 Chromium 服务。Playwright 供 Agent 操作目标网页，Yak 根据已保存的请求和响应生成报文截图。浏览器服务在当前 Compose 项目的网络内通信，截图保存在项目的 `data/` 中。

Yakit 界面资源来自提供的 `yak.zip`（SHA-256 `f732144dc861e7091d2686e5dcc02674855a36919cb7df1b626c94fc678c9815`），已纳入 `skills/yak/`。它提供本地报文界面，包内不包含完整 Yak 扫描引擎；资源来源与许可见 `skills/yak/tool/assets/yakit/THIRD_PARTY.md`。

## 首次安装

适用于 macOS、Linux 或 WSL2，Docker 引擎为 Linux arm64 或 amd64。主机需有 Docker Compose v2（支持 `up --wait`）、Python 3、Go 1.26.3 或更新版本、Node.js 22、npm、bash 和 rsync。首次构建需要联网。

```bash
git clone -b feat/report-templates https://github.com/CurlySean/ARTEX.git
cd ARTEX
cp .env.example .env
# 编辑 .env，设置自己的 POSTGRES_PASSWORD
./deploy/browser-evidence/build-app.sh
python3 deploy/browser-evidence/install.py
```

安装程序提示输入 ARTEX 的管理员密码。新数据库会提示设置密码，也可通过环境变量 `ARTEX_TOKEN` 提供已有管理员会话。安装完成后访问 <http://127.0.0.1:8787>，在「系统 → LLM」配置本机使用的模型。数据库、访问密钥、任务和用户截图随各自实例保存。

构建从当前检出的源码生成带有报告模板和 ZIP 导出功能的应用镜像。若访问 Debian 包仓库较慢，可在上述两个命令前设置 `DEBIAN_MIRROR` 为同时提供 `/debian` 和 `/debian-security` 的镜像站根地址。

## 安装会配置什么

- 在「系统 → MCP」注册 `browser-evidence`，地址为 `http://artex-browser:8931/mcp`。每次 Agent 运行有独立浏览器会话，Chromium 将任务网站的请求发送到 ARTEX 流量代理，并信任当前实例的公共 CA。
- 开启流量捕获和 Agent 流量关联，将 Playwright 和 Yak 绑定到 [worker](prompts/worker.md)、[pentest](prompts/pentest.md) 与 [报告撰写者](prompts/reporter.md)。这三个文件是可查看、可复制的完整提示词。对已有自定义提示词，安装程序保留当前文字和工具绑定，只补入缺失的取证章节。重复执行会重新核对工具发现和绑定。
- 验证漏洞时，Agent 将网页截图交接为 `browser-evidence/<任务ID>/<步骤>/<文件名>.png`。报告撰写者从已绑定流量生成 Yak 图，将两类截图放入报告的「证据」章节。ZIP 导出会复制被引用的图片并生成包内相对链接。
- Yak 的控制器、渲染页面、字体及其许可证位于 [Yak Skill](../../skills/yak/SKILL.md)。报文截图服务通过应用的 loopback 访问已保存的场景。

## 验证

在仓库根目录运行以下命令。检查会用 Playwright 打开本地 ARTEX 首页，并用 Yak 渲染一笔合成的 HTTP 请求与响应，随后从磁盘读取两份 PNG 的尺寸。无需 LLM 密钥或业务任务。

```bash
export COMPOSE_FILE=docker-compose.yml:docker-compose.evidence.yml
docker compose exec -T artex python3 - < deploy/browser-evidence/verify.py
```

预期输出包含 `browser.png 1365 900` 和 `yak.png 1920 1080`。要核验实际报告，选择有两类截图的漏洞，从发现页导出 ZIP，完整解压后使用 Markdown 阅读器打开报告。

后续使用同一组 Compose 文件和项目名启动、停止或查看日志。应用容器重建后执行 `python3 deploy/browser-evidence/install.py`，使 Yak 渲染器连接当前应用容器。已有部署请从原项目目录操作，确保 Compose 使用原有数据卷、`./data`、`./skills` 和数据库配置。


批量复测也可使用取证工具：安装脚本发现已有 `retester` Agent 时，会为它增加浏览器 MCP 和 `yak` Skill 绑定，并保留其他工具与提示词。每次复测的 `get_finding_retest_context` 会返回独立证据目录；使用不同截图文件名，避免覆盖历史证据。
