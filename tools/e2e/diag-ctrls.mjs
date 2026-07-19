// 诊断 Ctrl+S 路径：是否触发 mt::response-file-save？是否写盘？
import { connectCdp, evaluate, sleep } from './lib/cdp.mjs'
import {
  invokeStoreAction, getCurrentFile, createTestFile, readFileAbs,
  clickAt, clickElement, waitForElement, waitForCurrentFile, pressKey
} from './setup.mjs'

const TEST_DIR = 'C:\\Work\\202607\\MarkText优化\\marktext-tauri\\tools\\e2e\\.test-data'

async function main() {
  const ws = await connectCdp()
  console.log('=== Diag Ctrl+S Path ===\n')

  // 清空 tabs
  await evaluate(ws, `(() => {
    const app = document.querySelector('#app');
    const pinia = app.__vue_app__.config.globalProperties.$pinia;
    const store = Array.from(pinia._s.values()).find(s => s.$id === 'editor');
    store.tabs = []; store.currentFile = null
    return 'cleared'
  })()`)
  await sleep(500)

  const markText = `CTRLS_MARK_${Date.now()}`
  const testFileName = 'diag-ctrls-test.md'
  const originalContent = '# CtrlS Test\n\n初始\n'
  const modifiedContent = originalContent + '\n' + markText + '\n'
  const testFilePath = createTestFile(testFileName, originalContent)

  await invokeStoreAction(ws, 'project', 'OPEN_PROJECT', TEST_DIR.replace(/\\/g, '/'))
  await waitForElement(ws, '.side-bar-file', 8000)

  const found = await evaluate(ws, `(() => {
    const files = Array.from(document.querySelectorAll('.side-bar-file'));
    const target = files.find(f => (f.getAttribute('title')||'').includes('diag-ctrls-test'));
    if (!target) return JSON.stringify({ found: false });
    const r = target.getBoundingClientRect();
    return JSON.stringify({ found: true, x: r.x + r.width/2, y: r.y + r.height/2 });
  })()`)
  const f = JSON.parse(found)
  if (!f.found) { console.log('未找到文件!'); process.exit(1) }
  await clickAt(ws, f.x, f.y)
  await waitForCurrentFile(ws, 8000)

  // 注入探针：监听 mt::response-file-save 和 mt::tab-saved
  await evaluate(ws, `(() => {
    window.__ctrls_diag = { responseSave: [], tabSaved: [], keydown: [] }
    window.electron.ipcRenderer.on('mt::response-file-save', (e, ...args) => {
      window.__ctrls_diag.responseSave.push({ time: Date.now(), id: args[0], mdLen: typeof args[3] === 'string' ? args[3].length : null })
    })
    window.electron.ipcRenderer.on('mt::tab-saved', (e, id) => {
      window.__ctrls_diag.tabSaved.push({ time: Date.now(), id })
    })
    // 监听 document keydown
    document.addEventListener('keydown', (e) => {
      if (e.key === 's' || e.key === 'S') {
        window.__ctrls_diag.keydown.push({ time: Date.now(), key: e.key, ctrl: e.ctrlKey, meta: e.metaKey })
      }
    }, true)
    return 'probes installed'
  })()`)

  // 修改 markdown
  await evaluate(ws, `(() => {
    const app = document.querySelector('#app');
    const pinia = app.__vue_app__.config.globalProperties.$pinia;
    const store = Array.from(pinia._s.values()).find(s => s.$id === 'editor');
    store.currentFile.markdown = ${JSON.stringify(modifiedContent)};
    store.currentFile.isSaved = false;
    return JSON.stringify({ mdLen: store.currentFile.markdown.length })
  })()`)

  // 聚焦编辑器
  try { await clickElement(ws, '.mu-container') } catch {}
  await sleep(300)

  console.log('[1] 按 Ctrl+S (CDP Input.dispatchKeyEvent)')
  await pressKey(ws, 'S', ['ctrl'])
  await sleep(2000)

  // 收集结果
  const diag = JSON.parse(await evaluate(ws, `JSON.stringify(window.__ctrls_diag)`))
  console.log('\n[2] 事件探针:')
  console.log('  mt::response-file-save 次数:', diag.responseSave.length)
  diag.responseSave.forEach(r => console.log('   ', JSON.stringify(r)))
  console.log('  mt::tab-saved 次数:', diag.tabSaved.length)
  diag.tabSaved.forEach(r => console.log('   ', JSON.stringify(r)))
  console.log('  document keydown(S) 次数:', diag.keydown.length)
  diag.keydown.forEach(r => console.log('   ', JSON.stringify(r)))

  // 最终状态
  const cf = await getCurrentFile(ws)
  console.log('\n[3] 最终状态:')
  console.log('  isSaved:', cf?.isSaved)
  console.log('  markdown len:', cf?.markdown?.length, '(修改后应为', modifiedContent.length, ')')

  // 磁盘
  try {
    const disk = readFileAbs(testFilePath)
    console.log('\n[4] 磁盘文件:')
    console.log('  长度:', disk.length, '(原始=' + originalContent.length + ', 修改=' + modifiedContent.length + ')')
    console.log('  包含 markText:', disk.includes(markText))
  } catch (e) { console.log('  读盘失败:', e.message) }

  // 结论
  console.log('\n=== 结论 ===')
  if (diag.responseSave.length === 0 && diag.keydown.length === 0) {
    console.log('★ CDP Ctrl+S 完全无效：既没触发 DOM keydown，也没触发保存链路')
    console.log('  → 需要用 JS dispatchEvent 或直接调 FILE_SAVE()')
  } else if (diag.responseSave.length === 0 && diag.keydown.length > 0) {
    console.log('★ DOM keydown 收到但未触发保存：keyboardShortcuts.ts 未处理 Ctrl+S')
  } else if (diag.responseSave.length > 0 && diag.tabSaved.length === 0) {
    console.log('★ 保存链路启动但 tab-saved 未到达：invoke markdown_save 可能失败')
  } else if (diag.tabSaved.length > 0) {
    console.log('★ Ctrl+S 保存链路完整，检查磁盘是否更新')
  }

  process.exit(0)
}

main().catch(e => { console.error(e); process.exit(1) })
