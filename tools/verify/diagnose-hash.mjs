// Diagnose: typing '#' moves cursor to left of '#'
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

console.log('=== Diagnose # Input Bug ===');
const target = await getPageTarget();
const ws = new WebSocket(target.webSocketDebuggerUrl);
await new Promise((res, rej) => { ws.onopen = res; ws.onerror = () => rej(new Error('ws')); });

// Step 1: Check .mu-editor computed style
const style = await evaluate(ws, `(() => {
  const ed = document.querySelector('.mu-editor');
  if (!ed) return 'no .mu-editor found';
  const cs = getComputedStyle(ed);
  return JSON.stringify({
    direction: cs.direction,
    textAlign: cs.textAlign,
    unicodeBidi: cs.unicodeBidi,
    tagName: ed.tagName,
    className: ed.className,
    isContentEditable: ed.isContentEditable
  });
})()`);
console.log('Editor style:', style);

// Step 2: Focus the editor
await evaluate(ws, `(() => {
  const ed = document.querySelector('.mu-editor');
  if (ed) { ed.focus(); return 'focused'; }
  return 'not found';
})()`);

// Step 3: Get initial selection
const selBefore = await evaluate(ws, `(() => {
  const sel = window.getSelection();
  return JSON.stringify({
    anchorNode: sel.anchorNode?.nodeName,
    anchorOffset: sel.anchorOffset,
    focusNode: sel.focusNode?.nodeName,
    focusOffset: sel.focusOffset,
    type: sel.type
  });
})()`);
console.log('Selection before:', selBefore);

// Step 4: Type '#' via CDP Input.dispatchKeyEvent
// On US keyboard: # = Shift+3
await cdp(ws, 'Input.dispatchKeyEvent', {
  type: 'keyDown',
  key: '#',
  code: 'Digit3',
  windowsVirtualKeyCode: 51,
  modifiers: 2, // shift
  text: '#'
});
await cdp(ws, 'Input.dispatchKeyEvent', {
  type: 'keyUp',
  key: '#',
  code: 'Digit3',
  windowsVirtualKeyCode: 51,
  modifiers: 2
});
await sleep(300);

// Step 5: Check selection after '#'
const selAfter = await evaluate(ws, `(() => {
  const sel = window.getSelection();
  const ed = document.querySelector('.mu-editor');
  return JSON.stringify({
    anchorNode: sel.anchorNode?.nodeName,
    anchorOffset: sel.anchorOffset,
    focusOffset: sel.focusOffset,
    type: sel.type,
    editorText: ed?.textContent?.slice(0, 50),
    editorHTML: ed?.innerHTML?.slice(0, 200)
  });
})()`);
console.log('Selection after #:', selAfter);

// Step 6: Type a space (should trigger heading conversion)
await cdp(ws, 'Input.dispatchKeyEvent', {
  type: 'keyDown',
  key: ' ',
  code: 'Space',
  windowsVirtualKeyCode: 32,
  text: ' '
});
await cdp(ws, 'Input.dispatchKeyEvent', {
  type: 'keyUp',
  key: ' ',
  code: 'Space',
  windowsVirtualKeyCode: 32
});
await sleep(500);

// Step 7: Check state after space
const afterSpace = await evaluate(ws, `(() => {
  const ed = document.querySelector('.mu-editor');
  const sel = window.getSelection();
  const muContainer = document.querySelector('.mu-container');
  const firstBlock = muContainer?.children[0];
  return JSON.stringify({
    editorText: ed?.textContent?.slice(0, 50),
    selectionAnchor: sel.anchorOffset,
    selectionNode: sel.anchorNode?.nodeName,
    firstBlockClass: firstBlock?.className,
    firstBlockTag: firstBlock?.tagName,
    containerChildren: muContainer?.children.length,
    containerHTML: muContainer?.innerHTML?.slice(0, 300)
  });
})()`);
console.log('After space:', afterSpace);

ws.close();
