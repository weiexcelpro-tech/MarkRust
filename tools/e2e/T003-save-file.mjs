// T003: Save file via real Ctrl+S keypress (真实用户路径)
// Path: 打开文件 → 在编辑器中输入文字 → Ctrl+S → 验证磁盘文件更新
// 关键：用 insertText 输入（模拟真实用户），不直接改 store（会被 muya 覆盖）
// Ctrl+S → Tauri 菜单 accelerator → handleMenuClick('file.save') → FILE_SAVE() → invoke('markdown_save')
export const meta = {
  id: 'T003',
  name: '保存文件（Ctrl+S 真实按键）',
  priority: 'P0',
};

export default async function run(ws, ctx, h) {
  // ─── Setup: 创建测试文件 ──────────────────────────────────
  const timestamp = Date.now();
  const markText = `E2E_T003_MARK_${timestamp}`;
  const originalContent = '# T003 Save Test\n\n原始内容。\n';
  const testFileName = 'T003-save-test.md';
  const testFilePath = h.createTestFile(testFileName, originalContent);
  const testDir = h.TEST_DATA_DIR.replace(/\\/g, '/');

  // ─── Step 1: 清空 tabs + 打开项目 ──────────────────────────
  const beforeState = await h.getStore(ws, 'editor');
  const beforeTabs = beforeState?.tabs?.length || 0;
  if (beforeTabs > 0) {
    await h.evaluate(ws, `(() => {
      const app = document.querySelector('#app');
      const pinia = app.__vue_app__.config.globalProperties.$pinia;
      const store = Array.from(pinia._s.values()).find(s => s.$id === 'editor');
      if (store) { store.tabs = []; store.currentFile = null; }
      return 'cleared'
    })()`);
    await h.sleep(500);
  }
  ctx.pass(`初始状态清理完成 (before tabs=${beforeTabs})`);

  // 确保测试文件内容正确
  h.createTestFile(testFileName, originalContent);

  const openResult = await h.invokeStoreAction(ws, 'project', 'OPEN_PROJECT', testDir);
  if (!ctx.assert(openResult.ok, `OPEN_PROJECT 成功`)) {
    ctx.fail('OPEN_PROJECT 失败'); return;
  }

  const treeReady = await h.waitForElement(ws, '.side-bar-file', 8000);
  if (!ctx.assert(treeReady, '文件树渲染完成')) {
    ctx.fail('文件树未渲染'); return;
  }

  // 定位 T003 文件
  const found = await h.evaluate(ws, `(() => {
    const files = Array.from(document.querySelectorAll('.side-bar-file'));
    const target = files.find(f => {
      const t = f.getAttribute('title') || f.textContent || '';
      return t.includes('T003-save-test');
    });
    if (!target) return JSON.stringify({ found: false, count: files.length });
    const r = target.getBoundingClientRect();
    return JSON.stringify({ found: true, x: r.x + r.width/2, y: r.y + r.height/2 });
  })()`);
  const foundInfo = JSON.parse(found);
  if (!ctx.assert(foundInfo.found, `找到 T003 测试文件`)) {
    await h.screenshot(ws, 'T003-file-not-found');
    ctx.fail('未找到 T003-save-test.md'); return;
  }

  await h.clickAt(ws, foundInfo.x, foundInfo.y);
  const fileLoaded = await h.waitForCurrentFile(ws, 8000);
  if (!ctx.assert(fileLoaded, '文件加载完成')) {
    ctx.fail('点击后文件未加载'); return;
  }

  const currentFile = await h.getCurrentFile(ws);
  if (!ctx.assertTruthy(currentFile, 'currentFile 非空')) {
    ctx.fail('currentFile 为 null'); return;
  }
  ctx.assert(
    currentFile.filename === testFileName,
    `打开正确文件 (expected="${testFileName}", got="${currentFile.filename}")`
  );
  ctx.pass(`文件已打开 (isSaved=${currentFile.isSaved})`);

  // ─── Step 2: 在编辑器中真实输入文字 ────────────────────────
  // 点击 contenteditable 中心，确保焦点在 muya 编辑器（不是 .mu-container）
  try {
    await h.evaluate(ws, `(() => {
      const el = document.querySelector('[contenteditable=true]');
      if (!el) return;
      el.focus();
      const r = el.getBoundingClientRect();
      window._clickTarget = { x: r.x + r.width/2, y: r.y + r.height/2 };
    })()`)
    const rect = JSON.parse(await h.evaluate(ws, `JSON.stringify(window._clickTarget || null)`))
    if (rect) {
      await h.clickAt(ws, rect.x, rect.y)
      await h.sleep(300)
    }
  } catch (e) { /* ignore */ }

  // 用 insertText 输入标记文字（无 \n 包围，CDP Input.insertText 不支持多行）
  await h.insertText(ws, markText)
  await h.sleep(800)

  // 验证 store.markdown 已更新（muya 应该已同步到 store）
  const afterInput = await h.getCurrentFile(ws);
  ctx.assert(
    afterInput?.markdown?.includes(markText),
    `输入后 store.markdown 包含标记文字`
  );
  ctx.assert(
    afterInput?.isSaved === false,
    `输入后 isSaved === false (got ${afterInput?.isSaved})`
  );

  // ─── Step 3: 按 Ctrl+S 保存 ─────────────────────────────────
  await h.sleep(200);
  await h.pressKey(ws, 'S', ['ctrl']);
  ctx.pass('已按 Ctrl+S');

  // ─── Step 4: 等待保存完成 ──────────────────────────────────
  const saveDone = await h.waitForCondition(ws,
    `(() => {
      const a=document.querySelector('#app'); if(!a||!a.__vue_app__) return false;
      const p=a.__vue_app__.config.globalProperties.$pinia; if(!p||!p._s) return false;
      const s=Array.from(p._s.values()).find(x=>x.$id==='editor');
      return !!(s.currentFile && s.currentFile.isSaved === true);
    })()`,
    8000);
  ctx.assert(saveDone, '保存完成 (isSaved === true)');

  // 等待磁盘写入
  await h.sleep(1000);

  // ─── Step 5: 验证磁盘文件 ──────────────────────────────────
  let diskContent = '';
  try {
    diskContent = h.readFileAbs(testFilePath);
  } catch (e) {
    ctx.fail('读取磁盘文件失败', String(e));
  }
  ctx.assert(
    diskContent.includes(markText),
    `磁盘文件包含修改标记 "${markText}"`
  );
  ctx.assert(
    diskContent.includes('T003 Save Test'),
    '磁盘文件保留原始标题'
  );
  ctx.pass(`磁盘文件内容长度=${diskContent.length}`);

  // ─── Step 6: 验证 currentFile 状态 ─────────────────────────
  const afterFile = await h.getCurrentFile(ws);
  ctx.assert(
    afterFile?.isSaved === true,
    `保存后 currentFile.isSaved === true (got ${afterFile?.isSaved})`
  );
  ctx.assert(
    typeof afterFile?.encoding === 'object',
    `encoding 仍为 object 类型 (regression: got ${typeof afterFile?.encoding})`
  );

  // ─── Step 7: 截图 ──────────────────────────────────────────
  await h.screenshot(ws, 'T003-saved');

  // ─── Cleanup ───────────────────────────────────────────────
  try {
    h.createTestFile(testFileName, originalContent);
    ctx.pass('已恢复测试文件原始内容');
  } catch (e) {
    ctx.fail('恢复测试文件失败', String(e));
  }
}
