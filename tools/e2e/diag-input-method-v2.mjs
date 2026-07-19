// 改进版：先打开文件再测试输入方法
import { connectCdp, evaluate, sleep, cdp } from './lib/cdp.mjs'
import { insertText, clickElement, clickAt, waitForElement, waitForCurrentFile, invokeStoreAction, createTestFile, TEST_DATA_DIR, sleep as h_sleep } from './setup.mjs'

async function getStoreMarkdown(ws) {
  // 用 JSON.stringify 包裹以确保 Vue reactive proxy 正确序列化
  const r = await evaluate(ws, `JSON.stringify((() => {
    const a=document.querySelector('#app'); if(!a||!a.__vue_app__) return null;
    const p=a.__vue_app__.config.globalProperties.$pinia; if(!p||!p._s) return null;
    const s=Array.from(p._s.values()).find(x=>x.$id==='editor');
    if(!s||!s.currentFile) return null;
    return {
      markdown: s.currentFile.markdown || '',
      isSaved: s.currentFile.isSaved,
      filename: s.currentFile.filename || ''
    };
  })())`)
  try { return JSON.parse(r) } catch { return null }
}

async function focusContentEditable(ws) {
  // 点击 contenteditable 中心，确保焦点在 muya 编辑器
  const rect = await evaluate(ws, `(() => {
    const el = document.querySelector('[contenteditable=true]');
    if (!el) return null;
    const r = el.getBoundingClientRect();
    return JSON.stringify({ x: r.x + r.width/2, y: r.y + r.height/2 });
  })()`)
  if (rect) {
    const { x, y } = JSON.parse(rect)
    await cdp(ws, 'Input.dispatchMouseEvent', { type: 'mouseMoved', x, y })
    await cdp(ws, 'Input.dispatchMouseEvent', { type: 'mousePressed', x, y, button: 'left', clickCount: 1 })
    await cdp(ws, 'Input.dispatchMouseEvent', { type: 'mouseReleased', x, y, button: 'left', clickCount: 1 })
    await sleep(200)
  }
  await evaluate(ws, `document.querySelector('[contenteditable=true]')?.focus()`)
  await sleep(100)
}

async function method1_cdp_insertText(ws, marker) {
  console.log(`\n[方法1] CDP Input.insertText "${marker}"`)
  await focusContentEditable(ws)
  // 用 Ctrl+End 跳到文档末尾
  await cdp(ws, 'Input.dispatchKeyEvent', { type: 'rawKeyDown', key: 'Control', code: 'ControlLeft', windowsVirtualKeyCode: 0x11 })
  await cdp(ws, 'Input.dispatchKeyEvent', { type: 'rawKeyDown', key: 'End', code: 'End', windowsVirtualKeyCode: 0x23 })
  await cdp(ws, 'Input.dispatchKeyEvent', { type: 'keyUp', key: 'End', code: 'End', windowsVirtualKeyCode: 0x23 })
  await cdp(ws, 'Input.dispatchKeyEvent', { type: 'keyUp', key: 'Control', code: 'ControlLeft', windowsVirtualKeyCode: 0x11 })
  await sleep(200)
  
  await cdp(ws, 'Input.insertText', { text: marker })
  await sleep(800)
  
  const after = await getStoreMarkdown(ws)
  const inStore = (after?.markdown || '').includes(marker)
  console.log(`  Store markdown 含 "${marker}": ${inStore ? '✅ YES' : '❌ NO'} (当前 isSaved=${after?.isSaved})`)
  return { inStore }
}

async function method2_execCommand(ws, marker) {
  console.log(`\n[方法2] document.execCommand('insertText', false, "${marker}")`)
  await focusContentEditable(ws)
  const r = await evaluate(ws, `(() => {
    const el = document.querySelector('[contenteditable=true]');
    if (!el) return 'no-contenteditable';
    el.focus();
    const ok = document.execCommand('insertText', false, ${JSON.stringify(marker)});
    return 'execCommand: ' + ok;
  })()`)
  console.log(`  ${r}`)
  await sleep(800)
  const after = await getStoreMarkdown(ws)
  const inStore = (after?.markdown || '').includes(marker)
  console.log(`  Store markdown 含 "${marker}": ${inStore ? '✅ YES' : '❌ NO'}`)
  return { inStore }
}

async function method3_dispatchKeyEvent(ws, marker) {
  console.log(`\n[方法3] CDP Input.dispatchKeyEvent 逐字符 "${marker}"`)
  await focusContentEditable(ws)
  for (const ch of marker) {
    await cdp(ws, 'Input.dispatchKeyEvent', {
      type: 'keyDown', text: ch, key: ch, code: '',
      windowsVirtualKeyCode: ch.charCodeAt(0),
    })
    await cdp(ws, 'Input.dispatchKeyEvent', {
      type: 'keyUp', key: ch, code: '',
      windowsVirtualKeyCode: ch.charCodeAt(0),
    })
    await sleep(30)
  }
  await sleep(800)
  const after = await getStoreMarkdown(ws)
  const inStore = (after?.markdown || '').includes(marker)
  console.log(`  Store markdown 含 "${marker}": ${inStore ? '✅ YES' : '❌ NO'}`)
  return { inStore }
}

