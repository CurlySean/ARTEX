# Yakit 风格界面的来源与许可

此模式是 Weburp 的本地渲染界面，不是 Yakit 官方发行版，也不表示已经连接 Yak 引擎。

## 原版参考

用户指定源码：`C:\AI\goods\yakit-master`，根 package.json 版本 `1.4.9-1109`。

- `native/layout.json` 使用隔离原版 Renderer 静态结构（清除报文、React/Electron 逻辑，动作重新绑定至 Weburp）；`native/style-Bwoq6x9r.css`、`native/inline.css`、`native/theme.css` 复用原版构建样式及 Ant Design 注入样式。来源记录见 `native/PROVENANCE.json`。不代表正在运行 Yakit。
- 构建样式中的 Ant Design / 图标资源保留其 MIT 许可（`native/ANTD-LICENSE.txt`、`native/ANT-ICONS-LICENSE.txt`）；KaTeX 字体保留 `native/KATEX-LICENSE.txt`，并纳入原版派生界面的 AGPL-3.0 来源说明。
- 布局尺寸参考：`pages/layout/HeardMenu/HeardMenu.module.scss`、`pages/layout/mainOperatorContent/MainOperatorContent.module.scss`、`components/layout/uiLayout.module.scss`。
- Web Fuzzer 参考：`pages/fuzzer/HTTPFuzzerPage.module.scss`、`pages/fuzzer/WebFuzzerPage/WebFuzzerPage.module.scss`。
- `http-language.js` 提取并适配自 `utils/monacoSpec/fuzzHTTPMonacoSpec.ts` 的 Monarch tokenizer，不包含 Electron IPC、补全或引擎调用。
- `monaco-theme.js` 提取并适配自 `utils/monacoSpec/theme.ts`；保留原始规则，使用 Yakit 默认橙色主题。
- `logo.png` 来自 `assets/yakitLogo.png`。
- 终端结构采用原版 Console 辅助窗口的 `terminalPage-module_aux-terminal-page_TSfgw`、`AuxXterm-module_aux-xterm_NhpsE` 样式类；复用默认字体、15px 字号及颜色，不保留原版历史日志、进程、IPC 或执行能力。
- 上述来自 Yakit 仓库的材料按仓库附带的 AGPL-3.0 处理，完整文本见 `YAKIT-LICENSE.txt`。对外分发或通过网络提供修改后的派生版本时，应遵守相应的源码提供及版权保留义务；不要把这些材料当作 MIT 代码重新许可。

## 固定版本的离线依赖

| 资源 | 版本 | 许可文件 |
| --- | --- | --- |
| Monaco Editor | 0.40.0 | monaco/LICENSE、monaco/ThirdPartyNotices.txt |
| @yakit-libs/color | 1.4.1 | color/LICENSE |
| @yakit-libs/yakit-ui-icons | 0.2.9 | icons-source/LICENSE |
| @xterm/xterm | 5.5.0 | xterm/LICENSE |
| @xterm/addon-fit | 0.10.0 | xterm-fit/LICENSE |

以上 npm 包按各包中的 MIT 许可使用。图标通过包内原版 SVG 定义导出为静态 SVG；运行时不需要 React。
`PROVENANCE.json` 保存下载包的 SHA-256，便于核对来源。运行时无 CDN、无外部字体或图标请求。

## 重建资源

在 tool 目录下载相同版本的 npm 包到 `_downloads` 后执行：

```bat
python scripts\prepare_yakit.py C:\AI\goods\yakit-master
node scripts\export_yakit_assets.cjs
```

下载时使用 `npm pack --ignore-scripts`；本项目不执行依赖包的安装脚本。上述命令只重建基础资源。`native/` 的隔离构建与静态导出步骤见 `_verification/REFERENCE_BUILD.md`、`_verification/export_native_layout.cjs`；导出器拒绝覆盖现有目录，重建前须保留并核对原产物。
