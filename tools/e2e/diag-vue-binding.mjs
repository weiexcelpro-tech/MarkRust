// 全面探测 .editor-wrapper 上的 Vue 3 事件绑定
// Vue 3 有多种内部属性名，逐个尝试
import { connectCdp, evaluate, sleep } from './lib/cdp.mjs'

async function main() {
  const ws = await connectCdp()
  console.log('=== Vue 3 事件绑定全面探测 ===\n')

  // 1) 先检查 .editor-wrapper 上的所有 Vue 内部属性
  const probe = JSON.parse(await evaluate(ws, `JSON.stringify((() => {
    const el = document.querySelector('.editor-wrapper');
    if (!el) return { found: false };
    const keys = Object.keys(el).filter(k => k.startsWith('__'));
    const result = { found: true, keys };
    // 逐个尝试常见的 Vue 3 内部属性
    for (const k of keys) {
      result[k] = typeof el[k];
    }
    // 检查 __vnode (元素自身的 vnode)
    if (el.__vnode) {
      result.vnodeProps = Object.keys(el.__vnode.props || {});
      result.vnodePropsHasOnContextmenu = !!(el.__vnode.props && el.__vnode.props.onContextmenu);
    }
    // 检查 __vueParentComponent
    if (el.__vueParentComponent) {
      const comp = el.__vueParentComponent;
      result.parentCompType = typeof comp;
      if (comp.vnode && comp.vnode.props) {
        result.parentVnodeProps = Object.keys(comp.vnode.props);
      }
    }
    return result;
  })())`))
  console.log('1. .editor-wrapper 内部属性:', JSON.stringify(probe, null, 2))

  // 2) 试试通过 app 实例找 editor 组件
  const appProbe = JSON.parse(await evaluate(ws, `JSON.stringify((() => {
    const appEl = document.querySelector('#app');
    if (!appEl) return { appFound: false };
    const app = appEl.__vue_app__;
    if (!app) return { appFound: true, vueApp: false };
    return {
      appFound: true,
      vueApp: true,
      version: app.version,
      configKeys: Object.keys(app.config || {})
    };
  })())`))
  console.log('\n2. Vue app 探测:', JSON.stringify(appProbe, null, 2))

  // 3) 关键测试：直接检查 .editor-wrapper 上是否有 oncontextmenu (DOM level 0)
  const domProbe = JSON.parse(await evaluate(ws, `JSON.stringify((() => {
    const el = document.querySelector('.editor-wrapper');
    return {
      hasOncontextmenu: !!el.oncontextmenu,
      oncontextmenuType: typeof el.oncontextmenu,
      oncontextmenuStr: el.oncontextmenu ? el.oncontextmenu.toString().slice(0, 200) : null
    };
  })())`))
  console.log('\n3. DOM level 0 oncontextmenu:', JSON.stringify(domProbe, null, 2))

  // 4) 直接劫持 addEventListener — 看谁来注册
  // 已知右键触发 contextmenu 事件但不 preventDefault，说明 Vue 的 onContextmenu 没被注册
  // 这里通过 DOM 事件监听器探测 — 但 oncontextmenu property 也会被 Vue 设置吗？
  // 实际上 Vue 3 用 addEventListener 注册事件，不设置 oncontextmenu property

  // 5) 列出 .editor-wrapper 在 path 中的所有元素和它们的 __vnode
  const pathProbe = JSON.parse(await evaluate(ws, `JSON.stringify((() => {
    const wrapper = document.querySelector('.editor-wrapper');
    const result = [];
    let cur = wrapper;
    while (cur && cur.tagName) {
      const info = {
        tag: cur.tagName,
        class: cur.className || '',
        hasVnode: !!cur.__vnode,
        vnodeProps: cur.__vnode ? Object.keys(cur.__vnode.props || {}) : [],
        hasVueParent: !!cur.__vueParentComponent
      };
      if (cur.__vnode && cur.__vnode.props && cur.__vnode.props.onContextmenu) {
        info.HAS_ON_CONTEXTMENU = true;
        info.onContextmenuType = typeof cur.__vnode.props.onContextmenu;
      }
      result.push(info);
      cur = cur.parentElement;
      if (result.length > 15) break;
    }
    return result;
  })())`))
  console.log('\n4. .editor-wrapper 及祖先链的 __vnode 检查:')
  for (const p of pathProbe) {
    const marker = p.HAS_ON_CONTEXTMENU ? ' ★★★ HAS ON_CONTEXTMENU' : '';
    console.log(`  <${p.tag} class="${p.class}"> hasVnode=${p.hasVnode} hasVueParent=${p.hasVueParent}${marker}`)
    if (p.vnodeProps && p.vnodeProps.length > 0) {
      console.log(`    vnodeProps: ${JSON.stringify(p.vnodeProps)}`)
    }
  }

  // 6) 终极测试：手动触发 Vue 编译产物中的 handleEditorContextMenu
  // 如果能找到 editor 组件实例，直接调它的 handleEditorContextMenu
  const invokeProbe = JSON.parse(await evaluate(ws, `JSON.stringify((() => {
    // 尝试通过 __vueParentComponent 链找 editor 组件实例
    const wrapper = document.querySelector('.editor-wrapper');
    if (!wrapper) return { found: false };
    let cur = wrapper;
    let editorComp = null;
    while (cur) {
      if (cur.__vueParentComponent) {
        const comp = cur.__vueParentComponent;
        // 检查组件的 setupState 是否有 handleEditorContextMenu
        const ss = comp.setupState;
        if (ss && typeof ss.handleEditorContextMenu === 'function') {
          editorComp = {
            found: true,
            compId: comp.uid,
            setupStateKeys: Object.keys(ss).slice(0, 20),
            hasHandleEditorContextMenu: true
          };
          break;
        }
      }
      cur = cur.parentElement;
    }
    return editorComp || { found: false, msg: 'no editorComp found in ancestor chain' };
  })())`))
  console.log('\n5. 通过祖先链找 editor 组件:', JSON.stringify(invokeProbe, null, 2))

  process.exit(0)
}
main().catch(e => { console.error(e); process.exit(1) })
