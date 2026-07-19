// 捕获 handleEditorContextMenu 内部可能抛出的异常
// 通过 window.onerror + console.error 劫持 + 全局 try/catch
import { connectCdp, evaluate, sleep } from './lib/cdp.mjs'
import { rightClickAt } from './setup.mjs'

async function main() {
  const ws = await connectCdp()
  console.log('=== 异常捕获诊断 ===\n')

  // 安装多层异常捕获
  await evaluate(ws, `
    window._diagErrors = [];
    window._diagConsoleErrors = [];
    
    // 1) window.onerror - 捕获同步异常
    window.addEventListener('error', (e) => {
      window._diagErrors.push({
        type: 'error',
        message: e.message,
        filename: e.filename,
        lineno: e.lineno,
        colno: e.colno,
        stack: e.error ? e.error.stack : null
      });
    });
    
    // 2) unhandledrejection - Promise 异常
    window.addEventListener('unhandledrejection', (e) => {
      window._diagErrors.push({
        type: 'unhandledrejection',
        reason: String(e.reason),
        stack: e.reason && e.reason.stack ? e.reason.stack : null
      });
    });
    
    // 3) 劫持 console.error
    const origConsoleError = console.error;
    console.error = function(...args) {
      window._diagConsoleErrors.push(args.map(a => {
        try { return typeof a === 'object' ? JSON.stringify(a, Object.getOwnPropertyNames(a || {})).slice(0, 500) : String(a) } catch(e) { return String(a) }
      }));
      origConsoleError.apply(console, args);
    };
    
    // 4) 劫持 window.electron.windowControl.popupMenu（看是否被调用）
    if (window.electron && window.electron.windowControl && !window.electron.windowControl._hijacked) {
      const orig = window.electron.windowControl.popupMenu;
      window.electron.windowControl._hijacked = true;
      window.electron.windowControl._callCount = 0;
      window.electron.windowControl.popupMenu = function(...args) {
        window.electron.windowControl._callCount++;
        try {
          return orig.apply(this, args);
        } catch (e) {
          window._diagErrors.push({
            type: 'popupMenu-error',
            message: e.message,
            stack: e.stack,
            argsPreview: JSON.stringify(args).slice(0, 200)
          });
          throw e;
        }
      };
    }
    
    // 5) 劫持 window.electron.ipcRenderer.on - 看是否被调用
    if (window.electron && window.electron.ipcRenderer && !window.electron.ipcRenderer._onHijacked) {
      window.electron.ipcRenderer._onHijacked = true;
      window.electron.ipcRenderer._onCalls = [];
      const origOn = window.electron.ipcRenderer.on;
      window.electron.ipcRenderer.on = function(channel, listener) {
        window.electron.ipcRenderer._onCalls.push({
          channel: channel,
          listenerType: typeof listener
        });
        try {
          return origOn.apply(this, arguments);
        } catch (e) {
          window._diagErrors.push({
            type: 'ipcRenderer.on-error',
            message: e.message,
            stack: e.stack,
            channel: channel
          });
          throw e;
        }
      };
    }
    
    'exception catchers installed'
  `)

  // 取右键位置
  const rect = JSON.parse(await evaluate(ws, `JSON.stringify((() => {
    const el = document.querySelector('[contenteditable=true]');
    if (!el) return null;
    const r = el.getBoundingClientRect();
    return { x: r.x + r.width/2, y: r.y + r.height/2 };
  })())`))
  if (!rect) { console.log('❌ 无 contenteditable'); process.exit(1) }
  console.log('右键位置:', rect)

  // 触发右键
  console.log('\n>>> 触发右键...')
  await rightClickAt(ws, rect.x, rect.y)
  await sleep(600)

  // 读取诊断结果
  const result = JSON.parse(await evaluate(ws, `JSON.stringify({
    errors: window._diagErrors,
    consoleErrors: window._diagConsoleErrors,
    popupMenuCallCount: window.electron.windowControl._callCount,
    ipcOnCalls: window.electron.ipcRenderer._onCalls
  })`))
  
  console.log('\n=== 结果 ===')
  console.log('popupMenu 被调用次数:', result.popupMenuCallCount)
  console.log('ipcRenderer.on 被调用次数:', result.ipcOnCalls?.length || 0)
  if (result.ipcOnCalls?.length) {
    console.log('ipcRenderer.on 调用详情:')
    result.ipcOnCalls.forEach((c, i) => console.log(`  [${i}] channel=${c.channel} listener=${c.listenerType}`))
  }
  
  console.log('\n=== 全局错误 (window.onerror / unhandledrejection) ===')
  if (result.errors.length === 0) {
    console.log('  (无)')
  } else {
    result.errors.forEach((e, i) => {
      console.log(`\n  [${i}] ${e.type}: ${e.message}`)
      if (e.filename) console.log(`      at ${e.filename}:${e.lineno}:${e.colno}`)
      if (e.stack) console.log(`      stack: ${e.stack.slice(0, 500)}`)
      if (e.channel) console.log(`      channel: ${e.channel}`)
      if (e.argsPreview) console.log(`      args: ${e.argsPreview}`)
    })
  }
  
  console.log('\n=== console.error 调用 ===')
  if (result.consoleErrors.length === 0) {
    console.log('  (无)')
  } else {
    result.consoleErrors.forEach((args, i) => {
      console.log(`  [${i}] ${args.join(' | ')}`)
    })
  }

  // 检查菜单 DOM
  const menuCount = await evaluate(ws, `document.querySelectorAll('div[style*="z-index:99999"]').length`)
  console.log('\n菜单 DOM 数:', menuCount)

  process.exit(0)
}
main().catch(e => { console.error(e); process.exit(1) })
