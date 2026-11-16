# ARTEX 统一部署

[compose.unified.yaml](../../compose.unified.yaml) 把 ARTEX、PostgreSQL、Playwright 浏览器和 Yak 截图服务放在一个 Docker Compose 项目中。Docker Desktop 中默认显示为 `artex`，可整组启停。此配置使用仓库内的源码和工具构建，不引用作者机器上的路径、镜像、数据库或密钥，也不部署 Weburp 服务。

## 换一台机器首次启动

支持 macOS、Linux 和 WSL2，Docker 引擎需为 Linux arm64 或 amd64。安装 Docker Compose v2（支持 `up --wait`）、Python 3、Go 1.26.3 或更新版本、Node.js 22、npm、bash 和 rsync。首次构建需要联网；后续启动直接使用已构建的镜像。 如 Debian 官方源下载缓慢，可使用镜像站，例如 `DEBIAN_MIRROR=https://mirrors.ustc.edu.cn ./artex-stack.sh start`。

```bash
git clone -b feat/report-templates https://github.com/CurlySean/ARTEX.git
cd ARTEX
./artex-stack.sh start
```

macOS 也可以双击仓库根目录的 **启动 ARTEX.command**。Docker Desktop 尚未运行时，脚本会先启动它；就绪后自动打开 ARTEX 网页。

首次启动自动生成本机 `.env` 中的随机数据库密码和 `state/jwt.key`，构建本分支应用与截图工具镜像，然后提示设置 ARTEX 管理员密码。安装程序注册浏览器 MCP，配置 worker、pentest、报告撰写者的取证提示词，并给已有的复测 Agent 绑定浏览器与 Yak。最后实际生成两种 PNG，验证成功才记录安装完成。中途失败可以重新运行同一命令。

完成后访问 <http://127.0.0.1:8787>，在「系统 → LLM」填写自己的模型配置。新实例使用新的 PostgreSQL 16 数据卷，GitHub 不包含原机器的任务、模板实例、LLM 配置或密钥。

## 日常操作

```bash
./artex-stack.sh start     # 启动整组；等待四个服务健康
./artex-stack.sh stop      # 停止整组，保留数据
./artex-stack.sh status    # 查看状态
./artex-stack.sh verify    # 实际验证 Playwright 与 Yak 截图
```

macOS 可双击 **停止 ARTEX.command** 停止整组。更新分支源码后，执行 `./artex-stack.sh install` 重新构建、安装并验证；输入当前管理员密码即可，已有自定义提示词及工具绑定会保留并补充取证章节。

验证输出应包含 `browser.png 1365 900` 和 `yak.png 1920 1080`。无需 LLM 密钥或业务目标。

## 端口和项目名

需要调整默认端口或运行多个实例时，先执行以下命令生成本机配置，再编辑 `.env`，最后启动：

```bash
python3 deploy/unified/init-local.py
# 编辑 .env 中的 COMPOSE_PROJECT_NAME、ARTEX_PORT、ARTEX_PROXY_PORT
./artex-stack.sh start
```

默认只监听 `127.0.0.1:8787` 与 `127.0.0.1:8788`。项目名决定 PostgreSQL 卷名，因此在同一个实例后续启动时应保持一致。各实例使用各自的仓库目录和端口。自定义数据库密码时使用 URL 安全字符；脚本生成的随机十六进制密码可直接使用。

通过 Compose 直接管理时，使用同一份文件：

```bash
docker compose -f compose.unified.yaml logs --tail 100 artex
docker compose -f compose.unified.yaml ps
```

## 本机文件

| 内容 | 保存位置 |
| --- | --- |
| 数据库 | `<项目名>_pgdata` Docker 命名卷 |
| 任务、报告、网页截图和流量 | `data/` |
| JWT 签名密钥和 Yak 状态 | `state/` |
| 数据库密码和可选 LLM 环境配置 | `.env` |
| 可复用工具源码 | `skills/yak/` |

`.env`、`state/`、`data/`、备份和验收文件均排除在 Git 与镜像构建上下文之外。启动与停止不删除数据。迁移已有数据需要另行传递数据库备份与上述私有目录；不要通过 Git 提交这些文件。

浏览器隔离、证据路径和提示词的说明见 [浏览器取证部署文档](../browser-evidence/README.md)。
