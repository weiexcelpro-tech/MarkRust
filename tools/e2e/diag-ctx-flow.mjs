// 正确追踪 contextmenu 事件流 - capture + bubble + final 状态
// 同时劫持 popupMenu 调用看是否触发
import { connectCdp, evaluate, sleep } from './lib/cdp.mjs'
import { rightClickAt } from './setup.mjs'

async function main() {
  const ws = await connectCdp()
  console.log('=== contextmenu 事件流追踪（capture + bubble + final）===\n')

  // 安装三阶段监听器
  await evaluate(ws, `
    window._ctxTrace = {
      capture: null,
      bubble: null,
      final: null,
      popupMenuCalled: false,
      popupMenuArgs: null
    };

    // 1) Capture 阶段：在 document 上的 capture
    document.addEventListener('contextmenu', (e) => {
      window._ctxTrace.capture = {
        targetTag: e.target.tagName,
        targetClass: e.target.className,
        defaultPrevented: e.defaultPrevented,
        eventPhase: e.eventPhase
      };
    }, true);

    // 2) Bubble 阶段：在 .editor-wrapper 上的 bubble (useCapture:false)
    const wrapper = document.querySelector('.editor-wrapper');
    if (wrapper) {
      wrapper.addEventListener('contextmenu', (e) => {
        window._ctxTrace.bubble = {
          targetTag: e.target.tagName,
          targetClass: e.target.className,
          defaultPrevented: e.defaultPrevented,  // 此时 Vue 监听器可能还没执行（按注册顺序）
          eventPhase: e.eventPhase
        };
      }, false);
    }

    // 3) Final 阶段：setTimeout 0 检查最终状态
    // 这个会被在所有同步监听器之后触发

    // 4) 劫持 window.electron.windowControl.popupMenu 看是否被调用
    if (window.electron && window.electron.windowControl) {
      const orig = window.electron.windowControl.popupMenu;
      window.electron.windowControl.popupMenu = function(...args) {
        window._ctxTrace.popupMenuCalled = true;
        window._ctxTrace.popupMenuArgs = JSON.stringify(args).slice(0, 200);
        return orig.apply(this, args);
      };
    }

    'installed'
  `)

  // 触发右键
  const rect = JSON.parse(await evaluate(ws, `JSON.stringify((() => {
    const el = document.querySelector('[contenteditable=true]');
    if (!el) return null;
    const r = el.getBoundingClientRect();
    return { x: r.x + r.width/2, y: r.y + r.height/2 };
  })())`))
  if (!rect) { console.log('❌ 无 contenteditable'); process.exit(1) }
  console.log('contenteditable 中心:', rect)

  await rightClickAt(ws, rect.x, rect.y)
  await sleep(400)

  // 读 final 状态 — 注意 setTimeout 是另一轮事件循环
  const trace = JSON.parse(await evaluate(ws, `JSON.stringify(window._ctxTrace)`))
  console.log('\nCapture 阶段:', JSON.stringify(trace.capture, null, 2))
  console.log('\nBubble 阶段 (.editor-wrapper):', JSON.stringify(trace.bubble, null, 2))
  console.log('\npopupMenu 是否被调用:', trace.popupMenuCalled ? 'YES ✅' : 'NO ❌')
  if (trace.popupMenuArgs) {
    console.log('popupMenu 参数:', trace.popupMenuArgs)
  }

  // 检查最终 defaultPrevented — 通过 setTimeout 异步读
  await evaluate(ws, `
    document.addEventListener('contextmenu', (e) => {
      setTimeout(() => {
        window._ctxTrace.final = {
          defaultPrevented: e.defaultPrevented,
          clientX: e.clientX,
          clientY: e.clientY
        };
      }, 0);
    }, { capture: false, once: true });
    'final checker installed'
  `)

  // 再次触发
  await rightClickAt(ws, rect.x, rect.y)
  await sleep(500)

  const trace2 = JSON.parse(await evaluate(ws, `JSON.stringify(window._ctxTrace)`))
  console.log('\nFinal (setTimeout 0):', JSON.stringify(trace2.final, null, 2))

  // 检查菜单 DOM 是否出现
  const menuDom = await evaluate(ws, `(() => {
    const menus = document.querySelectorAll('div[style*="z-index:99999"]');
    return menus.length;
  })()`)
  console.log(`\nz-index:99999 菜单 DOM 数: ${menuDom}`)

  // 检查 window.electron.windowControl 是否存在
  const electronCheck = JSON.parse(await evaluate(ws, `JSON.stringify({
    hasElectron: typeof window.electron,
    hasWindowControl: window.electron ? typeof window.electron.windowControl : 'n/a',
    hasPopupMenu: window.electron && window.electron.windowControl ? typeof window.electron.windowControl.popupMenu : 'n/a'
  })`))
  console.log('\nwindow.electron.windowControl.popupMenu 探测:', JSON.stringify(electronCheck, null, 2))

  process.exit(0)
}
main().catch(e => { console.error(e); process.exit(1) })
