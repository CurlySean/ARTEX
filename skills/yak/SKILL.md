---
name: yak
description: 在本机 Yakit 风格界面中查看已保存的 HTTP 请求与响应、重放授权请求并生成报告证据截图。
---

# Yak

这个 Skill 使用 `yak.zip` 提供的本地 Yakit 风格界面和 HTTP 证据工具。ARTEX 中的入口是 `tool/yak.py`，默认使用 Yakit 风格。它负责请求和响应展示、授权请求重放、场景存储与截图；包内不含完整 Yak 扫描引擎。

在 ARTEX 容器里使用：

```bash
python3 /app/skills/yak/tool/yak.py doctor
python3 /app/skills/yak/tool/yak.py start
python3 /app/skills/yak/tool/yak.py api GET /api/health
```

## 已有流量截图

报告撰写时，将同一笔交互的请求和响应保存为私有临时文件，只渲染已记录的证据，不重新发送：

```bash
python3 /app/skills/yak/tool/yak.py capture repeater \
  --request request.txt --response response.txt \
  --out /app/data/tasks/<任务ID>/report-evidence/<漏洞ID>/v<版本>/binding-<编号>.png
```

必须同时提供 `--request` 和 `--response`。渲染前遮盖有效凭据与无关个人数据；报告图注注明任何遮盖或节选。只在确认 PNG 已生成后引用它。

## 其他命令

- `capture terminal --entries-file entries.json --out /absolute/path.png` 只渲染已有终端记录，不执行命令。
- `api POST /api/scene --data-file scene.json` 保存场景；`api POST /api/send --data-file send.json` 会真实发送请求，只在授权测试工作流中使用。
- `status --json` 查看服务状态；输出含私有 Token，不要写入报告或日志。
- `stop` 停止本地服务。服务仅监听容器回环接口。
- `YAK_STATE_DIR` 可指定绝对路径；默认状态目录为 `~/.yak`。

详细 API、资源来源与许可见 `tool/README.md` 和 `tool/assets/yakit/THIRD_PARTY.md`。截图是保存报文的界面渲染，不能当作 Yak 扫描引擎运行记录。
