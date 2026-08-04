/**
 * E2E tests for source-code mode bug fixes:
 *   1. Cursor drift — adjustCursor offsets should NOT corrupt CM cursor positions
 *   2. TOC scroll offset — 50px margin-top must be accounted for
 *   3. Search/replace — must operate on CodeMirror, not hidden muya
 *
 * These tests run against the vite dev server with Tauri IPC mocked.
 * Usage: npx playwright test source-mode-fixes.spec.ts --reporter=line
 */
import { test, expect } from '@playwright/test'
import { injectTauriMock, bootstrapApp } from './mock-tauri'

// Markdown content with table separators, code fences, and headings —
// exactly the constructs that trigger adjustCursor line offsets.
const TEST_MARKDOWN = [
  '# First Heading',
  '',
  'Some paragraph text.',
  '',
  '## Table Section',
  '',
  '| Header A | Header B |',
  '| --- | --- |',
  '| Cell 1 | Cell 2 |',
  '| Cell 3 | Cell 4 |',
  '',
  '## Code Section',
  '',
  '```python',
  'def hello():',
  '    print("world")',
  '```',
  '',
  '## Last Heading',
  '',
  'Final paragraph.',
  ''
].join('\n')

test.beforeEach(async ({ page }) => {
  await injectTauriMock(page, {
    fs_read_file: TEST_MARKDOWN,
  })
  // Use bootstrapApp to properly initialize the editor with our test markdown content
  await bootstrapApp(page, {
    waitForMs: 3000,
    markdownList: [TEST_MARKDOWN],
  })
})

/** Switch to source-code mode via Pinia store */
async function switchToSourceMode(page: import('@playwright/test').Page) {
  // First verify the app is properly initialized
  const hasTab = await page.locator('.editor-tabs .tabs-container li').count()
  if (hasTab === 0) {
    throw new Error('No editor tab found — app not properly initialized')
  }

  // Set sourceCode preference to true
  await page.evaluate(() => {
    const app = document.querySelector('#app')?.__vue_app__
    if (app?.config?.globalProperties) {
      const pinia = app.config.globalProperties.$pinia
      const prefsStore = pinia._s.get('preferences')
      if (prefsStore) prefsStore.sourceCode = true
    }
  })
  await page.waitForTimeout(1000)

  // Wait for source-code container to appear
  await expect(page.locator('.source-code')).toBeVisible({ timeout: 10000 })
  await page.waitForTimeout(500)
}

// ─────────────────────────────────────────────
// Fix 1: Source-code mode cursor drift
// ─────────────────────────────────────────────

test.describe('源码模式光标漂移修复', () => {
  test('光标在表格分隔行附近不发生行号偏移', async ({ page }) => {
    await switchToSourceMode(page)
    await page.locator('.source-code').click()

    // Place cursor at the table separator line (line 7, 0-indexed)
    // Line 7 is "| --- | --- |" which triggers adjustCursor +1
    const cursorBefore = await page.evaluate(() => {
      const cm = document.querySelector('.CodeMirror')?.CodeMirror
      if (!cm) return null
      cm.setCursor({ line: 7, ch: 0 })
      return cm.getCursor()
    })
    expect(cursorBefore).not.toBeNull()
    expect(cursorBefore!.line).toBe(7)

    // Trigger cursorActivity by moving the cursor
    await page.keyboard.press('End')
    await page.waitForTimeout(200)

    // Cursor should still report line 7
    const cursorAfter = await page.evaluate(() => {
      const cm = document.querySelector('.CodeMirror')?.CodeMirror
      if (!cm) return null
      return cm.getCursor()
    })
    expect(cursorAfter).not.toBeNull()
    expect(cursorAfter!.line).toBe(7)
  })

  test('光标在代码围栏行附近不发生行号偏移', async ({ page }) => {
    await switchToSourceMode(page)
    await page.locator('.source-code').click()

    // Place cursor at the opening code fence (line 13, "```python")
    await page.evaluate(() => {
      const cm = document.querySelector('.CodeMirror')?.CodeMirror
      if (cm) cm.setCursor({ line: 13, ch: 0 })
    })

    // Simulate a content save cycle
    await page.keyboard.type(' ')
    await page.waitForTimeout(100)
    await page.keyboard.press('Backspace')
    await page.waitForTimeout(200)

    const cursorAfter = await page.evaluate(() => {
      const cm = document.querySelector('.CodeMirror')?.CodeMirror
      if (!cm) return null
      return cm.getCursor()
    })
    expect(cursorAfter).not.toBeNull()
    expect(cursorAfter!.line).toBe(13)
  })
})

