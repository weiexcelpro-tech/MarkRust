// 对比不同输入方式触发 muya store 同步的效果
// 方法1: CDP Input.insertText
// 方法2: document.execCommand('insertText')
// 方法3: CDP Input.dispatchKeyEvent (逐字符)
// 方法4: 直接 dispatch InputEvent
import { connectCdp, evaluate, sleep, cdp } from './lib/cdp.mjs'
import { clickElement, clickAt, pressKey } from './setup.mjs'

async function insertTextCdp(ws, text) {
  await cdp(ws, 'Input.insertText', { text })
}

async function getStoreMarkdown(ws) {
  const r = await evaluate(ws, `(() => {
    const a=document.querySelector('#app'); if(!a||!a.__vue_app__) return null;
    const p=a.__vue_app__.config.globalProperties.$pinia; if(!p||!p._s) return null;
    const s=Array.from(p._s.values()).find(x=>x.$id==='editor');
    if(!s||!s.currentFile) return null;
    return {
      markdown: s.currentFile.markdown || '',
      isSaved: s.currentFile.isSaved,
      filename: s.currentFile.filename || ''
    };
  })()`)
  try { return JSON.parse(r) } catch { return null }
}

async function method1_cdp_insertText(ws, marker) {
  console.log(`\n[方法1] CDP Input.insertText "${marker}"`)
  const before = await getStoreMarkdown(ws)
  console.log(`  before: isSaved=${before?.isSaved}, md.len=${before?.markdown?.length}, md last50="${(before?.markdown||'').slice(-50)}"`)
  
  await insertTextCdp(ws, marker)
  await sleep(800)
  
  const after = await getStoreMarkdown(ws)
  const inStore = (after?.markdown || '').includes(marker)
  console.log(`  after:  isSaved=${after?.isSaved}, md.len=${after?.markdown?.length}, md last50="${(after?.markdown||'').slice(-50)}"`)
  console.log(`  Store 包含 "${marker}": ${inStore ? '✅ YES' : '❌ NO'}`)
  // 检查 DOM
  const inDom = await evaluate(ws, `document.querySelector('[contenteditable=true]')?.innerHTML?.includes(${JSON.stringify(marker)}) || false`)
  console.log(`  contenteditable DOM 包含 "${marker}": ${inDom === 'true' ? '✅ YES' : '❌ NO'}`)
  return { inStore, inDom: inDom === 'true' }
}

async function method2_execCommand(ws, marker) {
  console.log(`\n[方法2] document.execCommand('insertText', false, "${marker}")`)
  const before = await getStoreMarkdown(ws)
  
  // 直接在 contenteditable 元素上 execCommand
  const r = await evaluate(ws, `(() => {
    const el = document.querySelector('[contenteditable=true]');
    if (!el) return 'no-contenteditable';
    el.focus();
    const ok = document.execCommand('insertText', false, ${JSON.stringify(marker)});
    return 'execCommand result: ' + ok;
  })()`)
  console.log(`  execCommand: ${r}`)
  await sleep(800)
  
  const after = await getStoreMarkdown(ws)
  const inStore = (after?.markdown || '').includes(marker)
  console.log(`  Store 包含 "${marker}": ${inStore ? '✅ YES' : '❌ NO'}`)
  return { inStore }
}

async function method3_dispatchKeyEvent(ws, marker) {
  console.log(`\n[方法3] CDP Input.dispatchKeyEvent 逐字符 "${marker}"`)
  const before = await getStoreMarkdown(ws)
  
  // 确保焦点在 contenteditable
  await evaluate(ws, `document.querySelector('[contenteditable=true]')?.focus()`)
  await sleep(200)
  
  for (const ch of marker) {
    // keyDown
    await cdp(ws, 'Input.dispatchKeyEvent', {
      type: 'keyDown',
      text: ch,
      key: ch,
      code: '',
      windowsVirtualKeyCode: ch.charCodeAt(0),
    })
    // keyUp
    await cdp(ws, 'Input.dispatchKeyEvent', {
      type: 'keyUp',
      key: ch,
      code: '',
      windowsVirtualKeyCode: ch.charCodeAt(0),
    })
    await sleep(20)
  }
  await sleep(800)
  
  const after = await getStoreMarkdown(ws)
  const inStore = (after?.markdown || '').includes(marker)
  console.log(`  Store 包含 "${marker}": ${inStore ? '✅ YES' : '❌ NO'}`)
  return { inStore }
}

