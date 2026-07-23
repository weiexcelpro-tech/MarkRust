#!/usr/bin/env node
// E2E 测试：源码模式下 Ctrl+F / Ctrl+H 搜索替换栏是否可见
// 用法: 先启动 E2E_TEST=true npx vite，再 node tests/e2e/run-source-mode-search.cjs

const { chromium } = require('@playwright/test');

const BASE = 'http://localhost:1420';

const results = [];
function check(name, cond) {
  const ok = !!cond;
  results.push({ name, ok });
  console.log(`${ok ? 'PASS' : 'FAIL'}: ${name}`);
}

async function main() {
  const browser = await chromium.launch({ channel: 'msedge', headless: true });
  const ctx = await browser.newContext();
  const page = await ctx.newPage();

  // Tauri IPC mock
  await page.addInitScript(() => {
    window.__TAURI_INTERNALS__ = {
      invoke: async (cmd, args) => {
        if (cmd === 'preferences_get_all') {
          return { autoSave: false, theme: 'light', fontSize: 16, codeFontSize: 14,
                   sourceCode: false, typewriterMode: false, focusMode: false,
                   showSideBar: true, showTabBar: true, titleBarStyle: 'custom' };
        }
        if (cmd === 'preferences_set') return null;
        if (cmd === 'boot_info_async') return { rust: '1.92', tauri: '2' };
        return null;
      },
      currentWindow: { label: 'main' },
      metadata: { currentWindow: { label: 'main' } },
    };
    const listeners = new Map();
    window.__TAURI_INTERNALS__.listeners = listeners;
    window.__TAURI_INTERNALS__.transformCallback = (cb) => Math.random().toString(36);
  });

  await page.goto(BASE, { waitUntil: 'networkidle', timeout: 30000 });
  await page.waitForTimeout(3000);

  // ── Test 1: 预览模式 Ctrl+F 搜索栏可见 ──
  {
    // Click editor area first to ensure focus
    const editorEl = await page.$('.ag-editor, #ag-editor, .editor-component');
    if (editorEl) await editorEl.click();
    await page.waitForTimeout(300);

    await page.keyboard.press('Control+f');
    await page.waitForTimeout(500);

    const searchBarVisible = await page.evaluate(() => {
      const bar = document.querySelector('.search-bar');
      if (!bar) return false;
      const rect = bar.getBoundingClientRect();
      // Must be visible (v-show) and have positive dimensions
      return rect.width > 0 && rect.height > 0 && getComputedStyle(bar).display !== 'none';
    });
    check('预览模式 Ctrl+F → 搜索栏可见', searchBarVisible);

    // Close search bar
    await page.keyboard.press('Escape');
    await page.waitForTimeout(300);
  }

  // ── Test 2: 源码模式 Ctrl+F 搜索栏可见 ──
  {
    // Switch to source code mode via preferences store
    await page.evaluate(() => {
      // Access Pinia store to switch mode
      const app = document.querySelector('#app').__vue_app__;
      if (app && app.config && app.config.globalProperties) {
        const pinia = app.config.globalProperties.$pinia;
        if (pinia) {
          const prefsStore = pinia._s.get('preferences');
          if (prefsStore) {
            prefsStore.sourceCode = true;
          }
        }
      }
    });
    await page.waitForTimeout(1000);

    // Verify source code mode is active
    const sourceCodeActive = await page.evaluate(() => {
      return document.querySelector('.source-code') !== null;
    });
    check('源码模式已激活', sourceCodeActive);

    // Click on source code area to ensure focus
    const sourceCodeEl = await page.$('.source-code');
    if (sourceCodeEl) await sourceCodeEl.click();
    await page.waitForTimeout(300);

    // Press Ctrl+F
    await page.keyboard.press('Control+f');
    await page.waitForTimeout(500);

    const searchBarVisibleInSourceMode = await page.evaluate(() => {
      const bar = document.querySelector('.search-bar');
      if (!bar) return { visible: false, reason: 'element not found' };
      const style = getComputedStyle(bar);
      const rect = bar.getBoundingClientRect();
      return {
        visible: style.display !== 'none' && rect.width > 0 && rect.height > 0,
        display: style.display,
        width: rect.width,
        height: rect.height,
        zIndex: style.zIndex,
        position: style.position,
        parentInfo: bar.parentElement ? {
          class: bar.parentElement.className,
          zIndex: getComputedStyle(bar.parentElement).zIndex,
          position: getComputedStyle(bar.parentElement).position,
        } : null
      };
    });

    if (typeof searchBarVisibleInSourceMode === 'object' && 'visible' in searchBarVisibleInSourceMode) {
      check('源码模式 Ctrl+F → 搜索栏可见', searchBarVisibleInSourceMode.visible);
      if (!searchBarVisibleInSourceMode.visible) {
        console.log('  Debug info:', JSON.stringify(searchBarVisibleInSourceMode, null, 2));
      }
    } else {
      check('源码模式 Ctrl+F → 搜索栏可见', false);
    }

    // Close search bar
    await page.keyboard.press('Escape');
    await page.waitForTimeout(300);
  }

  // ── Test 3: 源码模式 Ctrl+H 替换栏可见 ──
  {
    await page.keyboard.press('Control+h');
    await page.waitForTimeout(500);

    const replaceBarVisible = await page.evaluate(() => {
      const bar = document.querySelector('.search-bar');
      if (!bar) return { visible: false, reason: 'element not found' };
      const style = getComputedStyle(bar);
      const rect = bar.getBoundingClientRect();
      // Check if replace section is visible
      const replaceSection = bar.querySelector('.replace');
      const replaceVisible = replaceSection ? getComputedStyle(replaceSection).display !== 'none' : false;
      return {
        visible: style.display !== 'none' && rect.width > 0 && rect.height > 0,
        replaceVisible,
        display: style.display,
      };
    });

    if (typeof replaceBarVisible === 'object' && 'visible' in replaceBarVisible) {
      check('源码模式 Ctrl+H → 替换栏可见', replaceBarVisible.visible);
      if (!replaceBarVisible.visible) {
        console.log('  Debug info:', JSON.stringify(replaceBarVisible, null, 2));
      }
    } else {
      check('源码模式 Ctrl+H → 替换栏可见', false);
    }
  }

  // ── Test 4: 搜索栏不在 z-index:-1 上下文中 ──
  {
    const stackingContext = await page.evaluate(() => {
      const bar = document.querySelector('.search-bar');
      if (!bar) return { ok: false, reason: 'no search bar' };

      // Walk up from search-bar and check if any ancestor has z-index < 0
      let el = bar.parentElement;
      const ancestors = [];
      while (el) {
        const style = getComputedStyle(el);
        const zi = style.zIndex;
        if (zi !== 'auto' && parseInt(zi) < 0) {
          ancestors.push({ tag: el.tagName, class: el.className, zIndex: zi });
        }
        el = el.parentElement;
      }
      return { ok: ancestors.length === 0, negativeZAncestors: ancestors };
    });

    check('搜索栏不受 z-index:-1 影响', stackingContext.ok);
    if (!stackingContext.ok) {
      console.log('  Negative z-index ancestors:', JSON.stringify(stackingContext.negativeZAncestors, null, 2));
    }
  }

  // ── Test 5: 搜索栏可交互（输入框可聚焦） ──
  {
    // Re-open search bar
    await page.keyboard.press('Control+f');
    await page.waitForTimeout(500);

    const inputFocusable = await page.evaluate(() => {
      const input = document.querySelector('.search-bar input[type="text"]');
      if (!input) return { ok: false, reason: 'no input found' };
      input.focus();
      return { ok: document.activeElement === input, activeTag: document.activeElement?.tagName };
    });

    check('源码模式搜索栏输入框可聚焦', inputFocusable.ok);
    if (!inputFocusable.ok) {
      console.log('  Debug:', JSON.stringify(inputFocusable, null, 2));
    }
  }

  // ── Results ──
  console.log('\n' + '='.repeat(60));
  const passed = results.filter((r) => r.ok).length;
  const failed = results.length - passed;
  console.log(`Results: ${passed}/${results.length} passed${failed ? `, ${failed} FAILED` : ''}`);

  await browser.close();
  process.exit(failed > 0 ? 1 : 0);
}

main().catch((err) => {
  console.error('Fatal:', err);
  process.exit(1);
});
