import { connectCdp, evaluate, sleep } from './lib/cdp.mjs';

const ws = await connectCdp();
console.log('[DIAG] CDP connected');

const stateRaw = await evaluate(ws, `(() => {
  const a = document.querySelector('#app');
  if (!a || !a.__vue_app__) return JSON.stringify({err:'no vue app'});
  const p = a.__vue_app__.config.globalProperties.$pinia;
  if (!p || !p._s) return JSON.stringify({err:'no pinia'});
  const stores = {};
  for (const [k, s] of p._s.entries()) {
    stores[k] = {
      $id: s.$id,
      keys: Object.keys(s).slice(0, 30),
    };
    if (s.$id === 'editor') {
      stores[k].tabsLen = s.tabs?.length;
      stores[k].tabsPaths = (s.tabs||[]).map(t => t?.pathname || t?.name || '?');
      stores[k].currentFile = s.currentFile ? {pathname: s.currentFile.pathname, name: s.currentFile.name, isSaved: s.currentFile.isSaved} : null;
    }
    if (s.$id === 'project') {
      stores[k].projectName = s.projectName;
      stores[k].projectRoot = s.projectRoot;
      stores[k].rootPath = s.rootPath;
      stores[k].openFiles = s.openFiles;
    }
  }
  // DOM info
  const dom = {
    sideFileCount: document.querySelectorAll('.side-bar-file').length,
    sideFileTitles: Array.from(document.querySelectorAll('.side-bar-file')).slice(0,15).map(f=>f.getAttribute('title')||f.textContent?.trim().slice(0,30)),
    muTableCount: document.querySelectorAll('.mu-table').length,
    hasEditorArea: !!document.querySelector('.editor-component, .editor-area'),
    bodyText: document.body.textContent?.trim().slice(0,200)
  };
  return JSON.stringify({ stores, dom });
})()`);

console.log('[DIAG] state:');
console.log(stateRaw);

ws.close();
process.exit(0);
