// 诊断右键菜单不出现的原因
import { connectCdp, evaluate, sleep, cdp } from './lib/cdp.mjs'
import { rightClickAt, pressKey } from './setup.mjs'

async function main() {
  const ws = await connectCdp()
  console.log('=== 右键菜单触发诊断 ===')

  // 安装 contextmenu / mousedown / mouseup 计数器
  await evaluate(ws, `
    window._events = { contextmenu: 0, mousedown: 0, mouseup: 0, click: 0 };
    document.addEventListener('contextmenu', (e) => {
      window._events.contextmenu++;
      console.log('[contextmenu] target=', e.target?.className, 'defaultPrevented=', e.defaultPrevented);
    }, true);
    document.addEventListener('mousedown', (e) => {
      if (e.button === 2) window._events.mousedown++;
    }, true);
    document.addEventListener('mouseup', (e) => {
      if (e.button === 2) window._events.mouseup++;
    }, true);
    document.addEventListener('click', (e) => {
      if (e.button === 2) window._events.click++;
    }, true);
    'installed'
  `)

  // 获取 contenteditable 中心
  const rect = JSON.parse(await evaluate(ws, `JSON.stringify((() => {
    const el = document.querySelector('[contenteditable=true]');
    if (!el) return null;
    const r = el.getBoundingClientRect();
    return { x: r.x + r.width/2, y: r.y + r.height/2, w: r.width, h: r.height };
  })())`))
  console.log('编辑器中心:', rect)
  if (!rect) { console.log('❌ 无 contenteditable'); process.exit(1) }

  // ── 方法1: CDP Input.dispatchMouseEvent right-click ──
  console.log('\n[方法1] CDP Input.dispatchMouseEvent button:right')
  await rightClickAt(ws, rect.x, rect.y)
  await sleep(400)
  const events1 = JSON.parse(await evaluate(ws, `JSON.stringify(window._events)`))
  console.log('  events:', events1)
  const hasMenu1 = JSON.parse(await evaluate(ws, `JSON.stringify({
    exists: !!document.querySelector('body > div[style*="z-index"]'),
    bodyDivCount: document.querySelectorAll('body > div').length,
    bodyLast: Array.from(document.querySelectorAll('body > div')).slice(-3).map(d => ({
      class: d.className,
      style: d.getAttribute('style')?.slice(0, 80),
      pos: d.style.position,
      z: d.style.zIndex
    }))
  })`))
  console.log('  菜单:', hasMenu1)

  // ── 方法2: 直接 dispatch MouseEvent contextmenu ──
  console.log('\n[方法2] 直接 dispatch MouseEvent("contextmenu")')
  await evaluate(ws, `
    const el = document.querySelector('[contenteditable=true]');
    const r = el.getBoundingClientRect();
    const cx = r.x + r.width/2;
    const cy = r.y + r.height/2;
    const ev = new MouseEvent('contextmenu', {
      bubbles: true, cancelable: true, composed: true,
      clientX: cx, clientY: cy, button: 2
    });
    el.dispatchEvent(ev);
    'dispatched'
  `)
  await sleep(400)
  const events2 = JSON.parse(await evaluate(ws, `JSON.stringify(window._events)`))
  console.log('  events:', events2)
  const hasMenu2 = JSON.parse(await evaluate(ws, `JSON.stringify({
    exists: !!document.querySelector('body > div[style*="z-index"]'),
    bodyDivCount: document.querySelectorAll('body > div').length,
    bodyLast: Array.from(document.querySelectorAll('body > div')).slice(-3).map(d => ({
      class: d.className,
      style: (d.getAttribute('style')||'').slice(0, 80),
      pos: d.style.position,
      z: d.style.zIndex
    }))
  })`))
  console.log('  菜单:', hasMenu2)

  // ── 方法3: 检查 editorRef / handleEditorContextMenu 是否注册 ──
  console.log('\n[方法3] 检查 Vue 组件 handleEditorContextMenu 是否注册')
  const check = JSON.parse(await evaluate(ws, `JSON.stringify((() => {
    const ed = document.querySelector('.editor-wrapper');
    if (!ed) return { found: false, reason: 'no .editor-wrapper' };
    // Vue 3 把事件监听器挂在 __vnode.props 或 __vueParentComponent 上
    const vnode = ed.__vnode || (ed.__vueParentComponent && ed.__vueParentComponent.vnode);
    const props = ed.__vnode ? ed.__vnode.props : null;
    // 检查 contextmenu 在 props 中
    const hasCtxHandler = !!(props && props.onContextmenu);
    return {
      found: true,
      className: ed.className,
      hasVnode: !!ed.__vnode,
      hasCtxHandler,
      propsKeys: props ? Object.keys(props).slice(0, 20) : [],
      hasAtContextmenuAttr: ed.hasAttribute('@contextmenu') || ed.outerHTML.includes('@contextmenu'),
      // 检查有没有通过 addEventListener 注册 contextmenu
      viaAddEventListener: 'unknown'  // 无法直接检查，但可看 events 计数
    };
  })())`))
  console.log('  editor-wrapper:', check)

  process.exit(0)
}
main().catch(e => { console.error(e); process.exit(1) })
