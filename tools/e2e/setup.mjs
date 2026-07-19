// E2E Setup & Helpers for MarkRust (Tauri 2) testing
// Provides: CDP connection, app lifecycle, DOM/UI interaction utilities, assertions
// Usage: import { ensureApp, createCtx, ... } from './setup.mjs'

import { spawn } from 'child_process';
import { existsSync, mkdirSync, writeFileSync, readFileSync, unlinkSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

import {
  connectCdp, cdp, evaluate, tauriInvoke, probeTauriGlobals, sleep,
  getPageTarget
} from './lib/cdp.mjs';

// ─── Constants ──────────────────────────────────────────────────

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const PROJECT_ROOT = join(__dirname, '..', '..');
export const EXE_PATH = join(PROJECT_ROOT, 'src-tauri', 'target', 'release', 'markrust.exe');
export const CDP_PORT = 9222;
export const SCREENSHOT_DIR = join(__dirname, '.screenshots');
export const TEST_DATA_DIR = join(__dirname, '.test-data');

// Ensure helper directories exist
[SCREENSHOT_DIR, TEST_DATA_DIR].forEach(d => {
  if (!existsSync(d)) mkdirSync(d, { recursive: true });
});

// ─── App Lifecycle ──────────────────────────────────────────────

/**
 * Check if CDP is reachable (app already running with debugging).
 * @returns {Promise<boolean>}
 */
export async function isAppRunning() {
  try {
    const target = await getPageTarget();
    return !!target;
  } catch {
    return false;
  }
}

/**
 * Ensure markrust.exe is running with CDP debugging enabled.
 * If already running, reuse the existing instance.
 * @param {object} opts - { forceRestart: boolean, timeout: number }
 * @returns {Promise<WebSocket>} Connected CDP WebSocket
 */
export async function ensureApp(opts = {}) {
  const { forceRestart = false, timeout = 20000 } = opts;

  if (forceRestart) {
    await killApp();
    await sleep(1500);
  }

  // Try connecting first (app may already be running)
  let running = await isAppRunning();
  if (!running) {
    console.log('[setup] App not running, starting markrust.exe with CDP...');
    await startApp();
  } else {
    console.log('[setup] App already running, reusing instance.');
  }

  // Wait for CDP to be fully ready
  const ws = await waitForCdp(timeout);
  console.log('[setup] CDP connected.');

  // Wait for app to be fully ready — both Tauri runtime injected AND Vue mounted.
  // 历史 Bug: CDP 端口在 WebView2 启动后立即可用，但此时 Vue app 还在加载,
  // __TAURI_INTERNALS__ 还未注入。若只单次 probe 就放行, T001 等会因
  // #app.__vue_app__ 不存在而连锁 FAIL。轮询等待两层都就绪才放行。
  const ready = await waitForAppReady(ws, 15000);
  if (!ready.ok) {
    console.error(`[setup] ERROR: App not ready after 15s.`);
    console.error(`[setup]   hasTauriInternals=${ready.probe?.hasTauriInternals}, location=${ready.probe?.location}`);
    throw new Error('App failed to become ready: Tauri runtime not injected or Vue app not mounted within 15s');
  }
  console.log(`[setup] App ready (internals=${ready.probe.hasTauriInternals}, tauri=${ready.probe.hasTauri}).`);

  return ws;
}

/**
 * 轮询等待 app 完全就绪 — 同时满足两个条件:
 *   1. window.__TAURI_INTERNALS__ 已注入 (typeof === 'object')
 *   2. Vue app 已挂载 (#app.__vue_app__ 存在)
 *
 * @param {WebSocket} ws
 * @param {number} timeout - ms, 默认 15000
 * @returns {Promise<{ok:boolean, probe?:object}>}
 */
async function waitForAppReady(ws, timeout = 15000) {
  const start = Date.now();
  let lastProbe = null;
  while (Date.now() - start < timeout) {
    try {
      const probe = await probeTauriGlobals(ws);
      const probeObj = JSON.parse(probe);
      lastProbe = probeObj;
      const tauriReady = probeObj.hasTauriInternals === 'object';
      const vueMounted = await evaluate(ws, `(() => {
        const app = document.querySelector('#app');
        return !!(app && app.__vue_app__);
      })()`);
      if (tauriReady && vueMounted) {
        return { ok: true, probe: probeObj };
      }
    } catch { /* ignore transient errors during startup */ }
    await sleep(500);
  }
  return { ok: false, probe: lastProbe };
}

/**
 * Start markrust.exe with WebView2 CDP debugging enabled.
 */
export async function startApp() {
  if (!existsSync(EXE_PATH)) {
    throw new Error(`markrust.exe not found at: ${EXE_PATH}\nBuild with: cargo build --release --features embed-frontend`);
  }
  const child = spawn(EXE_PATH, [], {
    detached: true,
    stdio: 'ignore',
    env: {
      ...process.env,
      WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS: `--remote-debugging-port=${CDP_PORT}`,
    },
  });
  child.unref();
  console.log(`[setup] Started markrust.exe (PID ${child.pid}).`);
}

/**
 * Kill all markrust.exe processes.
 */
export async function killApp() {
  try {
    // Use taskkill /F /IM on Windows
    const { execSync } = await import('child_process');
    execSync('taskkill /F /IM markrust.exe 2>nul', { stdio: 'ignore' });
    console.log('[setup] Killed markrust.exe.');
  } catch {
    // Process may not exist; ignore
  }
}

/**
 * Wait for CDP endpoint to become available and return connected WebSocket.
 * @param {number} timeout - Max wait in ms
 */
async function waitForCdp(timeout) {
  const start = Date.now();
  let lastErr;
  while (Date.now() - start < timeout) {
    try {
      const ws = await connectCdp();
      return ws;
    } catch (e) {
      lastErr = e;
      await sleep(500);
    }
  }
  throw new Error(`CDP connection timeout after ${timeout}ms: ${lastErr?.message || lastErr}`);
}

// ─── Store Access ───────────────────────────────────────────────

/**
 * Get a Pinia store's $state by store id.
 * Uses safe JSON stringify to handle Vue reactive circular references.
 * @param {WebSocket} ws
 * @param {string} storeId - e.g. 'editor', 'project', 'layout', 'preference'
 */
export async function getStore(ws, storeId) {
  const result = await evaluate(ws, `(() => {
    const app = document.querySelector('#app');
    if (!app || !app.__vue_app__) return null;
    const pinia = app.__vue_app__.config.globalProperties.$pinia;
    if (!pinia || !pinia._s) return null;
    const store = Array.from(pinia._s.values()).find(s => s.$id === '${storeId}');
    if (!store) return null;
    // Pinia setup store 不会把 ref 放入 $state，所以直接读 store 实例属性。
    // 但要排除 $/_ 开头的内部键（$id/$onAction 等）和函数。
    const stateObj = {};
    for (const k of Object.keys(store)) {
      if (k.startsWith('$') || k.startsWith('_')) continue;
      const v = store[k];
      if (typeof v === 'function') continue;
      stateObj[k] = v;
    }
    // Safe stringify: 处理 Vue reactive proxy 的循环引用
    const seen = new WeakSet();
    const replacer = (key, value) => {
      if (typeof value === 'object' && value !== null) {
        if (seen.has(value)) return '[Circular]';
        seen.add(value);
      }
      return value;
    };
    return JSON.stringify(stateObj, replacer, 0);
  })()`);
  return result ? JSON.parse(result) : null;
}

/**
 * Get list of all Pinia store ids.
 */
export async function listStores(ws) {
  const result = await evaluate(ws, `(() => {
    const app = document.querySelector('#app');
    if (!app || !app.__vue_app__) return '[]';
    const pinia = app.__vue_app__.config.globalProperties.$pinia;
    if (!pinia || !pinia._s) return '[]';
    return JSON.stringify(Array.from(pinia._s.keys()));
  })()`);
  return JSON.parse(result || '[]');
}

/**
 * Get current file info from editor store.
 */
export async function getCurrentFile(ws) {
  const state = await getStore(ws, 'editor');
  if (!state) return null;
  return state.currentFile || null;
}

/**
 * Call a Pinia store action by name with arguments.
 * Action name is validated to contain only alphanumeric/underscore chars.
 * @param {WebSocket} ws
 * @param {string} storeId - e.g. 'editor', 'project', 'layout'
 * @param {string} actionName - e.g. 'OPEN_PROJECT', 'NEW_UNTITLED_TAB'
 * @param  {...any} args - arguments to pass to the action
 * @returns {Promise<{ok:boolean, value?:any, error?:string}>}
 */
export async function invokeStoreAction(ws, storeId, actionName, ...args) {
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(actionName)) {
    return { ok: false, error: `Invalid action name: ${actionName}` };
  }
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(storeId)) {
    return { ok: false, error: `Invalid store id: ${storeId}` };
  }
  const argsStr = args.map(a => JSON.stringify(a)).join(',');
  const result = await evaluate(ws, `(async () => {
    const app = document.querySelector('#app');
    if (!app || !app.__vue_app__) return { ok: false, error: 'Vue app not mounted' };
    const pinia = app.__vue_app__.config.globalProperties.$pinia;
    if (!pinia || !pinia._s) return { ok: false, error: 'Pinia not available' };
    const store = Array.from(pinia._s.values()).find(s => s.$id === '${storeId}');
    if (!store) return { ok: false, error: 'store not found: ${storeId}' };
    const fn = store['${actionName}'];
    if (typeof fn !== 'function') return { ok: false, error: 'action not found: ${actionName}' };
    try {
      const r = await fn.call(store, ${argsStr});
      return { ok: true, value: r === undefined ? null : r };
    } catch(e) {
      return { ok: false, error: String(e && e.message || e) };
    }
  })()`);
  return result;
}

