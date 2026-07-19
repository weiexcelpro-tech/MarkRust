// 验证打开 .md 文件渲染 + 快捷键行为
const CDP_BASE = 'http://127.0.0.1:9222';
const TEST_FILE = 'C:/Work/202607/功能领先性KPI/整合/功能对比矩阵_验证修正版.md';

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

async function getState(ws) {
  return JSON.parse(await evaluate(ws, `(() => {
    const app = document.querySelector('#app').__vue_app__;
    const pinia = app.config.globalProperties.$pinia;
    const ed = pinia.state.value.editor;
    const prefs = pinia.state.value.preferences;
    const mc = document.querySelector('.mu-container');
    return JSON.stringify({
      filename: ed.currentFile?.filename,
      pathname: ed.currentFile?.pathname,
      cfMarkdownLen: (ed.currentFile?.markdown||'').length,
      cfMarkdownPreview: (ed.currentFile?.markdown||'').slice(0,120),
      sourceCode: prefs.sourceCode,
      muyaTextLen: mc ? (mc.textContent||'').length : -1,
      muyaTextPreview: mc ? (mc.textContent||'').slice(0,120) : '',
      muyaInnerHTMLLen: mc ? mc.innerHTML.length : -1,
      muyaChildren: mc ? mc.children.length : -1,
      tabsCount: ed.tabs.length
    });
  })()`));
}

async function main() {
  const target = await getPageTarget();
  const ws = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((res, rej) => { ws.onopen = res; ws.onerror = () => rej(new Error('ws')); });

  try {
    // 启用 Page 域用于截图
    await cdp(ws, 'Page.enable');

    console.log('=== STEP 0: 初始状态 ===');
    console.log(await getState(ws));

    console.log('\n=== STEP 1: 模拟点击打开 README.md ===');
    await evaluate(ws, `window.electron.ipcRenderer.send('mt::open-file', ${JSON.stringify(TEST_FILE)}, {})`);
    await sleep(3000);
    const afterOpen = await getState(ws);
    console.log(afterOpen);

    console.log('\n=== STEP 2: 检查渲染判定 ===');
    if (afterOpen.cfMarkdownLen > 0 && afterOpen.muyaTextLen > 0) {
      console.log('✓ 文件内容已加载到 currentFile 且 muya 有渲染文本');
    } else if (afterOpen.cfMarkdownLen > 0 && afterOpen.muyaTextLen === 0) {
      console.log('✗ currentFile 有内容但 muya 未渲染（setContent 失败或时序问题）');
    } else {
      console.log('✗ currentFile 为空（文件打开流程断裂：mt::open-file 未触发或 fs_read_file 失败）');
    }

    console.log('\n=== STEP 3: 截图（保存当前 UI 状态）===');
    const shot = await cdp(ws, 'Page.captureScreenshot', { format: 'png' });
    const fs = await import('fs');
    fs.writeFileSync('C:/Work/202607/MarkText优化/marktext-tauri/tools/verify/screenshot-after-open.png', Buffer.from(shot.data, 'base64'));
    console.log('截图已保存: tools/verify/screenshot-after-open.png');

    console.log('\n=== STEP 4: 测试 Ctrl+E 快捷键（切换源码模式）===');
    const beforeSourceCode = afterOpen.sourceCode;
    console.log('sourceCode before Ctrl+E:', beforeSourceCode);
    // 通过 CDP Input.dispatchKeyEvent 模拟真实按键
    await cdp(ws, 'Input.dispatchKeyEvent', { type: 'rawKeyDown', key: 'e', code: 'KeyE', windowsVirtualKeyCode: 69, modifiers: 2 /* control */ });
    await sleep(300);
    await cdp(ws, 'Input.dispatchKeyEvent', { type: 'keyUp', key: 'e', code: 'KeyE', windowsVirtualKeyCode: 69, modifiers: 2 });
    await sleep(1000);
    const afterCtrlE = await getState(ws);
    console.log('sourceCode after Ctrl+E:', afterCtrlE.sourceCode);
    if (afterCtrlE.sourceCode !== beforeSourceCode) {
      console.log('✓ Ctrl+E 生效（sourceCode 翻转）');
    } else {
      console.log('✗ Ctrl+E 无效（确认 keyboardShortcut.ts 的 .ag-editor 选择器 bug）');
      // 手动测试：直接通过 store 翻转 sourceCode，确认渲染层工作
      console.log('\n=== STEP 4b: 手动翻转 sourceCode（绕过快捷键）===');
      await evaluate(ws, `(() => {
        const app = document.querySelector('#app').__vue_app__;
        const pinia = app.config.globalProperties.$pinia;
        const prefs = pinia.state.value.preferences;
        prefs.sourceCode = !prefs.sourceCode;
      })()`);
      await sleep(500);
      const afterManual = await getState(ws);
      console.log('sourceCode after manual toggle:', afterManual.sourceCode);
    }

    console.log('\n=== VERIFICATION COMPLETE ===');
  } finally {
    ws.close();
  }
}

main().catch(e => { console.error('FATAL:', e.message || e); process.exit(1); });
