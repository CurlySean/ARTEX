/* Yakit-style local evidence UI. Shell is adapted, not a running Yak engine. */
(function () {
  "use strict";
  const $ = selector => document.querySelector(selector);
  const q = new URLSearchParams(location.search);
  const token = q.get("token") || "";
  const base = window.weburpYakitAssets;
  const B = window.WeburpBytes;
  const terminalMode = location.pathname === "/yakit/terminal";
  const icons = window.YakitIcons;
  const icon = name => icons[name] || "";
  const btn = (id, name, label, cls = "text", attrs = "") =>
    '<button id="' + id + '" type="button" class="' + cls + '" ' + attrs + '>' + icon(name) + label + '</button>';
  const state = {
    scene: null, id: q.get("scene"), request: new TextEncoder().encode("GET / HTTP/1.1\r\nHost: 127.0.0.1:8080\r\nConnection: close\r\n\r\n"),
    response: new Uint8Array(), reqView: "raw", resView: "raw", history: [], meta: null,
    busy: false, setting: false, theme: document.documentElement.dataset.theme
  };
  let reqEditor, resEditor, term, fitAddon;
  let viewGeneration = 0;
  function vars() {
    const style = getComputedStyle(document.documentElement);
    return new Proxy({}, {get: (_, name) => style.getPropertyValue(name).trim()});
  }
  async function api(path, method = "GET", body) {
    const response = await fetch(path, {
      method, headers: {"Authorization": "Bearer " + token, ...(body === undefined ? {} : {"Content-Type":"application/json"})},
      ...(body === undefined ? {} : {body: JSON.stringify(body)})
    });
    const value = await response.json();
    if (!response.ok || value.ok === false) throw new Error(value.error || "本地接口 HTTP " + response.status);
    return value;
  }
  function errorNotice(error, fatal = false) {
    $("#notice").textContent = error.message || String(error);
    $("#notice").hidden = false;
    if (fatal) {
      window.__ready = false;
      document.documentElement.dataset.weburpReady = "error";
    }
  }
  function hideNotice() { $("#notice").hidden = true; }
  function renderShell() {
    $("#app").innerHTML = window.weburpYakitLayout.html;
    document.body.classList.toggle("terminal-mode", terminalMode);
    if (terminalMode) {
      // 原版默认 Console 是独立的全幅终端，不显示 Web Fuzzer 页签或工具栏。
      $("#app").firstElementChild.hidden = true;
      $("#workspace").id = "replayWorkspace";
      $("#app").insertAdjacentHTML("afterbegin", '<div class="ant-app yakit-antd-app yakit"><div class="terminalPage-module_aux-terminal-page_TSfgw"><div class="AuxXterm-module_aux-xterm_NhpsE" id="workspace"></div></div></div>');
    }
    const status = document.createElement("div");
    status.hidden = true;
    for (const id of ["saveState","footerInfo","footerName","requestBytes","responseBytes","requestEncoding","responseEncoding","requestPosition","responsePosition"]) {
      const span = document.createElement("span"); span.id = id; status.appendChild(span);
    }
    $("#app").appendChild(status);
    $("#app").insertAdjacentHTML("beforeend", '<div id="notice" class="notice" role="alert" hidden></div><section id="history" class="history" aria-label="重放历史" hidden></section><section id="viewMenu" class="view-menu" aria-label="响应视图" hidden></section>');
    const z = Number(q.get("zoom") || 1);
    if (!(z >= 0.25 && z <= 4)) throw new Error("缩放比例必须为 0.25 到 4");
    document.body.style.zoom = z;
    const fit = () => { $("#app").style.height = window.innerHeight / z + "px"; };
    fit(); addEventListener("resize", fit);
    $("#themeToggle").title = "切换浅色和深色主题";
    $("#themeToggle").setAttribute("aria-label", "切换浅色和深色主题");
    $("#themeToggle").onclick = () => {
      state.theme = state.theme === "light" ? "dark" : "light";
      document.documentElement.dataset.theme = state.theme;
      q.set("theme", state.theme);
      history.replaceState(null, "", location.pathname + "?" + q);
      if (term) term.options.theme = xtermTheme();
      else window.applyYakitMonacoTheme(vars(), state.theme);
    };
    $("#menuToggle").onclick = () => {
      const menu = $("#nativeMenu");
      menu.hidden = !menu.hidden;
      $("#menuToggle").setAttribute("aria-pressed", String(!menu.hidden));
    };
    $("#openOther").title = terminalMode ? "请求重放" : "终端记录（仅渲染，不执行命令）";
    $("#openOther").onclick = () => {
      const route = terminalMode ? "/yakit" : "/yakit/terminal";
      location.href = route + "?token=" + encodeURIComponent(token) + "&theme=" + state.theme;
    };
    if (terminalMode) {
      $("#openOther").lastElementChild.textContent = "Web Fuzzer";
      $("#sceneName").textContent = "终端记录";
    }
    $("#saveScene").setAttribute("aria-label", "保存场景");
    $("#saveScene").onclick = () => saveScene().catch(errorNotice);
    $("#newScene").setAttribute("aria-label", "新建场景");
    $("#newScene").onclick = async () => {
      try {
        await saveScene();
        location.href = location.pathname + "?token=" + encodeURIComponent(token) + "&theme=" + state.theme;
      } catch (error) { errorNotice(error); }
    };
    document.querySelectorAll("button:not([id])").forEach(button => {
      if (!button.dataset.view && !button.dataset.action) {
        button.setAttribute("aria-disabled","true");
        button.title = "静态参考控件：此功能未接入";
      }
    });
    document.querySelectorAll("#nativeMenu textarea,#nativeMenu input").forEach(input => {
      input.readOnly = true; input.title = "静态 Codec 展示，未执行转换";
    });
    addEventListener("keydown", e => {
      if (e.key === "Escape") { hideNotice(); $("#history").hidden = true; $("#viewMenu").hidden = true; }
      if (!terminalMode && ((e.ctrlKey && (e.key.toLowerCase() === "r" || e.key === "Enter")) || (e.altKey && e.key === "Enter"))) {
        e.preventDefault(); if (!state.busy) send().catch(errorNotice);
      }
      if (e.ctrlKey && e.key.toLowerCase() === "s") { e.preventDefault(); saveScene().catch(errorNotice); }
      if ((e.key === "Enter" || e.key === " ") && e.target.matches('[role="button"]:not(button)')) {
        e.preventDefault(); e.target.click();
      }
    });
  }
  function renderRepeater() {
    const config = document.createElement("aside");
    config.className = "advanced"; config.id = "advanced"; config.hidden = true;
    config.innerHTML =
      '<h2>高级配置' + btn("closeConfig","","×","text icon",'aria-label="关闭高级配置"') + '</h2>' +
      '<div class="config-group"><h3>请求包配置</h3>' +
      '<label class="config-field">实际连接 Host<input id="targetHost" placeholder="默认使用请求中的 Host" autocomplete="off"></label>' +
      '<label class="config-field">实际连接端口<input id="targetPort" type="number" min="1" max="65535" placeholder="自动"></label>' +
      '<label class="config-field">HTTP 协议<select id="httpVersion"><option value="auto">自动协商</option><option value="never">HTTP/1.1</option><option value="force">HTTP/2</option></select></label>' +
      '<label class="config-inline"><span>自动修复 Content-Length</span><input id="fixCL" type="checkbox" checked></label></div>' +
      '<div class="config-group"><h3>请求超时</h3><label class="config-field">超时时间 / 秒<input id="timeout" type="number" min="1" max="300" value="30"></label></div>' +
      '<p class="config-note">实际连接地址可与报文 Host 不同。每次发送一个请求；不展开 Fuzz 标签，不执行插件。</p>';
    $("#workspace").appendChild(config);
    const targetLabel = document.createElement("span"); targetLabel.id = "targetLabel"; targetLabel.hidden = true;
    $("#workspace").appendChild(targetLabel);
    $("#configToggle").setAttribute("aria-expanded","false");
    window.applyYakitMonacoTheme(vars(), state.theme);
    const options = {
      value:"", language:"http", theme:"kurior", automaticLayout:true,
      scrollBeyondLastLine:false, fontFamily:'Consolas, "Courier New", monospace', fontWeight:"500", fontSize:12, lineHeight:16,
      showFoldingControls:"always", showUnused:true, wordWrap:"on", renderLineHighlight:"all",
      lineNumbers:"on", lineNumbersMinChars:5, minimap:{enabled:false}, contextmenu:false,
      renderWhitespace:"all", bracketPairColorization:{enabled:true,independentColorPoolPerBracketType:true},
      fixedOverflowWidgets:true, glyphMargin:true, unicodeHighlight:{ambiguousCharacters:false}
    };
    reqEditor = monaco.editor.create($("#requestEditor"),options);
    resEditor = monaco.editor.create($("#responseEditor"),{...options,readOnly:true,glyphMargin:false,minimap:{enabled:true}});
    const info = $("#responseInfo");
    resEditor.addOverlayWidget({getId:()=>"weburp-response-info",getDomNode:()=>info,getPosition:()=>({preference:monaco.editor.OverlayWidgetPositionPreference.TOP_RIGHT_CORNER})});
    reqEditor.onDidChangeModelContent(() => decoratePacket(reqEditor, "request"));
    resEditor.onDidChangeModelContent(() => decoratePacket(resEditor, "response"));
    $("#responseDetails").onclick = () => { info.hidden = !info.hidden; };
    $("#responseViews").onclick = showResponseViews;
    reqEditor.onDidChangeModelContent(() => {
      if (state.setting || state.reqView !== "raw") return;
      try { $("#requestBytes").textContent = requestBytes().length + " B"; $("#saveState").textContent = "未保存"; }
      catch (error) { errorNotice(error); }
    });
    reqEditor.onDidChangeCursorPosition(event => {
      $("#requestPosition").textContent = "行 " + event.position.lineNumber + "，列 " + event.position.column;
    });
    resEditor.onDidChangeCursorPosition(event => {
      $("#responsePosition").textContent = "行 " + event.position.lineNumber + "，列 " + event.position.column;
    });
    $("#send").onclick = () => send().catch(errorNotice);
    $("#showHistory").onclick = showHistory;
    $("#saveToolbar").setAttribute("aria-label","保存场景");
    $("#saveToolbar").onclick = () => saveScene().catch(errorNotice);
    $("#targetConfig").setAttribute("aria-label","实际连接配置");
    $("#targetConfig").onclick = $("#configToggle").onclick = toggleConfig;
    $("#closeConfig").onclick = toggleConfig;
    ["targetHost","targetPort","tls"].forEach(id => $("#"+id).addEventListener("change",updateTargetLabel));
    document.querySelectorAll("[data-view]").forEach(button => {
      button.onclick = () => { const side = button.dataset.side; const active = state[side === "request" ? "reqView" : "resView"]; setView(side,active === button.dataset.view ? "raw" : button.dataset.view).catch(errorNotice); };
    });
    document.querySelectorAll("[data-action]").forEach(button => {
      button.onclick = () => {
        const editor = button.dataset.side === "request" ? reqEditor : resEditor;
        if (button.dataset.action === "search") editor.getAction("actions.find").run();
        if (button.dataset.action === "wrap") {
          const current = editor.getOption(monaco.editor.EditorOption.wordWrap);
          editor.updateOptions({wordWrap:current === "on" ? "off" : "on"});
        }
      };
    });
    setupSplitter();
    if (q.get("config") === "1") toggleConfig();
  }
  const packetDecorations = new WeakMap();
  function decoratePacket(editor, side) {
    const model = editor.getModel(), marks = [];
    if (model.getLanguageId() === "http") {
      for (let line = 1; line <= model.getLineCount(); line++) {
        const text = model.getLineContent(line), end = text.length + 1;
        if (line < model.getLineCount()) marks.push({range:new monaco.Range(line,end,line,end),options:{afterContentClassName:"crlf"}});
        if (side === "request" && /^Host:/i.test(text)) marks.push({range:new monaco.Range(line,6,line,6),options:{afterContentClassName:"host lang-zh"}});
        if (side === "response" && /^Content-Length:/i.test(text)) marks.push({range:new monaco.Range(line,15,line,15),options:{afterContentClassName:"content-length lang-zh"}});
      }
    }
    packetDecorations.set(editor,editor.deltaDecorations(packetDecorations.get(editor)||[],marks));
  }
  function showResponseViews() {
    const menu = $("#viewMenu");
    menu.replaceChildren(); menu.hidden = !menu.hidden;
    for (const [view,label] of [["raw","原始文本"],["pretty","美化"],["hex","HEX"],["render","隔离渲染"]]) {
      const button = document.createElement("button"); button.type = "button"; button.textContent = label;
      button.onclick = () => { menu.hidden = true; setView("response",view).catch(errorNotice); };
      menu.appendChild(button);
    }
    const r = $("#responseViews").getBoundingClientRect(), z = Number(q.get("zoom")||1);
    menu.style.left = Math.min(r.left,innerWidth-150)/z + "px";
    menu.style.top = r.bottom/z + 4 + "px";
  }
  function toggleConfig() {
    const show = $("#advanced").hidden;
    $("#advanced").hidden = !show;
    $("#configToggle").classList.toggle("active",show);
    $("#configToggle").setAttribute("aria-expanded",String(show));
  }
  function setupSplitter() {
    const handle = $("#splitter"), grid = $("#editors");
    function resize(clientX) {
      const r = grid.getBoundingClientRect();
      const ratio = Math.min(0.8,Math.max(0.2,(clientX-r.left)/r.width));
      grid.style.gridTemplateColumns = "minmax(0," + ratio + "fr) 8px minmax(0," + (1-ratio) + "fr)";
    }
    handle.onpointerdown = e => {
      if (matchMedia("(max-width:760px)").matches) return;
      handle.setPointerCapture(e.pointerId);
      handle.onpointermove = e => resize(e.clientX);
      handle.onpointerup = () => { handle.onpointermove = null; };
    };
    handle.onkeydown = e => {
      if (e.key !== "ArrowLeft" && e.key !== "ArrowRight") return;
      e.preventDefault();
      resize(handle.getBoundingClientRect().left + (e.key==="ArrowLeft"?-20:20));
    };
  }
  function requestBytes() {
    return state.reqView === "raw" ? B.edit(state.request,reqEditor.getValue()) : state.request;
  }
  function setRaw(side,bytes) {
    const editor = side === "request" ? reqEditor : resEditor;
    state.setting = true;
    editor.setValue(B.normalize(B.decode(bytes)));
    editor.getModel().setEOL(monaco.editor.EndOfLineSequence.LF);
    state.setting = false;
    $("#"+side+"Bytes").textContent = bytes.length + " B";
    $("#"+side+"Encoding").textContent = B.encoding(bytes) === "utf8" ? "UTF-8" : "Latin-1";
  }
  function updateMeta() {
    const first = B.decode(B.split(state.response).head).split(/\r?\n/)[0];
    const status = /^HTTP\/\S+\s+(\d+)/.exec(first);
    const bodySize = B.split(state.response).body.length;
    const elapsed = state.meta && state.meta.elapsed_ms;
    $("#responseMeta").textContent = bodySize + "bytes" + (elapsed == null ? "" : " / " + elapsed + "ms");
    $("#responseMeta").title = (status ? status[1] + " · " : "") + state.response.length + " B";
    const info = $("#responseInfo"); info.replaceChildren();
    if (state.response.length) {
      const host = $("#targetHost").value.trim() || ((/^Host:\s*(.+)$/im.exec(B.decode(state.request))||[])[1]||"").trim();
      const details = [];
      if (state.meta && state.meta.peer) details.push("远端地址：" + state.meta.peer);
      else if (host) details.push("目标地址：" + host);
      if (elapsed != null) details.push("响应时间：" + elapsed + "ms");
      for (const text of details) { const span = document.createElement("span"); span.textContent = text; info.appendChild(span); }
    }
  }
  async function decodedBody(bytes) {
    const parts = B.split(bytes), head = B.latin1(parts.head);
    let body = parts.body;
    if (/^transfer-encoding:\s*.*chunked/im.test(head)) {
      let offset=0; const chunks=[];
      while (offset<body.length) {
        const raw=B.latin1(body.subarray(offset)), end=raw.indexOf("\r\n");
        if(end<0 || !/^[0-9a-f]+(?:;.*)?$/i.test(raw.slice(0,end))) throw new Error("分块响应格式无效");
        const size=parseInt(raw.slice(0,end),16); offset+=end+2;
        if(size===0) break;
        if(offset+size+2>body.length) throw new Error("分块响应不完整");
        chunks.push(body.slice(offset,offset+size)); offset+=size+2;
      }
      body=B.concat(...chunks);
    }
    const encoding=/^content-encoding:\s*(gzip|deflate|br)\s*$/im.exec(head);
    if (encoding && body.length) {
      const stream=new Blob([body]).stream().pipeThrough(new DecompressionStream(encoding[1].toLowerCase()));
      body=new Uint8Array(await new Response(stream).arrayBuffer());
    }
    return {head:B.decode(parts.head),body,text:B.decode(body)};
  }
  async function setView(side,view) {
    const generation=side === "response" ? ++viewGeneration : viewGeneration;
    const editor = side === "request" ? reqEditor : resEditor;
    if (side === "request") state.request = requestBytes();
    const bytes = side === "request" ? state.request : state.response;
    state[side==="request"?"reqView":"resView"]=view;
    document.querySelectorAll('[data-side="'+side+'"][data-view]').forEach(button => button.classList.toggle("selected",button.dataset.view===view));
    const host=$("#"+side+"Editor");
    const frame=host.querySelector("iframe");
    if(frame) frame.remove();
    editor.getDomNode().style.display="";
    editor.updateOptions({readOnly:side==="response"||view!=="raw"});
    monaco.editor.setModelLanguage(editor.getModel(),view==="hex"?"plaintext":"http");
    if(view==="raw") { setRaw(side,bytes); return; }
    if(view==="hex") {
      state.setting=true;editor.setValue(B.hex(bytes));state.setting=false;return;
    }
    const decoded=await decodedBody(bytes);
    if(generation!==viewGeneration)return;
    if(view==="pretty") {
      let body=decoded.text;
      try { body=JSON.stringify(JSON.parse(body),null,2); } catch(_) {}
      state.setting=true;editor.setValue(B.normalize(decoded.head)+"\n\n"+body);state.setting=false;
    } else if(view==="render") {
      editor.getDomNode().style.display="none";
      const preview=document.createElement("iframe");
      preview.className="response-render";preview.title="隔离的响应渲染";
      preview.setAttribute("sandbox","");preview.referrerPolicy="no-referrer";
      preview.srcdoc='<meta http-equiv="Content-Security-Policy" content="default-src \'none\'; style-src \'unsafe-inline\'; img-src data:"><meta charset="utf-8">'+decoded.text;
      host.appendChild(preview);
    }
  }
  function target() {
    const host=$("#targetHost").value.trim(), portText=$("#targetPort").value;
    if(portText && (!Number.isInteger(Number(portText))||Number(portText)<1||Number(portText)>65535)) throw new Error("目标端口必须为 1 到 65535");
    return {...(host?{host}:{}),...(portText?{port:Number(portText)}:{}),tls:$("#tls").checked};
  }
  function updateTargetLabel() {
    const explicit=$("#targetHost").value.trim();
    const requestHost=/^Host:\s*(.+)$/im.exec(B.decode(state.request));
    $("#targetLabel").textContent=explicit||((requestHost&&requestHost[1].trim())||"");
  }
  async function send() {
    if(state.busy) return;
    hideNotice();
    const raw=requestBytes(), endpoint=target();
    const bytes=$("#fixCL").checked ? B.fixContentLength(raw) : raw;
    const timeout=Number($("#timeout").value);
    if(!Number.isFinite(timeout)||timeout<1||timeout>300)throw new Error("超时时间必须为 1 到 300 秒");
    state.busy=true;$("#send").disabled=true;$("#send").textContent="发送中…";
    $("#saveState").textContent="正在发送";
    try {
      const result=await api("/api/send","POST",{
        request_b64:B.b64encode(bytes),target:endpoint,http2:$("#httpVersion").value,timeout,
        update_content_length:false,...(state.id?{scene_id:state.id}:{})
      });
      state.request=bytes;state.response=B.b64decode(result.response_b64);state.meta=result;
      if(state.id && $("#fixCL").checked) {
        // Read back the exact bytes the server actually sent after Content-Length repair.
        const scene=await api("/api/scene/"+encodeURIComponent(state.id));
        state.scene=scene;state.request=B.b64decode(scene.request_b64);state.history=scene.history||[];
      } else {
        state.history.push({request_b64:B.b64encode(bytes),response_b64:result.response_b64,elapsed_ms:result.elapsed_ms,ts:new Date().toISOString()});
        state.history=state.history.slice(-50);
      }
      state.reqView="hex";
      await setView("request","raw");await setView("response",state.resView);
      updateMeta();updateTargetLabel();
      $("#saveState").textContent=state.id?"已写入历史":"未保存";
      $("#footerInfo").textContent="HTTP/"+result.http_version+" · "+result.peer;
      return true;
    } catch(error) {
      $("#saveState").textContent="发送失败";errorNotice(error);throw error;
    } finally {
      state.busy=false;$("#send").disabled=false;$("#send").textContent="发送 Alt+↵";
    }
  }
  async function saveScene() {
    let scene;
    if(terminalMode) scene={...(state.scene||{}),type:"terminal",shell:(state.scene&&state.scene.shell)||q.get("shell")||"cmd",entries:(state.scene&&state.scene.entries)||[]};
    else scene={
      ...(state.scene||{}),type:"repeater",request_b64:B.b64encode(requestBytes()),response_b64:B.b64encode(state.response),
      target:target(),history:state.history,view:state.resView,meta:state.meta,
      http2:$("#httpVersion").value,timeout:Number($("#timeout").value),update_content_length:$("#fixCL").checked
    };
    scene.name=scene.name||(terminalMode?"终端记录":"Web Fuzzer-[1]");
    if(state.id)scene.id=state.id;
    const result=await api("/api/scene","POST",scene);
    state.id=result.id;state.scene={...scene,id:result.id};q.set("scene",result.id);
    history.replaceState(null,"",location.pathname+"?"+q);
    $("#saveState").textContent="已保存";
    return result.id;
  }
  function showHistory() {
    const box=$("#history");box.replaceChildren();box.hidden=!box.hidden;
    const title=document.createElement("h2");title.textContent="历史记录 ("+state.history.length+")";box.appendChild(title);
    if(!state.history.length) {
      const p=document.createElement("p");p.textContent="暂无重放记录";box.appendChild(p);return;
    }
    state.history.slice().reverse().forEach(item=>{
      const button=document.createElement("button");button.type="button";
      const text=B.decode(B.b64decode(item.request_b64||""));
      button.textContent=(item.ts||"")+"  "+text.split(/\r?\n/)[0]+(item.elapsed_ms==null?"":"  "+item.elapsed_ms+" ms");
      button.onclick=async()=>{
        state.request=B.b64decode(item.request_b64);state.response=B.b64decode(item.response_b64);
        state.meta={elapsed_ms:item.elapsed_ms};
        state.reqView="hex";await setView("request","raw");await setView("response","raw");
        updateMeta();updateTargetLabel();box.hidden=true;
      };
      box.appendChild(button);
    });
  }
  function xtermTheme() {
    const v=vars(), get=(key)=>v["--"+key];
    return {
      foreground:get("Colors-Use-Neutral-Text-1-Title"),background:get("Colors-Use-Neutral-Bg"),
      cursor:get("Colors-Use-Main-Primary"),cursorAccent:get("Colors-Use-Neutral-Bg"),
      selectionBackground:get("Colors-Use-Main-Focus"),selectionForeground:get("Colors-Use-Neutral-Text-1-Title"),
      black:get("Colors-Use-Neutral-Bg"),red:get("Colors-Use-Error-Primary"),green:get("yakit-colors-Green-80"),
      yellow:get("yakit-colors-Orange-80"),blue:get("yakit-colors-Blue-80"),magenta:get("yakit-colors-Magenta-80"),
      cyan:get("yakit-colors-Lake-blue-80"),white:get("Colors-Use-Neutral-Text-1-Title"),
      brightBlack:get("Colors-Use-Neutral-Disable"),brightRed:get("yakit-colors-Error-80"),
      brightGreen:get("yakit-colors-Green-100"),brightYellow:get("yakit-colors-Orange-100"),
      brightBlue:get("yakit-colors-Blue-100"),brightMagenta:get("yakit-colors-Magenta-100"),
      brightCyan:get("yakit-colors-Lake-blue-100"),brightWhite:get("Colors-Use-Neutral-Text-1-Title")
    };
  }
  async function renderTerminal() {
    $("#workspace").innerHTML='<div id="terminal" aria-label="终端记录（仅渲染，不执行命令）"></div><div hidden><span id="terminalShell"></span><button id="copyTranscript" type="button">复制终端记录</button></div>';
    const scene=state.scene||{shell:q.get("shell")||"cmd",entries:[]};
    const shell=scene.shell||"cmd";
    if(!["cmd","ps","bash"].includes(shell))throw new Error("终端类型必须是 cmd、ps 或 bash");
    if(!Array.isArray(scene.entries))throw new Error("终端 entries 必须是数组");
    $("#terminalShell").textContent={cmd:"Command Prompt",ps:"Windows PowerShell",bash:"Bash"}[shell];
    term=new Terminal({
      fontFamily:'Consolas, "Lucida Console", "Courier New", monospace',
      convertEol:true,fontSize:15,theme:xtermTheme(),cursorBlink:false,disableStdin:true,scrollback:10000,
      allowProposedApi:false
    });
    fitAddon=new FitAddon.FitAddon();term.loadAddon(fitAddon);term.open($("#terminal"));fitAddon.fit();
    let cwd=shell==="bash"?"/tmp":"C:\\Users\\analyst";
    const prompt=()=>shell==="bash"?cwd+" $ ":shell==="ps"?"PS "+cwd+"> ":cwd+">";
    const chunks=[];
    if(scene.banner&&shell==="cmd") {
      chunks.push("Microsoft Windows [Version 10.0.26100.4652]\r\n(c) Microsoft Corporation. All rights reserved.\r\n\r\n");
    }
    scene.entries.forEach(entry=>{
      if(entry.cwd)cwd=String(entry.cwd);
      chunks.push(prompt()+String(entry.cmd||"")+"\r\n");
      if(entry.output!=null && String(entry.output)!=="") {
        const output=String(entry.output).replace(/\r?\n/g,"\r\n");chunks.push(output);
        if(!output.endsWith("\r\n"))chunks.push("\r\n");
      }
      if(entry.exit!=null&&Number(entry.exit)!==0)chunks.push("[exit code "+entry.exit+"]\r\n");
    });
    if(q.get("cursor")!=="0")chunks.push(prompt());
    const transcript=chunks.join("");
    await new Promise(resolve=>term.write(transcript,resolve));
    term.scrollToTop();term.refresh(0,term.rows-1);
    $("#copyTranscript").onclick=()=>navigator.clipboard.writeText(transcript).catch(errorNotice);
    term.attachCustomKeyEventHandler(event=>{
      if (event.type === "keydown" && (event.ctrlKey || event.metaKey) && event.code === "KeyC") {
        navigator.clipboard.writeText(term.getSelection()).catch(errorNotice);
        return false;
      }
      return true;
    });
    new ResizeObserver(()=>{fitAddon.fit();term.refresh(0,term.rows-1);}).observe($("#terminal"));
    $("#footerInfo").textContent=scene.entries.length+" 条记录";
    if(q.get("cursor")==="0") {
      const css=document.createElement("style");css.textContent=".xterm-cursor-layer{visibility:hidden}.xterm-cursor{visibility:hidden}";document.head.appendChild(css);
    }
  }
  async function init() {
    renderShell();
    if(state.id) {
      state.scene=await api("/api/scene/"+encodeURIComponent(state.id));
      if(state.scene.type!==(terminalMode?"terminal":"repeater"))throw new Error("场景类型与页面不匹配");
      $("#sceneName").textContent=state.scene.name||(terminalMode?"终端":"Web Fuzzer-[1]");
      $("#saveState").textContent="已加载";
    }
    if(terminalMode) {
      // Load the bundled font before xterm measures its character grid.
      const renderer=await import("/assets/evidence-render.js?token="+encodeURIComponent(token));
      await renderer.ensureEvidenceFont(token);
      await renderTerminal();
      await renderer.markEvidenceReady(token);
    } else {
      renderRepeater();
      if(state.scene) {
        const s=state.scene;
        if(s.request_b64!=null)state.request=B.b64decode(s.request_b64);else if(s.request!=null)state.request=new TextEncoder().encode(s.request);
        if(s.response_b64!=null)state.response=B.b64decode(s.response_b64);else if(s.response!=null)state.response=new TextEncoder().encode(s.response);
        state.history=s.history||[];state.meta=s.meta||null;
        $("#targetHost").value=(s.target&&s.target.host)||"";$("#targetPort").value=(s.target&&s.target.port)||"";
        const host=/^Host:\s*.*:443\s*$/im.test(B.decode(state.request));
        $("#tls").checked=s.target&&s.target.tls!=null?!!s.target.tls:host;
        if(["auto","never","force"].includes(s.http2))$("#httpVersion").value=s.http2;
        if(s.timeout)$("#timeout").value=s.timeout;
        $("#fixCL").checked=s.update_content_length!==false;
      }
      state.reqView="hex";
      await setView("request","raw");
      const view=q.get("view")||(state.scene&&state.scene.view)||"raw";
      await setView("response",["raw","pretty","hex","render"].includes(view)?view:"raw");
      updateMeta();updateTargetLabel();
      if(q.get("send")==="1")await send();
      const renderer=await import("/assets/evidence-render.js?token="+encodeURIComponent(token));
      await renderer.markEvidenceReady(token);
    }
    document.documentElement.dataset.weburpStyle="yakit";
  }
  init().catch(error=>errorNotice(error,true));
})();
