/** Local authenticated CJK font. Raw HTTP evidence bytes are never transcoded. */
let fontPromise;
export function ensureEvidenceFont(token) {
  if (!fontPromise) fontPromise = (async () => {
    if (!globalThis.FontFace || !document.fonts) throw new Error('浏览器缺少字体加载能力');
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 30000);
    try {
      const response = await fetch('/assets/fonts/NotoSansCJKsc-Regular.otf', {
        credentials:'same-origin', signal:controller.signal,
        headers:{Authorization:'Bearer ' + token},
      });
      if (!response.ok) throw new Error('中文字体加载失败 HTTP ' + response.status);
      const bytes = await response.arrayBuffer();
      if (bytes.byteLength !== 16437364) throw new Error('中文字库大小不匹配，请完整更新 weburp');
      const hash = [...new Uint8Array(await crypto.subtle.digest('SHA-256', bytes))].map(b => b.toString(16).padStart(2,'0')).join('');
      if (hash !== '2c76254f6fc379fddfce0a7e84fb5385bb135d3e399294f6eeb6680d0365b74b') throw new Error('中文字库校验失败，请完整更新 weburp');
      const font = new FontFace('Weburp Evidence CJK', bytes, {weight:'400',style:'normal',display:'block'});
      await font.load(); document.fonts.add(font);
      await document.fonts.load('16px "Weburp Evidence CJK"', '中文请求响应安全验证成功截图');
      await document.fonts.ready;
      document.documentElement.dataset.weburpFont = 'ready';
    } finally { clearTimeout(timer); }
  })().catch(error => { document.documentElement.dataset.weburpFont = 'error'; throw error; });
  return fontPromise;
}

export async function markEvidenceReady(token) {
  await ensureEvidenceFont(token);
  // FontFaceSet.ready already covers font loading/layout. A background/headless
  // page may stop issuing animation frames after its virtual-time budget; waiting
  // for two rAF callbacks could leave a fully loaded scene stuck at "loading".
  // Flush layout synchronously, then let the screenshot compositor paint it.
  document.documentElement.getBoundingClientRect();
  window.__ready = true;
  document.documentElement.dataset.weburpReady = '1';
}