/**
 * Send an IPC message via the electron.ipcRenderer shim (tauri-bridge).
 * This exercises the real bridge→invoke→store listener chain.
 * @param {WebSocket} ws
 * @param {string} channel - e.g. 'mt::open-file', 'mt::cmd-open-folder'
 * @param  {...any} args - arguments to send
 */
export async function sendIpc(ws, channel, ...args) {
  const argsStr = args.map(a => JSON.stringify(a)).join(',');
  const result = await evaluate(ws, `(async () => {
    if (!window.electron || !window.electron.ipcRenderer || typeof window.electron.ipcRenderer.send !== 'function') {
      return { ok: false, error: 'window.electron.ipcRenderer not available' };
    }
    try {
      window.electron.ipcRenderer.send(${JSON.stringify(channel)}, ${argsStr});
      return { ok: true };
    } catch(e) {
      return { ok: false, error: String(e && e.message || e) };
    }
  })()`);
  return result;
}

// ─── DOM/UI Interaction ─────────────────────────────────────────

/**
 * Get bounding rect of an element (center coordinates for clicking).
 * @returns {Promise<{x:number,y:number,width:number,height:number}|null>}
 */
export async function getElementRect(ws, selector) {
  const result = await evaluate(ws, `(() => {
    const el = document.querySelector(${JSON.stringify(selector)});
    if (!el) return null;
    const r = el.getBoundingClientRect();
    return JSON.stringify({ x: r.x, y: r.y, width: r.width, height: r.height,
      cx: r.x + r.width / 2, cy: r.y + r.height / 2 });
  })()`);
  return result ? JSON.parse(result) : null;
}