async function method4_combined(ws, marker) {
  console.log(`\n[方法4] execCommand + InputEvent "${marker}"`)
  await focusContentEditable(ws)
  const r = await evaluate(ws, `(() => {
    const el = document.querySelector('[contenteditable=true]');
    if (!el) return 'no-contenteditable';
    el.focus();
    const sel = window.getSelection();
    if (!sel.rangeCount) return 'no-sel';
    const range = sel.getRangeAt(0);
    range.deleteContents();
    range.insertNode(document.createTextNode(${JSON.stringify(marker)}));
    range.collapse(false);
    el.dispatchEvent(new InputEvent('input', {
      bubbles: true, cancelable: true,
      inputType: 'insertText', data: ${JSON.stringify(marker)},
    }));
    return 'inserted+dispatched';
  })()`)
  console.log(`  ${r}`)
  await sleep(800)
  const after = await getStoreMarkdown(ws)
  const inStore = (after?.markdown || '').includes(marker)
  console.log(`  Store markdown 含 "${marker}": ${inStore ? '✅ YES' : '❌ NO'}`)
  return { inStore }
}

async function main() {
  const ws = await connectCdp()
  console.log('=== 输入方法对比诊断 v2 ===')
  
  // ── Step 1: 创建并打开测试文件 ──
  const testDir = TEST_DATA_DIR.replace(/\\/g, '/')
  createTestFile('diag-input-test.md', '# Diag Input\n\nHello world.\n')
  console.log('打开测试文件...')
  
  // 清空 tabs + 打开项目
  await evaluate(ws, `(() => {
    const app = document.querySelector('#app');
    const pinia = app.__vue_app__.config.globalProperties.$pinia;
    const store = Array.from(pinia._s.values()).find(s => s.$id === 'editor');
    if (store) { store.tabs = []; store.currentFile = null; }
    return 'cleared'
  })()`)
  await sleep(500)
  
  await invokeStoreAction(ws, 'project', 'OPEN_PROJECT', testDir)
  await waitForElement(ws, '.side-bar-file', 8000)
  
  // 点击 diag-input-test 文件
  const pos = await evaluate(ws, `(() => {
    const files = Array.from(document.querySelectorAll('.side-bar-file'));
    const target = files.find(f => {
      const t = f.getAttribute('title') || f.textContent || '';
      return t.includes('diag-input-test');
    });
    if (!target) return JSON.stringify({ found: false });
    const r = target.getBoundingClientRect();
    return JSON.stringify({ found: true, x: r.x + r.width/2, y: r.y + r.height/2 });
  })()`)
  const info = JSON.parse(pos)
  if (!info.found) {
    console.log('❌ 未找到 diag-input-test.md')
    process.exit(1)
  }
  await clickAt(ws, info.x, info.y)
  await waitForCurrentFile(ws, 8000)
  
  const store0 = await getStoreMarkdown(ws)
  console.log(`已打开文件: ${store0?.filename}, md.len=${store0?.markdown?.length}, isSaved=${store0?.isSaved}`)
  console.log(`md 前100: "${(store0?.markdown||'').slice(0, 100)}"`)
  
  // ── Step 2: 测试 4 种方法 ──
  const ts = Date.now()
  const r1 = await method1_cdp_insertText(ws, `M1${ts}`)
  const r2 = await method2_execCommand(ws, `M2${ts}`)
  const r3 = await method3_dispatchKeyEvent(ws, `M3${ts}`)
  const r4 = await method4_combined(ws, `M4${ts}`)
  
  console.log('\n=== 总结 ===')
  console.log(`方法1 CDP Input.insertText:    store=${r1.inStore?'YES ✅':'NO ❌'}`)
  console.log(`方法2 execCommand:              store=${r2.inStore?'YES ✅':'NO ❌'}`)
  console.log(`方法3 dispatchKeyEvent(逐字符): store=${r3.inStore?'YES ✅':'NO ❌'}`)
  console.log(`方法4 execCommand+InputEvent:   store=${r4.inStore?'YES ✅':'NO ❌'}`)
  
  console.log('\n=== 最终 store.markdown 末尾 200 字符 ===')
  const final = await getStoreMarkdown(ws)
  console.log(`isSaved=${final?.isSaved}, len=${final?.markdown?.length}`)
  console.log(`tail: "${(final?.markdown||'').slice(-200)}"`)
  
  process.exit(0)
}
main().catch(e => { console.error(e); process.exit(1) })
