// T004: Markdown rendering verification
// Path: open file with various markdown syntax → verify muya renders correct block types
// Catches: muya not rendering, CSS not loaded, block parser broken
export const meta = {
  id: 'T004',
  name: 'Markdown 渲染（多语法块识别）',
  priority: 'P0',
};

const SYNTAX_FILE = `# T004 标题1

## T004 标题2

段落文本内容。

- 无序项1
- 无序项2
- 无序项3

1. 有序项1
2. 有序项2

| 列1 | 列2 |
|-----|-----|
| A   | B   |
| C   | D   |

\`\`\`javascript
console.log("hello");
\`\`\`

> 引用块文本

**粗体** *斜体* \`行内代码\`
`;

export default async function run(ws, ctx, h) {
  // ─── Setup ──────────────────────────────────────────────────
  const testFileName = 'T004-render-test.md';
  h.createTestFile(testFileName, SYNTAX_FILE);
  const testDir = h.TEST_DATA_DIR.replace(/\\/g, '/');

  // ─── Step 1: Close all tabs (clean slate) ───────────────────
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

  // Ensure WYSIWYG mode (sourceCode off) for rendering test
  const prefsBefore = await h.getStore(ws, 'preferences');
  if (prefsBefore?.sourceCode === true) {
    await h.evaluate(ws, `(() => {
      const app = document.querySelector('#app');
      if (!app || !app.__vue_app__) return false;
      const pinia = app.__vue_app__.config.globalProperties.$pinia;
      const store = Array.from(pinia._s.values()).find(s => s.$id === 'preferences');
      if (store) store.sourceCode = false;
      return true;
    })()`);
    await h.sleep(500);
    ctx.pass('已关闭 sourceCode 模式（确保 WYSIWYG 渲染）');
  }

  // ─── Step 2: Open project + locate T004 file ────────────────
  const openResult = await h.invokeStoreAction(ws, 'project', 'OPEN_PROJECT', testDir);
  if (!ctx.assert(openResult.ok, 'OPEN_PROJECT 成功')) {
    ctx.fail('OPEN_PROJECT 失败');
    return;
  }

  const treeReady = await h.waitForElement(ws, '.side-bar-file', 8000);
  if (!ctx.assert(treeReady, '文件树渲染完成')) {
    ctx.fail('文件树未渲染');
    return;
  }

  const found = await h.evaluate(ws, `(() => {
    const files = Array.from(document.querySelectorAll('.side-bar-file'));
    const target = files.find(f => {
      const t = f.getAttribute('title') || f.textContent || '';
      return t.includes('T004-render-test');
    });
    if (!target) return JSON.stringify({ found: false, count: files.length });
    const r = target.getBoundingClientRect();
    return JSON.stringify({ found: true, x: r.x + r.width/2, y: r.y + r.height/2 });
  })()`);
  const foundInfo = JSON.parse(found);
  if (!ctx.assert(foundInfo.found, `找到 T004 文件 (共 ${foundInfo.count} 个文件项)`)) {
    await h.screenshot(ws, 'T004-file-not-found');
    ctx.fail('未找到 T004-render-test.md');
    return;
  }

  await h.clickAt(ws, foundInfo.x, foundInfo.y);
  const fileLoaded = await h.waitForCurrentFile(ws, 8000);
  if (!ctx.assert(fileLoaded, '文件加载完成')) {
    ctx.fail('文件未加载');
    return;
  }

  // ─── Step 3: Wait for muya to render ────────────────────────
  const hasMuya = await h.waitForElement(ws, '.mu-container, .mu-editor, .muya', 8000);
  ctx.assert(hasMuya, 'muya 编辑器容器已挂载');
  // Allow full block rendering (tables/code blocks take extra ticks)
  await h.sleep(1800);

  // ─── Step 4: Check muya block types via DOM ─────────────────
  const blockInfo = await h.evaluate(ws, `(() => {
    const result = {};
    // Try multiple possible selectors for each block type (muya class naming variants)
    result.atxHeading = !!document.querySelector('.mu-atx-heading, .mu-heading, [class*="atx"], h1, h2');
    result.table = !!document.querySelector('.mu-table, [class*="mu-table"]');
    result.bulletList = !!document.querySelector('.mu-bullet-list, .mu-unordered-list, [class*="bullet-list"]');
    result.orderList = !!document.querySelector('.mu-order-list, .mu-ordered-list, [class*="order-list"]');
    result.codeBlock = !!document.querySelector('.mu-code-block, [class*="code-block"], .mu-fence-code, [class*="fence"]');
    result.blockQuote = !!document.querySelector('.mu-block-quote, [class*="block-quote"]');
    // Counts
    result.headingCount = document.querySelectorAll('.mu-atx-heading, .mu-heading, [class*="atx"]').length;
    result.tableCount = document.querySelectorAll('.mu-table, [class*="mu-table"]').length;
    result.bulletCount = document.querySelectorAll('.mu-bullet-list, [class*="bullet-list"]').length;
    result.orderCount = document.querySelectorAll('.mu-order-list, [class*="order-list"]').length;
    result.codeCount = document.querySelectorAll('.mu-code-block, [class*="code-block"], [class*="fence"]').length;
    result.quoteCount = document.querySelectorAll('.mu-block-quote, [class*="block-quote"]').length;
    // H1 computed font-size (CSS loaded indicator)
    const h1 = document.querySelector('.mu-atx-heading, .mu-heading, h1');
    if (h1) {
      const cs = window.getComputedStyle(h1);
      result.h1FontSize = cs.fontSize;
      result.h1PixelSize = parseFloat(cs.fontSize);
    } else {
      result.h1PixelSize = -1;
    }
    // Overall muya block count
    result.totalMuBlocks = document.querySelectorAll('[class*="mu-"]').length;
    return JSON.stringify(result);
  })()`);

  let blocks;
  try {
    blocks = JSON.parse(blockInfo);
  } catch {
    ctx.fail('无法解析渲染块信息', String(blockInfo).slice(0, 200));
    return;
  }

  ctx.assert(blocks.atxHeading, `标题渲染 (.mu-atx-heading, count=${blocks.headingCount})`);
  ctx.assert(blocks.bulletList, `无序列表渲染 (.mu-bullet-list, count=${blocks.bulletCount})`);
  ctx.assert(blocks.orderList, `有序列表渲染 (.mu-order-list, count=${blocks.orderCount})`);
  ctx.assert(blocks.table, `表格渲染 (.mu-table, count=${blocks.tableCount})`);
  ctx.assert(blocks.codeBlock, `代码块渲染 (.mu-code-block, count=${blocks.codeCount})`);
  ctx.assert(blocks.blockQuote, `引用块渲染 (.mu-block-quote, count=${blocks.quoteCount})`);

  // ─── Step 5: CSS loaded check (computed style) ──────────────
  if (blocks.h1PixelSize !== undefined && blocks.h1PixelSize >= 0) {
    ctx.assert(
      blocks.h1PixelSize >= 20,
      `H1 字号 >= 20px (CSS 已加载, fontSize=${blocks.h1FontSize}, px=${blocks.h1PixelSize})`
    );
  } else {
    ctx.fail('无法获取 H1 computed fontSize（CSS 可能未加载）');
  }

  ctx.pass(`muya 块总数=${blocks.totalMuBlocks}`);

  // ─── Step 6: Screenshot ─────────────────────────────────────
  await h.screenshot(ws, 'T004-rendered');
  ctx.pass('Markdown 多语法渲染验证完成');
}
