import { connectCdp, evaluate } from './lib/cdp.mjs';

const ws = await connectCdp();

const raw = await evaluate(ws, `(()=>{
  const a=document.querySelector('#app');
  const p=a.__vue_app__.config.globalProperties.$pinia;
  const layout=Array.from(p._s.values()).find(x=>x.$id==='layout');
  const editor=Array.from(p._s.values()).find(x=>x.$id==='editor');
  
  // 找侧栏相关元素
  const sideBar = document.querySelector('.side-bar, .sidebar, [class*="side-bar"]');
  const sideBarParent = sideBar?.parentElement;
  
  // 找包含 .side-bar-file 的容器
  let fileContainer = null;
  const firstFile = document.querySelector('.side-bar-file');
  if (firstFile) {
    let el = firstFile;
    const chain = [];
    for (let i=0; i<10 && el; i++) {
      const r = el.getBoundingClientRect();
      chain.push({tag: el.tagName, cls: el.className?.toString?.().slice(0,60), x:r.x, y:r.y, w:r.width, h:r.height, display: getComputedStyle(el).display, visibility: getComputedStyle(el).visibility});
      el = el.parentElement;
    }
    return JSON.stringify({layout: {showSideBar: layout?.showSideBar, sideBarWidth: layout?.sideBarWidth, effectiveSideBarWidth: layout?.effectiveSideBarWidth, showTabBar: layout?.showTabBar, rightColumn: layout?.rightColumn}, editor: {tabsLen: editor?.tabs?.length, currentFile: editor?.currentFile?.name || null}, fileChain: chain, hasEditorArea: !!document.querySelector('.editor-component, .editor-area')});
  }
  return JSON.stringify({layout, noFileFound: true});
})()`);

console.log('[DIAG3]', raw);
ws.close();
process.exit(0);
