// 简单诊断：检查应用当前状态和 OPEN_PROJECT 行为
import { connectCdp, evaluate, sleep, cdp } from './lib/cdp.mjs'
import { invokeStoreAction, waitForElement, TEST_DATA_DIR, createTestFile, sleep as h_sleep } from './setup.mjs'

async function main() {
  const ws = await connectCdp()
  console.log('=== 应用状态诊断 ===')
  
  // 1. 检查 store
  const storeInfo = await evaluate(ws, `(() => {
    const a=document.querySelector('#app'); if(!a||!a.__vue_app__) return 'no-app';
    const p=a.__vue_app__.config.globalProperties.$pinia; if(!p||!p._s) return 'no-pinia';
    const stores = {};
    for (const [id, s] of p._s.entries()) {
      stores[id] = {
        keys: Object.keys(s).slice(0, 20),
        currentFile: id === 'editor' ? (s.currentFile ? {
          filename: s.currentFile.filename,
          isSaved: s.currentFile.isSaved,
          markdown_len: (s.currentFile.markdown||'').length,
        } : null) : undefined,
        tabs: id === 'editor' ? (s.tabs||[]).map(t => ({ filename: t.filename, isSaved: t.isSaved })) : undefined
      };
    }
    return JSON.stringify(stores, null, 2);
  })()`)
  console.log('\n--- Store 状态 ---')
  console.log(storeInfo)
  
  // 2. 检查 DOM 状态
  const domInfo = JSON.parse(await evaluate(ws, `JSON.stringify({
    sideBarFiles: document.querySelectorAll('.side-bar-file').length,
    muContainer: !!document.querySelector('.mu-container'),
    muEditor: !!document.querySelector('.mu-editor'),
    contentEditable: document.querySelector('[contenteditable=true]')?.className || 'none',
    activeElement: document.activeElement?.className || 'none',
    editorVisible: (() => {
      const el = document.querySelector('.mu-container') || document.querySelector('.editor-component');
      if (!el) return 'no-editor-element';
      const r = el.getBoundingClientRect();
      return { w: r.width, h: r.height, visible: r.width > 0 && r.height > 0 };
    })()
  })`))
  console.log('\n--- DOM 状态 ---')
  console.log(domInfo)
  
  process.exit(0)
}
main().catch(e => { console.error(e); process.exit(1) })
