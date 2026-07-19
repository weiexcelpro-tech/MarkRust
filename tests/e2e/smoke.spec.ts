import { test, expect } from '@playwright/test'
import { injectTauriMock } from './mock-tauri'

test.beforeEach(async ({ page }) => {
  await injectTauriMock(page)
  await page.goto('http://localhost:1420/')
  await page.waitForSelector('#app', { timeout: 15000 })
  await page.waitForTimeout(3000)
})

test.describe('渲染验证', () => {
  test('#app 容器非空（非白屏）', async ({ page }) => {
    const htmlLen = await page.evaluate(() => document.getElementById('app')?.innerHTML.length ?? 0)
    expect(htmlLen).toBeGreaterThan(100)
  })

  test('sidebar 可见', async ({ page }) => {
    const sidebar = page.locator('.side-bar, [class*="side-bar"], [class*="sidebar"]')
    await expect(sidebar.first()).toBeVisible({ timeout: 5000 })
  })

  test('编辑器区域存在', async ({ page }) => {
    const editor = page.locator('#ag-editor, .editor, [contenteditable], .mu-editor, [class*="editor"]')
    await expect(editor.first()).toBeVisible({ timeout: 5000 })
  })

  test('title bar 存在', async ({ page }) => {
    const titleBar = page.locator('.title-bar, [class*="title-bar"], .left-bar, .right-bar')
    await expect(titleBar.first()).toBeVisible({ timeout: 5000 })
  })
})

test.describe('编辑器交互', () => {
  test('编辑器可输入文字', async ({ page }) => {
    const editor = page.locator('[contenteditable], .ag-editor, .mu-editor')
    if (await editor.count() > 0) {
      await editor.first().click()
      await page.keyboard.type('Hello E2E Test')
      await page.waitForTimeout(500)
      const bodyText = await page.evaluate(() => document.body.innerText)
      expect(bodyText).toContain('Hello')
    }
  })

  test('Ctrl+Z 撤销输入', async ({ page }) => {
    const editor = page.locator('[contenteditable], .ag-editor, .mu-editor')
    if (await editor.count() > 0) {
      await editor.first().click()
      await page.keyboard.type('UniqueText12345')
      await page.waitForTimeout(300)
      await page.keyboard.press('Control+z')
      await page.waitForTimeout(300)
      const bodyText = await page.evaluate(() => document.body.innerText)
      expect(bodyText).not.toContain('UniqueText12345')
    }
  })
})

test.describe('控制台错误', () => {
  test('无致命 JS 错误', async ({ page }) => {
    const errors: string[] = []
    page.on('pageerror', (err) => errors.push(err.message))
    await page.reload()
    await page.waitForTimeout(3000)
    const fatal = errors.filter((e) =>
      !e.includes('ElementPlusError') &&
      !e.includes('prism-') &&
      !e.includes('Unknown variable dynamic import')
    )
    expect(fatal).toEqual([])
  })
})
