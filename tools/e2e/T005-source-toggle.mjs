// T005: Ctrl+E source code / WYSIWYG toggle
// Path: open file → focus editor → press Ctrl+E → verify sourceCode state + DOM change
// Catches: keyboard shortcut broken, preferences store not toggled, CodeMirror not mounted
export const meta = {
  id: 'T005',
  name: 'Ctrl+E 源码/渲染切换',
  priority: 'P0',
};

export default async function run(ws, ctx, h) {
  // ─── Setup ──────────────────────────────────────────────────
  const testFileName = 'T005-toggle-test.md';
  const testFileContent = '# T005 Toggle Test\n\n切换测试内容。\n\n- 列表项\n';
  h.createTestFile(testFileName, testFileContent);
  const testDir = h.TEST_DATA_DIR.replace(/\\/g, '/');

  // ─── Step 1: Close all tabs ─────────────────────────────────
  const beforeState = await h.getStore(ws, 'editor');
  const beforeTabs = beforeState?.tabs?.length || 0;
  if (beforeTabs > 0) {
    let tabs = beforeTabs;
    while (tabs > 0) {
      const r = await h.invokeStoreAction(ws, 'editor', 'CLOSE_TAB');
      if (!r.ok) break;
      const s = await h.getStore(ws, 'editor');
      const newLen = s?.tabs?.length ?? 0;
      if (newLen >= tabs) break;
      tabs = newLen;
    }
    await h.sleep(500);
  }

  // Reset sourceCode to false (known initial state)
  await h.evaluate(ws, `(() => {
    const app = document.querySelector('#app');
    if (!app || !app.__vue_app__) return false;
    const pinia = app.__vue_app__.config.globalProperties.$pinia;
    const store = Array.from(pinia._s.values()).find(s => s.$id === 'preferences');
    if (store) store.sourceCode = false;
    return true;
  })()`);
  await h.sleep(400);

  // ─── Step 2: Open project + file ────────────────────────────
  const openResult = await h.invokeStoreAction(ws, 'project', 'OPEN_PROJECT', testDir);
  if (!ctx.assert(openResult.ok, 'OPEN_PROJECT 成功')) {
    ctx.fail('OPEN_PROJECT 失败');
    return;
  }

  await h.waitForElement(ws, '.side-bar-file', 8000);

  const found = await h.evaluate(ws, `(() => {
    const files = Array.from(document.querySelectorAll('.side-bar-file'));
    const target = files.find(f => {
      const t = f.getAttribute('title') || f.textContent || '';
      return t.includes('T005-toggle-test');
    });
    if (!target) return JSON.stringify({ found: false, count: files.length });
    const r = target.getBoundingClientRect();
    return JSON.stringify({ found: true, x: r.x + r.width/2, y: r.y + r.height/2 });
  })()`);
  const foundInfo = JSON.parse(found);
  if (!ctx.assert(foundInfo.found, `找到 T005 文件 (共 ${foundInfo.count} 个文件项)`)) {
    await h.screenshot(ws, 'T005-file-not-found');
    ctx.fail('未找到 T005-toggle-test.md');
    return;
  }

  await h.clickAt(ws, foundInfo.x, foundInfo.y);
  const fileLoaded = await h.waitForCurrentFile(ws, 8000);
  if (!ctx.assert(fileLoaded, '文件加载完成')) {
    ctx.fail('文件未加载');
    return;
  }

  await h.waitForElement(ws, '.mu-container, .mu-editor', 8000);
  await h.sleep(800);

  // ─── Step 3: Record initial state ───────────────────────────
  const prefsBefore = await h.getStore(ws, 'preferences');
  const initial = prefsBefore?.sourceCode;
  ctx.assert(initial === false, `初始 sourceCode === false (got ${initial})`);

  const domBefore = await h.evaluate(ws, `(() => ({
    hasMuya: !!(document.querySelector('.mu-container') || document.querySelector('.mu-editor')),
    hasSourceCode: !!(document.querySelector('.source-code') || document.querySelector('.CodeMirror')),
    muCount: document.querySelectorAll('[class*="mu-"]').length
  }))()`);
  ctx.assert(domBefore.hasMuya, `初始 DOM 有 muya 编辑器 (muCount=${domBefore.muCount})`);
  ctx.assert(!domBefore.hasSourceCode, '初始 DOM 无 source-code/CodeMirror 组件');

  // ─── Step 4: Focus muya editor ──────────────────────────────
  try {
    await h.clickElement(ws, '.mu-container');
  } catch {
    try { await h.clickElement(ws, '.mu-editor'); } catch {}
  }
  await h.sleep(400);

  // ─── Step 5: Press Ctrl+E (first toggle → source mode ON) ───
  await h.pressKey(ws, 'E', ['ctrl']);
  ctx.pass('已按 Ctrl+E (第一次)');
  await h.sleep(900);

  // ─── Step 6: Verify sourceCode toggled ON ───────────────────
  const prefsAfter1 = await h.getStore(ws, 'preferences');
  const after1 = prefsAfter1?.sourceCode;
  ctx.assert(after1 === true, `第一次 Ctrl+E 后 sourceCode === true (got ${after1})`);

  const domAfter1 = await h.evaluate(ws, `(() => ({
    hasMuya: !!(document.querySelector('.mu-container') || document.querySelector('.mu-editor')),
    hasSourceCode: !!(document.querySelector('.source-code') || document.querySelector('.CodeMirror')),
    cmCount: document.querySelectorAll('.CodeMirror').length
  }))()`);
  ctx.assert(
    domAfter1.hasSourceCode,
    `切换后 DOM 出现 source-code/CodeMirror (cmCount=${domAfter1.cmCount})`
  );

  await h.screenshot(ws, 'T005-source-mode');

  // ─── Step 7: Focus CodeMirror then press Ctrl+E again ───────
  try {
    await h.clickElement(ws, '.source-code');
  } catch {
    try { await h.clickElement(ws, '.CodeMirror'); } catch {}
  }
  await h.sleep(300);
  await h.pressKey(ws, 'E', ['ctrl']);
  ctx.pass('已按 Ctrl+E (第二次)');
  await h.sleep(900);

  // ─── Step 8: Verify sourceCode toggled OFF ──────────────────
  const prefsAfter2 = await h.getStore(ws, 'preferences');
  const after2 = prefsAfter2?.sourceCode;
  ctx.assert(after2 === false, `第二次 Ctrl+E 后 sourceCode === false (got ${after2})`);

  const domAfter2 = await h.evaluate(ws, `(() => ({
    hasMuya: !!(document.querySelector('.mu-container') || document.querySelector('.mu-editor')),
    hasSourceCode: !!(document.querySelector('.source-code') || document.querySelector('.CodeMirror')),
    muCount: document.querySelectorAll('[class*="mu-"]').length
  }))()`);
  ctx.assert(
    domAfter2.hasMuya,
    `切回后 DOM 恢复 muya 编辑器 (muCount=${domAfter2.muCount})`
  );

  await h.screenshot(ws, 'T005-wysiwyg-restored');

  // ─── Step 9: Verify returned to initial state ───────────────
  ctx.assert(after2 === initial, '最终 sourceCode 状态回到初始值');
  ctx.assert(
    domAfter2.hasMuya === domBefore.hasMuya,
    '最终 DOM 状态与初始一致 (muya 编辑器恢复)'
  );

  ctx.pass('Ctrl+E 源码/渲染双向切换验证完成');
}
