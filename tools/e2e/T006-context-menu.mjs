// T006: 右键菜单（contextmenu）冒烟测试
// Path: 打开文件 → 在编辑器右键 → 检查 contextmenu 浮层出现 → Esc 关闭
// 对应已知 Bug：右键菜单丢失（CodeMirror stopPropagation 截断 / contextMenu 主进程未移植）
export const meta = {
  id: 'T006',
  name: '右键菜单冒烟测试',
  priority: 'P1',
};

export default async function run(ws, ctx, h) {
  // ─── Setup: 打开测试文件 ──────────────────────────────────
  const testFileName = 'T006-context-test.md';
  const testFileContent = '# T006 右键菜单测试\n\n正文段落，用于右键测试。\n';
  h.createTestFile(testFileName, testFileContent);
  const testDir = h.TEST_DATA_DIR.replace(/\\/g, '/');

  // 清空 tabs
  const beforeState = await h.getStore(ws, 'editor');
  if (beforeState?.tabs?.length > 0) {
    let tabs = beforeState.tabs.length;
    while (tabs > 0) {
      const r = await h.invokeStoreAction(ws, 'editor', 'CLOSE_TAB');
      if (!r.ok) break;
      const s = await h.getStore(ws, 'editor');
      const newLen = s?.tabs?.length ?? 0;
      if (newLen >= tabs) break;
      tabs = newLen;
    }
    await h.sleep(300);
  }
  ctx.pass('初始状态清理完成');

  // 打开项目 + 点文件
  const openResult = await h.invokeStoreAction(ws, 'project', 'OPEN_PROJECT', testDir);
  ctx.assert(openResult.ok, 'OPEN_PROJECT 成功');

  const treeReady = await h.waitForElement(ws, '.side-bar-file', 8000);
  if (!ctx.assert(treeReady, '文件树渲染完成')) {
    ctx.fail('文件树未渲染'); return;
  }

  const pos = await h.evaluate(ws, `(() => {
    const files = Array.from(document.querySelectorAll('.side-bar-file'));
    const target = files.find(f => {
      const t = f.getAttribute('title') || f.textContent || '';
      return t.includes('T006-context-test');
    });
    if (!target) return JSON.stringify({ found: false });
    const r = target.getBoundingClientRect();
    return JSON.stringify({ found: true, x: r.x + r.width/2, y: r.y + r.height/2 });
  })()`);
  const info = JSON.parse(pos);
  if (!ctx.assert(info.found, '找到 T006 测试文件')) {
    ctx.fail('未找到测试文件'); return;
  }
  await h.clickAt(ws, info.x, info.y);
  const fileLoaded = await h.waitForCurrentFile(ws, 8000);
  if (!ctx.assert(fileLoaded, '文件加载完成')) {
    ctx.fail('文件未加载'); return;
  }
  await h.sleep(800); // 等 muya 渲染

  // ─── Step 1: 获取 contenteditable 中心坐标 ──────────────
  const editorRect = JSON.parse(await h.evaluate(ws, `JSON.stringify((() => {
    const el = document.querySelector('[contenteditable=true]') || document.querySelector('.mu-container');
    if (!el) return null;
    const r = el.getBoundingClientRect();
    return { x: r.x + r.width/2, y: r.y + r.height/2, w: r.width, h: r.height };
  })())`));
  if (!ctx.assertTruthy(editorRect, '找到编辑器元素')) {
    ctx.fail('无 contenteditable/mu-container'); return;
  }
  ctx.pass(`编辑器中心: (${Math.round(editorRect.x)}, ${Math.round(editorRect.y)})`);

  // ─── Step 2: 右键编辑器 ────────────────────────────────
  await h.rightClickAt(ws, editorRect.x, editorRect.y);
  await h.sleep(500);

  // ─── Step 3: 检查右键菜单 DOM 出现 ─────────────────────
  // 移植版右键菜单通过 tauri-bridge.ts 创建，DOM 根容器使用 inline style
  // 关键标识：position:fixed + z-index:99999（无任何 class）
  const menuInfo = JSON.parse(await h.evaluate(ws, `JSON.stringify((() => {
    // 1. 通过 z-index:99999 找菜单根容器
    const allDivs = document.querySelectorAll('body > div');
    const menuRoots = Array.from(allDivs).filter(el => {
      const st = el.style;
      return st.position === 'fixed' &&
             (st.zIndex === '99999' || st.zIndex === 99999) &&
             st.display !== 'none';
    });
    if (menuRoots.length === 0) return { foundAny: false };
    const root = menuRoots[0];
    // 2. 提取菜单项（叶子 div，非分隔符）
    const items = [];
    const separators = [];
    for (const child of root.children) {
      if (child.tagName !== 'DIV') continue;
      const cs = child.style;
      if (cs.height === '1px' || (cs.background && cs.background.includes('#e0e0e0'))) {
        separators.push('sep');
      } else {
        items.push({
          text: child.textContent?.trim() || '',
          disabled: cs.opacity === '0.4' || (cs.cursor === 'default' && cs.opacity === '0.4')
        });
      }
    }
    const rect = root.getBoundingClientRect();
    return {
      foundAny: true,
      menuCount: menuRoots.length,
      rect: { x: rect.x, y: rect.y, w: rect.width, h: rect.height },
      items,
      separatorCount: separators.length,
      rawHTML: root.outerHTML.slice(0, 400)
    };
  })())`));

  if (menuInfo.foundAny) {
    ctx.pass(`右键菜单 DOM 出现 (${menuInfo.items.length} 项 + ${menuInfo.separatorCount} 分隔符)`);
    console.log('  位置:', JSON.stringify(menuInfo.rect));
    console.log('  菜单项:', menuInfo.items.map(i => `${i.text}${i.disabled?'(disabled)':''}`).join(' | '));

    // 验证菜单项数量（8 项 + 2 分隔符）
    ctx.assert(
      menuInfo.items.length >= 5,
      `菜单项 ≥ 5 (实际=${menuInfo.items.length})`
    );
    ctx.assert(
      menuInfo.separatorCount >= 1,
      `含分隔符 (实际=${menuInfo.separatorCount})`
    );

    // 验证包含关键菜单项（移植版硬编码英文）
    const labels = menuInfo.items.map(i => i.text);
    ctx.assert(
      labels.some(l => l.toLowerCase().includes('cut') || l.toLowerCase().includes('剪切')),
      `含 Cut/剪切 项`
    );
    ctx.assert(
      labels.some(l => l.toLowerCase().includes('copy') || l.toLowerCase().includes('复制')),
      `含 Copy/复制 项`
    );
    ctx.assert(
      labels.some(l => l.toLowerCase().includes('paste') || l.toLowerCase().includes('粘贴')),
      `含 Paste/粘贴 项`
    );

    // ─── Step 4: Esc 关闭菜单 ──────────────────────────
    await h.pressKey(ws, 'Escape');
    await h.sleep(400);
    const stillVisible = JSON.parse(await h.evaluate(ws, `JSON.stringify((() => {
      const allDivs = document.querySelectorAll('body > div');
      for (const el of allDivs) {
        if (el.style.position === 'fixed' &&
            (el.style.zIndex === '99999' || el.style.zIndex === 99999)) {
          const r = el.getBoundingClientRect();
          if (r.width > 0 && r.height > 0) return true;
        }
      }
      return false;
    })())`));
    ctx.assert(!stillVisible, 'Esc 后菜单关闭');
  } else {
    ctx.fail('❌ 右键菜单未出现（z-index:99999 容器未找到）');
    await h.screenshot(ws, 'T006-no-context-menu');
  }

  await h.screenshot(ws, 'T006-final');
}
