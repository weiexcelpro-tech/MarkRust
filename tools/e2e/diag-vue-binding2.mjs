// 终极诊断：通过劫持 addEventListener 和 patchEvent，看 Vue 是否注册了 contextmenu 监听器
// 同时测试手动注册 contextmenu 监听器是否能触发 preventDefault
import { connectCdp, evaluate, sleep } from './lib/cdp.mjs'
import { rightClickAt } from './setup.mjs'

async function main() {
  const ws = await connectCdp()
  console.log('=== Vue 事件注册探测（劫持 addEventListener）===\n')

  // 1) 劫持 addEventListener，记录所有 contextmenu 注册
  await evaluate(ws, `
    window._ctxListeners = [];
    const nativeAdd = Element.prototype.addEventListener;
    Element.prototype.addEventListener = function(type, fn, opts) {
      if (type === 'contextmenu') {
        window._ctxListeners.push({
          tag: this.tagName,
          class: this.className || '',
          id: this.id || '',
          fnStr: fn ? fn.toString().slice(0, 300) : null,
          fnLen: fn ? fn.toString().length : 0,
          optsCapture: typeof opts === 'object' ? opts.capture : opts
        });
      }
      return nativeAdd.call(this, type, fn, opts);
    };
    'installed'
  `)

  // 2) 还要看 Vue 已经注册过的（劫持前的）。用 Chrome DevTools getEventListeners API
  // CDP Runtime.evaluate 不能直接调 getEventListeners，但 DOMDebugger.getEventListeners 可以
  // 这里先用另一个思路：手动触发一个 contextmenu 事件并检查谁先收到

  // 3) 测试：手动注册一个 contextmenu 监听器并触发 preventDefault，验证 CDP 右键的行为
  await evaluate(ws, `
    window._ctxManualResult = null;
    document.querySelector('.editor-wrapper').addEventListener('contextmenu', (e) => {
      e.preventDefault();
      e.stopPropagation();
      window._ctxManualResult = { triggered: true, clientX: e.clientX, clientY: e.clientY };
    });
    'manual listener installed on .editor-wrapper'
  `)

  // 4) 获取 contenteditable 中心坐标
  const rect = JSON.parse(await evaluate(ws, `JSON.stringify((() => {
    const el = document.querySelector('[contenteditable=true]');
    if (!el) return null;
    const r = el.getBoundingClientRect();
    return { x: r.x + r.width/2, y: r.y + r.height/2 };
  })())`))
  if (!rect) { console.log('❌ 无 contenteditable'); process.exit(1) }
  console.log('contenteditable 中心:', rect)

  // 5) 右键触发
  await rightClickAt(ws, rect.x, rect.y)
  await sleep(400)

  // 6) 读结果
  const manualResult = JSON.parse(await evaluate(ws, `JSON.stringify(window._ctxManualResult)`))
  console.log('\n手动监听器结果:', JSON.stringify(manualResult, null, 2))

  // 7) 试一下 Vue 是否注册过 contextmenu — 通过劫持后的新增记录
  const newListeners = JSON.parse(await evaluate(ws, `JSON.stringify(window._ctxListeners)`))
  console.log('\n劫持后新注册的 contextmenu 监听器数:', newListeners.length)
  for (const l of newListeners) {
    console.log(`  <${l.tag} class="${l.class}"> fnLen=${l.fnLen} capture=${l.optsCapture}`)
    if (l.fnStr) console.log(`    fn: ${l.fnStr}`)
  }

  // 8) 关键：检查 Vue 是否注册过 contextmenu（劫持前的）
  // 用 Runtime.evaluate 调用 DOMDebugger.getEventListeners（通过 CDP API）
  // 这个不行 — 只能通过 CDP 协议本身
  // 替代方案：trigger 一个伪造 contextmenu 事件并检查 defaultPrevented

  // 先移除我们手动注册的，然后再次触发
  await evaluate(ws, `
    // 清掉手动监听器（通过覆盖方式不优雅但有效）
    // 实际上无法精确移除匿名函数 — 改用命名引用重新注册
    'skip removal'
  `)

  // 9) 测试 Vue 的 onContextmenu 是否存在 — 用 dispatchEvent 触发一个模拟 contextmenu
  // 但这次只让 Vue 自己的监听器响应
  // 先看看 .editor-wrapper 上 Vue 注册的事件处理是否生效
  // 通过 patch 一个新的事件 — 让 Vue 监听器执行
  // 实际上我们前面的诊断已经证明：CDP 右键触发的 contextmenu 事件 defaultPrevented=false
  // 说明 Vue 的 onContextmenu 没生效
  
  // 10) 检查 Vue 3 生产模式下绑定的方式
  // 生产模式 Vue 3 可能用 onxxx (attribute) 而非 addEventListener
  // 检查 .editor-wrapper 的 outerHTML（看有无 oncontextmenu=...）
  const outerHtml = await evaluate(ws, `document.querySelector('.editor-wrapper').outerHTML.slice(0, 500)`)
  console.log('\n.editor-wrapper outerHTML (前 500 字符):')
  console.log('  ', outerHtml)

  // 11) 查找 editor.vue 编译后注册事件的位置 — 通过 dist 文件的 contextmenu 关键字
  // 这个我们后面在 PowerShell 里搜

  // 12) 直接搜索运行时是否有 onContextmenu 被读到
  // 通过劫持 Object.defineProperty 看是否设置 onContextmenu
  const bindingCheck = JSON.parse(await evaluate(ws, `JSON.stringify((() => {
    const el = document.querySelector('.editor-wrapper');
    // 检查所有可能的属性名
    const candidates = [
      'oncontextmenu', 'onContextmenu', 'onContextmenuPrevent',
      '_vei', '__vueInternal'  // Vue 3 用 _vei (vue event invokers) 存事件
    ];
    const result = {};
    for (const k of candidates) {
      result[k] = typeof el[k];
      if (el[k] && typeof el[k] === 'function') {
        result[k + '_str'] = el[k].toString().slice(0, 200);
      } else if (el[k] && typeof el[k] === 'object') {
        result[k + '_keys'] = Object.keys(el[k]).slice(0, 20);
      }
    }
    // Vue 3 用 el._vei (Vue Event Invokers) Map 来管理事件
    if (el._vei) {
      result.veiKeys = Array.from(el._vei.keys());
    }
    return result;
  })())`))
  console.log('\nVue 3 事件绑定探测:', JSON.stringify(bindingCheck, null, 2))

  process.exit(0)
}
main().catch(e => { console.error(e); process.exit(1) })
