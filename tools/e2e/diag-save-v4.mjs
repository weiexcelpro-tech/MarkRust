// 诊断脚本 v4：复用 setup.mjs 的 getStore / invokeStoreAction
// 流程：NEW_UNTITLED_TAB → 注入 pathname → 注入探针 → FILE_SAVE → 检查探针
import { connectCdp, evaluate, sleep } from './lib/cdp.mjs'
import { getStore, invokeStoreAction, createTestFile, readFileAbs } from './setup.mjs'
import { writeFileSync } from 'fs'
import { join } from 'path'

const TEST_DIR = 'C:\\Work\\202607\\MarkText优化\\marktext-tauri\\tools\\e2e\\.test-data'
const TEST_FILE = 'diag-v4-test.md'
const TEST_PATH = join(TEST_DIR, TEST_FILE).replace(/\\/g, '\\\\')

async function main() {
  const ws = await connectCdp()
  console.log('=== Diag v4: localEmit 链路探针（复用 setup.mjs）===\n')

  // 1. 应用状态
  const pingResult = await evaluate(ws, `JSON.stringify({
    hasElectron: !!window.electron,
    hasIpcRenderer: !!(window.electron && window.electron.ipcRenderer),
    hasApp: !!(document.querySelector('#app') && document.querySelector('#app').__vue_app__)
  })`)
  console.log('[Step 1] 应用状态:', pingResult)

  // 2. 列出所有 store
  const storesList = await evaluate(ws, `(() => {
    const app = document.querySelector('#app');
    if (!app || !app.__vue_app__) return '[]';
    const pinia = app.__vue_app__.config.globalProperties.$pinia;
    if (!pinia || !pinia._s) return '[]';
    return JSON.stringify(Array.from(pinia._s.keys()));
  })()`)
  console.log('[Step 2] 已注册 Pinia stores:', storesList)

  // 3. 创建一个测试文件到磁盘（覆盖式）
  const initialContent = '# Diag V4 Test\n\n初始内容\n'
  writeFileSync(TEST_PATH.replace(/\\\\/g, '\\'), initialContent, 'utf-8')
  console.log(`\n[Step 3] 已创建测试文件: ${TEST_PATH.replace(/\\\\/g, '\\')}`)

  // 4. 创建一个 untitled tab 并选为 currentFile
  console.log('\n[Step 4] 调用 NEW_UNTITLED_TAB 创建新 tab...')
  const newTabResult = await invokeStoreAction(ws, 'editor', 'NEW_UNTITLED_TAB', { selected: true })
  console.log('  返回:', JSON.stringify(newTabResult))
  await sleep(300)

  // 5. 读取当前 currentFile
  const state1 = await getStore(ws, 'editor')
  if (!state1?.currentFile) {
    console.log('\n[Step 5] ❌ NEW_UNTITLED_TAB 后仍无 currentFile，终止')
    process.exit(1)
  }
  const cf1 = state1.currentFile
  console.log('\n[Step 5] 新 tab 状态:')
  console.log('  id:', cf1.id, '(', typeof cf1.id, ')')
  console.log('  filename:', cf1.filename)
  console.log('  pathname:', cf1.pathname)
  console.log('  isSaved:', cf1.isSaved)

  // 6. 修改 currentFile 的 pathname 指向测试文件 + 修改 markdown
  //    这样 FILE_SAVE 会走 "pathname 非空 → 直接 invoke('markdown_save')" 分支
  console.log('\n[Step 6] 设置 pathname 和 markdown...')
  const setPathResult = await evaluate(ws, `(() => {
    const app = document.querySelector('#app');
    const pinia = app.__vue_app__.config.globalProperties.$pinia;
    const store = Array.from(pinia._s.values()).find(s => s.$id === 'editor');
    if (!store || !store.currentFile) return JSON.stringify({ error: 'no currentFile' });
    store.currentFile.pathname = '${TEST_PATH}';
    store.currentFile.filename = '${TEST_FILE}';
    store.currentFile.markdown = '# Modified\\n\\nDIAGV4_MARK_${Date.now()}\\n';
    store.currentFile.isSaved = false;
    return JSON.stringify({
      ok: true,
      id: store.currentFile.id,
      pathname: store.currentFile.pathname,
      markdownLen: store.currentFile.markdown.length
    })
  })()`)
  console.log('  设置结果:', setPathResult)

  // 7. 注入探针 listener
  console.log('\n[Step 7] 注入探针 listener...')
  const probeResult = await evaluate(ws, `(() => {
    window.__diagProbe = { tabSaved: null, setPathname: null, tabSaveFailure: null, sendCalls: [] }
    // 包装 ipcRenderer.send 拦截所有调用
    const origSend = window.electron.ipcRenderer.send.bind(window.electron.ipcRenderer)
    window.electron.ipcRenderer.send = function(channel, ...args) {
      try {
        window.__diagProbe.sendCalls.push({
          channel,
          argsLen: args.length,
          firstArg: args[0],
          secondArg: args[1],
          time: Date.now()
        })
      } catch(e) {}
      return origSend(channel, ...args)
    }
    // 注册探针 listener（同时进入 Tauri 原生 listen 和 localListeners）
    window.electron.ipcRenderer.on('mt::tab-saved', (e, tabId) => {
      window.__diagProbe.tabSaved = {
        eType: typeof e,
        eLocal: e && e.__local,
        tabId,
        tabIdType: typeof tabId,
        time: Date.now()
      }
    })
    window.electron.ipcRenderer.on('mt::set-pathname', (e, info) => {
      window.__diagProbe.setPathname = {
        eType: typeof e,
        eLocal: e && e.__local,
        info,
        time: Date.now()
      }
    })
    window.electron.ipcRenderer.on('mt::tab-save-failure', (e, id, msg) => {
      window.__diagProbe.tabSaveFailure = { id, msg, time: Date.now() }
    })
    return JSON.stringify({ registered: true })
  })()`)
  console.log('  探针注册:', probeResult)

  // 8. 调用 FILE_SAVE
  console.log('\n[Step 8] 调用 editor.FILE_SAVE()...')
  const saveResult = await invokeStoreAction(ws, 'editor', 'FILE_SAVE')
  console.log('  FILE_SAVE 返回:', JSON.stringify(saveResult))

  // 9. 等待异步链路完成
  console.log('\n[Step 9] 等待 2000ms...')
  await sleep(2000)

  // 10. 检查探针触发情况
  const probeCheck = await evaluate(ws, `JSON.stringify(window.__diagProbe)`)
  console.log('\n[Step 10] 探针触发情况:')
  console.log(' ', probeCheck)

  // 11. 检查 sendCalls — 看 FILE_SAVE 有没有发出 mt::response-file-save
  console.log('\n[Step 11] ipcRenderer.send 调用记录（看是否发出 mt::response-file-save）:')
  const sendCalls = await evaluate(ws, `JSON.stringify(window.__diagProbe.sendCalls)`)
  console.log(' ', sendCalls)

  // 12. 最终状态
  const stateAfter = await getStore(ws, 'editor')
  console.log('\n[Step 12] 调用后状态:')
  console.log('  currentFile.id:', stateAfter.currentFile?.id)
  console.log('  isSaved:', stateAfter.currentFile?.isSaved)
  console.log('  pathname:', stateAfter.currentFile?.pathname)
  console.log('  tabs[]:', stateAfter.tabs?.map(t => ({ id: t.id, isSaved: t.isSaved, pathname: t.pathname })))

  // 13. 磁盘文件验证
  console.log('\n[Step 13] 磁盘文件验证:')
  try {
    const diskContent = readFileAbs(TEST_PATH.replace(/\\\\/g, '\\'))
    console.log('  文件内容长度:', diskContent.length)
    console.log('  包含 DIAGV4_MARK:', diskContent.includes('DIAGV4_MARK'))
    console.log('  文件前 200 字符:', JSON.stringify(diskContent.slice(0, 200)))
  } catch (e) {
    console.log('  读取失败:', e.message)
  }

  console.log('\n=== 诊断完成 ===')
  process.exit(0)
}

main().catch(e => {
  console.error('诊断失败:', e)
  process.exit(1)
})
