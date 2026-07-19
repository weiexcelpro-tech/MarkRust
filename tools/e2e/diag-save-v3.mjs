// 诊断脚本 v3：通过探针 listener 验证 localEmit → ipcRenderer.on 链路
// 测试矩阵：
//   A. 注册探针 listener → 调用 FILE_SAVE → 检查探针是否被触发
//   B. 读取 currentFile.id 和 tabs[*].id 的值+类型，验证 tabId 匹配
//   C. 检查 tauri-bridge 桥接状态

import { connectCdp, evaluate, sleep } from './lib/cdp.mjs'

async function main() {
  const ws = await connectCdp()
  console.log('=== Diag v3: localEmit 链路探针 ===\n')

  // 1. 应用状态检查
  const pingResult = await evaluate(ws, `JSON.stringify({
    hasElectron: !!window.electron,
    hasIpcRenderer: !!(window.electron && window.electron.ipcRenderer),
    hasPinia: !!window.__PINIA_STORES__,
    editorStore: !!(window.__PINIA_STORES__ && window.__PINIA_STORES__.editor)
  })`)
  console.log('[Step 1] 应用状态:', pingResult)

  // 2. 注入探针 listener —— 通过 ipcRenderer.on 注册，会同时进入 localListeners
  const probeCode = `(() => {
    window.__diagProbe = window.__diagProbe || { tabSaved: null, setPathname: null, tabSaveFailure: null }
    window.electron.ipcRenderer.on('mt::tab-saved', (e, tabId) => {
      window.__diagProbe.tabSaved = { eType: typeof e, eLocal: e && e.__local, tabId, tabIdType: typeof tabId, time: Date.now() }
    })
    window.electron.ipcRenderer.on('mt::set-pathname', (e, info) => {
      window.__diagProbe.setPathname = { eType: typeof e, eLocal: e && e.__local, info, time: Date.now() }
    })
    window.electron.ipcRenderer.on('mt::tab-save-failure', (e, id, msg) => {
      window.__diagProbe.tabSaveFailure = { eType: typeof e, id, msg, time: Date.now() }
    })
    return JSON.stringify({ registered: true })
  })()`
  const probeResult = await evaluate(ws, probeCode)
  console.log('[Step 2] 探针注册:', probeResult)

  // 3. 读取 currentFile 和 tabs 的 id 信息，验证类型匹配
  const stateCode = `(() => {
    const store = window.__PINIA_STORES__ && window.__PINIA_STORES__.editor
    if (!store) return JSON.stringify({ error: 'no editor store' })
    const cf = store.currentFile
    const tabs = store.tabs
    return JSON.stringify({
      currentFile: cf ? {
        id: cf.id,
        idType: typeof cf.id,
        filename: cf.filename,
        pathname: cf.pathname,
        isSaved: cf.isSaved,
        markdownLen: cf.markdown ? cf.markdown.length : 0
      } : null,
      tabsCount: tabs.length,
      tabs: tabs.map(t => ({
        id: t.id,
        idType: typeof t.id,
        filename: t.filename,
        pathname: t.pathname,
        isSaved: t.isSaved
      }))
    })
  })()`
  const stateBefore = await evaluate(ws, stateCode)
  console.log('\n[Step 3] 调用前状态:', stateBefore)

  // 4. 调用 FILE_SAVE action
  console.log('\n[Step 4] 调用 editor.FILE_SAVE()...')
  const saveResult = await evaluate(ws, `(() => {
    try {
      const store = window.__PINIA_STORES__ && window.__PINIA_STORES__.editor
      if (!store) return JSON.stringify({ error: 'no store' })
      store.FILE_SAVE()
      return JSON.stringify({ ok: true, currentFileId: store.currentFile ? store.currentFile.id : null })
    } catch (e) {
      return JSON.stringify({ error: String(e), stack: e.stack })
    }
  })()`)
  console.log('  FILE_SAVE 返回:', saveResult)

  // 5. 等待异步链路完成
  console.log('\n[Step 5] 等待 1500ms 让异步链路完成...')
  await sleep(1500)

  // 6. 检查探针是否被触发
  const probeCheck = await evaluate(ws, `JSON.stringify(window.__diagProbe)`)
  console.log('\n[Step 6] 探针触发情况:', probeCheck)

  // 7. 调用后状态对比
  const stateAfter = await evaluate(ws, stateCode)
  console.log('\n[Step 7] 调用后状态:', stateAfter)

  // 8. 检查 tauri-bridge 桥接状态
  const bridgeCheck = `JSON.stringify({
    hasElectron: !!window.electron,
    hasInvoke: !!(window.electron && window.electron.ipcRenderer && window.electron.ipcRenderer.invoke),
    hasSend: !!(window.electron && window.electron.ipcRenderer && window.electron.ipcRenderer.send),
    hasOn: !!(window.electron && window.electron.ipcRenderer && window.electron.ipcRenderer.on),
    hasLocalEmit: typeof window.localEmit !== 'undefined',
    hasMittBus: typeof window.__MITT_BUS__ !== 'undefined'
  })`
  const bridgeResult = await evaluate(ws, bridgeCheck)
  console.log('\n[Step 8] tauri-bridge 状态:', bridgeResult)

  // 9. 额外：检查 window.electron.ipcRenderer._events 或类似内部状态（看 listener 注册数）
  // 直接统计 localListeners 大小做不到（模块私有），但可以通过包装 ipcRenderer.on 统计调用次数
  // 这步先省略，看前面结果决定

  console.log('\n=== 诊断完成 ===')
  process.exit(0)
}

main().catch(e => {
  console.error('诊断失败:', e)
  process.exit(1)
})