/**
 * Click at absolute viewport coordinates.
 */
export async function clickAt(ws, x, y, button = 'left') {
  await cdp(ws, 'Input.dispatchMouseEvent', {
    type: 'mouseMoved', x, y
  });
  await cdp(ws, 'Input.dispatchMouseEvent', {
    type: 'mousePressed', x, y, button, clickCount: 1
  });
  await cdp(ws, 'Input.dispatchMouseEvent', {
    type: 'mouseReleased', x, y, button, clickCount: 1
  });
  await sleep(150);
}

/**
 * Click center of an element matching selector.
 */
export async function clickElement(ws, selector) {
  const rect = await getElementRect(ws, selector);
  if (!rect) throw new Error(`clickElement: element not found: ${selector}`);
  await clickAt(ws, rect.cx, rect.cy);
}

/**
 * Right-click at coordinates.
 */
export async function rightClickAt(ws, x, y) {
  await cdp(ws, 'Input.dispatchMouseEvent', {
    type: 'mouseMoved', x, y
  });
  await cdp(ws, 'Input.dispatchMouseEvent', {
    type: 'mousePressed', x, y, button: 'right', clickCount: 1
  });
  await cdp(ws, 'Input.dispatchMouseEvent', {
    type: 'mouseReleased', x, y, button: 'right', clickCount: 1
  });
  await sleep(200);
}

