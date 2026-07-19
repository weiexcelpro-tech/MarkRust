// 精确定位 contextmenu handler 早 return 的原因
// 检查 editorRef.value 与 target 的 DOM 关系
import { connectCdp, evaluate, sleep } from './lib/cdp.mjs'
import { rightClickAt } from './setup.mjs'

async function main() {
  const ws = await connectCdp()
  console.log('=== 守卫检查诊断：editorRef.value.contains(target) ===\n')

  // 获取 contenteditable 中心点
  const rect = JSON.parse(await evaluate(ws, `JSON.stringify((() => {
    const el = document.querySelector('[contenteditable=true]');
    if (!el) return null;
    const r = el.getBoundingClientRect();
    return { x: r.x + r.width/2, y: r.y + r.height/2 };
  })())`))
  if (!rect) { console.log('❌ 无 contenteditable'); process.exit(1) }
  console.log('右键位置:', rect)

  // 安装实时探针：在 contextmenu bubble 最早期记录所有关键状态
  // 注意：Vue 的 @contextmenu.prevent wrapper 会先 preventDefault 再 调用 handler
  // 所以我们的探针要在 Vue wrapper 之前 看到 preventDefault 还没被调用
  // 但是 listener 是按注册顺序执行的，Vue 已经注册在前了
  // 改用另一种方法：直接在 contextmenu 之后用 setTimeout(0) 检查 DOM 状态
  await evaluate(ws, `
    window._guardTrace = null;
    document.addEventListener('contextmenu', (e) => {
      const target = e.target;
      const editorComponent = document.querySelector('.editor-component');
      const editorWrapper = document.querySelector('.editor-wrapper');
      
      // 构造 target 的祖先链
      const ancestorChain = [];
      let cur = target;
      for (let i = 0; i < 10 && cur; i++) {
        ancestorChain.push({
          tag: cur.tagName,
          class: cur.className || '',
          id: cur.id || ''
        });
        cur = cur.parentElement;
      }
      
      window._guardTrace = {
        target: {
          tag: target.tagName,
          class: target.className,
          id: target.id
        },
        editorComponentExists: !!editorComponent,
        editorComponentContainsTarget: editorComponent ? editorComponent.contains(target) : false,
        editorWrapperContainsTarget: editorWrapper ? editorWrapper.contains(target) : false,
        editorComponentChildCount: editorComponent ? editorComponent.children.length : -1,
        editorComponentFirstChildTag: editorComponent && editorComponent.firstElementChild ? editorComponent.firstElementChild.tagName + '.' + editorComponent.firstElementChild.className : 'none',
        ancestorChain: ancestorChain,
        // 模拟 handler 内部的守卫判断
        guardWouldReturn: (!editorComponent || !editorComponent.contains(target))
      };
    }, true);  // capture 阶段，最早执行
    'probe installed'
  `)

  // 触发右键
  await rightClickAt(ws, rect.x, rect.y)
  await sleep(500)

  const trace = JSON.parse(await evaluate(ws, `JSON.stringify(window._guardTrace)`))
  console.log('\n=== 守卫检查结果 ===')
  console.log('target:', JSON.stringify(trace.target))
  console.log('editorComponent 是否存在:', trace.editorComponentExists)
  console.log('editorComponent.contains(target):', trace.editorComponentContainsTarget)
  console.log('editorWrapper.contains(target):', trace.editorWrapperContainsTarget)
  console.log('editorComponent 子元素数:', trace.editorComponentChildCount)
  console.log('editorComponent 第一个子元素:', trace.editorComponentFirstChildTag)
  console.log('\n祖先链:')
  trace.ancestorChain.forEach((node, i) => {
    console.log(`  [${i}] ${node.tag}.${node.class}${node.id ? '#' + node.id : ''}`)
  })
  console.log('\n>>> handler 守卫会 return:', trace.guardWouldReturn ? 'YES ❌ (bug 根因)' : 'NO ✅')
  
  // 再检查 popupMenu 是否被调用
  const menuCount = await evaluate(ws, `document.querySelectorAll('div[style*="z-index:99999"]').length`)
  console.log('菜单 DOM 数:', menuCount)

  process.exit(0)
}
main().catch(e => { console.error(e); process.exit(1) })
