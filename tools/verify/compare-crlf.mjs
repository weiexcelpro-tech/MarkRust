// Compare CRLF vs LF file rendering
const CDP_BASE = 'http://127.0.0.1:9222';
const FILE_A = 'C:/Work/202607/功能领先性KPI/整合/功能对比矩阵_验证修正版.md'; // CRLF
const FILE_B = 'C:/Work/202607/RESEARCH/desktop-agent-trends/full_report.md'; // LF

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

async function openAndCheck(ws, label, filepath) {
  await evaluate(ws, `window.electron.ipcRenderer.send('mt::open-file', ${JSON.stringify(filepath)}, {})`);
  await sleep(3000);
  const state = await evaluate(ws, `(() => {
    const pinia = document.querySelector('#app').__vue_app__.config.globalProperties.$pinia;
    const editor = Array.from(pinia._s.values()).find(s => s.$id === 'editor');
    const prefs = Array.from(pinia._s.values()).find(s => s.$id === 'preferences');
    const mc = document.querySelector('.mu-container');
    const md = editor?.currentFile?.markdown || '';
    const hasCR = md.includes('\\r');
    const crCount = (md.match(/\\r/g) || []).length;
    const lfCount = (md.match(/\\n/g) || []).length;
    return JSON.stringify({
      filename: editor?.currentFile?.filename,
      pathname: editor?.currentFile?.pathname?.slice(-50),
      mdLen: md.length,
      hasCR: hasCR,
      crCount: crCount,
      lfCount: lfCount,
      lineEnding: editor?.currentFile?.lineEnding,
      isMixedLineEndings: editor?.currentFile?.isMixedLineEndings,
      sourceCode: prefs?.sourceCode,
      muyaChildren: mc ? mc.children.length : -1,
      muyaTextLen: mc ? (mc.textContent || '').length : -1,
      muyaInnerHTMLLen: mc ? mc.innerHTML.length : -1,
      muyaFirstChildClass: mc?.children[0]?.className || 'none'
    });
  })()`);
  const parsed = JSON.parse(state);
  console.log(`\n=== ${label} ===`);
  console.log(`  File: ${filepath.split(/[\\/]/).pop()}`);
  console.log(`  filename: ${parsed.filename}`);
  console.log(`  mdLen: ${parsed.mdLen}`);
  console.log(`  hasCR: ${parsed.hasCR}, crCount: ${parsed.crCount}, lfCount: ${parsed.lfCount}`);
  console.log(`  lineEnding: ${parsed.lineEnding}, isMixed: ${parsed.isMixedLineEndings}`);
  console.log(`  sourceCode: ${parsed.sourceCode}`);
  console.log(`  muyaChildren: ${parsed.muyaChildren}`);
  console.log(`  muyaTextLen: ${parsed.muyaTextLen}`);
  console.log(`  muyaInnerHTMLLen: ${parsed.muyaInnerHTMLLen}`);
  console.log(`  muyaFirstChildClass: ${parsed.muyaFirstChildClass}`);
  return parsed;
}

const target = await getPageTarget();
const ws = new WebSocket(target.webSocketDebuggerUrl);
await new Promise((res, rej) => { ws.onopen = res; ws.onerror = () => rej(new Error('ws')); });

console.log('=== CRLF vs LF Rendering Comparison ===');

const a = await openAndCheck(ws, 'FILE A (CRLF - not rendering)', FILE_A);
const b = await openAndCheck(ws, 'FILE B (LF - renders OK)', FILE_B);

console.log('\n=== COMPARISON ===');
console.log(`  A muyaChildren: ${a.muyaChildren} vs B: ${b.muyaChildren}`);
console.log(`  A muyaTextLen:  ${a.muyaTextLen} vs B: ${b.muyaTextLen}`);
console.log(`  A hasCR: ${a.hasCR} vs B: ${b.hasCR}`);
console.log(`  A sourceCode: ${a.sourceCode} vs B: ${b.sourceCode}`);

if (a.muyaChildren <= 1 && b.muyaChildren > 1) {
  console.log('\n  => CRLF file failed to render (muya has no children)');
} else if (a.muyaChildren > 1 && b.muyaChildren > 1) {
  console.log('\n  => Both rendered - CRLF may not be the issue');
}

ws.close();
