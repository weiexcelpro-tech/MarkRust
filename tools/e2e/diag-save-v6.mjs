// 诊断脚本 v6：T003 真实路径 + CDP keyevent 路径验证
// 核心问题：
//   Q1. CDP Input.dispatchKeyEvent 是否触发 DOM keydown 事件？（a 键对照）
//   Q2. Ctrl+S 真实走哪条路径？（keyboardShortcuts keydown? Tauri menu accelerator?）
//   Q3. T003 真实路径（OPEN_PROJECT→点击文件）下 tabs[] 与 currentFile.id 是否匹配？
//   Q4. Ctrl+S vs 直接 FILE_SAVE() 对比，isSaved 翻转差异
import { connectCdp, evaluate, cdp, sleep } from './lib/cdp.mjs'
import {
  getStore, invokeStoreAction, getCurrentFile, createTestFile, readFileAbs,
  clickAt, waitForElement, waitForCurrentFile, pressKey
} from './setup.mjs'

const TEST_DIR = 'C:\\Work\\202607\\MarkText优化\\marktext-tauri\\tools\\e2e\\.test-data'

async function main() {
  const ws = await connectCdp()
  console.log('=== Diag v6: T003 真实路径 + CDP keyevent 路径验证 ===\n')

  // ─── Step 1: T003 真实路径打开文件 ──────────────────────────
  console.log('[Step 1] 走 T003 真实路径打开文件...')

  // 清空 tabs（干净起点）
  await evaluate(ws, `(() => {
    const app = document.querySelector('#app');
    const pinia = app.__vue_app__.config.globalProperties.$pinia;
    const store = Array.from(pinia._s.values()).find(s => s.$id === 'editor');
    store.tabs = []
    store.currentFile = null
    return 'cleared'
  })()`)

  // 创建测试文件
  const markText = `DIAGV6_MARK_${Date.now()}`
  const testFileName = 'diag-v6-test.md'
  const testFilePath = createTestFile(testFileName, '# Diag V6\n\n初始内容\n')

  // OPEN_PROJECT
  const openResult = await invokeStoreAction(ws, 'project', 'OPEN_PROJECT', TEST_DIR.replace(/\\/g, '/'))
  console.log('  OPEN_PROJECT.ok:', openResult?.ok)

  const treeReady = await waitForElement(ws, '.side-bar-file', 8000)
  if (!treeReady) { console.log('  文件树未渲染!'); process.exit(1) }

  // 定位并点击 diag-v6-test.md
  const found = await evaluate(ws, `(() => {
    const files = Array.from(document.querySelectorAll('.side-bar-file'));
    const target = files.find(f => {
      const t = f.getAttribute('title') || f.textContent || '';
      return t.includes('diag-v6-test');
    });
    if (!target) return JSON.stringify({ found: false, count: files.length });
    const r = target.getBoundingClientRect();
    return JSON.stringify({ found: true, x: r.x + r.width/2, y: r.y + r.height/2 });
  })()`)
  const foundInfo = JSON.parse(found)
  if (!foundInfo.found) { console.log('  未找到 diag-v6-test.md!'); process.exit(1) }

  await clickAt(ws, foundInfo.x, foundInfo.y)
  const fileLoaded = await waitForCurrentFile(ws, 8000)
  if (!fileLoaded) { console.log('  文件未加载!'); process.exit(1) }

  const cf = await getCurrentFile(ws)
  console.log('  currentFile:', JSON.stringify({
    id: cf?.id,
    filename: cf?.filename,
    pathname: cf?.pathname?.slice(-30),
    isSaved: cf?.isSaved
  }))

  // ★ 关键：检查 tabs[] vs currentFile.id
  const state1 = await getStore(ws, 'editor')
  const tabsInfo = state1.tabs?.map(t => ({ id: t.id, filename: t.filename, isSaved: t.isSaved }))
  const cfInTabs = state1.tabs?.some(t => t.id === cf?.id)
  console.log('  tabs[]:', JSON.stringify(tabsInfo))
  console.log('  ★ currentFile.id 在 tabs[] 中?', cfInTabs, '(cf.id=' + cf?.id + ')')

  // ─── Step 2: 修改 markdown ──────────────────────────────────
  console.log('\n[Step 2] 修改 markdown...')
  const modifiedContent = '# Diag V6\n\n初始内容\n\n' + markText + '\n'
  await evaluate(ws, `(() => {
    const app = document.querySelector('#app');
    const pinia = app.__vue_app__.config.globalProperties.$pinia;
    const store = Array.from(pinia._s.values()).find(s => s.$id === 'editor');
    store.currentFile.markdown = ${JSON.stringify(modifiedContent)};
    store.currentFile.isSaved = false;
    return JSON.stringify({ mdLen: store.currentFile.markdown.length, isSaved: store.currentFile.isSaved })
  })()`)

  // ─── Step 3: 注入探针 ───────────────────────────────────────
  console.log('\n[Step 3] 注入探针: keydown(capture) + ipcRenderer.send wrap + IPC listeners')
  await evaluate(ws, `(() => {
    window.__diag6 = {
      keydown_a: [],
      keydown_ctrls: [],
      keydown_any: [],
      ipcSend: [],
      askFileSave: 0,
      tabSaved: []
    }
    // 包装 ipcRenderer.send
    const origSend = window.electron.ipcRenderer.send.bind(window.electron.ipcRenderer)
    window.electron.ipcRenderer.send = function(channel, ...args) {
      window.__diag6.ipcSend.push({ channel, firstArg: args[0], time: Date.now() })
      return origSend(channel, ...args)
    }
    // keydown 探针（capture phase，监听所有 keydown）
    document.addEventListener('keydown', (e) => {
      const info = { key: e.key, code: e.code, ctrlKey: e.ctrlKey, target: e.target.tagName, time: Date.now() }
      window.__diag6.keydown_any.push(info)
      if (e.key === 'a' && !e.ctrlKey) window.__diag6.keydown_a.push(info)
      if ((e.key === 's' || e.key === 'S') && e.ctrlKey) window.__diag6.keydown_ctrls.push(info)
    }, { capture: true })
    // IPC 通道监听
    window.electron.ipcRenderer.on('mt::editor-ask-file-save', () => window.__diag6.askFileSave++)
    window.electron.ipcRenderer.on('mt::tab-saved', (e, id) => window.__diag6.tabSaved.push({ id, time: Date.now() }))
    return 'probes installed'
  })()`)

  // ─── Step 4: 基础验证 - 派发 'a' 键 ────────────────────────
  console.log('\n[Step 4] 基础验证: 派发 a 键（无修饰键）, 检查 DOM keydown 是否触发')
  // 聚焦编辑器
  try {
    const rect = await evaluate(ws, `(() => {
      const el = document.querySelector('.mu-container') || document.querySelector('.mu-editor')
      if (!el) return null
      const r = el.getBoundingClientRect()
      return JSON.stringify({ x: r.x + r.width/2, y: r.y + r.height/2 })
    })()`)
    if (rect) {
      const { x, y } = JSON.parse(rect)
      await cdp(ws, 'Input.dispatchMouseEvent', { type: 'mousePressed', x, y, button: 'left', clickCount: 1 })
      await cdp(ws, 'Input.dispatchMouseEvent', { type: 'mouseReleased', x, y, button: 'left', clickCount: 1 })
      await sleep(200)
    }
  } catch (e) {}

  await cdp(ws, 'Input.dispatchKeyEvent', { type: 'rawKeyDown', key: 'a', code: 'KeyA', windowsVirtualKeyCode: 65, modifiers: 0 })
  await cdp(ws, 'Input.dispatchKeyEvent', { type: 'keyUp', key: 'a', code: 'KeyA', windowsVirtualKeyCode: 65, modifiers: 0 })
  await sleep(300)

  const probeA = JSON.parse(await evaluate(ws, `JSON.stringify({ keydown_a: window.__diag6.keydown_a.length, keydown_any: window.__diag6.keydown_any.length })`))
  console.log('  a键 keydown 探针:', probeA.keydown_a, '次')
  console.log('  所有 keydown 探针:', probeA.keydown_any, '次')
  if (probeA.keydown_any === 0) {
    console.log('  ⚠️ CDP keyevent 没有触发 DOM keydown！这是 Ctrl+S 不工作的根因。')
  } else {
    console.log('  ✅ CDP keyevent 能触发 DOM keydown')
  }

  // ─── Step 5: 清空探针, 派发 Ctrl+S ─────────────────────────
  console.log('\n[Step 5] 清空探针, 派发 Ctrl+S...')
  await evaluate(ws, `(() => {
    window.__diag6.keydown_any = []; window.__diag6.keydown_ctrls = [];
    window.__diag6.ipcSend = []; window.__diag6.askFileSave = 0; window.__diag6.tabSaved = [];
    return 'cleared'
  })()`)

  await pressKey(ws, 'S', ['ctrl'])
  await sleep(500)

  const probeS = JSON.parse(await evaluate(ws, `JSON.stringify(window.__diag6)`))
  console.log('  Ctrl+S keydown 探针:', probeS.keydown_ctrls, '次')
  console.log('  所有 keydown 探针:', probeS.keydown_any, '次')
  console.log('  ipcSend channels:', probeS.ipcSend.map(s => s.channel))
  console.log('  askFileSave:', probeS.askFileSave)
  console.log('  tabSaved:', probeS.tabSaved)

  // ─── Step 6: 等待异步链路完成 ──────────────────────────────
  await sleep(1500)
  const probeS2 = JSON.parse(await evaluate(ws, `JSON.stringify(window.__diag6)`))
  console.log('\n[Step 6] 等待 1500ms 后:')
  console.log('  ipcSend channels:', probeS2.ipcSend.map(s => s.channel))
  console.log('  askFileSave:', probeS2.askFileSave)
  console.log('  tabSaved:', probeS2.tabSaved)

  // ─── Step 7: 最终状态 + 磁盘 ───────────────────────────────
  const state2 = await getStore(ws, 'editor')
  console.log('\n[Step 7] Ctrl+S 后最终状态:')
  console.log('  currentFile.id:', state2.currentFile?.id)
  console.log('  currentFile.isSaved:', state2.currentFile?.isSaved)
  console.log('  tabs[]:', state2.tabs?.map(t => ({ id: t.id, isSaved: t.isSaved })))
  let diskAfterCtrlS = ''
  try {
    diskAfterCtrlS = readFileAbs(testFilePath)
    console.log('  磁盘文件长度:', diskAfterCtrlS.length, '包含 markText:', diskAfterCtrlS.includes(markText))
  } catch (e) { console.log('  磁盘读盘失败:', e.message) }

  // ─── Step 8: 对比 - 直接调用 FILE_SAVE() ───────────────────
  console.log('\n[Step 8] 对比: 直接调用 FILE_SAVE()...')
  await evaluate(ws, `(() => {
    window.__diag6.ipcSend = []; window.__diag6.askFileSave = 0; window.__diag6.tabSaved = [];
    return 'cleared'
  })()`)
  // 重新设为未保存 + 修改内容
  const markText2 = `DIAGV6_MARK2_${Date.now()}`
  await evaluate(ws, `(() => {
    const app = document.querySelector('#app');
    const pinia = app.__vue_app__.config.globalProperties.$pinia;
    const store = Array.from(pinia._s.values()).find(s => s.$id === 'editor');
    store.currentFile.markdown = ${JSON.stringify('# Diag V6\n\n初始内容\n\n' + markText2 + '\n')};
    store.currentFile.isSaved = false;
    return 'set unsaved'
  })()`)

  const saveRes = await invokeStoreAction(ws, 'editor', 'FILE_SAVE')
  await sleep(1500)

  const probeF = JSON.parse(await evaluate(ws, `JSON.stringify({ ipcSend: window.__diag6.ipcSend, askFileSave: window.__diag6.askFileSave, tabSaved: window.__diag6.tabSaved })`))
  console.log('  FILE_SAVE 后:')
  console.log('  ipcSend channels:', probeF.ipcSend.map(s => s.channel))
  console.log('  tabSaved:', probeF.tabSaved)

  const state3 = await getStore(ws, 'editor')
  console.log('  currentFile.isSaved:', state3.currentFile?.isSaved)
  console.log('  tabs[] isSaved:', state3.tabs?.map(t => ({ id: t.id, isSaved: t.isSaved })))
  try {
    const disk2 = readFileAbs(testFilePath)
    console.log('  磁盘文件长度:', disk2.length, '包含 markText2:', disk2.includes(markText2))
  } catch (e) {}

  // ─── 结论 ──────────────────────────────────────────────────
  console.log('\n═══════════════════════════════════════════')
  console.log('=== 诊断结论 ===')
  console.log('═══════════════════════════════════════════')
  const aKeyWorks = probeA.keydown_any > 0
  const ctrlSKeydownWorks = probeS2.keydown_ctrls > 0
  const ctrlSTriggeredSave = probeS2.ipcSend.some(s => s.channel === 'mt::response-file-save')
  const fileSaveWorked = probeF.ipcSend.some(s => s.channel === 'mt::response-file-save')
  const isSavedAfterCtrlS = state2.currentFile?.isSaved === true
  const isSavedAfterFileSave = state3.currentFile?.isSaved === true
  const tabSavedReceived = probeS2.tabSaved.length > 0
  const tabSavedAfterFileSave = probeF.tabSaved.length > 0

  console.log('Q1. CDP a键 触发 DOM keydown?', aKeyWorks ? '✅ YES' : '❌ NO')
  console.log('Q2a. Ctrl+S keydown 触发?', ctrlSKeydownWorks ? '✅ YES' : '❌ NO')
  console.log('Q2b. Ctrl+S 触发 mt::response-file-save?', ctrlSTriggeredSave ? '✅ YES' : '❌ NO')
  console.log('Q2c. 直接 FILE_SAVE() 触发 mt::response-file-save?', fileSaveWorked ? '✅ YES' : '❌ NO')
  console.log('Q3a. currentFile.id 在 tabs[] 中?', cfInTabs ? '✅ YES' : '❌ NO (根因: tabs.find 失败)')
  console.log('Q3b. Ctrl+S 后 isSaved=true?', isSavedAfterCtrlS ? '✅ YES' : '❌ NO')
  console.log('Q3c. FILE_SAVE() 后 isSaved=true?', isSavedAfterFileSave ? '✅ YES' : '❌ NO')
  console.log('Q4a. Ctrl+S 收到 mt::tab-saved?', tabSavedReceived ? '✅ YES' : '❌ NO')
  console.log('Q4b. FILE_SAVE() 收到 mt::tab-saved?', tabSavedAfterFileSave ? '✅ YES' : '❌ NO')

  console.log('\n--- 根因分析 ---')
  if (!aKeyWorks) {
    console.log('→ CDP Input.dispatchKeyEvent 不触发 DOM keydown 事件（WebView2 限制）')
    console.log('→ T003 需要改用其他方式触发 Ctrl+S（直接 handleMenuClick 或 FILE_SAVE）')
  } else if (aKeyWorks && !ctrlSKeydownWorks) {
    console.log('→ a 键能触发 keydown 但 Ctrl+S 不能')
    console.log('→ 可能 Ctrl+S 被 Tauri 菜单 accelerator 或 WebView2 拦截')
  } else if (ctrlSKeydownWorks && !ctrlSTriggeredSave) {
    console.log('→ Ctrl+S keydown 触发了但没走 keyboardShortcuts→FILE_SAVE 链路')
    console.log('→ 检查 keyboardShortcuts init 时机或 SHORTCUT_MAP 映射')
  } else if (ctrlSTriggeredSave && !cfInTabs) {
    console.log('→ Ctrl+S 触发了保存但 currentFile.id 不在 tabs[] 中')
    console.log('→ mt::tab-saved 监听器 tabs.find(f => f.id === tabId) 失败 → isSaved 不翻转')
    console.log('→ 根因: NEW_UNTITLED_TAB(selected=true) 不 push 到 tabs，或 OPEN_PROJECT 路径 tab 管理 bug')
  } else if (ctrlSTriggeredSave && cfInTabs && !isSavedAfterCtrlS) {
    console.log('→ Ctrl+S 触发保存 + tab 在 tabs[] 中，但 isSaved 仍 false')
    console.log('→ 检查 mt::tab-saved 监听器是否收到事件 + id 是否匹配')
    if (!tabSavedReceived) {
      console.log('→ mt::tab-saved 未收到！检查 localEmit 链路')
    } else {
      console.log('→ mt::tab-saved 收到但 id 不匹配？tabSaved.id=' + probeS2.tabSaved[0]?.id + ' vs cf.id=' + cf?.id)
    }
  } else if (isSavedAfterCtrlS) {
    console.log('→ Ctrl+S 完整链路正常！T003 应该能通过（之前的失败可能是脏状态导致）')
  }

  process.exit(0)
}

main().catch(e => { console.error(e); process.exit(1) })
