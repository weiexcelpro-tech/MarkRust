import { connectCdp, evaluate, sleep, cdp } from './lib/cdp.mjs';
import { invokeStoreAction } from './setup.mjs';

const ws = await connectCdp();
console.log('[DIAG5] step1: re-OPEN_PROJECT');

const r = await invokeStoreAction(ws, 'project', 'OPEN_PROJECT',
  'C:/Work/202607/MarkText优化/marktext-tauri/tools/e2e/.test-data');
console.log('[DIAG5] OPEN_PROJECT ok=', r.ok);

// 等异步 _fillProjectTree
await sleep(1500);

// 查 projectTree 数据
const t1 = await evaluate(ws, `(()=>{const a=document.querySelector('#app');const p=a.__vue_app__.config.globalProperties.$pinia;const proj=Array.from(p._s.values()).find(x=>x.$id==='project');const t=proj.projectTree;return JSON.stringify({name:t?.name,childrenLen:t?.children?.length||0,first2:(t?.children||[]).slice(0,2).map(c=>({name:c.name,isDir:c.isDirectory,collapsed:c.isCollapsed}))});})()`);
console.log('[DIAG5] tree after OPEN:', t1);

// 查 fold 图标位置
const foldPos = await evaluate(ws, `(()=>{const i=document.querySelector('.project-tree .icon-arrow.fold, .project-tree .icon-arrow');if(!i)return JSON.stringify({found:false});const r=i.getBoundingClientRect();return JSON.stringify({found:true,x:r.x+r.width/2,y:r.y+r.height/2,cls:i.className,visible:r.width>0});})()`);
console.log('[DIAG5] fold icon:', foldPos);
const fInfo = JSON.parse(foldPos);

if (fInfo.found && fInfo.visible) {
  // click fold 图标展开
  await cdp(ws, 'Input.dispatchMouseEvent', { type: 'mouseMoved', x: fInfo.x, y: fInfo.y });
  await cdp(ws, 'Input.dispatchMouseEvent', { type: 'mousePressed', x: fInfo.x, y: fInfo.y, button: 'left', clickCount: 1 });
  await cdp(ws, 'Input.dispatchMouseEvent', { type: 'mouseReleased', x: fInfo.x, y: fInfo.y, button: 'left', clickCount: 1 });
  console.log('[DIAG5] clicked fold icon at', fInfo.x, fInfo.y);
  await sleep(1000);
  
  // 查 tree-wrapper 是否展开
  const twAfter = await evaluate(ws, `(()=>{const tw=document.querySelector('.project-tree .tree-wrapper');if(!tw)return JSON.stringify({found:false});const r=tw.getBoundingClientRect();return JSON.stringify({found:true,display:getComputedStyle(tw).display,childCount:tw.querySelectorAll('.side-bar-file').length,visible:r.width>0&&r.height>0});})()`);
  console.log('[DIAG5] tree-wrapper after fold-click:', twAfter);

  // 查文件项实际坐标
  const filePos = await evaluate(ws, `(()=>{const files=Array.from(document.querySelectorAll('.side-bar-file'));const t=files.find(f=>(f.getAttribute('title')||'').includes('T008-table-multiselect'));if(!t)return JSON.stringify({found:false,count:files.length});const r=t.getBoundingClientRect();return JSON.stringify({found:true,x:r.x+r.width/2,y:r.y+r.height/2,visible:r.width>0,display:getComputedStyle(t).display});})()`);
  console.log('[DIAG5] T008 file pos:', filePos);
}

ws.close();
process.exit(0);
