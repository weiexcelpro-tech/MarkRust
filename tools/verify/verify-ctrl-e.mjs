// 截图源码模式 vs 渲染模式，验证 Ctrl+E 双向切换
const CDP_BASE = 'http://127.0.0.1:9222';
const TEST_FILE = 'C:/Work/202607/功能领先性KPI/整合/功能对比矩阵_验证修正版.md';
const OUT = 'C:/Work/202607/MarkText优化/marktext-tauri/tools/verify';

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

async function pressCtrlE(ws) {
  await cdp(ws, 'Input.dispatchKeyEvent', { type: 'rawKeyDown', key: 'e', code: 'KeyE', windowsVirtualKeyCode: 69, modifiers: 2 });
  await sleep(300);
  await cdp(ws, 'Input.dispatchKeyEvent', { type: 'keyUp', key: 'e', code: 'KeyE', windowsVirtualKeyCode: 69, modifiers: 2 });
}

async function main() {
  const target = await getPageTarget();
  const ws = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((res, rej) => { ws.onopen = res; ws.onerror = () => rej(new Error('ws')); });
  try {
    await cdp(ws, 'Page.enable');
    const fs = await import('fs');

    // 确保文件已打开
    const state0 = JSON.parse(await evaluate(ws, `(() => {
      const app = document.querySelector('#app').__vue_app__;
      const pinia = app.config.globalProperties.$pinia;
      const ed = pinia.state.value.editor;
      const prefs = pinia.state.value.preferences;
      return JSON.stringify({ pathname: ed.currentFile?.pathname, mdLen: (ed.currentFile?.markdown||'').length, sourceCode: prefs.sourceCode });
    })()`));
    console.log('Current:', state0);

    if (!state0.pathname) {
      console.log('Opening test file...');
      await evaluate(ws, `window.electron.ipcRenderer.send('mt::open-file', ${JSON.stringify(TEST_FILE)}, {})`);
      await sleep(3000);
    }

    // 统一到渲染态 (sourceCode=false)
    let sc = JSON.parse(await evaluate(ws, `document.querySelector('#app').__vue_app__.config.globalProperties.$pinia.state.value.preferences.sourceCode`));
    if (sc) { await pressCtrlE(ws); await sleep(800); }
    console.log('Render mode (sourceCode=false)');
    let shot = await cdp(ws, 'Page.captureScreenshot', { format: 'png' });
    fs.writeFileSync(`${OUT}/mode-render.png`, Buffer.from(shot.data, 'base64'));
    console.log('  screenshot: mode-render.png');

    // 切到源码态
    await pressCtrlE(ws);
    await sleep(800);
    sc = JSON.parse(await evaluate(ws, `document.querySelector('#app').__vue_app__.config.globalProperties.$pinia.state.value.preferences.sourceCode`));
    console.log('Source mode (sourceCode=' + sc + ')');
    shot = await cdp(ws, 'Page.captureScreenshot', { format: 'png' });
    fs.writeFileSync(`${OUT}/mode-source.png`, Buffer.from(shot.data, 'base64'));
    console.log('  screenshot: mode-source.png');

    // 切回渲染态
    await pressCtrlE(ws);
    await sleep(800);
    sc = JSON.parse(await evaluate(ws, `document.querySelector('#app').__vue_app__.config.globalProperties.$pinia.state.value.preferences.sourceCode`));
    console.log('Back to render mode (sourceCode=' + sc + ')');
    shot = await cdp(ws, 'Page.captureScreenshot', { format: 'png' });
    fs.writeFileSync(`${OUT}/mode-render-back.png`, Buffer.from(shot.data, 'base64'));
    console.log('  screenshot: mode-render-back.png');

    console.log('\n✓ Ctrl+E 双向切换验证完成');
  } finally { ws.close(); }
}
main().catch(e => { console.error('FATAL:', e.message || e); process.exit(1); });
