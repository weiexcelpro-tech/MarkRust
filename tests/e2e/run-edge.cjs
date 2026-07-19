const { chromium } = require('@playwright/test')
const { writeFileSync, mkdirSync } = require('fs')
const { join } = require('path')

const SCREENSHOT_DIR = join(__dirname, 'screenshots')
mkdirSync(SCREENSHOT_DIR, { recursive: true })

const MOCK_RESPONSES = {
  'fs_is_file': false, 'fs_is_directory': true, 'fs_path_exists': false,
  'fs_read_file': '# Welcome\n\nTest.\n', 'fs_readdir': [],
  'fs_stat': { size: 100, isFile: true, isDirectory: false, isSymbolicLink: false, mtime: 0, atime: 0, birthtime: 0 },
  'preferences_get_all': { theme: 'light', autoSave: false, sideBarVisibility: true, tabBarVisibility: false, titleBarStyle: 'custom', endOfLine: 'lf', sourceCodeModeEnabled: false, focusMode: false, typewriterMode: false, language: 'en' },
  'preferences_set': true, 'boot_info_async': { versions: { rust: '1.92', tauri: '2' } },
  'cmd_exists': false, 'fonts_list': [], 'i18n_supported': ['en','zh'], 'i18n_is_supported': true,
  'win_is_fullscreen': false, 'window_is_maximized': false,
  'spellchecker_get_available_dictionaries': ['en-US'], 'spellchecker_set_enabled': true,
  'spellchecker_get_custom_dictionary_words': [], 'updater_check_latest': { has_update: false },
}

async function run() {
  const results = { passed: 0, failed: 0, details: [] }
  let browser, page

  try {
    browser = await chromium.launch({ channel: 'msedge', headless: false })
    const context = await browser.newContext({ viewport: { width: 1280, height: 800 } })
    page = await context.newPage()

    await page.addInitScript((responses) => {
      const map = responses
      const listeners = new Map()
      window.__TAURI_INTERNALS__ = {
        invoke: (cmd) => {
          const r = map[cmd]
          return Promise.resolve(r !== undefined ? JSON.parse(JSON.stringify(r)) : null)
        },
        metadata: { currentWindow: { label: 'main' }, currentWebview: { windowLabel: 'main', label: 'main' } },
      }
      window.__TAURI__ = {
        event: {
          listen: (event, opts, cb) => {
            if (!listeners.has(event)) listeners.set(event, new Set())
            if (cb) listeners.get(event).add(cb)
            return Promise.resolve(() => {})
          },
          emit: (event, payload) => {
            listeners.get(event)?.forEach((cb) => cb(payload))
            return Promise.resolve()
          },
        },
      }
    }, MOCK_RESPONSES)

    const errors = []
    page.on('pageerror', (err) => errors.push(err.message))

    await page.goto('http://localhost:1420/', { waitUntil: 'domcontentloaded', timeout: 15000 })
    await page.waitForTimeout(5000)

    // Test 1: 非白屏
    const appHTML = await page.evaluate(() => document.getElementById('app')?.innerHTML.length ?? 0)
    const t1 = appHTML > 100
    results.details.push(`非白屏 (app HTML ${appHTML} chars): ${t1 ? 'PASS' : 'FAIL'}`)
    t1 ? results.passed++ : results.failed++

    // Test 2: sidebar
    const sidebarVisible = await page.evaluate(() => {
      const el = document.querySelector('.side-bar, [class*="side-bar"], [class*="sidebar"]')
      return el ? window.getComputedStyle(el).display !== 'none' : false
    })
    results.details.push(`sidebar 可见: ${sidebarVisible ? 'PASS' : 'FAIL'}`)
    sidebarVisible ? results.passed++ : results.failed++

    // Test 3: 编辑器区域
    const editorVisible = await page.evaluate(() => {
      const el = document.querySelector('[contenteditable], .ag-editor, .mu-editor, #ag-editor, [class*="editor"]')
      return el ? window.getComputedStyle(el).display !== 'none' : false
    })
    results.details.push(`编辑器存在: ${editorVisible ? 'PASS' : 'FAIL'}`)
    editorVisible ? results.passed++ : results.failed++

    // Test 4: title bar
    const titleBarVisible = await page.evaluate(() => {
      const el = document.querySelector('.title-bar, [class*="title-bar"], .left-bar, .right-bar')
      return el ? true : false
    })
    results.details.push(`title bar 存在: ${titleBarVisible ? 'PASS' : 'FAIL'}`)
    titleBarVisible ? results.passed++ : results.failed++

    // Test 5: 编辑器可输入
    let canType = false
    try {
      const editor = await page.$('[contenteditable], .ag-editor, .mu-editor')
      if (editor) {
        await editor.click({ timeout: 2000 })
        await page.keyboard.type('E2E Test Input')
        await page.waitForTimeout(500)
        const bodyText = await page.evaluate(() => document.body.innerText)
        canType = bodyText.includes('E2E')
      }
    } catch {}
    results.details.push(`编辑器可输入: ${canType ? 'PASS' : 'FAIL'}`)
    canType ? results.passed++ : results.failed++

    // Test 6: Ctrl+Z 撤销
    let canUndo = false
    try {
      await page.keyboard.press('Control+z')
      await page.waitForTimeout(500)
      const bodyText2 = await page.evaluate(() => document.body.innerText)
      canUndo = !bodyText2.includes('E2E Test Input')
    } catch {}
    results.details.push(`Ctrl+Z 撤销: ${canUndo ? 'PASS' : 'FAIL'}`)
    canUndo ? results.passed++ : results.failed++

    // Test 7: 致命错误检查
    const fatal = errors.filter((e) =>
      !e.includes('ElementPlusError') && !e.includes('prism-') &&
      !e.includes('Unknown variable dynamic import') && !e.includes('intlify')
    )
    results.details.push(`无致命 JS 错误 (${fatal.length} fatal): ${fatal.length === 0 ? 'PASS' : 'FAIL'}`)
    fatal.length === 0 ? results.passed++ : results.failed++
    if (fatal.length > 0) results.details.push('  错误: ' + fatal.slice(0, 3).join('; '))

    await page.screenshot({ path: join(SCREENSHOT_DIR, 'e2e-final.png') })
  } catch (err) {
    results.failed++
    results.details.push(`异常: ${err.message}`)
    if (page) await page.screenshot({ path: join(SCREENSHOT_DIR, 'e2e-error.png') }).catch(() => {})
  } finally {
    if (browser) await browser.close().catch(() => {})
  }

  console.log('\n=== E2E 测试结果 ===')
  for (const d of results.details) console.log(d)
  console.log(`\n总计: ${results.passed} passed, ${results.failed} failed`)
  process.exit(results.failed > 0 ? 1 : 0)
}

run()
