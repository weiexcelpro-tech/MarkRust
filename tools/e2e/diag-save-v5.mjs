// 诊断脚本 v5：聚焦 Ctrl+S 键盘事件链路
// 测试矩阵：
//   A. keyboardShortcuts 是否 init 了？（document keydown 监听器数量）
//   B. 派发 Ctrl+S → 是否触发 handleMenuClick('file.save')？
//   C. 是否 emit 'mt::editor-ask-file-save'？bus 和 ipcRenderer 各收到没？
//   D. FILE_SAVE() 有没有被调用？
import { connectCdp, evaluate, cdp, sleep } from './lib/cdp.mjs'
import { getStore, invokeStoreAction, getCurrentFile, createTestFile, readFileAbs } from './setup.mjs'
import { writeFileSync } from 'fs'
import { join } from 'path'

const TEST_DIR = 'C:\\Work\\202607\\MarkText优化\\marktext-tauri\\tools\\e2e\\.test-data'

async function main() {
  const ws = await connectCdp()
  console.log('=== Diag v5: Ctrl+S 键盘事件链路 ===\n')

  // 1. 检查 keydown 监听器数量 + window.__initKeyboardShortcuts 痕迹
  console.log('[Step 1] 检查 keyboardShortcuts init 痕迹...')
  const initCheck = await evaluate(ws, `(() => {
    // 检查 window 上是否有 init 痕迹
    const keys = Object.keys(window).filter(k => k.toLowerCase().includes('shortcut') || k.toLowerCase().includes('keybind'))
    // 检查 document.__keybindings
    const docKeys = Object.keys(document).filter(k => k.toLowerCase().includes('key'))
    return JSON.stringify({
      windowShortcutsKeys: keys,
      docKeyKeys: docKeys,
      // 检查 handleMenuClick 是否存在
      hasHandleMenuClick: typeof window.handleMenuClick !== 'undefined',
      // 检查 menuBridge 是否暴露
      hasMenuBridge: typeof window.menuBridge !== 'undefined'
    })
  })()`)
  console.log('  init 痕迹:', initCheck)

  // 2. 先创建一个有 pathname 的 currentFile（复用诊断 v4 路径）
  console.log('\n[Step 2] 准备 currentFile...')
  // 关闭所有现有 tab
  await evaluate(ws, `(() => {
    const app = document.querySelector('#app');
    const pinia = app.__vue_app__.config.globalProperties.$pinia;
    const store = Array.from(pinia._s.values()).find(s => s.$id === 'editor');
    // 直接清空 tabs，currentFile 置空
    store.tabs = []
    store.currentFile = null
    return JSON.stringify({ tabsLen: store.tabs.length, hasCf: !!store.currentFile })
  })()`)

  // 准备一个带 pathname 的 currentFile（模拟 OPEN_PROJECT 后的状态）
  const testFile = join(TEST_DIR, 'diag-v5-test.md').replace(/\\/g, '\\\\')
  writeFileSync(testFile.replace(/\\\\/g, '\\'), '# Diag V5\n\n初始内容\n', 'utf-8')
  
  const setupResult = await evaluate(ws, `(() => {
    const app = document.querySelector('#app');
    const pinia = app.__vue_app__.config.globalProperties.$pinia;
    const store = Array.from(pinia._s.values()).find(s => s.$id === 'editor');
    // 模拟 OPEN_PROJECT 后的状态：tab 在 tabs[] 数组中 + currentFile 指向它
    const fileState = {
      id: 'mt-diag-v5',
      filename: 'diag-v5-test.md',
      pathname: '${testFile}',
      markdown: '# Diag V5\\n\\nDIAGV5_MARK\\n',
      isSaved: false,
      encoding: { encoding: 'utf-8', isBom: false },
      lineEnding: 'lf',
      history: { stack: [], lastEditIndex: -1 },
      cursor: { start: 0, end: 0 },
      selections: [],
      searchMatches: { index: -1, matches: [], value: '' }
    }
    store.tabs.push(fileState)
    store.UPDATE_CURRENT_FILE(fileState)
    return JSON.stringify({
      ok: true,
      cfId: store.currentFile?.id,
      cfPathname: store.currentFile?.pathname,
      tabsLen: store.tabs.length,
      tabsIds: store.tabs.map(t => t.id)
    })
  })()`)
  console.log('  准备结果:', setupResult)

  // 3. 注入全方位探针：包装 bus.emit, ipcRenderer.send, handleMenuClick (如果能找到)
  console.log('\n[Step 3] 注入探针...')
  const probeSetup = await evaluate(ws, `(() => {
    window.__diag5 = {
      keydown: [],
      busEmit: [],
      ipcSend: [],
      fileSave: 0,
      handleMenuClick: []
    }
    
    // 包装 bus.emit —— 找到 mitt bus 实例
    // bus 是模块私有，但 editor store 用了它，我们通过监听 ipcRenderer 看副作用
    
    // 包装 ipcRenderer.send
    const origSend = window.electron.ipcRenderer.send.bind(window.electron.ipcRenderer)
    window.electron.ipcRenderer.send = function(channel, ...args) {
      window.__diag5.ipcSend.push({ channel, firstArg: args[0], time: Date.now() })
      return origSend(channel, ...args)
    }
    
    // 在 document 上注册一个 capture-phase keydown 监听器看事件是否到达
    document.addEventListener('keydown', (e) => {
      if (e.ctrlKey && (e.key === 's' || e.key === 'S')) {
        window.__diag5.keydown.push({
          key: e.key,
          ctrlKey: e.ctrlKey,
          target: e.target.tagName,
          time: Date.now(),
          defaultPrevented: false
        })
      }
    }, { capture: true })
    
    // 监听 mt::tab-saved / mt::editor-ask-file-save via ipcRenderer.on
    window.electron.ipcRenderer.on('mt::editor-ask-file-save', (e) => {
      window.__diag5.busEmit.push({ channel: 'mt::editor-ask-file-save', time: Date.now() })
    })
    window.electron.ipcRenderer.on('mt::tab-saved', (e, id) => {
      window.__diag5.busEmit.push({ channel: 'mt::tab-saved', id, time: Date.now() })
    })
    
    return JSON.stringify({ ok: true })
  })()`)
  console.log('  探针:', probeSetup)

  // 4. 先用 pressKey 派发 Ctrl+S（模拟 T003 测试）
  console.log('\n[Step 4] 用 CDP Input.dispatchKeyEvent 派发 Ctrl+S...')
  // 先点击 mu-container 聚焦编辑器
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
      console.log('  已点击编辑器聚焦')
    }
  } catch (e) { console.log('  聚焦失败:', e.message) }

  // Ctrl+S
  await cdp(ws, 'Input.dispatchKeyEvent', { type: 'rawKeyDown', key: 's', code: 'KeyS', windowsVirtualKeyCode: 83, modifiers: 2 })
  await cdp(ws, 'Input.dispatchKeyEvent', { type: 'keyUp', key: 's', code: 'KeyS', windowsVirtualKeyCode: 83, modifiers: 2 })
  await sleep(500)
  console.log('  Ctrl+S 已派发')

  // 5. 检查探针触发情况
  const probe1 = await evaluate(ws, `JSON.stringify(window.__diag5)`)
  console.log('\n[Step 5] 探针触发情况:')
  console.log(' ', probe1)

  // 6. 等待异步链路
  await sleep(1500)
  const probe2 = await evaluate(ws, `JSON.stringify(window.__diag5)`)
  console.log('\n[Step 6] 等待 1500ms 后:')
  console.log(' ', probe2)

  // 7. 最终状态
  const state = await getStore(ws, 'editor')
  console.log('\n[Step 7] 最终状态:')
  console.log('  currentFile.id:', state.currentFile?.id)
  console.log('  isSaved:', state.currentFile?.isSaved)
  console.log('  tabs:', state.tabs?.map(t => ({ id: t.id, isSaved: t.isSaved })))

  // 8. 磁盘文件
  try {
    const disk = readFileAbs(testFile.replace(/\\\\/g, '\\'))
    console.log('\n[Step 8] 磁盘文件:')
    console.log('  长度:', disk.length)
    console.log('  包含 DIAGV5_MARK:', disk.includes('DIAGV5_MARK'))
  } catch (e) {
    console.log('\n[Step 8] 读盘失败:', e.message)
  }

  // 9. 终极测试：直接调用 FILE_SAVE 看链路是否正常（vs Ctrl+S）
  console.log('\n[Step 9] 终极对比：直接调用 FILE_SAVE()...')
  await evaluate(ws, `(() => { window.__diag5.ipcSend = []; window.__diag5.busEmit = []; return 'cleared' })()`)
  const saveRes = await invokeStoreAction(ws, 'editor', 'FILE_SAVE')
  console.log('  FILE_SAVE 返回:', JSON.stringify(saveRes))
  await sleep(1500)
  const probe3 = await evaluate(ws, `JSON.stringify(window.__diag5)`)
  console.log('  探针:', probe3)

  const state2 = await getStore(ws, 'editor')
  console.log('  isSaved after FILE_SAVE:', state2.currentFile?.isSaved)

  try {
    const disk = readFileAbs(testFile.replace(/\\\\/g, '\\'))
    console.log('  磁盘文件长度:', disk.length, '包含 DIAGV5_MARK:', disk.includes('DIAGV5_MARK'))
  } catch (e) {}

  console.log('\n=== 诊断完成 ===')
  process.exit(0)
}

main().catch(e => { console.error(e); process.exit(1) })
