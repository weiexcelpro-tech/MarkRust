// MarkRust 运行时诊断脚本（零依赖，用 Node 24 内置 WebSocket + fetch）
// 用法：先用 CDP 环境变量启动 markrust.exe，然后 node diagnose.mjs
const CDP_BASE = 'http://127.0.0.1:9222';

async function getPageTarget() {
  const res = await fetch(`${CDP_BASE}/json/list`);
  const targets = await res.json();
  return targets.find(t => t.type === 'page') ?? targets[0];
}

let msgId = 1;
async function cdpEvaluate(ws, expression) {
  const id = msgId++;
  const msg = { id, method: 'Runtime.evaluate', params: { expression, returnByValue: true, awaitPromise: true } };
  ws.send(JSON.stringify(msg));
  return new Promise((resolve, reject) => {
    const handler = (event) => {
      const resp = JSON.parse(event.data);
      if (resp.id === id) {
        ws.removeEventListener('message', handler);
        if (resp.error) reject(new Error(JSON.stringify(resp.error)));
        else {
          const val = resp.result?.result;
          if (val?.subtype === 'error') reject(new Error(val.description));
          else resolve(val?.value);
        }
      }
    };
    ws.addEventListener('message', handler);
    setTimeout(() => { ws.removeEventListener('message', handler); reject(new Error('timeout: ' + expression.slice(0, 60))); }, 8000);
  });
}

async function main() {
  const target = await getPageTarget();
  if (!target) { console.error('No page target found'); process.exit(1); }
  console.log('Target URL:', target.url);

  const ws = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((res, rej) => { ws.onopen = res; ws.onerror = (e) => rej(new Error('ws error')); });

  try {
    // 1. 基本信息
    const basic = await cdpEvaluate(ws, `JSON.stringify({
      url: location.href, title: document.title,
      bodyTextLen: document.body.innerText.length,
      bodyPreview: document.body.innerText.slice(0, 400)
    })`);
    console.log('\n=== BASIC ==='); console.log(JSON.parse(basic));

    // 2. 编辑器 DOM 结构（muya vs sourceCode）
    const dom = await cdpEvaluate(ws, `JSON.stringify({
      muContainer: document.querySelectorAll('.mu-container').length,
      muyaEditor: document.querySelectorAll('.muya-editor').length,
      agEditor: document.querySelectorAll('.ag-editor').length,
      sourceCodeLayer: document.querySelectorAll('[class*="source-code"],.CodeMirror,textarea.cm-content').length,
      editorWithTabs: document.querySelectorAll('.editor-with-tabs').length,
      sideBar: document.querySelectorAll('.side-bar,.sidebar').length,
      openFolderBtn: !!document.querySelector('[class*="open-folder"],[class*="openFolder"]'),
      treeFiles: document.querySelectorAll('.sideBar .tree-file, [class*="tree-file"], [class*="treeFile"]').length,
      sample: [...document.querySelectorAll('[class*="editor"],[class*="muya"],[class*="source"]')].slice(0,12).map(e => (e.tagName+'.'+(e.className||'').toString().slice(0,60)+' '+(e.offsetParent!==null?'vis':'hid')))
    })`);
    console.log('\n=== EDITOR DOM ==='); console.log(JSON.parse(dom));

    // 3. muya 内容详情
    const muyaContent = await cdpEvaluate(ws, `(() => {
      const mc = document.querySelector('.mu-container');
      if (!mc) return JSON.stringify({error: 'no .mu-container found'});
      return JSON.stringify({
        children: mc.children.length,
        textLen: (mc.textContent||'').length,
        textPreview: (mc.textContent||'').slice(0, 200),
        innerHTMLLen: mc.innerHTML.length,
        visible: mc.offsetParent !== null,
        rect: (() => { const r = mc.getBoundingClientRect(); return {w:r.width,h:r.height,top:r.top}; })()
      });
    })()`);
    console.log('\n=== MUYA CONTENT ==='); console.log(JSON.parse(muyaContent));

    // 4. sourceCode 覆盖层详情
    const srcLayer = await cdpEvaluate(ws, `(() => {
      const layers = [...document.querySelectorAll('[class*="source-code"],.CodeMirror,textarea,code.flowed')];
      return JSON.stringify(layers.slice(0,5).map(e => ({
        tag: e.tagName, cls: (e.className||'').toString().slice(0,70),
        vis: e.offsetParent !== null, text: (e.value||e.textContent||'').slice(0,150)
      })));
    })()`);
    console.log('\n=== SOURCE LAYER ==='); console.log(JSON.parse(srcLayer));

    // 5. Pinia store 状态（preferences.sourceCode, currentFile）
    const store = await cdpEvaluate(ws, `(() => {
      const app = document.querySelector('#app');
      if (!app || !app.__vue_app__) return JSON.stringify({error: 'no vue app'});
      const pinia = app.__vue_app__.config.globalProperties.$pinia;
      if (!pinia) return JSON.stringify({error: 'no pinia'});
      const out = {};
      for (const [name, st] of Object.entries(pinia.state.value)) {
        if (name === 'preferences' || name === 'editor') {
          // 只取关键字段避免巨大输出
          const cloned = JSON.parse(JSON.stringify(st));
          if (cloned.tabs) cloned.tabs = '[' + cloned.tabs.length + ' tabs]';
          if (cloned.currentFile && cloned.currentFile.markdown) cloned.currentFile.markdown = cloned.currentFile.markdown.slice(0,100) + '...';
          out[name] = cloned;
        }
      }
      return JSON.stringify(out);
    })()`);
    console.log('\n=== PINIA STORE ==='); console.log(JSON.parse(store));

    // 6. 检查 keyboardShortcut 的 isTextInputTarget 判断（用真实 DOM 验证 .ag-editor bug）
    const ksdDiag = await cdpEvaluate(ws, `(() => {
      // 找 contenteditable 元素（muya 编辑区）
      const ce = document.querySelector('[contenteditable="true"]');
      if (!ce) return JSON.stringify({error: 'no contenteditable element'});
      const closestAgEditor = ce.closest('.ag-editor');
      const closestMuContainer = ce.closest('.mu-container');
      return JSON.stringify({
        contentEditableFound: true,
        closestAgEditor: !!closestAgEditor,
        closestMuContainer: !!closestMuContainer,
        ceClassName: (ce.className||'').toString().slice(0,80),
        parentClassName: (ce.parentElement?.className||'').toString().slice(0,80),
        diagnosis: closestAgEditor ? 'would work' : (closestMuContainer ? 'BUG CONFIRMED: .ag-editor missing, .mu-container exists' : 'neither selector matches')
      });
    })()`);
    console.log('\n=== KEYBOARD SHORTCUT BUG ==='); console.log(JSON.parse(ksdDiag));

  } finally {
    ws.close();
  }
  console.log('\n=== DIAGNOSIS COMPLETE ===');
}

main().catch(e => { console.error('FATAL:', e.message || e); process.exit(1); });