/**
 * Right-click center of an element.
 */
export async function rightClickElement(ws, selector) {
  const rect = await getElementRect(ws, selector);
  if (!rect) throw new Error(`rightClickElement: element not found: ${selector}`);
  await rightClickAt(ws, rect.cx, rect.cy);
}

/**
 * Press a single key with optional modifiers.
 * @param {WebSocket} ws
 * @param {string} key - e.g. 's', 'Enter', 'Escape', 'F5'
 * @param {string[]} modifiers - ['ctrl', 'shift', 'alt', 'meta']
 */
export async function pressKey(ws, key, modifiers = []) {
  let modBits = 0;
  if (modifiers.includes('ctrl')) modBits |= 2;
  if (modifiers.includes('shift')) modBits |= 1;
  if (modifiers.includes('alt')) modBits |= 4;
  if (modifiers.includes('meta')) modBits |= 8;

  // Determine code and virtual key
  const code = key.length === 1 ? 'Key' + key.toUpperCase() : key;
  let vkc = 0;
  if (key.length === 1) {
    vkc = key.toUpperCase().charCodeAt(0);
  } else {
    const map = { 'Enter': 13, 'Escape': 27, 'Backspace': 8, 'Tab': 9, 'F5': 116,
      'ArrowLeft': 37, 'ArrowRight': 39, 'ArrowUp': 38, 'ArrowDown': 40,
      'Delete': 46, 'Home': 36, 'End': 35 };
    vkc = map[key] || 0;
  }

  const commonParams = {
    key, code,
    windowsVirtualKeyCode: vkc,
    modifiers: modBits,
  };

  // keyDown
  await cdp(ws, 'Input.dispatchKeyEvent', {
    type: 'rawKeyDown', ...commonParams
  });
  // keyUp
  await cdp(ws, 'Input.dispatchKeyEvent', {
    type: 'keyUp', ...commonParams
  });
  await sleep(120);
}

/**
 * Type a string of text (inserts characters one by one).
 * Use for input fields; for editor content use insertText via CDP.
 */
export async function typeText(ws, text) {
  for (const ch of text) {
    await cdp(ws, 'Input.dispatchKeyEvent', {
      type: 'char',
      text: ch,
      key: ch,
    });
  }
  await sleep(100);
}

/**
 * Insert text at current cursor position via Input.insertText (more reliable than typing).
 */
export async function insertText(ws, text) {
  await cdp(ws, 'Input.insertText', { text });
  await sleep(150);
}

/**
 * Take a screenshot and save to .screenshots/.
 * @param {string} name - filename without extension
 * @returns {Promise<string>} saved file path
 */
export async function screenshot(ws, name) {
  const result = await cdp(ws, 'Page.captureScreenshot', { format: 'png' });
  const filepath = join(SCREENSHOT_DIR, `${name}.png`);
  writeFileSync(filepath, Buffer.from(result.data, 'base64'));
  return filepath;
}

// ─── Wait Helpers ───────────────────────────────────────────────

/**
 * Wait until an element matching selector exists in DOM.
 * @param {WebSocket} ws
 * @param {string} selector
 * @param {number} timeout - ms, default 10000
 * @param {number} interval - ms, default 300
 */
export async function waitForElement(ws, selector, timeout = 10000, interval = 300) {
  const start = Date.now();
  while (Date.now() - start < timeout) {
    const exists = await evaluate(ws, `!!document.querySelector(${JSON.stringify(selector)})`);
    if (exists) return true;
    await sleep(interval);
  }
  return false;
}

/**
 * Wait until a JS expression evaluates truthy.
 * @param {WebSocket} ws
 * @param {string} expr - JS expression string
 * @param {number} timeout
 * @param {number} interval
 */
export async function waitForCondition(ws, expr, timeout = 10000, interval = 300) {
  const start = Date.now();
  while (Date.now() - start < timeout) {
    try {
      const result = await evaluate(ws, `(${expr})`);
      if (result) return true;
    } catch { /* ignore evaluation errors during wait */ }
    await sleep(interval);
  }
  return false;
}

