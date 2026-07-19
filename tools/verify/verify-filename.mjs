// Verify tab filename displays correctly (not 'Untitled-1')
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
    setTimeout(() => { ws.removeEventListener('message', handler); reject(new Error('timeout: ' + method)); }, 10000);
  });
}

async function evaluate(ws, expression) {
  const r = await cdp(ws, 'Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
  if (r.result.subtype === 'error') throw new Error(r.result.description);
  return r.result.value;
}

const sleep = ms => new Promise(r => setTimeout(r, ms));

console.log('=== Verify Tab Filename ===');
const target = await getPageTarget();
const ws = new WebSocket(target.webSocketDebuggerUrl);
await new Promise((res, rej) => { ws.onopen = res; ws.onerror = () => rej(new Error('ws')); });

// Open file via IPC
await evaluate(ws, `window.electron.ipcRenderer.send('mt::open-file', ${JSON.stringify(TEST_FILE)}, {})`);
await sleep(2500);

// Check filename
const state = await evaluate(ws, `(() => {
  const pinia = document.querySelector('#app').__vue_app__.config.globalProperties.$pinia;
  const editor = Array.from(pinia._s.values()).find(s => s.$id === 'editor');
  return JSON.stringify({
    filename: editor.currentFile?.filename,
    pathname: editor.currentFile?.pathname?.slice(-50),
    tabs: editor.tabs.map(t => ({ filename: t.filename, pathname: t.pathname?.slice(-50) }))
  });
})()`);
console.log('State:', state);

const expected = TEST_FILE.split(/[\\/]/).pop();
const parsed = JSON.parse(state);
console.log('\nExpected:', expected);
console.log('Actual:', parsed.filename);
console.log('PASS:', parsed.filename === expected ? 'YES' : 'NO');

ws.close();
