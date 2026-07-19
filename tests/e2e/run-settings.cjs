#!/usr/bin/env node
// E2E 测试：sidebar 设置 tab 渲染 + 偏好读写
// 用法: 先启动 E2E_TEST=true npx vite，再 node tests/e2e/run-settings.cjs

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

  // Mock Tauri API（editor 窗口，不是 settings 窗口）
  await page.addInitScript(() => {
    const mockLog = [];
    window.__MOCK_LOG__ = mockLog;

    window.__TAURI_INTERNALS__ = {
      invoke: async (cmd, args) => {
        mockLog.push({ cmd, args: JSON.stringify(args) });
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

    // Mock Tauri event（简单 Map）
    const listeners = new Map();
    window.__TAURI_INTERNALS__.listeners = listeners;
    window.__TAURI_INTERNALS__.transformCallback = (cb) => {
      const id = Math.random().toString(36);
      return id;
    };
  });

  const consoleErrors = [];
  page.on('console', (msg) => {
    if (msg.type() === 'error') consoleErrors.push(msg.text());
  });

  await page.goto(BASE, { waitUntil: 'networkidle', timeout: 30000 });
  await page.waitForTimeout(3000);

  // ── 1: 编辑器正常渲染（非白屏）──
  const htmlLen = await page.evaluate(() => document.body.innerHTML.length);
  check('编辑器渲染正常 (HTML > 500)', htmlLen > 500);

  // ── 2: sidebar 存在 ──
  const hasSidebar = await page.evaluate(() =>
    document.querySelector('.side-bar') !== null
  );
  check('Sidebar 存在', hasSidebar);

  // ── 3: 点击齿轮图标 → rightColumn='settings' ──
  // 底部设置图标在 .left-column .bottom ul li
  const settingsIconClicked = await page.evaluate(() => {
    const bottomItems = document.querySelectorAll('.side-bar .left-column .bottom li');
    if (bottomItems.length === 0) return false;
    bottomItems[bottomItems.length - 1].click();
    return true;
  });
  check('点击设置齿轮图标', settingsIconClicked);
  await page.waitForTimeout(500);

  // ── 4: settings 组件渲染 ──
  const hasSettingsPanel = await page.evaluate(() =>
    document.querySelector('.sidebar-settings') !== null
  );
  check('Sidebar 设置面板已渲染', hasSettingsPanel);

  // ── 5: 设置面板包含标题 ──
  const hasHeader = await page.evaluate(() => {
    const el = document.querySelector('.sidebar-settings h3');
    return el ? el.textContent.includes('Settings') : false;
  });
  check('设置面板包含 Settings 标题', hasHeader);

  // ── 6: 设置项分组存在 ──
  const groupCount = await page.evaluate(() =>
    document.querySelectorAll('.sidebar-settings .setting-group').length
  );
  check('设置项分组 >= 2', groupCount >= 2);

  // ── 7: Theme 下拉选择器存在 ──
  const hasThemeSelect = await page.evaluate(() => {
    const labels = Array.from(document.querySelectorAll('.sidebar-settings label'));
    return labels.some(l => l.textContent === 'Theme');
  });
  check('Theme 设置项存在', hasThemeSelect);

  // ── 8: 修改 Theme → preferences_set 被调用 ──
  await page.evaluate(() => {
    const selects = document.querySelectorAll('.sidebar-settings select');
    if (selects.length > 0) {
      const themeSelect = selects[0];
      themeSelect.value = 'dark';
      themeSelect.dispatchEvent(new Event('change', { bubbles: true }));
    }
  });
  await page.waitForTimeout(500);
  const mockLog = await page.evaluate(() => window.__MOCK_LOG__ || []);
  const prefSetCall = mockLog.find(l => l.cmd === 'preferences_set');
  check('修改 Theme 触发 preferences_set', !!prefSetCall);

  // ── 9: Auto Save 复选框切换 ──
  const checkboxToggled = await page.evaluate(() => {
    const checkboxes = document.querySelectorAll('.sidebar-settings input[type="checkbox"]');
    if (checkboxes.length === 0) return false;
    checkboxes[0].click();
    return true;
  });
  check('Auto Save 复选框可点击', checkboxToggled);
  await page.waitForTimeout(300);

  // ── 10: 不再调用 window_open_settings（sidebar 方案） ──
  const openSettingsCall = mockLog.find(l => l.cmd === 'window_open_settings');
  check('不调用 window_open_settings（sidebar 方案）', !openSettingsCall);

  // ── 11: 无致命 JS 错误 ──
  const fatalErrors = consoleErrors.filter(e =>
    !e.includes('title slot') && !e.includes('favicon') && !e.includes('intlify') &&
    !e.includes('404') && !e.includes('update-buffer-state')
  );
  check('无致命 JS 错误', fatalErrors.length === 0);
  if (fatalErrors.length > 0) {
    console.log('  致命错误:', fatalErrors.slice(0, 3));
  }

  await page.screenshot({ path: 'tests/e2e/screenshots/sidebar-settings.png', fullPage: true });

  await browser.close();

  const passed = results.filter(r => r.ok).length;
  console.log(`\n=== Sidebar 设置 E2E: ${passed}/${results.length} passed ===`);
  process.exit(passed === results.length ? 0 : 1);
}

main().catch(e => { console.error(e); process.exit(1); });