/**
 * Wait until currentFile is set in editor store.
 */
export async function waitForCurrentFile(ws, timeout = 8000) {
  return waitForCondition(ws,
    `(() => { const a=document.querySelector('#app'); if(!a||!a.__vue_app__) return false;
       const p=a.__vue_app__.config.globalProperties.$pinia; if(!p||!p._s) return false;
       const s=Array.from(p._s.values()).find(x=>x.$id==='editor'); if(!s) return false;
       return !!(s.currentFile && s.currentFile.pathname); })()`,
    timeout);
}

/**
 * 确保项目树根目录处于展开状态。
 *
 * 单跑 T00x 时，OPEN_PROJECT 后项目树根目录可能处于折叠状态——
 * 此时 .tree-wrapper display:none，所有 .side-bar-file 的 getBoundingClientRect()
 * 都是 (0,0,0,0)，clickAt 会点到左上角而非目标文件。
 *
 * 必须在 click 文件项之前调用此 helper，确保根目录展开且 .side-bar-file 可见。
 *
 * @param {WebSocket} ws
 * @returns {Promise<{already:boolean, expanded:boolean}>}
 *   - already=true: 调用前就已展开
 *   - expanded=true: 调用后展开成功（或者 already=true 时此字段为 true）
 */
export async function ensureProjectTreeExpanded(ws) {
  // 检查是否已展开
  const stateRaw = await evaluate(ws, `(() => {
    const tw = document.querySelector('.project-tree .tree-wrapper');
    if (tw && getComputedStyle(tw).display !== 'none' &&
        tw.querySelectorAll('.side-bar-file').length > 0) {
      return JSON.stringify({ already: true });
    }
    // 找折叠箭头
    const i = document.querySelector('.project-tree .icon-arrow.fold, .project-tree .icon-arrow');
    if (!i) return JSON.stringify({ already: false, found: false });
    const r = i.getBoundingClientRect();
    return JSON.stringify({ already: false, found: true, x: r.x + r.width/2, y: r.y + r.height/2, cls: i.className });
  })()`);
  const state = JSON.parse(stateRaw);

  if (state.already) return { already: true, expanded: true };
  if (!state.found) return { already: false, expanded: false };

  // click 折叠箭头展开
  await cdp(ws, 'Input.dispatchMouseEvent', { type: 'mouseMoved', x: state.x, y: state.y });
  await cdp(ws, 'Input.dispatchMouseEvent', { type: 'mousePressed', x: state.x, y: state.y, button: 'left', clickCount: 1 });
  await cdp(ws, 'Input.dispatchMouseEvent', { type: 'mouseReleased', x: state.x, y: state.y, button: 'left', clickCount: 1 });

  // 等展开完成
  const ok = await waitForCondition(ws,
    `(() => { const tw = document.querySelector('.project-tree .tree-wrapper');
       return !!(tw && getComputedStyle(tw).display !== 'none' &&
                 tw.querySelectorAll('.side-bar-file').length > 0); })()`,
    5000);
  await sleep(300);
  return { already: false, expanded: ok };
}

// ─── File Helpers ───────────────────────────────────────────────

/**
 * Create a test markdown file under .test-data/.
 * @param {string} name - filename (e.g. 'test1.md')
 * @param {string} content
 * @returns {string} absolute path
 */
export function createTestFile(name, content) {
  const filepath = join(TEST_DATA_DIR, name);
  writeFileSync(filepath, content, 'utf-8');
  return filepath;
}

/**
 * Read a test file's contents.
 */
export function readTestFile(name) {
  const filepath = join(TEST_DATA_DIR, name);
  return readFileSync(filepath, 'utf-8');
}

/**
 * Delete a test file (ignore errors).
 */
export function deleteTestFile(name) {
  const filepath = join(TEST_DATA_DIR, name);
  try { unlinkSync(filepath); } catch { /* ignore */ }
}

/**
 * Read any file by absolute path.
 */
export function readFileAbs(absPath) {
  return readFileSync(absPath, 'utf-8');
}

// ─── Assertion & Test Context ───────────────────────────────────

/**
 * Create a test context object that collects results and provides asserts.
 * Each test file receives a ctx and records PASS/FAIL/SKIP outcomes.
 */
