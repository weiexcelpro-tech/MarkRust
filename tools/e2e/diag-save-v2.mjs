// Diagnostic v2: directly call FILE_SAVE + check keydown listeners
import { connectCdp, evaluate, cdp } from './lib/cdp.mjs';
import { invokeStoreAction, getStore } from './setup.mjs';

const ws = await connectCdp();
console.log('Connected to CDP');

// Use the file currently loaded (from previous T003 run)
let cf = await getStore(ws, 'editor');
console.log('0. Current:', JSON.stringify({filename: cf.currentFile?.filename, isSaved: cf.currentFile?.isSaved, pathname: cf.currentFile?.pathname}));

// 1. Ensure markdown is modified + isSaved=false
await evaluate(ws, `(() => {
  const app = document.querySelector('#app');
  const pinia = app.__vue_app__.config.globalProperties.$pinia;
  const store = Array.from(pinia._s.values()).find(s => s.$id === 'editor');
  if (!store.currentFile) return;
  store.currentFile.markdown = store.currentFile.markdown + '\\nDIAG2_MARK\\n';
  store.currentFile.isSaved = false;
})()`);
console.log('1. Modified markdown, isSaved=false');

// 2. Directly call FILE_SAVE action (bypass keyboard + bus + handleMenuClick)
const saveRes = await invokeStoreAction(ws, 'editor', 'FILE_SAVE');
console.log('2. FILE_SAVE action result:', JSON.stringify(saveRes));

// 3. Wait + check isSaved
await new Promise(r => setTimeout(r, 2500));
cf = await getStore(ws, 'editor');
console.log('3. After FILE_SAVE:', JSON.stringify({isSaved: cf.currentFile?.isSaved, markdownLen: cf.currentFile?.markdown?.length}));

// 4. Check disk file
const fs = await import('fs');
const path = cf.currentFile?.pathname;
if (path) {
  try {
    const disk = fs.readFileSync(path.replace(/\\/g,'/'), 'utf-8');
    console.log('4. Disk file contains DIAG2_MARK:', disk.includes('DIAG2_MARK'));
    console.log('   Disk file length:', disk.length);
  } catch(e) {
    console.log('4. Disk read error:', e.message, 'path=', path);
  }
}

// 5. Use CDP DOMDebugger to check keydown listeners on document
try {
  const { root } = await cdp(ws, 'DOM.getDocument', { depth: 0 });
  const docNodeId = root.nodeId;
  const listeners = await cdp(ws, 'DOMDebugger.getEventListeners', { nodeId: docNodeId, depth: 1 });
  console.log('5. Document event listeners:', JSON.stringify({
    types: listeners.listeners.map(l => l.type),
    keydownCount: listeners.listeners.filter(l => l.type === 'keydown').length,
    keydownDetails: listeners.listeners.filter(l => l.type === 'keydown').map(l => ({
      type: l.type, useCapture: l.useCapture, once: l.once,
      scriptId: l.scriptId, lineNumber: l.lineNumber, columnNumber: l.columnNumber
    }))
  }));
} catch(e) {
  console.log('5. getEventListeners error:', e.message);
}

ws.close();
