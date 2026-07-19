import { connectCdp, evaluate } from './lib/cdp.mjs';

const ws = await connectCdp();

// 查找侧栏 DOM 结构 + 找展开/折叠按钮
const raw = await evaluate(ws, `(()=>{
  const tree = document.querySelector('.project-tree');
  if (!tree) return JSON.stringify({err:'no project-tree'});
  
  // 找所有可能的展开/折叠控制元素
  const expandables = [];
  tree.querySelectorAll('*').forEach(el => {
    const cls = el.className?.toString?.() || '';
    if (cls.match(/expand|collapse|arrow|toggle|folder|directory/i) || el.tagName === 'SUMMARY') {
      const r = el.getBoundingClientRect();
      expandables.push({tag: el.tagName, cls: cls.slice(0,80), txt:(el.textContent||'').trim().slice(0,30), x:r.x, y:r.y, w:r.width, h:r.height, display: getComputedStyle(el).display});
    }
  });
  
  // 找 root folder 的展开按钮
  const rootCell = tree.querySelector('.tree-root, .project-tree-item, .folder, .directory');
  const rootInfo = rootCell ? (()=>{const r=rootCell.getBoundingClientRect();return {cls:rootCell.className?.toString?.().slice(0,80), x:r.x, y:r.y, w:r.width, h:r.height, expanded: rootCell.getAttribute('aria-expanded'), dataset: JSON.stringify(rootCell.dataset)};})() : null;
  
  // 找 .tree-wrapper 父级，看为什么 display:none
  const tw = tree.querySelector('.tree-wrapper');
  let twInfo = null;
  if (tw) {
    twInfo = {display: getComputedStyle(tw).display, parentCls: tw.parentElement?.className?.toString?.()?.slice(0,80), ariaExpanded: tw.parentElement?.getAttribute?.('aria-expanded'), hidden: tw.hidden};
    // 找控制 tree-wrapper 显示的兄弟元素
    const parent = tw.parentElement;
    if (parent) {
      const sibs = Array.from(parent.children).map(c=>({tag:c.tagName, cls:c.className?.toString?.()?.slice(0,60), display:getComputedStyle(c).display}));
      twInfo.siblings = sibs;
    }
  }
  
  // 检查 projectTree store 数据
  const a = document.querySelector('#app');
  const p = a.__vue_app__.config.globalProperties.$pinia;
  const proj = Array.from(p._s.values()).find(x=>x.$id==='project');
  const tree2 = proj?.projectTree;
  
  return JSON.stringify({expandablesCount: expandables.length, expandables: expandables.slice(0,8), rootCell: rootInfo, treeWrapper: twInfo, projectTreeShape: tree2 ? {name: tree2.name, pathname: tree2.pathname, isDirectory: tree2.isDirectory, isCollapsed: tree2.isCollapsed, childrenCount: tree2.children?.length, firstChild: tree2.children?.[0] ? {name: tree2.children[0].name, isCollapsed: tree2.children[0].isCollapsed, isDirectory: tree2.children[0].isDirectory} : null} : null, activeItem: proj?.activeItem}, null, 2);
})()`);

console.log('[DIAG4]', raw);
ws.close();
process.exit(0);
