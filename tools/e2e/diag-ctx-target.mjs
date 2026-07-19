// 深入诊断 contextmenu event target 链和 Vue handler 调用
import { connectCdp, evaluate, sleep, cdp } from './lib/cdp.mjs'
import { rightClickAt } from './setup.mjs'

async function main() {
  const ws = await connectCdp()
  console.log('=== contextmenu target 链诊断 ===')

  // 安装深度监听器：捕获 contextmenu target 链 和 defaultPrevented
  await evaluate(ws, `
    window._ctxEvents = [];
    document.addEventListener('contextmenu', (e) => {
      // 收集 target + path
      const path = e.composedPath().map(el => {
        if (typeof el === 'string') return el;
        return {
          tag: el.tagName,
          class: el.className || '',
          id: el.id || '',
          hasAttr: el.hasAttribute ? el.hasAttribute('class') : false
        };
      }).slice(0, 10);
      window._ctxEvents.push({
        targetClass: e.target?.className || 'none',
        targetTag: e.target?.tagName || 'none',
        path,
        defaultPrevented: e.defaultPrevented,
        timeStamp: e.timeStamp
      });
    }, true);
    'installed'
  `)

  // 获取 contenteditable 中心
  const rect = JSON.parse(await evaluate(ws, `JSON.stringify((() => {
    const el = document.querySelector('[contenteditable=true]');
    if (!el) return null;
    const r = el.getBoundingClientRect();
    return { x: r.x + r.width/2, y: r.y + r.height/2 };
  })())`))
  if (!rect) { console.log('❌ 无 contenteditable'); process.exit(1) }

  // 右键
  await rightClickAt(ws, rect.x, rect.y)
  await sleep(400)

  const events = JSON.parse(await evaluate(ws, `JSON.stringify(window._ctxEvents)`))
  console.log('contextmenu 事件数:', events.length)
  for (const e of events) {
    console.log(`\n  target: ${e.targetTag}.${e.targetClass}`)
    console.log(`  defaultPrevented: ${e.defaultPrevented}`)
    console.log(`  path (前 5):`)
    for (const p of e.path.slice(0, 5)) {
      console.log(`    ${p.tag || p} class="${typeof p === 'string' ? '' : p.class}"`)
    }
  }

  // 检查 .editor-wrapper 是否在 path 中
  const hasEditorWrapper = events.some(e =>
    e.path.some(p => typeof p !== 'string' && p.class && p.class.includes('editor-wrapper'))
  )
  console.log(`\n.editor-wrapper 在 path 中: ${hasEditorWrapper ? '✅ YES' : '❌ NO'}`)

  // 检查 Vue handler 是否绑定
  const handlerInfo = JSON.parse(await evaluate(ws, `JSON.stringify((() => {
    // 找 .editor-wrapper
    const el = document.querySelector('.editor-wrapper');
    if (!el) return { found: false };
    // Vue 3 内部属性可能挂在 __vueParentComponent
    const comp = el.__vueParentComponent;
    if (!comp) return { found: true, hasComp: false };
    // props 中的事件处理器
    const props = comp.props || {};
    const vnodeProps = (comp.vnode && comp.vnode.props) || {};
    return {
      found: true,
      hasComp: true,
      propsKeys: Object.keys(props),
      vnodePropsKeys: Object.keys(vnodeProps),
      hasOnContextmenu: !!vnodeProps['onContextmenu'],
      hasOnContextmenuPrevent: !!vnodeProps['onContextmenu.prevent']
    };
  })())`))
  console.log('\n.editor-wrapper Vue 组件:', handlerInfo)

  // 尝试：用 JS 直接调 (假设能拿到 Vue 实例)
  // 或者：检查 document 上其他 contextmenu 监听器

  // 还要看一下 .editor-wrapper 下面是不是 .editor-component
  const structure = JSON.parse(await evaluate(ws, `JSON.stringify((() => {
    const wrapper = document.querySelector('.editor-wrapper');
    if (!wrapper) return null;
    const directChildren = Array.from(wrapper.children).map(c => ({
      tag: c.tagName,
      class: c.className,
      hasContextmenuAttr: c.outerHTML.includes('@contextmenu'),
      // 查找子组件中的 contextmenu
      hasEditorComponent: !!c.querySelector('.editor-component')
    }));
    return {
      wrapperClass: wrapper.className,
      childrenCount: wrapper.children.length,
      directChildren,
      // 检查 wrapper 是否就是 .editor-component
      isEditorComponent: wrapper.classList.contains('editor-component')
    };
  })())`))
  console.log('\n.editor-wrapper 结构:', JSON.stringify(structure, null, 2))

  // 还检查 .editor-component（可能 @contextmenu 在 .editor-component 上而非 .editor-wrapper）
  const ecCheck = JSON.parse(await evaluate(ws, `JSON.stringify((() => {
    const ec = document.querySelector('.editor-component');
    if (!ec) return { found: false };
    // Vue 3 内部属性
    const comp = ec.__vueParentComponent || ec.__vnode;
    const vnodeProps = (comp && comp.vnode && comp.vnode.props) || (ec.__vnode && ec.__vnode.props) || {};
    return {
      found: true,
      class: ec.className,
      compPropsKeys: Object.keys(vnodeProps),
      hasOnContextmenu: !!vnodeProps['onContextmenu'],
      // 检查它的父级 .editor-wrapper 是否注册了 handler
      parentIsEditorWrapper: ec.parentElement?.classList.contains('editor-wrapper')
    };
  })())`))
  console.log('\n.editor-component:', ecCheck)

  process.exit(0)
}
main().catch(e => { console.error(e); process.exit(1) })
