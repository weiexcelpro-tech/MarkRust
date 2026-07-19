// Verify cursor position after # heading conversion
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
      if (resp.id === id) { ws.removeEventListener('message', handler); resp.error ? reject(new Error(JSON.stringify(resp.error))) : resolve(resp.result); }
    };
    ws.addEventListener('message', handler);
    setTimeout(() => { ws.removeEventListener('message', handler); reject(new Error('timeout')); }, 10000);
  });
}
async function evaluate(ws, expression) {
  const r = await cdp(ws, 'Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
  return r.result.value;
}
const sleep = ms => new Promise(r => setTimeout(r, ms));

console.log('=== Verify Cursor After # ===');
const target = await getPageTarget();
const ws = new WebSocket(target.webSocketDebuggerUrl);
await new Promise((res, rej) => { ws.onopen = res; ws.onerror = () => rej(new Error('ws')); });

// Focus editor
await evaluate(ws, `document.querySelector('.mu-editor')?.focus()`);
await sleep(300);

// Clear content
await evaluate(ws, `document.execCommand('selectAll')`);
await cdp(ws, 'Input.dispatchKeyEvent', { type: 'rawKeyDown', key: 'Backspace', code: 'Backspace', windowsVirtualKeyCode: 8 });
await sleep(200);

// Type # via insertText (single char, no duplicate)
await cdp(ws, 'Input.insertText', { text: '#' });
await sleep(300);

// Check cursor
const result = await evaluate(ws, `(() => {
  const sel = window.getSelection();
  const node = sel.anchorNode;
  const ed = document.querySelector('.mu-editor');
  const firstBlock = ed?.querySelector('[class*=mu-atx-heading], [class*=mu-paragraph]');
  return JSON.stringify({
    offset: sel.anchorOffset,
    nodeType: node?.nodeName,
    nodeText: node?.textContent?.slice(0, 40),
    parentClass: node?.parentElement?.className?.slice(0, 80),
    firstBlockClass: firstBlock?.className?.slice(0, 40),
    firstBlockText: firstBlock?.textContent?.slice(0, 40)
  });
})()`);

const parsed = JSON.parse(result);
console.log('Result:', JSON.stringify(parsed, null, 2));
console.log('\nIs heading:', parsed.firstBlockClass?.includes('atx-heading'));
console.log('Cursor offset:', parsed.offset);
console.log('Offset > 0:', parsed.offset > 0 ? 'PASS ✓' : 'FAIL ✗');

ws.close();
