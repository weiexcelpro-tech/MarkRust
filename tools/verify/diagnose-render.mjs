// Diagnose real-click render path vs IPC path
// Usage: node diagnose-render.mjs
const CDP_URL = 'http://127.0.0.1:9222';
const TEST_DIR = 'C:/Work/202607/MarkText优化/marktext-develop'; // known dir with .md files

const resp = await fetch(`${CDP_URL}/json`);
const targets = await resp.json();
const page = targets.find(t => t.type === 'page');
if (!page) { console.error('No page target'); process.exit(1); }
console.log('Connected to page target');

const ws = new WebSocket(page.webSocketDebuggerUrl);
let msgId = 0;
const pending = new Map();
const screenshots = [];

ws.addEventListener('message', (event) => {
  const msg = JSON.parse(event.data);
  if (msg.id && pending.has(msg.id)) {
    pending.get(msg.id)(msg);
    pending.delete(msg.id);
  }
});

function send(method, params = {}) {
  const id = ++msgId;
  return new Promise((resolve) => {
    pending.set(id, resolve);
    ws.send(JSON.stringify({ id, method, params }));
  });
}

async function evaluate(expr) {
  const r = await send('Runtime.evaluate', {
    expression: expr,
    returnByValue: true,
    awaitPromise: true,
  });
  if (r.result?.exceptionDetails) {
    console.error('JS Error:', JSON.stringify(r.result.exceptionDetails));
    return null;
  }
  return r.result?.result?.value;
}

async function screenshot(name) {
  const r = await send('Page.captureScreenshot', { format: 'png' });
  if (r.result?.data) {
    const path = `C:/Work/202607/MarkText优化/marktext-tauri/tools/verify/${name}.png`;
    await import('fs').then(fs => fs.writeFileSync(path, Buffer.from(r.result.data, 'base64')));
    console.log(`  screenshot: ${name}.png`);
  }
}

await new Promise(r => ws.addEventListener('open', r));
console.log('WebSocket connected\n');

// Enable Page domain for screenshots
await send('Page.enable');

// === STEP 1: Initial state ===
console.log('=== STEP 1: Initial state ===');
const initState = await evaluate(`(() => {
  const pinia = document.querySelector('#app').__vue_app__.config.globalProperties.$pinia;
  const editorStore = Array.from(pinia._s.values()).find(s => s.$id === 'editor');
  const prefStore = Array.from(pinia._s.values()).find(s => s.$id === 'preferences');
  const cf = editorStore?.currentFile;
  return {
    hasCurrentFile: !!cf,
    cfPathname: cf?.pathname ?? null,
    cfFilename: cf?.filename ?? null,
    cfMarkdownLen: cf?.markdown?.length ?? 0,
    sourceCode: prefStore?.sourceCode ?? null,
    tabsCount: editorStore?.tabs?.length ?? 0,
    hasEditorComponent: !!document.querySelector('.editor-component'),
    hasMuContainer: !!document.querySelector('.mu-container, .mu-editor'),
    muContainerChildren: document.querySelector('.mu-container')?.children?.length ?? 0,
  };
})()`);
console.log('Initial:', JSON.stringify(initState, null, 2));

// === STEP 2: Open folder via store action ===
console.log('\n=== STEP 2: Open folder ===');
await evaluate(`
  (async () => {
    const pinia = document.querySelector('#app').__vue_app__.config.globalProperties.$pinia;
    const projectStore = Array.from(pinia._s.values()).find(s => s.$id === 'project');
    projectStore.OPEN_PROJECT(${JSON.stringify(TEST_DIR)});
  })()
`);
await new Promise(r => setTimeout(r, 1500)); // wait for tree to render
const treeState = await evaluate(`(() => {
  const pinia = document.querySelector('#app').__vue_app__.config.globalProperties.$pinia;
  const projectStore = Array.from(pinia._s.values()).find(s => s.$id === 'project');
  const tree = projectStore?.projectTree;
  const allFiles = [];
  const collect = (node) => {
    if (!node) return;
    if (node.isFile) allFiles.push({ name: node.name, pathname: node.pathname, isMarkdown: node.isMarkdown });
    if (node.folders) node.folders.forEach(f => { collect(f); });
    if (node.files) node.files.forEach(f => allFiles.push({ name: f.name, pathname: f.pathname, isMarkdown: f.isMarkdown }));
  };
  collect(tree);
  // find first .md file
  const firstMd = allFiles.find(f => f.isMarkdown);
  return {
    treeName: tree?.name ?? null,
    totalFiles: allFiles.length,
    mdCount: allFiles.filter(f => f.isMarkdown).length,
    firstMdFile: firstMd ?? null,
    sidebarFileNodes: document.querySelectorAll('[class*="file"], [class*="tree-file"]').length,
  };
})()`);
console.log('Tree:', JSON.stringify(treeState, null, 2));

if (!treeState?.firstMdFile) {
  console.error('NO .md file found in tree! Cannot test click.');
  process.exit(1);
}

// === STEP 3: Find and click the .md file via REAL DOM click ===
console.log('\n=== STEP 3: Real DOM click on .md file ===');
const firstMd = treeState.firstMdFile;
console.log('Target file:', firstMd.pathname);

