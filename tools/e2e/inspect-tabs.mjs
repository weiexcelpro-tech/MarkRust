// 精确检查 tabs[0] 的真实结构 vs currentFile
import { connectCdp, evaluate } from './lib/cdp.mjs'

const ws = await connectCdp()

const result = await evaluate(ws, `(() => {
  const app = document.querySelector('#app');
  const pinia = app.__vue_app__.config.globalProperties.$pinia;
  const store = Array.from(pinia._s.values()).find(s => s.$id === 'editor');
  const tab0 = store.tabs[0];
  const cf = store.currentFile;
  return JSON.stringify({
    tabsLen: store.tabs.length,
    tab0_exists: !!tab0,
    tab0_keys: tab0 ? Object.keys(tab0) : null,
    tab0_ownKeys: tab0 ? Object.getOwnPropertyNames(tab0) : null,
    tab0_id: tab0?.id,
    tab0_id_type: typeof tab0?.id,
    tab0_filename: tab0?.filename,
    tab0_isSaved: tab0?.isSaved,
    tab0_markdown_len: tab0?.markdown?.length,
    tab0_pathname: tab0?.pathname,
    cf_id: cf?.id,
    cf_filename: cf?.filename,
    cf_isSaved: cf?.isSaved,
    cf_markdown_len: cf?.markdown?.length,
    cf_pathname: cf?.pathname,
    same_ref: tab0 === cf,
    tab0_constructor: tab0?.constructor?.name,
    cf_constructor: cf?.constructor?.name,
    // 检查是否是 Vue reactive proxy
    tab0_isReactive: !!(tab0?.__v_isRef || tab0?.__v_isReactive),
    cf_isReactive: !!(cf?.__v_isRef || cf?.__v_isReactive),
    // toJSON 检查
    tab0_json: tab0 ? JSON.stringify(tab0) : null,
    cf_json: cf ? JSON.stringify(cf) : null
  }, null, 2)
})()`)

console.log(result)
process.exit(0)
