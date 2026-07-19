// T008: 表格 Shift+Click 多选视觉测试
// Path: 打开含表格的 md → 等待 .mu-table 渲染 → 单击 cell1（anchor）→ Shift+click cell9
//       → 验证 9 个 .mu-table-cell-selected + 边缘 border class 正确
//       → 普通单击中格应清空选中
// 对应已知 Bug：TableRectSelection 未实现 Shift+click 多选 + _onMouseUp 错误清空 anchor
// 修复：TableRectSelection.ts 的 _onMouseDown 新增 Shift 分支 + _onMouseUp 保留 anchor

export const meta = {
  id: 'T008',
  name: '表格 Shift+Click 多选视觉',
  priority: 'P1',
};

const TABLE_FILE = `# T008 表格多选测试

| H1 | H2 | H3 |
|----|----|----|
| A1 | A2 | A3 |
| B1 | B2 | B3 |

正文段落。
`;

// Shift modifier bit for CDP Input.dispatchMouseEvent
const SHIFT_BIT = 8;

export default async function run(ws, ctx, h) {
  // ─── Setup ──────────────────────────────────────────────────
  const testFileName = 'T008-table-multiselect.md';
  h.createTestFile(testFileName, TABLE_FILE);
  const testDir = h.TEST_DATA_DIR.replace(/\\/g, '/');

  // ─── Step 1: Clean slate — close all tabs ───────────────────
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
  ctx.pass(`初始状态清理完成 (before tabs=${beforeTabs})`);

  // ─── Step 2: Open project + locate T008 file ────────────────
  const openResult = await h.invokeStoreAction(ws, 'project', 'OPEN_PROJECT', testDir);
  if (!ctx.assert(openResult.ok, 'OPEN_PROJECT 成功')) {
    ctx.fail('OPEN_PROJECT 失败');
    return;
  }

  // 等异步 _fillProjectTree 填充（OPEN_PROJECT 立即返回时 store projectTree.children 仍为空）
  await h.sleep(1200);

  // ─── Step 2b: 展开项目树根目录 ──────────────────────────
  // 单跑 T008 时项目树根目录可能处于折叠状态（tree-wrapper display:none），
  // 此时所有 .side-bar-file 的 getBoundingClientRect() 都是 (0,0,0,0)，
  // clickAt 会点到左上角工具栏而非目标文件。先 click 折叠箭头展开。
  const foldExpanded = await h.evaluate(ws, `(()=>{
    const tw = document.querySelector('.project-tree .tree-wrapper');
    if (tw && getComputedStyle(tw).display !== 'none') return JSON.stringify({already:true});
    const i = document.querySelector('.project-tree .icon-arrow.fold, .project-tree .icon-arrow');
    if (!i) return JSON.stringify({already:false, found:false});
    const r = i.getBoundingClientRect();
    return JSON.stringify({already:false, found:true, x:r.x+r.width/2, y:r.y+r.height/2, cls:i.className});
  })()`);
  const fold = JSON.parse(foldExpanded);
  if (!fold.already) {
    if (!ctx.assert(fold.found, '找到项目树折叠箭头')) {
      ctx.fail('项目树折叠箭头不存在');
      return;
    }
    await h.clickAt(ws, fold.x, fold.y);
    // 等 tree-wrapper display:block + 文件项 visible
    const expanded = await h.waitForCondition(ws,
      `(()=>{const tw=document.querySelector('.project-tree .tree-wrapper');return !!(tw && getComputedStyle(tw).display!=='none' && tw.querySelectorAll('.side-bar-file').length>0);})()`,
      5000);
    ctx.assert(expanded, '项目树根目录已展开');
    await h.sleep(300);
  } else {
    ctx.pass('项目树已展开，无需 click');
  }

  const treeReady = await h.waitForElement(ws, '.side-bar-file', 8000);
  if (!ctx.assert(treeReady, '文件树渲染完成')) {
    ctx.fail('文件树未渲染');
    return;
  }

  const targetFile = await h.evaluate(ws, `(() => {
    const files = Array.from(document.querySelectorAll('.side-bar-file'));
    // 仅取可见的文件项（width>0），避免点到被折叠的子目录
    const visible = files.filter(f => f.getBoundingClientRect().width > 0);
    const target = visible.find(f => {
      const t = f.getAttribute('title') || f.textContent || '';
      return t.includes('T008-table-multiselect');
    });
    if (!target) return JSON.stringify({ found: false, visibleCount: visible.length, totalCount: files.length });
    const r = target.getBoundingClientRect();
    return JSON.stringify({ found: true, x: r.x + r.width/2, y: r.y + r.height/2, w: r.width, h: r.height });
  })()`);
  const fInfo = JSON.parse(targetFile);
  if (!ctx.assert(fInfo.found, `找到 T008 文件 (共 ${fInfo.count} 个文件项)`)) {
    await h.screenshot(ws, 'T008-file-not-found');
    ctx.fail('未找到 T008-table-multiselect.md');
    return;
  }
  await h.clickAt(ws, fInfo.x, fInfo.y);
  const fileLoaded = await h.waitForCurrentFile(ws, 8000);
  if (!ctx.assert(fileLoaded, '文件加载完成')) {
    ctx.fail('文件未加载');
    return;
  }

  // ─── Step 3: Wait for table to render ───────────────────────
  const tableReady = await h.waitForElement(ws, '.mu-table', 8000);
  if (!ctx.assert(tableReady, '表格已渲染 (.mu-table)')) {
    await h.screenshot(ws, 'T008-table-not-rendered');
    ctx.fail('表格未渲染');
    return;
  }
  // Allow table to fully layout (cells need offsetLeft/offsetTop resolved)
  await h.sleep(1500);

  // ─── Step 4: Get all 9 cell coordinates (3 th + 6 td) ───────
  // Use general .mu-table-cell selector to capture both th and td.
  const cellsInfo = await h.evaluate(ws, `(() => {
    const cells = document.querySelectorAll('.mu-table-cell');
    if (cells.length < 9) return JSON.stringify({ ok: false, count: cells.length, tagNames: Array.from(cells).map(c => c.tagName) });
    const out = [];
    for (let i = 0; i < 9; i++) {
      const r = cells[i].getBoundingClientRect();
      out.push({ x: r.x + r.width/2, y: r.y + r.height/2, w: r.width, h: r.height, tag: cells[i].tagName });
    }
    return JSON.stringify({ ok: true, cells: out, count: cells.length });
  })()`);
  const cInfo = JSON.parse(cellsInfo);
  if (!ctx.assert(cInfo.ok, `找到至少 9 个 .mu-table-cell (实际 ${cInfo.count})`)) {
    await h.screenshot(ws, 'T008-cells-not-found');
    ctx.fail(`表格单元格数量不足: tagNames=${cInfo.tagNames?.join(',') || '?'}`);
    return;
  }
  ctx.pass(`表格单元格已就位: ${cInfo.cells.map(c => c.tag).join(',')} (${cInfo.count} 个)`);

  // ─── Step 5: 普通单击 cell1 (H1) — 设置 anchor ──────────────
  // 关键: 不 dispatch mousemove，模拟真实单击（mousedown→mouseup）
  // 这样 _isSelecting=false，根据 _onMouseUp 修复，anchor 应被保留
  const c1 = cInfo.cells[0];

  // 先把鼠标移到 cell1（让浏览器 focus 正确）
  await h.cdp(ws, 'Input.dispatchMouseEvent', { type: 'mouseMoved', x: c1.x, y: c1.y });
  await h.sleep(100);

  // mousedown - 不带任何 modifier
  await h.cdp(ws, 'Input.dispatchMouseEvent', {
    type: 'mousePressed', x: c1.x, y: c1.y, button: 'left', clickCount: 1, modifiers: 0
  });
  await h.sleep(50);

  // mouseup - 立即释放，不 dispatch mousemove（避免触发 _onMouseMove 的拖拽逻辑）
  await h.cdp(ws, 'Input.dispatchMouseEvent', {
    type: 'mouseReleased', x: c1.x, y: c1.y, button: 'left', clickCount: 1, modifiers: 0
  });
  await h.sleep(400);

  // 单击后 cell1 不应有 mu-table-cell-selected class（普通单击不高亮，符合原版）
  const afterSingleClick = await h.evaluate(ws,
    `document.querySelectorAll('.mu-table-cell.mu-table-cell-selected').length`);
  ctx.pass(`单击 cell1 (H1) 后, selected count = ${afterSingleClick}（期望 0: 单击不高亮）`);
  await h.screenshot(ws, 'T008-after-single-click');

  // ─── Step 6: Shift+click cell9 (B3) — 扩展选择到整张表 ──────
  const c9 = cInfo.cells[8];

  // mouseMoved to c9 (不带 shift，仅移动)
  await h.cdp(ws, 'Input.dispatchMouseEvent', { type: 'mouseMoved', x: c9.x, y: c9.y });
  await h.sleep(100);

  // Shift+mousePressed (modifiers=8)
  await h.cdp(ws, 'Input.dispatchMouseEvent', {
    type: 'mousePressed', x: c9.x, y: c9.y, button: 'left', clickCount: 1, modifiers: SHIFT_BIT
  });
  await h.sleep(50);

  // Shift+mouseReleased
  await h.cdp(ws, 'Input.dispatchMouseEvent', {
    type: 'mouseReleased', x: c9.x, y: c9.y, button: 'left', clickCount: 1, modifiers: SHIFT_BIT
  });
  // Wait for _renderHighlight() to apply CSS classes
  await h.sleep(500);

  await h.screenshot(ws, 'T008-after-shift-click');

  // ─── Step 7: 验证 9 个 .mu-table-cell-selected ─────────────
  const selectedCount = await h.evaluate(ws,
    `document.querySelectorAll('.mu-table-cell.mu-table-cell-selected').length`);
  ctx.assert(selectedCount === 9, `Shift+click 后 9 个 cell 都被选中 (实际 ${selectedCount})`);

  if (selectedCount !== 9) {
    // Diagnostic: dump which cells are selected
    const diag = await h.evaluate(ws, `(() => {
      const all = document.querySelectorAll('.mu-table-cell');
      const out = [];
      all.forEach((c, i) => {
        if (c.classList.contains('mu-table-cell-selected')) {
          out.push({ idx: i, tag: c.tagName, text: c.textContent?.trim().slice(0, 20) });
        }
      });
      return JSON.stringify({ total: all.length, selected: out });
    })()`);
    ctx.fail('Shift+click 多选无效', diag);
    return;
  }

  // ─── Step 7.5: 验证选中单元格文字非空 + CSS 根因防回归 ───
  // 历史 Bug: --editor-color-04 曾被误写为不透明 #f7f7f7，导致
  // .mu-table-cell-selected::before (z-index:1) 完全遮挡文字。
  // 这里做两层防护：(a) DOM 层 textContent 非空；(b) CSS 层变量半透明。
  const textVisibility = await h.evaluate(ws, `(() => {
    const sel = document.querySelectorAll('.mu-table-cell.mu-table-cell-selected');
    const empty = [];
    sel.forEach((c, i) => {
      const t = (c.textContent || '').trim();
      if (!t) empty.push(i);
    });
    // 检查 --editor-color-04 计算值是否半透明（alpha < 1）
    const root = getComputedStyle(document.documentElement);
    const v04 = root.getPropertyValue('--editor-color-04').trim();
    let alphaOk = false;
    if (v04.startsWith('rgba')) {
      const m = v04.match(/rgba\\([^,]+,[^,]+,[^,]+,\\s*([\\d.]+)\\s*\\)/);
      if (m) alphaOk = parseFloat(m[1]) < 1;
    } else if (v04.startsWith('rgb(')) {
      alphaOk = false; // 不透明 rgb() 仍会遮挡
    } else if (v04.startsWith('#')) {
      alphaOk = false; // 不透明 hex 仍会遮挡
    }
    return JSON.stringify({ total: sel.length, emptyCount: empty.length, emptyIdx: empty, editorColor04: v04, alphaOk });
  })()`);
  const tv = JSON.parse(textVisibility);
  ctx.assert(tv.emptyCount === 0, `选中单元格文字非空 (${tv.total - tv.emptyCount}/${tv.total} 有内容)`);
  ctx.assert(tv.alphaOk, `--editor-color-04 半透明防遮挡 (当前值: "${tv.editorColor04}")`);

  // ─── Step 8: 验证边缘 border class 数量正确 ────────────────
  // 3x3 表格全选：
  //   border-top: 3 cells (顶行 3 个)
  //   border-right: 3 cells (右列 3 个)
  //   border-bottom: 3 cells (底行 3 个)
  //   border-left: 3 cells (左列 3 个)
  const borderInfo = await h.evaluate(ws, `(() => {
    const cells = document.querySelectorAll('.mu-table-cell.mu-table-cell-selected');
    const info = { top: 0, right: 0, bottom: 0, left: 0 };
    for (const c of cells) {
      if (c.classList.contains('mu-table-cell-border-top')) info.top++;
      if (c.classList.contains('mu-table-cell-border-right')) info.right++;
      if (c.classList.contains('mu-table-cell-border-bottom')) info.bottom++;
      if (c.classList.contains('mu-table-cell-border-left')) info.left++;
    }
    return JSON.stringify(info);
  })()`);
  const b = JSON.parse(borderInfo);
  ctx.assert(b.top === 3, `border-top 数量=3 (实际 ${b.top})`);
  ctx.assert(b.right === 3, `border-right 数量=3 (实际 ${b.right})`);
  ctx.assert(b.bottom === 3, `border-bottom 数量=3 (实际 ${b.bottom})`);
  ctx.assert(b.left === 3, `border-left 数量=3 (实际 ${b.left})`);

  // ─── Step 9: 普通单击 cell5 (A2) — 应清空选中 ─────────────
  const c5 = cInfo.cells[4];  // A2 (中间格)

  await h.cdp(ws, 'Input.dispatchMouseEvent', { type: 'mouseMoved', x: c5.x, y: c5.y });
  await h.sleep(100);
  await h.cdp(ws, 'Input.dispatchMouseEvent', {
    type: 'mousePressed', x: c5.x, y: c5.y, button: 'left', clickCount: 1, modifiers: 0
  });
  await h.sleep(50);
  await h.cdp(ws, 'Input.dispatchMouseEvent', {
    type: 'mouseReleased', x: c5.x, y: c5.y, button: 'left', clickCount: 1, modifiers: 0
  });
  await h.sleep(500);

  const afterClearClick = await h.evaluate(ws,
    `document.querySelectorAll('.mu-table-cell.mu-table-cell-selected').length`);
  ctx.assert(afterClearClick === 0, `普通单击 cell5 后清空选中 (实际 ${afterClearClick})`);

  await h.screenshot(ws, 'T008-after-clear-click');
  ctx.pass('表格 Shift+click 多选视觉验证通过');
}