// Find the DOM element for this file and click it
const clickResult = await evaluate(`
  (() => {
    const pinia = document.querySelector('#app').__vue_app__.config.globalProperties.$pinia;
    const editorStore = Array.from(pinia._s.values()).find(s => s.$id === 'editor');
    const beforeState = {
      cfPathname: editorStore?.currentFile?.pathname ?? null,
      tabsCount: editorStore?.tabs?.length ?? 0,
    };

    // Strategy: find clickable file elements in sidebar
    // treeFile.vue renders with @click="handleFileClick"
    // Try various selectors to find file nodes
    const selectors = [
      '.tree-file', '.file-node', '[data-pathname]',
      '.side-bar .row', '.side-bar [class*="file"]',
      '[class*="treeFile"]', '[class*="tree-file"]'
    ];
    let found = null;
    let usedSelector = null;
    for (const sel of selectors) {
      const els = document.querySelectorAll(sel);
      if (els.length > 0) {
        found = els;
        usedSelector = sel;
        break;
      }
    }

    return {
      beforeState,
      foundElements: found?.length ?? 0,
      usedSelector,
      // Also try finding by text content matching filename
      bodyHtml: document.querySelector('.side-bar')?.innerHTML?.substring(0, 500) ?? 'no sidebar',
    };
  })()
`);
console.log('Click target search:', JSON.stringify(clickResult, null, 2));

// If we found elements, try clicking. Otherwise use JS to dispatch event
// Try a more aggressive approach: find ALL clickable elements in sidebar
const clickExecuted = await evaluate(`
  (async () => {
    const pinia = document.querySelector('#app').__vue_app__.config.globalProperties.$pinia;
    const editorStore = Array.from(pinia._s.values()).find(s => s.$id === 'editor');
    const targetPath = ${JSON.stringify(firstMd.pathname)};

    // Find file node by matching pathname in DOM text or data attribute
    const allElements = document.querySelectorAll('.side-bar *');
    let targetEl = null;
    for (const el of allElements) {
      const text = el.textContent?.trim();
      // treeFile shows filename as text
      if (text === ${JSON.stringify(firstMd.name)} && el.click) {
        targetEl = el;
        break;
      }
    }

    if (!targetEl) {
      // Fallback: directly call the IPC like treeFile.vue does
      // This simulates what happens AFTER treeFile's isMarkdown check passes
      window.electron.ipcRenderer.send('mt::open-file', targetPath, {});
      return { method: 'ipc-fallback', reason: 'DOM element not found' };
    }

    // Real DOM click - this triggers Vue's @click handler
    targetEl.click();
    return { method: 'real-dom-click', element: targetEl.className };
  })()
`);
console.log('Click result:', JSON.stringify(clickExecuted, null, 2));

// Wait for async file load + render
await new Promise(r => setTimeout(r, 3000));

// === STEP 4: Check render state after click ===
console.log('\n=== STEP 4: Post-click render state ===');
const postState = await evaluate(`(() => {
  const pinia = document.querySelector('#app').__vue_app__.config.globalProperties.$pinia;
  const editorStore = Array.from(pinia._s.values()).find(s => s.$id === 'editor');
  const cf = editorStore?.currentFile;
  return {
    cfPathname: cf?.pathname ?? null,
    cfFilename: cf?.filename ?? null,
    cfMarkdownLen: cf?.markdown?.length ?? 0,
    tabsCount: editorStore?.tabs?.length ?? 0,
    hasMuContainer: !!document.querySelector('.mu-container, .mu-editor'),
    muContainerChildren: document.querySelector('.mu-container')?.children?.length ?? 0,
    editorAreaHtml: document.querySelector('.mu-container')?.innerHTML?.length ?? 0,
    // Check if muya rendered blocks (look for muya block elements)
    muyaBlocks: document.querySelectorAll('.mu-container [class*="block"], .mu-container .mu-paragraph, .mu-container h1, .mu-container h2, .mu-container p, .mu-container table').length,
  };
})()`);
console.log('Post-click:', JSON.stringify(postState, null, 2));
await screenshot('after-real-click');

// === STEP 5: Compare - try IPC direct (known working) ===
console.log('\n=== STEP 5: IPC direct comparison ===');
// Reset to blank first
await evaluate(`
  (() => {
    const pinia = document.querySelector('#app').__vue_app__.config.globalProperties.$pinia;
    const editorStore = Array.from(pinia._s.values()).find(s => s.$id === 'editor');
    editorStore.NEW_UNTITLED_TAB({});
  })()
`);
await new Promise(r => setTimeout(r, 1000));

await evaluate(`
  window.electron.ipcRenderer.send('mt::open-file', ${JSON.stringify(firstMd.pathname)})
`);
await new Promise(r => setTimeout(r, 3000));

const ipcState = await evaluate(`(() => {
  const pinia = document.querySelector('#app').__vue_app__.config.globalProperties.$pinia;
  const editorStore = Array.from(pinia._s.values()).find(s => s.$id === 'editor');
  const cf = editorStore?.currentFile;
  return {
    cfPathname: cf?.pathname ?? null,
    cfMarkdownLen: cf?.markdown?.length ?? 0,
    muContainerChildren: document.querySelector('.mu-container')?.children?.length ?? 0,
    muyaBlocks: document.querySelectorAll('.mu-container [class*="block"], .mu-container .mu-paragraph, .mu-container h1, .mu-container h2, .mu-container p, .mu-container table').length,
  };
})()`);
console.log('IPC direct:', JSON.stringify(ipcState, null, 2));
await screenshot('after-ipc-direct');

console.log('\n=== DIAGNOSIS SUMMARY ===');
console.log('Real click rendered blocks:', postState?.muyaBlocks ?? 'N/A');
console.log('IPC direct rendered blocks:', ipcState?.muyaBlocks ?? 'N/A');
if ((postState?.muyaBlocks ?? 0) === 0 && (ipcState?.muyaBlocks ?? 0) > 0) {
  console.log('>>> CONFIRMED: Real DOM click does NOT render, IPC does');
} else if ((postState?.muyaBlocks ?? 0) > 0) {
  console.log('>>> Real DOM click DOES render — issue may be intermittent or fixed');
} else {
  console.log('>>> Both paths failed — deeper issue');
}

ws.close();
process.exit(0);
