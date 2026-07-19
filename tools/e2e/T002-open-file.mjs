// T002: Open file via real DOM click on sidebar file tree
// Path: OPEN_PROJECT (store action, bypasses dialog) → real DOM click on .side-bar-file → verify currentFile
// This catches bugs where file opening chain is broken (e.g. encoding type mismatch)
export const meta = {
  id: 'T002',
  name: '打开文件（真实 DOM 点击文件树）',
  priority: 'P0',
};

export default async function run(ws, ctx, h) {
  // ─── Setup: create test file ─────────────────────────────────
  const testFileName = 'T002-test.md';
  const testFileContent = '# T002 测试文件\n\n这是一个 E2E 测试文件。\n\n## 二级标题\n\n- 列表项 1\n- 列表项 2\n\n正文段落。\n';
  const testFilePath = h.createTestFile(testFileName, testFileContent);
  // Use forward slashes for cross-platform JS paths
  const testDir = h.TEST_DATA_DIR.replace(/\\/g, '/');

  // ─── Step 1: Close any currently open tabs (clean slate) ─────
  // Get current tabs count to know our starting state
  const beforeState = await h.getStore(ws, 'editor');
  const beforeTabs = beforeState?.tabs?.length || 0;
  if (beforeTabs > 0) {
    // Close all tabs via store action (close all tabs one by one)
    // We skip cleanup if it fails — the test still validates opening behavior
    let tabs = beforeTabs;
    while (tabs > 0) {
      const r = await h.invokeStoreAction(ws, 'editor', 'CLOSE_TAB');
      if (!r.ok) break;
      const s = await h.getStore(ws, 'editor');
      const newLen = s?.tabs?.length ?? 0;
      if (newLen >= tabs) break;  // no progress, abort
      tabs = newLen;
    }
    await h.sleep(500);
  }
  ctx.pass(`初始状态清理完成 (before tabs=${beforeTabs})`);

  // ─── Step 2: Open test directory as project (store action, bypasses dialog) ───
  const openResult = await h.invokeStoreAction(ws, 'project', 'OPEN_PROJECT', testDir);
  if (!ctx.assert(openResult.ok, `OPEN_PROJECT 调用成功 (dir=${testDir})`)) {
    ctx.fail('OPEN_PROJECT 失败，无法继续', openResult.error || '');
    return;
  }
  ctx.pass(`OPEN_PROJECT 成功打开目录: ${testDir}`);

  // OPEN_PROJECT 异步 _fillProjectTree 填充子节点，等一会再展开根目录
  await h.sleep(1200);

  // ─── Step 2b: 确保项目树根目录展开 ─────────────────────────
  // 单跑 T002 时项目树根目录可能折叠，所有 .side-bar-file 都不可见，clickAt 会点到 (0,0)
  const expandResult = await h.ensureProjectTreeExpanded(ws);
  if (!ctx.assert(expandResult.expanded, '项目树根目录展开')) {
    await h.screenshot(ws, 'T002-tree-not-expanded');
    ctx.fail('项目树根目录无法展开');
    return;
  }
  ctx.pass(`项目树展开 (already=${expandResult.already})`);

  // ─── Step 3: Wait for file tree to render .side-bar-file ─────
  const treeReady = await h.waitForElement(ws, '.side-bar-file', 8000);
  if (!ctx.assert(treeReady, '文件树渲染完成 (.side-bar-file 出现)')) {
    // Try screenshot for debugging
    await h.screenshot(ws, 'T002-tree-not-rendered');
    ctx.fail('文件树未渲染，无法点击文件');
    return;
  }

  // ─── Step 4: Verify side bar is visible ──────────────────────
  const sideBarVisible = await h.evaluate(ws, `(() => {
    const el = document.querySelector('.side-bar') || document.querySelector('.sidebar') ||
               document.querySelector('[class*="sidebar"]') || document.querySelector('.side-bar-file');
    if (!el) return false;
    const rect = el.getBoundingClientRect();
    return rect.width > 0 && rect.height > 0;
  })()`);
  ctx.assert(sideBarVisible, '侧边栏可见');

  // Screenshot for visual reference
  await h.screenshot(ws, 'T002-file-tree');

  // ─── Step 5: Get the target .side-bar-file element info ──────
  // 注意: 文件项按字母排序，files[0] 不一定是 T002-test.md
  // 必须按 title 精确匹配，避免点到其他测试残留文件（如 T-diag-table.md）
  const fileInfo = await h.evaluate(ws, `(() => {
    const files = Array.from(document.querySelectorAll('.side-bar-file'));
    // 仅取可见项（width>0），避免点到折叠目录里的隐藏项
    const visible = files.filter(f => f.getBoundingClientRect().width > 0);
    const target = visible.find(f => {
      const t = f.getAttribute('title') || f.textContent || '';
      return t.includes('T002-test.md');
    });
    if (!target) return JSON.stringify({ found: false, visibleCount: visible.length, totalCount: files.length });
    const r = target.getBoundingClientRect();
    return JSON.stringify({
      found: true,
      count: visible.length,
      x: r.x + r.width / 2,
      y: r.y + r.height / 2,
      width: r.width,
      height: r.height,
      title: target.getAttribute('title') || '',
      text: target.textContent?.trim() || '',
    });
  })()`);
  const info = JSON.parse(fileInfo);
  if (!ctx.assert(info.found, `找到 T002-test.md 文件项 (visible=${info.visibleCount}, total=${info.totalCount})`)) {
    await h.screenshot(ws, 'T002-target-not-found');
    ctx.fail('未找到 T002-test.md 文件项');
    return;
  }
  ctx.pass(`找到 T002-test.md (共 ${info.count} 个可见文件项)`);

  // ─── Step 6: REAL DOM CLICK on target file ────────────────────
  // This is the critical UI path — must use Input.dispatchMouseEvent, not IPC
  await h.clickAt(ws, info.x, info.y);
  ctx.pass(`已真实 DOM 点击 T002-test.md (coords: ${Math.round(info.x)},${Math.round(info.y)})`);

  // ─── Step 7: Wait for currentFile to be set ──────────────────
  const fileLoaded = await h.waitForCurrentFile(ws, 8000);
  if (!ctx.assert(fileLoaded, 'currentFile 已设置 (文件加载完成)')) {
    await h.screenshot(ws, 'T002-file-not-loaded');
    ctx.fail('点击后文件未加载');
    return;
  }

  // ─── Step 8: Verify currentFile contents ─────────────────────
  const currentFile = await h.getCurrentFile(ws);
  if (!ctx.assertTruthy(currentFile, 'currentFile 非空')) {
    ctx.fail('currentFile 为 null');
    return;
  }

  // filename should be the real test file name, not "Untitled-1"
  ctx.assert(
    currentFile.filename === testFileName,
    `filename 正确 (expected="${testFileName}", got="${currentFile.filename}")`
  );
  ctx.assert(
    currentFile.filename !== 'Untitled-1' && !/Untitled-\d+/.test(currentFile.filename || ''),
    'filename 不是 Untitled-N (回归 T008 用例)'
  );
  ctx.assertTruthy(
    currentFile.pathname && currentFile.pathname.length > 0,
    `pathname 非空 (pathname="${currentFile.pathname}")`
  );
  ctx.assertTruthy(
    currentFile.markdown && currentFile.markdown.length > 0,
    `markdown 内容非空 (length=${currentFile.markdown?.length || 0})`
  );
  ctx.assertTruthy(
    currentFile.markdown?.includes('T002 测试文件'),
    'markdown 内容包含测试标记'
  );

  // ─── Step 9: Verify encoding is object type (regression for save bug) ───
  const encodingType = typeof currentFile.encoding;
  ctx.assert(
    encodingType === 'object',
    `encoding 类型为 object (got ${encodingType}, value=${JSON.stringify(currentFile.encoding)})`
  );

  // ─── Step 10: Verify editor UI rendered (muya container) ─────
  await h.sleep(800);  // allow muya to render
  const hasMuya = await h.evaluate(ws, `(() => {
    return !!(document.querySelector('.mu-container') ||
              document.querySelector('.muya') ||
              document.querySelector('.mu-editor'));
  })()`);
  ctx.assert(hasMuya, 'muya 编辑器容器已渲染 (.mu-container/.mu-editor)');

  // ─── Step 11: Final screenshot ───────────────────────────────
  await h.screenshot(ws, 'T002-file-opened');
  ctx.pass('文件打开流程完成');
}
