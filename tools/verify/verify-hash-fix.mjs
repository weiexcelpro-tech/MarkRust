// Verify # cursor fix by manually executing the fix logic
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

const target = await getPageTarget();
const ws = new WebSocket(target.webSocketDebuggerUrl);
await new Promise((res, rej) => { ws.onopen = res; ws.onerror = () => rej(new Error('ws')); });

// Focus editor
await evaluate(ws, `document.querySelector('.mu-editor')?.focus()`);

// Type # via CDP
await cdp(ws, 'Input.dispatchKeyEvent', { type: 'rawKeyDown', key: '#', code: 'Digit3', windowsVirtualKeyCode: 51, modifiers: 2 });
await cdp(ws, 'Input.dispatchKeyEvent', { type: 'keyUp', key: '#', code: 'Digit3', windowsVirtualKeyCode: 51, modifiers: 2 });
await sleep(500);

// Check cursor before fix
const before = await evaluate(ws, `JSON.stringify({ node: window.getSelection().anchorNode?.nodeName, offset: window.getSelection().anchorOffset })`);
console.log('Before fix:', before);

// Manually run fix logic
const fixResult = await evaluate(ws, `(function() {
  var s = window.getSelection();
  if (!s || !s.isCollapsed || s.anchorOffset !== 0) return 'skip: offset=' + s.anchorOffset;
  var n = s.anchorNode;
  if (!n) return 'no node';
  var h = n.nodeType === 3 ? (n.parentElement && n.parentElement.closest('.mu-atx-heading')) : (n.closest && n.closest('.mu-atx-heading'));
  if (!h) return 'no heading: node=' + n.nodeName + ' type=' + n.nodeType;
  var ss = h.querySelector('.mu-syntax-text');
  var tn = ss && ss.firstChild;
  if (!tn) return 'no textNode, html: ' + h.innerHTML.slice(0, 200);
  if (!tn.textContent || !tn.textContent.startsWith('#')) return 'no hash: ' + tn.textContent;
  s.setPosition(tn, 1);
  return 'FIXED to offset 1';
})()`);
console.log('Fix result:', fixResult);

// Check cursor after fix
const after = await evaluate(ws, `JSON.stringify({ node: window.getSelection().anchorNode?.nodeName, offset: window.getSelection().anchorOffset })`);
console.log('After fix:', after);

ws.close();
