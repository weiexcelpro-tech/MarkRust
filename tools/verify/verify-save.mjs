// Verify markdown_save command works end-to-end
const CDP_BASE = 'http://127.0.0.1:9222';
const TEST_PATH = 'C:/Work/202607/test-markrust-save.md';
const TEST_CONTENT = '# Test Save\n\nHello from MarkRust save test.\n';

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

console.log('=== Verify Save (markdown_save) ===');
const target = await getPageTarget();
const ws = new WebSocket(target.webSocketDebuggerUrl);
await new Promise((res, rej) => { ws.onopen = res; ws.onerror = () => rej(new Error('ws')); });

// Step 1: Trigger save via ipcRenderer.send('mt::response-file-save', id, filename, pathname, markdown, options, defaultPath)
const options = { encoding: 'utf-8', lineEnding: 'lf', adjustLineEndingOnSave: false, trimTrailingNewline: 2 };
const sendExpr = `window.electron.ipcRenderer.send('mt::response-file-save', ${JSON.stringify('test-id')}, ${JSON.stringify('test-markrust-save.md')}, ${JSON.stringify(TEST_PATH)}, ${JSON.stringify(TEST_CONTENT)}, ${JSON.stringify(options)}, '')`;
await evaluate(ws, sendExpr);
console.log('Save triggered, waiting...');
await sleep(2000);

// Step 2: Read back the file via fileUtils.readFile (which calls fs_read_file)
const readBack = await evaluate(ws, `window.fileUtils.readFile(${JSON.stringify(TEST_PATH)})`);
console.log('Read back length:', readBack ? readBack.length : 'null');
console.log('Expected length:', TEST_CONTENT.length);
console.log('Content match:', readBack === TEST_CONTENT ? 'PASS' : 'FAIL');
if (readBack !== TEST_CONTENT) {
  console.log('Expected:', JSON.stringify(TEST_CONTENT));
  console.log('Got:', JSON.stringify(readBack));
}

// Step 3: Check tab-saved event was emitted (check editor store)
const tabState = await evaluate(ws, `(() => {
  const pinia = document.querySelector('#app').__vue_app__.config.globalProperties.$pinia;
  const editor = Array.from(pinia._s.values()).find(s => s.$id === 'editor');
  return JSON.stringify({
    tabCount: editor.tabs.length,
    currentFile: editor.currentFile ? { filename: editor.currentFile.filename, pathname: editor.currentFile.pathname, isSaved: editor.currentFile.isSaved } : null
  });
})()`);
console.log('Tab state:', tabState);

// Cleanup: delete test file
await evaluate(ws, `window.fileUtils.removeItem(${JSON.stringify(TEST_PATH)}).catch(() => {})`);
console.log('Test file cleaned up');

ws.close();
