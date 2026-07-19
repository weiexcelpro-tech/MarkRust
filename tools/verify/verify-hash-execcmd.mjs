// Verify # cursor fix using execCommand (triggers input event)
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
      if (resp.id === id) { ws.removeEventListener('message', handler); resolve(resp.result); }
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

console.log('=== Verify # Fix (execCommand) ===');
const target = await getPageTarget();
const ws = new WebSocket(target.webSocketDebuggerUrl);
await new Promise((res, rej) => { ws.onopen = res; ws.onerror = () => rej(new Error('ws')); });

// Focus editor
await evaluate(ws, `document.querySelector('.mu-editor')?.focus()`);

// Check initial state
const before = await evaluate(ws, `(() => {
  const p = document.querySelector('.mu-paragraph-content');
  return JSON.stringify({ text: p?.textContent, hasNbsp: p?.textContent?.startsWith('\\xa0') });
})()`);
console.log('Before:', before);

// Type # using execCommand (triggers input event)
await evaluate(ws, `document.execCommand('insertText', false, '#')`);
await sleep(500);

// Check after #
const afterHash = await evaluate(ws, `(() => {
  const sel = window.getSelection();
  const muContainer = document.querySelector('.mu-container');
  const firstBlock = muContainer?.children[0];
  return JSON.stringify({
    selectionNode: sel.anchorNode?.nodeName,
    selectionOffset: sel.anchorOffset,
    firstBlockClass: firstBlock?.className,
    firstBlockTag: firstBlock?.tagName,
    editorText: document.querySelector('.mu-editor')?.textContent?.slice(0, 20)
  });
})()`);
console.log('After #:', afterHash);

// Type space
await evaluate(ws, `document.execCommand('insertText', false, ' ')`);
await sleep(500);

// Check after space
const afterSpace = await evaluate(ws, `(() => {
  const sel = window.getSelection();
  const muContainer = document.querySelector('.mu-container');
  const firstBlock = muContainer?.children[0];
  return JSON.stringify({
    selectionNode: sel.anchorNode?.nodeName,
    selectionOffset: sel.anchorOffset,
    firstBlockClass: firstBlock?.className,
    firstBlockTag: firstBlock?.tagName,
    editorText: document.querySelector('.mu-editor')?.textContent?.slice(0, 20)
  });
})()`);
console.log('After space:', afterSpace);

ws.close();
