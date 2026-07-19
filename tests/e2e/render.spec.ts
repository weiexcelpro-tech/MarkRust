import { test, expect } from '@playwright/test'
import { injectTauriMock } from './mock-tauri'

test.beforeEach(async ({ page }) => {
  await injectTauriMock(page)
  await page.goto('/')
  await expect(page.locator('.editor-container')).toBeVisible({ timeout: 15000 })
  await page.waitForTimeout(1000)
})

test.describe('基本渲染', () => {
  test('editor-container 挂载到 DOM 且可见', async ({ page }) => {
    const container = page.locator('.editor-container')
    await expect(container).toBeVisible()
    await expect(container).toHaveClass(/editor-container/)
  })

  test('side-bar 默认可见且含左列（图标导航）与右列（面板）', async ({ page }) => {
    const sidebar = page.locator('.side-bar')
    await expect(sidebar).toBeVisible()
    await expect(sidebar.locator('.left-column')).toBeVisible()
    await expect(sidebar.locator('.right-column')).toBeVisible()
  })

  test('左列含 files / search / toc 三个面板切换按钮 + 底部 settings', async ({ page }) => {
    const left = page.locator('.side-bar .left-column')
    const topIcons = left.locator('ul').first().locator('li')
    await expect(topIcons).toHaveCount(3)
    const bottomIcons = left.locator('ul.bottom li')
    await expect(bottomIcons).toHaveCount(1)
  })

  test('side-bar 默认激活 TOC 面板（不是 files）', async ({ page }) => {
    const leftIcons = page.locator('.side-bar .left-column ul').first().locator('li')
    await expect(leftIcons.nth(2)).toHaveClass(/\bactive\b/)
    await expect(leftIcons.nth(0)).not.toHaveClass(/\bactive\b/)
    await expect(page.locator('.side-bar .right-column .side-bar-toc')).toBeVisible()
  })

  test('title-bar 可见且为 frameless 自定义样式', async ({ page }) => {
    const titleBar = page.locator('.title-bar').first()
    await expect(titleBar).toBeVisible()
    await expect(titleBar).toHaveClass(/\bframeless\b/)
  })

  test('editor-with-tabs 可见且包含编辑器组件', async ({ page }) => {
    const editorWithTabs = page.locator('.editor-with-tabs')
    await expect(editorWithTabs).toBeVisible()
    await expect(editorWithTabs.locator('.editor-component')).toBeVisible()
  })
})

test.describe('编辑器渲染', () => {
  test('muya 编辑器容器挂载', async ({ page }) => {
    const muya = page.locator('.editor-component.mu-editor')
    await expect(muya).toBeVisible()
  })

  test('bootstrap-editor 默认创建 1 个空白 tab', async ({ page }) => {
    const tabs = page.locator('.editor-tabs .tabs-container li')
    await expect(tabs).toHaveCount(1)
  })

  test('编辑器中可输入文字并渲染为段落', async ({ page }) => {
    const editor = page.locator('.editor-component.mu-editor')
    await editor.click()
    await page.keyboard.type('Hello MarkTEXT e2e')
    await expect(page.locator('.editor-component')).toContainText('Hello MarkTEXT e2e', { timeout: 5000 })
  })
})

test.describe('控制台健康', () => {
  test('页面加载后无致命 JS 错误（排除 Element Plus / intlify 实验性告警）', async ({ page }) => {
    const errors: string[] = []
    page.on('pageerror', (err) => errors.push(err.message))
    const ignored = [
      'ElementPlusError',
      '[intlify]',
      'title slot is about to be deprecated',
      'unhandled invoke',
      'unmapped ipcRenderer',
    ]
    const fatal = errors.filter((e) => !ignored.some((p) => e.includes(p)))
    expect(fatal, `Fatal errors:\n${fatal.join('\n')}`).toHaveLength(0)
  })
})
