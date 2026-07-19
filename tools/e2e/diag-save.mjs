// Diagnostic: trace where the save chain breaks
import { connectCdp, evaluate } from './lib/cdp.mjs';

const ws = await connectCdp();
console.log('Connected to CDP');

const getFileInfo = async () => {
  return await evaluate(ws, `(() => {
    const app = document.querySelector('#app');
    const pinia = app.__vue_app__.config.globalProperties.$pinia;
    const store = Array.from(pinia._s.values()).find(s => s.$id === 'editor');
    const f = store.currentFile;
    return f ? JSON.stringify({filename: f.filename, isSaved: f.isSaved, pathname: f.pathname, encodingType: typeof f.encoding, markdownLen: f.markdown?.length}) : 'null';
  })()`);
};

// 1. Initial state
console.log('1. Initial:', await getFileInfo());

// 2. Modify markdown + mark unsaved
const modRes = await evaluate(ws, `(() => {
  const app = document.querySelector('#app');
  const pinia = app.__vue_app__.config.globalProperties.$pinia;
  const store = Array.from(pinia._s.values()).find(s => s.$id === 'editor');
  if (!store.currentFile) return 'no currentFile';
  store.currentFile.markdown = store.currentFile.markdown + '\\nDIAG_MARK\\n';
  store.currentFile.isSaved = false;
  return JSON.stringify({markdownLen: store.currentFile.markdown.length, isSaved: store.currentFile.isSaved});
})()`);
console.log('2. After modify:', modRes);

// 3. Probe: where is the mitt bus? Check what handleMenuClick / command does
const probeRes = await evaluate(ws, `(() => {
  const result = {};
  result.hasElectron = !!window.electron;
  result.hasBus = !!(window.__MITT_BUS__);
  // Check if there's a global command registry
  result.hasCommandRegistry = !!(window.__commands__ || window.__commandRegistry);
  // Try to find bus via app
  const app = document.querySelector('#app');
  if (app && app.__vue_app__) {
    const gp = app.__vue_app__.config.globalProperties;
    result.hasBusOnGlobal = !!(gp.$bus || gp.$mitt);
  }
  return JSON.stringify(result);
})()`);
console.log('3. Probe bus:', probeRes);

// 4. Try direct bus.emit
const busRes = await evaluate(ws, `(async () => {
  try {
    const app = document.querySelector('#app');
    const gp = app.__vue_app__.config.globalProperties;
    // MarkDownText uses a shared mitt bus — try common locations
    let bus = window.__MITT_BUS__ || gp.$bus || gp.$mitt;
    if (bus && typeof bus.emit === 'function') {
      bus.emit('mt::editor-ask-file-save');
      return 'bus.emit OK';
    }
    // Try via store (editor.ts uses imported bus)
    return 'bus not accessible from global scope';
  } catch(e) { return 'ERR: ' + e.message; }
})()`);
console.log('4. bus.emit:', busRes);

await new Promise(r => setTimeout(r, 2500));
console.log('5. After bus.emit wait:', await getFileInfo());

// 6. Dispatch real KeyboardEvent Ctrl+S
const kbdRes = await evaluate(ws, `(() => {
  try {
    const ev = new KeyboardEvent('keydown', {
      key: 's', code: 'KeyS', ctrlKey: true, bubbles: true, cancelable: true
    });
    document.dispatchEvent(ev);
    return 'dispatched keydown Ctrl+S on document';
  } catch(e) { return 'ERR: ' + e.message; }
})()`);
console.log('6. Kbd dispatch:', kbdRes);

await new Promise(r => setTimeout(r, 2500));
console.log('7. After kbd dispatch:', await getFileInfo());

// 8. Collect console logs from last few seconds
const logs = await evaluate(ws, `(() => {
  if (window.__diagLogs) return JSON.stringify(window.__diagLogs.slice(-30));
  return 'no logs captured';
})()`);
console.log('8. Console logs (if captured):', logs);

ws.close();
