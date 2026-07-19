// 通过 CDP DOMDebugger.getEventListeners API 直接查询元素事件监听器
// 这个 API 不依赖 Vue 内部属性，能直接读出浏览器内核注册的事件
import { connectCdp, cdp, evaluate, sleep } from './lib/cdp.mjs'
import { rightClickAt } from './setup.mjs'

async function main() {
  const ws = await connectCdp()
  console.log('=== CDP DOMDebugger.getEventListeners 直接查询 ===\n')

  // 1) 用 DOM.querySelector 找到 .editor-wrapper
  const doc = await cdp(ws, 'DOM.getDocument', { depth: 0 })
  const root = doc.root
  console.log('1. 根节点:', root.nodeName, 'nodeId:', root.nodeId)

  const wrapper = await cdp(ws, 'DOM.querySelector', {
    nodeId: root.nodeId,
    selector: '.editor-wrapper'
  })
  console.log('2. .editor-wrapper nodeId:', wrapper.nodeId)
  if (!wrapper.nodeId) {
    console.log('❌ 未找到 .editor-wrapper')
    process.exit(1)
  }

  // 2) 用 DOM.resolveNode 转 objectId
  const remoteObj = await cdp(ws, 'DOM.resolveNode', { nodeId: wrapper.nodeId })
  const objectId = remoteObj.object.objectId
  console.log('3. objectId:', objectId.slice(0, 50) + '...')

  // 3) 用 DOMDebugger.getEventListeners 获取事件监听器
  const listeners = await cdp(ws, 'DOMDebugger.getEventListeners', {
    objectId,
    depth: 2
  })
  console.log('\n4. .editor-wrapper 所有事件监听器:')
  console.log(`   总数: ${listeners.listeners.length}`)
  for (const l of listeners.listeners) {
    console.log(`   - type: ${l.type}`)
    console.log(`     useCapture: ${l.useCapture}, passive: ${l.passive}, once: ${l.once}`)
    if (l.scriptId) {
      console.log(`     scriptId: ${l.scriptId}:${l.lineNumber}:${l.columnNumber}`)
    }
    if (l.originalHandler && l.originalHandler.description) {
      console.log(`     originalHandler: ${l.originalHandler.description.slice(0, 150)}`)
    }
  }

  // 4) 也查 .editor-component (内部 contenteditable)
  const ec = await cdp(ws, 'DOM.querySelector', {
    nodeId: root.nodeId,
    selector: '.editor-component'
  })
  if (ec.nodeId) {
    const ecRemote = await cdp(ws, 'DOM.resolveNode', { nodeId: ec.nodeId })
    const ecListeners = await cdp(ws, 'DOMDebugger.getEventListeners', {
      objectId: ecRemote.object.objectId,
      depth: 2
    })
    console.log(`\n5. .editor-component 所有事件监听器:`)
    console.log(`   总数: ${ecListeners.listeners.length}`)
    for (const l of ecListeners.listeners) {
      console.log(`   - type: ${l.type}`)
      if (l.originalHandler && l.originalHandler.description) {
        console.log(`     originalHandler: ${l.originalHandler.description.slice(0, 150)}`)
      }
    }
  }

  // 5) 查 #app (Vue 挂载点)
  const app = await cdp(ws, 'DOM.querySelector', {
    nodeId: root.nodeId,
    selector: '#app'
  })
  if (app.nodeId) {
    const appRemote = await cdp(ws, 'DOM.resolveNode', { nodeId: app.nodeId })
    const appListeners = await cdp(ws, 'DOMDebugger.getEventListeners', {
      objectId: appRemote.object.objectId,
      depth: 2
    })
    console.log(`\n6. #app 所有事件监听器:`)
    console.log(`   总数: ${appListeners.listeners.length}`)
    for (const l of appListeners.listeners) {
      console.log(`   - type: ${l.type}`)
      if (l.originalHandler && l.originalHandler.description) {
        console.log(`     originalHandler: ${l.originalHandler.description.slice(0, 150)}`)
      }
    }
  }

  // 6) 查 document.body 上是否有 contextmenu 监听器
  const body = await cdp(ws, 'DOM.querySelector', {
    nodeId: root.nodeId,
    selector: 'body'
  })
  if (body.nodeId) {
    const bodyRemote = await cdp(ws, 'DOM.resolveNode', { nodeId: body.nodeId })
    const bodyListeners = await cdp(ws, 'DOMDebugger.getEventListeners', {
      objectId: bodyRemote.object.objectId,
      depth: 2
    })
    console.log(`\n7. body 所有事件监听器:`)
    console.log(`   总数: ${bodyListeners.listeners.length}`)
    for (const l of bodyListeners.listeners) {
      console.log(`   - type: ${l.type}`)
      if (l.originalHandler && l.originalHandler.description) {
        console.log(`     originalHandler: ${l.originalHandler.description.slice(0, 150)}`)
      }
    }
  }

  process.exit(0)
}
main().catch(e => { console.error(e); process.exit(1) })
