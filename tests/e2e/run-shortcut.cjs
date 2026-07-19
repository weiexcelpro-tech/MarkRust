#!/usr/bin/env node
// E2E 测试：键盘快捷键 → menuBridge 分发
// 用法: 先启动 E2E_TEST=true npx vite，再 node tests/e2e/run-shortcut.cjs

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

  const consoleMessages = [];
  page.on('console', (msg) => {
    consoleMessages.push(msg.text());
  });

  await page.goto(BASE, { waitUntil: 'networkidle', timeout: 30000 });
  await page.waitForTimeout(3000);

  const htmlLen = await page.evaluate(() => document.body.innerHTML.length);
  check('编辑器渲染正常 (HTML > 500)', htmlLen > 500);

  const registered = consoleMessages.some((m) =>
    m.includes('[keyboardShortcut] registered')
  );
  check('keyboardShortcut 模块加载并注册', registered);

  const editorVisible = await page.evaluate(() => {
    const el = document.querySelector('.ag-editor') || document.querySelector('#ag-editor');
    return el !== null;
  });

  if (editorVisible) {
    await page.click('.ag-editor, #ag-editor');
  } else {
    await page.click('body');
  }
  await page.waitForTimeout(300);

  // ── Ctrl+S → file.save ──
  consoleMessages.length = 0;
  await page.keyboard.press('Control+s');
  await page.waitForTimeout(200);
  {
    const found = consoleMessages.some((m) =>
      m.includes('[keyboardShortcut] dispatch: Ctrl+S → file.save')
    );
    check('Ctrl+S → file.save 分发', found);
  }

  // ── Ctrl+B → strongMenuItem ──
  consoleMessages.length = 0;
  await page.keyboard.press('Control+b');
  await page.waitForTimeout(200);
  {
    const found = consoleMessages.some((m) =>
      m.includes('[keyboardShortcut] dispatch: Ctrl+B → strongMenuItem')
    );
    check('Ctrl+B → strongMenuItem 分发', found);
  }

  // ── Ctrl+O → file.open-file ──
  consoleMessages.length = 0;
  await page.keyboard.press('Control+o');
  await page.waitForTimeout(200);
  {
    const found = consoleMessages.some((m) =>
      m.includes('[keyboardShortcut] dispatch: Ctrl+O → file.open-file')
    );
    check('Ctrl+O → file.open-file 分发', found);
  }

  // ── Ctrl+Shift+P → view.command-palette ──
  consoleMessages.length = 0;
  await page.keyboard.press('Control+Shift+p');
  await page.waitForTimeout(200);
  {
    const found = consoleMessages.some((m) =>
      m.includes('[keyboardShortcut] dispatch: Ctrl+Shift+P → view.command-palette')
    );
    check('Ctrl+Shift+P → view.command-palette 分发', found);
  }

  // ── Ctrl+I → emphasisMenuItem ──
  consoleMessages.length = 0;
  await page.keyboard.press('Control+i');
  await page.waitForTimeout(200);
  {
    const found = consoleMessages.some((m) =>
      m.includes('[keyboardShortcut] dispatch: Ctrl+I → emphasisMenuItem')
    );
    check('Ctrl+I → emphasisMenuItem 分发', found);
  }

  // ── F3 → edit.find-next ──
  consoleMessages.length = 0;
  await page.keyboard.press('F3');
  await page.waitForTimeout(200);
  {
    const found = consoleMessages.some((m) =>
      m.includes('[keyboardShortcut] dispatch: F3 → edit.find-next')
    );
    check('F3 → edit.find-next 分发', found);
  }

  // ── 未知快捷键不分发 (Ctrl+X 不在映射表中) ──
  consoleMessages.length = 0;
  await page.keyboard.press('Control+x');
  await page.waitForTimeout(200);
  {
    const found = consoleMessages.some((m) => m.includes('[keyboardShortcut] dispatch'));
    check('Ctrl+X 不在映射表中 → 不分发', !found);
  }

  // ── Result ──
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
