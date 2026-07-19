// Screenshot current state + diagnose render
const CDP_BASE = 'http://127.0.0.1:9222';

async function getPageTarget() {
  const res = await fetch(`${CDP_BASE}/json/list`);
  const targets = await res.json();
  return targets.find(t => t.type === 'page') ?? targets[0];
}

let msgId = 1;
async function cdp(ws, method, params = {}) {
  const id = msgId++;
  ws.send(JSON.stringify({ id, method, params }));
  return new Promise((resolve, reject) => {
    const handler = (event) => {
      const resp = JSON.parse(event.data);
      if (resp.id === id) {
        ws.removeEventListener('message', handler);
        if (resp.error) reject(new Error(JSON.stringify(resp.error)));
        else resolve(resp.result);
      }
    };
    ws.addEventListener('message', handler);
    setTimeout(() => { ws.removeEventListener('message', handler); reject(new Error('timeout')); }, 10000);
  });
}

async function evaluate(ws, expression) {
  const r = await cdp(ws, 'Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
  if (r.result.subtype === 'error') throw new Error(r.result.description);
  return r.result.value;
}

console.log('=== Screenshot + Diagnose ===');
const target = await getPageTarget();
const ws = new WebSocket(target.webSocketDebuggerUrl);
await new Promise((res, rej) => { ws.onopen = res; ws.onerror = () => rej(new Error('ws')); });

await cdp(ws, 'Page.enable');

// Diagnose current render state
const state = await evaluate(ws, `(() => {
  const mc = document.querySelector('.mu-container');
  const ed = document.querySelector('.mu-editor');
  const sc = document.querySelector('source-code, .source-code, [class*="source-code"]');
  const pinia = document.querySelector('#app').__vue_app__.config.globalProperties.$pinia;
  const prefs = Array.from(pinia._s.values()).find(s => s.$id === 'preferences');
  const editor = Array.from(pinia._s.values()).find(s => s.$id === 'editor');
  return JSON.stringify({
    muContainerExists: !!mc,
    muContainerChildren: mc ? mc.children.length : 0,
    muContainerFirstChildTag: mc?.firstElementChild?.tagName,
    muContainerFirstChildClass: mc?.firstElementChild?.className,
    muContainerHTML200: mc ? mc.innerHTML.slice(0, 200) : 'NOT FOUND',
    muEditorExists: !!ed,
    muEditorClass: ed?.className,
    sourceCodeComponentExists: !!sc,
    sourceCode: prefs?.sourceCode,
    sourceCodeModeEnabled: prefs?.sourceCodeModeEnabled,
    currentFilename: editor?.currentFile?.filename,
    currentMarkdownLen: (editor?.currentFile?.markdown || '').length,
    bodyClasses: document.body.className,
    muContainerDisplay: mc ? getComputedStyle(mc).display : 'N/A',
    muContainerVisibility: mc ? getComputedStyle(mc).visibility : 'N/A',
    editorComponentVisible: ed ? getComputedStyle(ed).display !== 'none' : false
  });
})()`);
console.log('State:', state);

// Check if CSS is loaded
const css = await evaluate(ws, `(() => {
  const stylesheets = Array.from(document.styleSheets);
  const muStyles = stylesheets.filter(s => {
    try { return s.href?.includes('muya') || s.cssRules?.[0]?.cssText?.includes('mu-'); }
    catch(e) { return false; }
  });
  return JSON.stringify({
    totalStylesheets: stylesheets.length,
    muyaStylesheets: muStyles.length,
    stylesheetHrefs: stylesheets.map(s => s.href?.slice(-50)).filter(Boolean)
  });
})()`);
console.log('CSS:', css);

// Screenshot
const r = await cdp(ws, 'Page.captureScreenshot', { format: 'png' });
const fs = await import('fs');
fs.writeFileSync('tools/verify/screenshot-current.png', Buffer.from(r.data, 'base64'));
console.log('Screenshot saved: tools/verify/screenshot-current.png');

ws.close();
