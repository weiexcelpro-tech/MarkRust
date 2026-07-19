// Test debounced MutationObserver cursor fix (no rebuild needed)
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
    setTimeout(() => { ws.removeEventListener('message', handler); reject(new Error('timeout: ' + method)); }, 10000);
  });
}
async function evaluate(ws, expression) {
  const r = await cdp(ws, 'Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
  if (r.result.subtype === 'error') throw new Error(r.result.description);
  return r.result.value;
}
const sleep = ms => new Promise(r => setTimeout(r, ms));

console.log('=== Debounced MutationObserver Cursor Fix Test ===');
const target = await getPageTarget();
const ws = new WebSocket(target.webSocketDebuggerUrl);
await new Promise((res, rej) => { ws.onopen = res; ws.onerror = () => rej(new Error('ws')); });

// Step 1: Create new tab to get clean editor
await evaluate(ws, `(() => {
  const pinia = document.querySelector('#app').__vue_app__.config.globalProperties.$pinia;
  const editor = Array.from(pinia._s.values()).find(s => s.$id === 'editor');
  editor.NEW_UNTITLED_TAB({});
  return 'new tab';
})()`);
await sleep(500);

// Step 2: Inject debounced MutationObserver
await evaluate(ws, `
window.__cursorFix?.disconnect();
window.__cursorFixTimer = null;
window.__cursorFix = new MutationObserver(() => {
  if (window.__cursorFixTimer) clearTimeout(window.__cursorFixTimer);
  window.__cursorFixTimer = setTimeout(() => {
    const heading = document.querySelector('.mu-atx-heading.mu-active');
    if (!heading) return;
    const span = heading.querySelector('.mu-syntax-text');
    const textNode = span?.firstChild;
    if (textNode && textNode.nodeType === 3) {
      const len = textNode.textContent?.length || 0;
      const range = document.createRange();
      range.setStart(textNode, len);
      range.setEnd(textNode, len);
      const sel = window.getSelection();
      sel?.removeAllRanges();
      sel?.addRange(range);
    }
  }, 300);
});
const container = document.querySelector('.mu-container');
if (container) {
  window.__cursorFix.observe(container, { childList: true, subtree: true, characterData: true, attributes: true });
}
'observer injected'
`);
console.log('Observer injected');

// Step 3: Focus editor and click
const rect = await evaluate(ws, `JSON.stringify({x: document.querySelector('.mu-editor')?.getBoundingClientRect().x + 50, y: document.querySelector('.mu-editor')?.getBoundingClientRect().y + 50})`);
const { x, y } = JSON.parse(rect);
await cdp(ws, 'Input.dispatchMouseEvent', { type: 'mousePressed', x, y, button: 'left', clickCount: 1 });
await cdp(ws, 'Input.dispatchMouseEvent', { type: 'mouseReleased', x, y, button: 'left', clickCount: 1 });
await sleep(500);

// Step 4: Input #
await cdp(ws, 'Input.insertText', { text: '#' });
console.log('Inserted #, waiting 800ms for conversion + debounce...');
await sleep(800);

// Step 5: Check cursor
const result = await evaluate(ws, `(() => {
  const sel = window.getSelection();
  return JSON.stringify({
    offset: sel.anchorOffset,
    nodeType: sel.anchorNode?.nodeType === 3 ? 'TEXT' : sel.anchorNode?.nodeName,
    text: sel.anchorNode?.textContent?.slice(0, 20),
    parentClass: sel.anchorNode?.parentElement?.className
  });
})()`);

console.log('Result:', result);
const parsed = JSON.parse(result);
console.log('Expected: offset=1');
console.log('Actual: offset=' + parsed.offset);
console.log('PASS:', parsed.offset === 1 ? 'YES' : 'NO');

ws.close();