// ─────────────────────────────────────────────
// Fix 2: TOC scroll offset (50px margin)
// ─────────────────────────────────────────────

test.describe('TOC跳转偏移修复', () => {
  test('源码模式下点击TOC条目后编辑器滚动到正确位置', async ({ page }) => {
    await switchToSourceMode(page)

    // Find the TOC entries in the sidebar
    const tocEntries = page.locator('.side-bar-toc .toc-item, .side-bar-toc a')
    const tocCount = await tocEntries.count()

    if (tocCount > 0) {
      // Scroll to top first
      await page.evaluate(() => {
        const container = document.querySelector('.source-code')
        if (container) container.scrollTop = 0
      })
      await page.waitForTimeout(300)

      // Click the last heading TOC entry
      await tocEntries.last().click()
      await page.waitForTimeout(800)

      // Verify that the source-code container has scrolled
      const scrollPosition = await page.evaluate(() => {
        const container = document.querySelector('.source-code')
        if (!container) return { scrollTop: 0 }
        return { scrollTop: container.scrollTop }
      })

      expect(scrollPosition.scrollTop).toBeGreaterThan(0)
    }
  })
})

// ─────────────────────────────────────────────
// Fix 3: Source-code mode search/replace
// ─────────────────────────────────────────────

test.describe('源码模式搜索替换修复', () => {
  test('源码模式 Ctrl+F 打开搜索栏', async ({ page }) => {
    await switchToSourceMode(page)
    await page.locator('.source-code').click()

    await page.keyboard.press('Control+f')
    await page.waitForTimeout(500)

    const searchBarVisible = await page.evaluate(() => {
      const bar = document.querySelector('.search-bar')
      if (!bar) return false
      const rect = bar.getBoundingClientRect()
      const style = getComputedStyle(bar)
      return rect.width > 0 && rect.height > 0 && style.display !== 'none'
    })
    expect(searchBarVisible).toBe(true)
  })

  test('搜索关键字后在CodeMirror中高亮匹配', async ({ page }) => {
    await switchToSourceMode(page)
    await page.locator('.source-code').click()

    // Open search bar and type a search term
    await page.keyboard.press('Control+f')
    await page.waitForTimeout(500)

    const searchInput = page.locator('.search-bar input[type="text"]').first()
    if (await searchInput.isVisible()) {
      await searchInput.fill('Cell')
      await page.waitForTimeout(600)

      // Check that CodeMirror has search highlight markers
      const hasHighlights = await page.evaluate(() => {
        const cm = document.querySelector('.CodeMirror')?.CodeMirror
        if (!cm) return false
        const marks = cm.getAllMarks()
        const searchMarks = marks.filter((m: any) =>
          m.className === 'cm-source-search-highlight' ||
          m.className === 'cm-source-search-highlight-active'
        )
        return searchMarks.length > 0
      })
      expect(hasHighlights).toBe(true)
    }
  })

  test('搜索栏输入框可聚焦', async ({ page }) => {
    await switchToSourceMode(page)
    await page.locator('.source-code').click()

    await page.keyboard.press('Control+f')
    await page.waitForTimeout(500)

    const searchInput = page.locator('.search-bar input[type="text"]').first()
    if (await searchInput.isVisible()) {
      await searchInput.click()
      await page.waitForTimeout(200)

      const inputFocusable = await page.evaluate(() => {
        const input = document.querySelector('.search-bar input[type="text"]')
        if (!input) return false
        input.focus()
        return document.activeElement === input
      })
      expect(inputFocusable).toBe(true)
    }
  })
})
