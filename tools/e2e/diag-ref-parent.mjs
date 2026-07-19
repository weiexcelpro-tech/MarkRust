import { connectCdp, evaluate, sleep } from './lib/cdp.mjs'

function withTimeout(p, ms, label) {
  return Promise.race([p, new Promise((_, rej) => setTimeout(() => rej(new Error(`TIMEOUT[${label}]`)), ms))])
}

async function main() {
  const ws = await withTimeout(connectCdp(), 10000, 'connectCdp')
  console.log('=== editorRef 父节点检测 ===\n')

  // 在 Rl 函数内加更详细的探针 - 检查 parentNode 链
  const result = await withTimeout(evaluate(ws, `
    (function() {
      // 从 document 找 .editor-component
      const domEl = document.querySelector('.editor-component');
      // 旧 editorRef 通过 patch 取
      // 既然 Rl 函数能访问 Qe.value，我们临时让 Rl 把 Qe.value 暴露出来
      window.__getRefInfo = null;
      return {
        domEl_info: domEl ? ('tag='+domEl.tagName+' parent='+domEl.parentNode?.tagName+'.'+domEl.parentNode?.className+' inDoc='+document.body.contains(domEl)) : 'null',
        domEl_parent_chain: domEl ? (function(){
          const arr=[]; let c=domEl; for(let i=0;i<8&&c;i++){arr.push(c.tagName+'.'+(c.className||'').slice(0,40)); c=c.parentElement} return arr
        })() : []
      };
    })()
  `), 5000, 'check')

  console.log('document.querySelector(".editor-component"):')
  console.log('  ', result.domEl_info)
  console.log('  父链:', result.domEl_parent_chain.join(' -> '))

  // 用 CDP 直接查询 dist 的 Rl 函数 - 通过 patched console.log 取 Qe.value 的信息
  // 我们 patch 加的日志已经能证明 Qe.value 是 HTMLDivElement 但不等于 dom El
  // 加个 patch：在 Rl 中输出 parentNode
  
  // 不重新构建，用 evaluate 临时给 Rl 注入更详细探针——但 Rl 是闭包内的，无法外部访问
  // 所以只能依赖已有的"[DIAG-RL] Qe.value=[type=...tag=...nodeType=...ctor=...eq_dom=...]"
  // 日志已经够清楚：Qe.value 是 HTMLDivElement 但不等于当前 .editor-component
  
  // 验证推断：muya 是否做了替换？  
  // 直接看 .editor-component 的祖先链和文档中的 DOM 结构
  const veryDetailed = await withTimeout(evaluate(ws, `
    (function(){
      // 全文档中所有 .editor-component 元素
      const all = document.querySelectorAll('.editor-component');
      const info = [];
      for (const el of all) {
        info.push({
          tag: el.tagName,
          class: el.className,
          inDoc: document.body.contains(el),
          parent: el.parentElement ? (el.parentElement.tagName+'.'+el.parentElement.className.slice(0,40)) : 'null',
          childCount: el.children.length,
          firstChildClass: el.firstElementChild ? el.firstElementChild.className.slice(0,60) : 'none'
        });
      }
      return info;
    })()
  `), 5000, 'all-editor-component')

  console.log('\n全文档 .editor-component 元素数:', veryDetailed.length)
  veryDetailed.forEach((el, i) => {
    console.log(`  [${i}] inDoc=${el.inDoc} class="${el.class}"`)
    console.log(`      parent=${el.parent}, childCount=${el.childCount}, firstChildClass="${el.firstChildClass}"`)
  })

  // 用 MutationObserver 检测 muya 是否替换了 .editor-component
  // 但需要重新触发初始化 - 太复杂
  
  // 检查 muya 实例（editor.value）的根元素
  const editorInstanceInfo = await withTimeout(evaluate(ws, `
    (function(){
      // 尝试通过 Vue app 拿到 editor 组件实例的 editor ref (muya 实例)
      try {
        const app = document.querySelector('#app');
        // Vue 3.5 生产模式不暴露 _instance，无法从外面拿
        return 'vue-instance-unreachable-in-prod';
      } catch(e) { return 'err: '+e.message }
    })()
  `), 5000, 'vue-probe')
  
  console.log('\nVue app instance:', editorInstanceInfo)

  process.exit(0)
}
main().catch(e => { console.error('FATAL:', e.message); process.exit(1) })
