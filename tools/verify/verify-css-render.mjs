// Verify muya CSS loaded + markdown rendered with styles
const CDP_BASE = 'http://127.0.0.1:9222';
const TEST_FILE = 'C:/Work/202607/MarkText优化/marktext-develop/README.md';

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

const sleep = ms => new Promise(r => setTimeout(r, ms));

console.log('=== Verify Muya CSS + Render ===');
const target = await getPageTarget();
const ws = new WebSocket(target.webSocketDebuggerUrl);
await new Promise((res, rej) => { ws.onopen = res; ws.onerror = () => rej(new Error('ws')); });

await cdp(ws, 'Page.enable');

// Open file
await evaluate(ws, `window.electron.ipcRenderer.send('mt::open-file', ${JSON.stringify(TEST_FILE)}, {})`);
await sleep(3000);

// Check render state + computed styles
const state = await evaluate(ws, `(() => {
  const mc = document.querySelector('.mu-container');
  const firstP = mc?.querySelector('.mu-paragraph');
  const firstH = mc?.querySelector('h1, h2, .mu-heading');
  const firstTable = mc?.querySelector('table, .mu-table');
  const cs = firstP ? getComputedStyle(firstP) : null;
  const hs = firstH ? getComputedStyle(firstH) : null;
  return JSON.stringify({
    muContainerChildren: mc?.children.length,
    firstChildTag: mc?.firstElementChild?.tagName,
    firstChildClass: mc?.firstElementChild?.className,
    paragraphFontSize: cs?.fontSize,
    paragraphColor: cs?.color,
    paragraphMargin: cs?.marginBottom,
    paragraphLineHeight: cs?.lineHeight,
    headingExists: !!firstH,
    headingTag: firstH?.tagName,
    headingFontSize: hs?.fontSize,
    headingFontWeight: hs?.fontWeight,
    headingColor: hs?.color,
    tableExists: !!firstTable,
    currentFilename: (() => {
      const pinia = document.querySelector('#app').__vue_app__.config.globalProperties.$pinia;
      const editor = Array.from(pinia._s.values()).find(s => s.$id === 'editor');
      return editor?.currentFile?.filename;
    })(),
    markdownLen: (() => {
      const pinia = document.querySelector('#app').__vue_app__.config.globalProperties.$pinia;
      const editor = Array.from(pinia._s.values()).find(s => s.$id === 'editor');
      return (editor?.currentFile?.markdown || '').length;
    })()
  });
})()`);
console.log('Render state:', state);

// Screenshot
const r = await cdp(ws, 'Page.captureScreenshot', { format: 'png' });
const fs = await import('fs');
fs.writeFileSync('tools/verify/screenshot-render-check.png', Buffer.from(r.data, 'base64'));
console.log('Screenshot saved: tools/verify/screenshot-render-check.png');

ws.close();