async function method4_inputEvent(ws, marker) {
  console.log(`\n[方法4] 直接 dispatch InputEvent "${marker}"`)
  
  const r = await evaluate(ws, `(() => {
    const el = document.querySelector('[contenteditable=true]');
    if (!el) return 'no-contenteditable';
    el.focus();
    // 在光标处插入文本节点
    const sel = window.getSelection();
    if (!sel.rangeCount) return 'no-selection';
    const range = sel.getRangeAt(0);
    range.deleteContents();
    range.insertNode(document.createTextNode(${JSON.stringify(marker)}));
    range.collapse(false);
    // 触发 input 事件
    el.dispatchEvent(new InputEvent('input', {
      bubbles: true,
      cancelable: true,
      inputType: 'insertText',
      data: ${JSON.stringify(marker)},
    }));
    return 'inserted + dispatched input event';
  })()`)
  console.log(`  result: ${r}`)
  await sleep(800)
  
  const after = await getStoreMarkdown(ws)
  const inStore = (after?.markdown || '').includes(marker)
  console.log(`  Store 包含 "${marker}": ${inStore ? '✅ YES' : '❌ NO'}`)
  return { inStore }
}

async function main() {
  const ws = await connectCdp()
  console.log('=== 输入方法对比诊断 ===')
  
  const store = await getStoreMarkdown(ws)
  console.log('当前文件:', store?.filename, 'md.len=', store?.markdown?.length)
  
  if (!store?.filename) {
    console.log('⚠️ 当前没有打开文件，编辑器可能是空的')
  }
  
  // 确保焦点在 contenteditable
  await evaluate(ws, `document.querySelector('[contenteditable=true]')?.focus()`)
  await sleep(300)
  
  // 等价的 4 种方法
  const ts = Date.now()
  const m1 = `M1_${ts}`
  const m2 = `M2_${ts}`
  const m3 = `M3_${ts}`
  const m4 = `M4_${ts}`
  
  const r1 = await method1_cdp_insertText(ws, m1)
  const r2 = await method2_execCommand(ws, m2)
  const r3 = await method3_dispatchKeyEvent(ws, m3)
  const r4 = await method4_inputEvent(ws, m4)
  
  console.log('\n=== 总结 ===')
  console.log(`方法1 CDP Input.insertText: store=${r1.inStore?'YES':'NO'}, dom=${r1.inDom?'YES':'NO'}`)
  console.log(`方法2 execCommand: store=${r2.inStore?'YES':'NO'}`)
  console.log(`方法3 dispatchKeyEvent: store=${r3.inStore?'YES':'NO'}`)
  console.log(`方法4 dispatchInputEvent: store=${r4.inStore?'YES':'NO'}`)
  
  console.log('\n=== 最终 store.markdown 内容 ===')
  const final = await getStoreMarkdown(ws)
  console.log(`isSaved=${final?.isSaved}, len=${final?.markdown?.length}`)
  console.log(`含 ${m1}? ${final?.markdown?.includes(m1)}`)
  console.log(`含 ${m2}? ${final?.markdown?.includes(m2)}`)
  console.log(`含 ${m3}? ${final?.markdown?.includes(m3)}`)
  console.log(`含 ${m4}? ${final?.markdown?.includes(m4)}`)
  
  process.exit(0)
}
main().catch(e => { console.error(e); process.exit(1) })
