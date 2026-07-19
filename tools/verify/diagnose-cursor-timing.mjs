// Diagnose cursor drift timing after # heading conversion
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

async function pressKey(ws, key, code, modifiers = 0) {
  await cdp(ws, 'Input.dispatchKeyEvent', { type: 'keyDown', key, code, windowsVirtualKeyCode: code?.charCodeAt(0) || 0, modifiers });
  await cdp(ws, 'Input.dispatchKeyEvent', { type: 'char', key, code, text: key, modifiers });
  await cdp(ws, 'Input.dispatchKeyEvent', { type: 'keyUp', key, code, modifiers });
}

const sleep = ms => new Promise(r => setTimeout(r, ms));

console.log('=== Cursor Drift Timing Diagnosis ===');
const target = await getPageTarget();
const ws = new WebSocket(target.webSocketDebuggerUrl);
await new Promise((res, rej) => { ws.onopen = res; ws.onerror = () => rej(new Error('ws')); });

// Step 1: Focus editor + clear content
await evaluate(ws, `(() => {
  const ed = document.querySelector('.mu-editor');
  if (ed) { ed.focus(); }
  window.__cursorTrace = [];
  return ed ? 'focused' : 'not found';
})()`);
console.log('Editor focused');
await sleep(300);

// Step 2: Inject cursor tracker that records at multiple time points
await evaluate(ws, `(() => {
  window.__cursorTrace = [];
  const record = (label) => {
    const sel = window.getSelection();
    const node = sel.anchorNode;
    window.__cursorTrace.push({
      label,
      offset: sel.anchorOffset,
      nodeType: node?.nodeName,
      nodeText: node?.textContent?.slice(0, 40),
      parentClass: node?.parentElement?.className?.slice(0, 60),
      time: performance.now()
    });
  };
  window.__recordCursor = record;
  return 'tracker installed';
})()`);

// Step 3: Press # and record cursor at multiple time points
// We need to record AFTER the key press at different delays
// Use a combination of sync, microtask, rAF, setTimeout
await evaluate(ws, `(() => {
  // Schedule recordings at various delays
  // These will fire after the current call stack unwinds
  queueMicrotask(() => window.__recordCursor?.('microtask'));
  requestAnimationFrame(() => window.__recordCursor?.('rAF'));
  setTimeout(() => window.__recordCursor?.('timeout0'), 0);
  setTimeout(() => window.__recordCursor?.('timeout16'), 16);
  setTimeout(() => window.__recordCursor?.('timeout50'), 50);
  setTimeout(() => window.__recordCursor?.('timeout100'), 100);
  return 'scheduled';
})()`);

// Now press # (this triggers the input handler → format detection → heading conversion)
await pressKey(ws, '#', 'Digit3');
console.log('Pressed #');

// Record immediately (sync, but after dispatchKeyEvent returns)
await evaluate(ws, `window.__recordCursor?.('post-dispatch')`);

// Wait for all timers
await sleep(200);

// Step 4: Collect results
const trace = await evaluate(ws, `JSON.stringify(window.__cursorTrace)`);
console.log('\n=== Cursor Trace ===');
const results = JSON.parse(trace);
for (const r of results) {
  console.log(`${r.label.padEnd(15)} offset=${r.offset}  node=${r.nodeType}  text="${r.nodeText}"  parent="${r.parentClass}"`);
}

// Step 5: Also check DOM structure
const dom = await evaluate(ws, `(() => {
  const ed = document.querySelector('.mu-editor');
  if (!ed) return 'no editor';
  const firstBlock = ed.querySelector('[class*="mu-atx-heading"], [class*="mu-paragraph"]');
  return {
    firstBlockClass: firstBlock?.className,
    firstBlockHTML: firstBlock?.innerHTML?.slice(0, 200),
    editorChildCount: ed.children.length
  };
})()`);
console.log('\n=== DOM ===');
console.log(JSON.stringify(dom, null, 2));

ws.close();
