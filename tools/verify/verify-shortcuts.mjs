// 综合快捷键验证：测试所有修复的快捷键 + 状态变化
const CDP_BASE = 'http://127.0.0.1:9222';

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

async function pressKey(ws, key, code, vk, modifiers) {
  await cdp(ws, 'Input.dispatchKeyEvent', { type: 'rawKeyDown', key, code, windowsVirtualKeyCode: vk, modifiers });
  await sleep(150);
  await cdp(ws, 'Input.dispatchKeyEvent', { type: 'keyUp', key, code, windowsVirtualKeyCode: vk, modifiers });
  await sleep(700);
}

async function getLayoutState(ws) {
  return JSON.parse(await evaluate(ws, `(() => {
    const app = document.querySelector('#app').__vue_app__;
    const pinia = app.config.globalProperties.$pinia;
    const ed = pinia.state.value.editor;
    const prefs = pinia.state.value.preferences;
    const layout = pinia.state.value.layout;
    return JSON.stringify({
      sourceCode: prefs?.sourceCode,
      rightColumn: layout?.rightColumn,
      showSideBar: layout?.showSideBar,
      showTabBar: layout?.showTabBar,
      typewriterMode: prefs?.typewriter,
      focusMode: prefs?.focus,
      tabsCount: ed?.tabs?.length ?? 0
    });
  })()`));
}

const CTRL = 2, SHIFT = 8, ALT = 1;
const results = [];

function record(name, before, after, field) {
  const changed = before[field] !== after[field];
  results.push({ name, field, before: before[field], after: after[field], pass: changed });
  console.log(`${changed ? '✓' : '✗'} ${name}: ${field} ${JSON.stringify(before[field])} → ${JSON.stringify(after[field])}`);
}

async function main() {
  const target = await getPageTarget();
  const ws = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((res, rej) => { ws.onopen = res; ws.onerror = () => rej(new Error('ws')); });

  try {
    await cdp(ws, 'Page.enable');
    console.log('=== 快捷键综合验证 ===\n');

    // 确保 sourceCode=false（渲染态），避免干扰
    let state = await getLayoutState(ws);
    console.log('初始状态:', state, '\n');

    // 1. Ctrl+K: TOC 切换 (layout.rightColumn)
    console.log('[1] Ctrl+K (TOC 切换)');
    let before = await getLayoutState(ws);
    await pressKey(ws, 'k', 'KeyK', 75, CTRL);
    let after = await getLayoutState(ws);
    record('Ctrl+K', before, after, 'rightColumn');

    // Ctrl+K 再按一次（toggle 回去）
    before = await getLayoutState(ws);
    await pressKey(ws, 'k', 'KeyK', 75, CTRL);
    after = await getLayoutState(ws);
    const back1 = before.rightColumn === after.rightColumn;
    console.log(`  toggle 回原值: ${back1 ? '✓' : '✗'} (${JSON.stringify(before.rightColumn)} → ${JSON.stringify(after.rightColumn)})`);

    // 2. Ctrl+E: 源码模式切换 (preferences.sourceCode)
    console.log('\n[2] Ctrl+E (源码模式)');
    before = await getLayoutState(ws);
    await pressKey(ws, 'e', 'KeyE', 69, CTRL);
    after = await getLayoutState(ws);
    record('Ctrl+E', before, after, 'sourceCode');
    // 切回渲染态
    await pressKey(ws, 'e', 'KeyE', 69, CTRL);

    // 3. Ctrl+J: 侧边栏切换 (layout.showSideBar)
    console.log('\n[3] Ctrl+J (侧边栏)');
    before = await getLayoutState(ws);
    await pressKey(ws, 'j', 'KeyJ', 74, CTRL);
    after = await getLayoutState(ws);
    record('Ctrl+J', before, after, 'showSideBar');
    await pressKey(ws, 'j', 'KeyJ', 74, CTRL); // toggle back

    // 4. Ctrl+Shift+B: 标签栏切换 (layout.showTabBar)
    console.log('\n[4] Ctrl+Shift+B (标签栏)');
    before = await getLayoutState(ws);
    await pressKey(ws, 'B', 'KeyB', 66, CTRL | SHIFT);
    after = await getLayoutState(ws);
    record('Ctrl+Shift+B', before, after, 'showTabBar');
    await pressKey(ws, 'B', 'KeyB', 66, CTRL | SHIFT); // toggle back

    // 5. Ctrl+Shift+G: 打字机模式 (preferences.typewriterMode)
    console.log('\n[5] Ctrl+Shift+G (打字机模式)');
    before = await getLayoutState(ws);
    await pressKey(ws, 'G', 'KeyG', 71, CTRL | SHIFT);
    after = await getLayoutState(ws);
    record('Ctrl+Shift+G', before, after, 'typewriterMode');
    await pressKey(ws, 'G', 'KeyG', 71, CTRL | SHIFT); // toggle back

    // 6. Ctrl+Shift+J: 专注模式 (preferences.focusMode)
    console.log('\n[6] Ctrl+Shift+J (专注模式)');
    before = await getLayoutState(ws);
    await pressKey(ws, 'J', 'KeyJ', 74, CTRL | SHIFT);
    after = await getLayoutState(ws);
    record('Ctrl+Shift+J', before, after, 'focusMode');
    await pressKey(ws, 'J', 'KeyJ', 74, CTRL | SHIFT); // toggle back

    // 汇总
    console.log('\n=== 汇总 ===');
    const passed = results.filter(r => r.pass).length;
    console.log(`通过: ${passed}/${results.length}`);
    if (passed === results.length) {
      console.log('✓ 所有视图切换快捷键验证通过');
    } else {
      console.log('✗ 部分快捷键未生效:', results.filter(r => !r.pass).map(r => r.name).join(', '));
    }

  } finally {
    ws.close();
  }
}

main().catch(e => { console.error('ERROR:', e.message); process.exit(1); });
