import { connectCdp, evaluate, sleep, cdp } from './lib/cdp.mjs';

const ws = await connectCdp();
console.log('[DIAG2] CDP connected');

// 找 T008 文件项坐标
const posRaw = await evaluate(ws, `(()=>{const files=Array.from(document.querySelectorAll('.side-bar-file'));const t=files.find(f=>(f.getAttribute('title')||'').includes('T008-table-multiselect'));if(!t)return JSON.stringify({found:false,count:files.length});const r=t.getBoundingClientRect();return JSON.stringify({found:true,x:r.x+r.width/2,y:r.y+r.height/2,w:r.width,h:r.height,visible:r.width>0&&r.height>0});})()`);
console.log('[DIAG2] pos:', posRaw);
const info = JSON.parse(posRaw);
if (!info.found) { console.log('[DIAG2] NOT FOUND'); process.exit(0); }

// 监听 click 事件（看 onClick 是否被触发）
await evaluate(ws, `(()=>{window.__t8clicks=[];document.addEventListener('click',e=>{window.__t8clicks.push({tag:e.target.tagName,cls:e.target.className,txt:(e.target.textContent||'').slice(0,30)});},true);return 'ok';})()`);

// click 文件项
await cdp(ws, 'Input.dispatchMouseEvent', { type: 'mouseMoved', x: info.x, y: info.y });
await sleep(80);
await cdp(ws, 'Input.dispatchMouseEvent', { type: 'mousePressed', x: info.x, y: info.y, button: 'left', clickCount: 1 });
await cdp(ws, 'Input.dispatchMouseEvent', { type: 'mouseReleased', x: info.x, y: info.y, button: 'left', clickCount: 1 });
console.log('[DIAG2] clicked at', info.x, info.y);

// 等 1.5s
await sleep(1500);

// 查状态
const afterRaw = await evaluate(ws, `(()=>{const a=document.querySelector('#app');const p=a.__vue_app__.config.globalProperties.$pinia;const s=Array.from(p._s.values()).find(x=>x.$id==='editor');const tabs=(s.tabs||[]).map(t=>t?.name||t?.pathname||'?');return JSON.stringify({tabsLen:s.tabs?.length,tabs:tabs,currentFile:s.currentFile?{n:s.currentFile.name,p:s.currentFile.pathname}:null,clicks:window.__t8clicks,editorArea:!!document.querySelector('.editor-component, .editor-area'),muContainer:!!document.querySelector('.mu-container, .mu-editor')});})()`);
console.log('[DIAG2] after click:', afterRaw);

// 试第二次 click（有时第一次只 focus）
await cdp(ws, 'Input.dispatchMouseEvent', { type: 'mousePressed', x: info.x, y: info.y, button: 'left', clickCount: 2 });
await cdp(ws, 'Input.dispatchMouseEvent', { type: 'mouseReleased', x: info.x, y: info.y, button: 'left', clickCount: 2 });
await sleep(1500);

const after2Raw = await evaluate(ws, `(()=>{const a=document.querySelector('#app');const p=a.__vue_app__.config.globalProperties.$pinia;const s=Array.from(p._s.values()).find(x=>x.$id==='editor');return JSON.stringify({tabsLen:s.tabs?.length,currentFile:s.currentFile?s.currentFile.name:null,editorArea:!!document.querySelector('.editor-component, .editor-area')});})()`);
console.log('[DIAG2] after dblclick:', after2Raw);

ws.close();
process.exit(0);
