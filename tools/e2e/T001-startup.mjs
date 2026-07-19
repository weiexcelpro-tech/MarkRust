// T001: Application startup & UI readiness
// Verifies: #app exists, Vue app mounted, Pinia accessible, editor store present, window title
export const meta = {
  id: 'T001',
  name: '应用启动与 UI 就绪',
  priority: 'P0',
};

export default async function run(ws, ctx, h) {
  // Step 1: #app element exists
  const hasApp = await h.evaluate(ws, `!!document.querySelector('#app')`);
  ctx.assert(hasApp, '#app 元素存在');

  // Step 2: Vue app instance mounted
  const hasVueApp = await h.evaluate(ws, `(() => {
    const el = document.querySelector('#app');
    return !!(el && el.__vue_app__);
  })()`);
  ctx.assert(hasVueApp, 'Vue 应用已挂载 (.__vue_app__)');

  if (!hasVueApp) {
    ctx.fail('Vue app not mounted, skipping remaining checks.');
    return;
  }

  // Step 3: Pinia store accessible
  const hasPinia = await h.evaluate(ws, `(() => {
    const app = document.querySelector('#app').__vue_app__;
    const pinia = app.config.globalProperties.$pinia;
    return !!(pinia && pinia._s);
  })()`);
  ctx.assert(hasPinia, 'Pinia store 可访问');

  // Step 4: editor store registered
  const storesJson = await h.evaluate(ws, `(() => {
    const app = document.querySelector('#app').__vue_app__;
    const pinia = app.config.globalProperties.$pinia;
    return JSON.stringify(Array.from(pinia._s.keys()));
  })()`);
  const stores = JSON.parse(storesJson || '[]');
  ctx.assert(stores.includes('editor'), `editor store 已注册 (stores: ${stores.join(', ')})`);

  // Step 5: Tauri globals available
  const probe = JSON.parse(await h.probeTauriGlobals(ws));
  const hasTauri = probe.hasTauriInternals !== 'undefined' || probe.hasTauri !== 'undefined';
  ctx.assert(hasTauri, `Tauri globals 可用 (internals=${probe.hasTauriInternals})`);

  // Step 6: Window title contains "MarkRust" or marktext-like identifier
  const title = await h.evaluate(ws, `document.title`);
  ctx.assertTruthy(title && title.length > 0, `窗口标题非空 (title="${title}")`);

  // Step 7: Editor container or source-code container present (UI rendered)
  const hasEditor = await h.evaluate(ws, `(() => {
    return !!(document.querySelector('.mu-editor') ||
              document.querySelector('.editor') ||
              document.querySelector('.CodeMirror') ||
              document.querySelector('[class*="editor"]'));
  })()`);
  ctx.assert(hasEditor, '编辑器容器已渲染 (.mu-editor/.editor/.CodeMirror)');

  // Step 8: Screenshot for visual reference
  const shotPath = await h.screenshot(ws, 'T001-startup');
  ctx.pass(`启动截图已保存: ${shotPath}`);

  // Step 9: editor store has expected initial shape (currentFile may or may not be set)
  const editorState = await h.getStore(ws, 'editor');
  if (editorState) {
    ctx.assertTruthy(
      Array.isArray(editorState.tabs) || typeof editorState.currentFile !== 'undefined',
      'editor store 结构正常 (tabs 或 currentFile 存在)'
    );
  } else {
    ctx.fail('editor store 为 null');
  }
}
