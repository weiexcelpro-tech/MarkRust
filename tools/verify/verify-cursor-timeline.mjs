// Diagnose: manually set cursor after heading conversion, check if overwritten
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
    setTimeout(() => { ws.removeEventListener('message', handler); reject(new Error('timeout: ' + method)); }, 10000);
  });
}

async function evaluate(ws, expression) {
  const r = await cdp(ws, 'Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
  if (r.result.subtype === 'error') throw new Error(r.result.description);
  return r.result.value;
}

const sleep = ms => new Promise(r => setTimeout(r, ms));

async function checkCursor(ws, label) {
  const state = await evaluate(ws, `(() => {
    const sel = window.getSelection();
    return JSON.stringify({
      offset: sel.anchorOffset,
      nodeType: sel.anchorNode?.nodeType === 3 ? 'TEXT' : sel.anchorNode?.nodeName,
      text: sel.anchorNode?.textContent?.slice(0, 20)
    });
  })()`);
  console.log(`  ${label}:`, state);
  return JSON.parse(state);
}

console.log('=== Cursor Timeline Diagnosis ===');
const target = await getPageTarget();
const ws = new WebSocket(target.webSocketDebuggerUrl);
await new Promise((res, rej) => { ws.onopen = res; ws.onerror = () => rej(new Error('ws')); });

// Focus editor
const rect = await evaluate(ws, `(() => {
  const ed = document.querySelector('.mu-editor');
  if (!ed) return null;
  const r = ed.getBoundingClientRect();
  return JSON.stringify({ x: r.x + 50, y: r.y + 50 });
})()`);
if (rect) {
  const { x, y } = JSON.parse(rect);
  await cdp(ws, 'Input.dispatchMouseEvent', { type: 'mousePressed', x, y, button: 'left', clickCount: 1 });
  await cdp(ws, 'Input.dispatchMouseEvent', { type: 'mouseReleased', x, y, button: 'left', clickCount: 1 });
  await sleep(500);
}

// Insert #
await cdp(ws, 'Input.insertText', { text: '#' });
console.log('Inserted #, waiting 300ms for heading conversion...');
await sleep(300);

// Check current cursor (should be offset 0 - the bug)
console.log('\nAfter heading conversion:');
await checkCursor(ws, 'initial');

// Manually set cursor to offset 1 (after #)
console.log('\nManually setting cursor to offset 1...');
await evaluate(ws, `(() => {
  const heading = document.querySelector('.mu-atx-heading');
  if (!heading) return 'no heading';
  const span = heading.querySelector('.mu-syntax-text');
  const textNode = span?.firstChild;
  if (!textNode || textNode.nodeType !== 3) return 'no text node';
  const range = document.createRange();
  range.setStart(textNode, 1);
  range.setEnd(textNode, 1);
  const sel = window.getSelection();
  sel.removeAllRanges();
  sel.addRange(range);
  return 'set';
})()`);

// Check if cursor persists at various time points
await sleep(10);
await checkCursor(ws, 'after 10ms');

await sleep(40);
await checkCursor(ws, 'after 50ms');

await sleep(50);
await checkCursor(ws, 'after 100ms');

await sleep(100);
await checkCursor(ws, 'after 200ms');

await sleep(300);
await checkCursor(ws, 'after 500ms');

console.log('\n=== Conclusion ===');
console.log('If cursor stays at offset 1: muya never set it correctly, but nothing overwrites a manual set');
console.log('If cursor reverts to 0: there is an async operation overwriting cursor');

ws.close();
