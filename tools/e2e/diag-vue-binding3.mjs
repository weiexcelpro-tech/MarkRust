// 检查 Vue 3.5 内部事件管理实现 - 看是否有任何元素有 _vei
import { connectCdp, evaluate } from './lib/cdp.mjs'

async function main() {
  const ws = await connectCdp()
  console.log('=== Vue 3.5 事件管理内部实现检查 ===\n')

  // 1) 检查整个文档中哪些元素有 _vei
  const veiCheck = JSON.parse(await evaluate(ws, `JSON.stringify((() => {
    const all = document.querySelectorAll('*');
    let withVei = 0;
    let totalTags = 0;
    const samples = [];
    for (const el of all) {
      totalTags++;
      if (el._vei) {
        withVei++;
        if (samples.length < 10) {
          samples.push({
            tag: el.tagName,
            class: (el.className || '').slice(0, 50),
            veiKeys: Object.keys(el._vei)
          });
        }
      }
    }
    return { totalTags, withVei, samples };
  })())`))
  console.log('1. 全文档 _vei 检查:')
  console.log(`  总标签数: ${veiCheck.totalTags}`)
  console.log(`  有 _vei 的元素数: ${veiCheck.withVei}`)
  console.log(`  样本:`)
  for (const s of veiCheck.samples) {
    console.log(`    <${s.tag} class="${s.class}"> veiKeys=${JSON.stringify(s.veiKeys)}`)
  }

  // 2) 检查 .editor-wrapper 上的所有 Vue 3 内部属性（最新版本可能有不同名）
  const internalProps = JSON.parse(await evaluate(ws, `JSON.stringify((() => {
    const el = document.querySelector('.editor-wrapper');
    if (!el) return null;
    // Vue 3.5 可能用 __vueInternal 或其他名字
    const allKeys = Object.getOwnPropertyNames(el).filter(k => k.startsWith('_') || k.startsWith('__'));
    const result = { allOwnKeys: allKeys };
    // 检查元素是否被 Vue 标记为 dynamic children
    // 检查有没有 __vnode
    result.hasVnode = !!el.__vnode;
    result.hasVParent = !!el.__vueParentComponent;
    // 检查 data-v-xxx (scoped css 标记)
    result.datasetKeys = Object.keys(el.dataset || {});
    return result;
  })())`))
  console.log('\n2. .editor-wrapper 内部属性:', JSON.stringify(internalProps, null, 2))

  // 3) 关键测试：手动 patch 一个 onContextmenu 到 .editor-wrapper 看效果
  // 如果手动 addEventListener 可以触发，但 Vue 没注册，说明 Vue 编译产物的事件被丢了
  // 我们已经验证过手动 addEventListener 可以触发

  // 4) 检查 Vue app 的 globalProperties 和 component lookup
  // 看 editor 组件的 render 函数是否被替换或破坏

  // 5) 搜索 dist 中是否有覆盖 onContextmenu 的代码
  // 比如有人写了自定义指令来覆盖事件
  const allListenersCheck = JSON.parse(await evaluate(ws, `JSON.stringify((() => {
    // Vue 3 用 baseCompile 编译模板，事件应该被正确编译
    // 但运行时可能因为某种原因没注册
    // 检查 .editor-wrapper 在 DOM 中的 closest 组件实例
    let cur = document.querySelector('.editor-wrapper');
    const info = [];
    while (cur && cur !== document.body) {
      // 检查 Vue 3.5 各种命名
      const vueData = {
        tag: cur.tagName,
        class: (cur.className || '').slice(0, 40),
        _vnode: !!cur._vnode,
        _vei: !!cur._vei,
        __vnode: !!cur.__vnode,
        __vueParentComponent: !!cur.__vueParentComponent,
        __vueInternalInstance: !!cur.__vueInternalInstance,
        __vueComponent: !!cur.__vueComponent
      };
      info.push(vueData);
      cur = cur.parentElement;
    }
    return info;
  })())`))
  console.log('\n3. .editor-wrapper 及其祖先的 Vue 内部属性检查:')
  for (const i of allListenersCheck) {
    console.log(`  <${i.tag} class="${i.class}"> _vnode=${i._vnode} _vei=${i._vei} __vnode=${i.__vnode} __vueParentComponent=${i.__vueParentComponent} __vueInternalInstance=${i.__vueInternalInstance} __vueComponent=${i.__vueComponent}`)
  }

  // 6) 反过来：从 #app 找 Vue app，再向下找 editor 组件实例
  const compTree = JSON.parse(await evaluate(ws, `JSON.stringify((() => {
    const appEl = document.querySelector('#app');
    if (!appEl || !appEl.__vue_app__) return null;
    const app = appEl.__vue_app__;
    // app._instance 是根组件
    const root = app._instance;
    if (!root) return { rootFound: false };
    // 递归遍历找 editor 组件
    function findEditor(comp, depth, maxDepth) {
      if (depth > maxDepth) return null;
      const name = comp.type?.name || comp.type?.__name || '';
      if (name === 'Editor' || name === 'editor') {
        return { found: true, name, depth, hasSetupState: !!comp.setupState };
      }
      // 遍历子组件
      const subTree = comp.subTree;
      if (!subTree) return null;
      function walk(vnode) {
        if (!vnode) return null;
        if (vnode.component) {
          const r = findEditor(vnode.component, depth + 1, maxDepth);
          if (r) return r;
        }
        if (vnode.children && Array.isArray(vnode.children)) {
          for (const c of vnode.children) {
            if (c && typeof c === 'object') {
              const r = walk(c);
              if (r) return r;
            }
          }
        }
        return null;
      }
      return walk(subTree);
    }
    const editor = findEditor(root, 0, 20);
    return { rootFound: true, rootName: root.type?.name || root.type?.__name, editorFound: !!editor, editorInfo: editor };
  })())`))
  console.log('\n4. 通过 Vue app tree 找 editor 组件:', JSON.stringify(compTree, null, 2))

  process.exit(0)
}
main().catch(e => { console.error(e); process.exit(1) })
