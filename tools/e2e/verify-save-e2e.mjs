// E2E verify: save via real Ctrl+S path (not direct IPC)
// This catches bugs where editor store data format differs from hardcoded test data
const CDP_BASE = 'http://127.0.0.1:9222';
const TEST_FILE = 'C:/Work/202607/test-e2e-save.md';

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

// Write initial test file
import { writeFileSync, readFileSync, unlinkSync, existsSync } from 'fs';
writeFileSync(TEST_FILE, '# E2E Save Test\n\nInitial content.\n', 'utf-8');

console.log('=== E2E Save Test (real Ctrl+S path) ===');
const target = await getPageTarget();
const ws = new WebSocket(target.webSocketDebuggerUrl);
await new Promise((res, rej) => { ws.onopen = res; ws.onerror = () => rej(new Error('ws')); });

// Step 1: Open file via IPC (this is OK - opening doesn't have the encoding bug)
await evaluate(ws, `window.electron.ipcRenderer.send('mt::open-file', ${JSON.stringify(TEST_FILE)}, {})`);
await sleep(2000);

// Step 2: Check editor store state - verify encoding is an object (the root cause of the bug)
const stateBefore = await evaluate(ws, `(() => {
  const pinia = document.querySelector('#app').__vue_app__.config.globalProperties.$pinia;
  const editor = Array.from(pinia._s.values()).find(s => s.$id === 'editor');
  const cf = editor.currentFile;
  return JSON.stringify({
    filename: cf?.filename,
    pathname: cf?.pathname,
    isSaved: cf?.isSaved,
    encodingType: typeof cf?.encoding,
    encodingValue: cf?.encoding,
    markdownLen: (cf?.markdown||'').length
  });
})()`);
console.log('Before save:', stateBefore);
const parsed = JSON.parse(stateBefore);

// Step 3: Focus the editor
await cdp(ws, 'Input.dispatchMouseEvent', {
  type: 'mousePressed', x: 400, y: 300, button: 'left', clickCount: 1
});
await cdp(ws, 'Input.dispatchMouseEvent', {
  type: 'mouseReleased', x: 400, y: 300, button: 'left', clickCount: 1
});
await sleep(500);

// Step 4: Press Ctrl+S (real keyboard shortcut path)
// This goes through: keyboardShortcut.ts → handleMenuClick → menuBridge → commands → editor.FILE_SAVE → getOptionsFromState → tauri-bridge save handler → invoke('markdown_save')
await cdp(ws, 'Input.dispatchKeyEvent', {
  type: 'keyDown', key: 's', code: 'KeyS',
  windowsVirtualKeyCode: 83, modifiers: 2  // 2 = ctrl
});
await cdp(ws, 'Input.dispatchKeyEvent', {
  type: 'keyUp', key: 's', code: 'KeyS',
  windowsVirtualKeyCode: 83, modifiers: 2
});
await sleep(2000);

// Step 5: Check result
const stateAfter = await evaluate(ws, `(() => {
  const pinia = document.querySelector('#app').__vue_app__.config.globalProperties.$pinia;
  const editor = Array.from(pinia._s.values()).find(s => s.$id === 'editor');
  const cf = editor.currentFile;
  return JSON.stringify({
    isSaved: cf?.isSaved,
    filename: cf?.filename,
    pathname: cf?.pathname
  });
})()`);
console.log('After save:', stateAfter);
const afterParsed = JSON.parse(stateAfter);

// Step 6: Verify file on disk
let diskContent = '';
let diskError = null;
try {
  diskContent = readFileSync(TEST_FILE, 'utf-8');
} catch (e) {
  diskError = e.message;
}

console.log('\n=== Results ===');
console.log('encoding was object (root cause):', parsed.encodingType === 'object' ? 'YES' : 'NO');
console.log('Save succeeded (isSaved):', afterParsed.isSaved === true ? 'YES' : 'NO');
console.log('No error (file exists on disk):', diskError === null ? 'YES' : 'NO - ' + diskError);
console.log('Disk content matches:', diskContent.includes('Initial content') ? 'YES' : 'NO');

const pass = afterParsed.isSaved === true && diskError === null && diskContent.includes('Initial content');
console.log('\nOVERALL:', pass ? 'PASS' : 'FAIL');

// Cleanup
try { unlinkSync(TEST_FILE); } catch {}

ws.close();
