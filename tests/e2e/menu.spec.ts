import { test, expect } from '@playwright/test'
import { injectTauriMock } from './mock-tauri'

test.beforeEach(async ({ page }) => {
  await injectTauriMock(page)
  await page.goto('/')
  await expect(page.locator('.editor-container')).toBeVisible({ timeout: 15000 })
  await expect(page.locator('.editor-tabs .tabs-container li')).toHaveCount(1, { timeout: 10000 })
  await page.waitForTimeout(500)
})

test.describe('Sidebar 面板切换', () => {
  test('点击 files 图标切换到文件树面板', async ({ page }) => {
    const leftIcons = page.locator('.side-bar .left-column ul').first().locator('li')
    await expect(leftIcons.nth(2)).toHaveClass(/\bactive\b/)
    await leftIcons.nth(0).click()
    await expect(leftIcons.nth(0)).toHaveClass(/\bactive\b/)
    await expect(leftIcons.nth(2)).not.toHaveClass(/\bactive\b/)
    await expect(page.locator('.side-bar .right-column .tree-view')).toBeVisible({ timeout: 5000 })
  })

  test('点击 search 图标切换到搜索面板', async ({ page }) => {
    const leftIcons = page.locator('.side-bar .left-column ul').first().locator('li')
    await leftIcons.nth(1).click()
    await expect(leftIcons.nth(1)).toHaveClass(/\bactive\b/)
    await expect(page.locator('.side-bar .right-column .side-bar-search')).toBeVisible({ timeout: 5000 })
  })

  test('点击 toc 图标回到 TOC 面板', async ({ page }) => {
    const leftIcons = page.locator('.side-bar .left-column ul').first().locator('li')
    await leftIcons.nth(0).click()
    await expect(leftIcons.nth(0)).toHaveClass(/\bactive\b/)
    await leftIcons.nth(2).click()
    await expect(leftIcons.nth(2)).toHaveClass(/\bactive\b/)
    await expect(page.locator('.side-bar .right-column .side-bar-toc')).toBeVisible()
  })
})

test.describe('编辑器快捷键', () => {
  test('Ctrl+Z 撤销编辑器输入', async ({ page }) => {
    const editor = page.locator('.editor-component.mu-editor')
    await editor.click()
    await page.keyboard.type('undoMe')
    await expect(page.locator('.editor-component')).toContainText('undoMe', { timeout: 5000 })
    await page.keyboard.press('Control+z')
    await page.waitForTimeout(300)
    await expect(page.locator('.editor-component')).not.toContainText('undoMe')
  })

  test('Ctrl+Y / Ctrl+Shift+Z 重做', async ({ page }) => {
    const editor = page.locator('.editor-component.mu-editor')
    await editor.click()
    await page.keyboard.type('redoMe')
    await expect(page.locator('.editor-component')).toContainText('redoMe', { timeout: 5000 })
    await page.keyboard.press('Control+z')
    await page.waitForTimeout(300)
    await expect(page.locator('.editor-component')).not.toContainText('redoMe')
    await page.keyboard.press('Control+y')
    await page.waitForTimeout(300)
    await expect(page.locator('.editor-component')).toContainText('redoMe')
  })
})