export function createCtx(testId, testName, priority) {
  return {
    testId,
    testName,
    priority,
    startTime: Date.now(),
    steps: [],
    status: null,
    error: null,

    /** Record a passing step. */
    pass(message) {
      this.steps.push({ status: 'PASS', message });
    },

    /** Record a failing step (marks whole test as FAIL). */
    fail(message, detail = '') {
      this.steps.push({ status: 'FAIL', message, detail });
      if (this.status !== 'ERROR') this.status = 'FAIL';
    },

    /** Record a skipped step (marks whole test as SKIP if no prior FAIL). */
    skip(message) {
      this.steps.push({ status: 'SKIP', message });
      if (this.status === null) this.status = 'SKIP';
    },

    /** Record an error (marks whole test as ERROR). */
    error_msg(message, detail = '') {
      this.steps.push({ status: 'ERROR', message, detail });
      this.status = 'ERROR';
    },

    /** Assert a condition; on failure marks test FAIL and returns false. */
    assert(condition, message) {
      if (condition) {
        this.pass(message);
        return true;
      }
      this.fail(message);
      return false;
    },

    /** Assert two values are deeply equal (JSON compare). */
    assertEqual(actual, expected, message) {
      const a = JSON.stringify(actual);
      const e = JSON.stringify(expected);
      if (a === e) {
        this.pass(message);
        return true;
      }
      this.fail(`${message} (expected ${e}, got ${a})`);
      return false;
    },

    /** Assert value is truthy. */
    assertTruthy(value, message) {
      return this.assert(!!value, message);
    },

    /** Assert value is falsy. */
    assertFalsy(value, message) {
      return this.assert(!value, message);
    },

    /** Mark test as complete (sets status to PASS if no failures). */
    done() {
      if (this.status === null) this.status = 'PASS';
      this.duration = Date.now() - this.startTime;
      return this;
    },
  };
}

// ─── Report Formatting ──────────────────────────────────────────

/**
 * Format test results into a markdown report.
 * @param {Array} results - array of ctx.done() results
 */
export function formatReport(results) {
  const total = results.length;
  const passed = results.filter(r => r.status === 'PASS').length;
  const failed = results.filter(r => r.status === 'FAIL').length;
  const errors = results.filter(r => r.status === 'ERROR').length;
  const skipped = results.filter(r => r.status === 'SKIP').length;

  let md = `# MarkRust E2E 测试报告\n\n`;
  md += `> 生成时间：${new Date().toISOString()}\n`;
  md += `> 测试总数：${total} | 通过：${passed} | 失败：${failed} | 错误：${errors} | 跳过：${skipped}\n\n`;

  // Summary table
  md += `## 概览\n\n`;
  md += `| 用例 ID | 名称 | 优先级 | 状态 | 耗时(ms) |\n`;
  md += `|---------|------|--------|------|----------|\n`;
  for (const r of results) {
    const emoji = r.status === 'PASS' ? '✅' : r.status === 'FAIL' ? '❌' :
                  r.status === 'ERROR' ? '💥' : '⏭️';
    md += `| ${r.testId} | ${r.testName} | ${r.priority} | ${emoji} ${r.status} | ${r.duration || 0} |\n`;
  }

  // Details for failures
  const failures = results.filter(r => r.status !== 'PASS' && r.steps.some(s => s.status !== 'PASS'));
  if (failures.length > 0) {
    md += `\n## 失败详情\n\n`;
    for (const r of failures) {
      md += `### ${r.testId} ${r.testName} [${r.priority}] — ${r.status}\n\n`;
      for (const step of r.steps) {
        const icon = step.status === 'PASS' ? '✅' : step.status === 'FAIL' ? '❌' :
                     step.status === 'ERROR' ? '💥' : '⏭️';
        md += `- ${icon} ${step.message}`;
        if (step.detail) md += `  \n  \`${step.detail}\``;
        md += `\n`;
      }
      md += `\n`;
    }
  }

  md += `\n---\n*报告结束*\n`;
  return md;
}

// ─── Re-exports for convenience ─────────────────────────────────

export {
  connectCdp, cdp, evaluate, tauriInvoke, probeTauriGlobals, sleep,
  getPageTarget
};
