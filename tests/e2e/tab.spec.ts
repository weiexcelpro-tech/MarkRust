import { test, expect } from '@playwright/test'
import { injectTauriMock, bootstrapApp } from './mock-tauri'

test.beforeEach(async ({ page }) => {
  await injectTauriMock(page)
  await bootstrapApp(page)
})

test.describe('Tab 管理', () => {
  test('点击 + 按钮新建第二个 tab', async ({ page }) => {
    const tabs = page.locator('.editor-tabs .tabs-container li')
    await expect(tabs).toHaveCount(1)
    await page.locator('.editor-tabs .new-file').click()
    await expect(tabs).toHaveCount(2)
  })

  test('点击 tab 的 close 图标关闭 tab', async ({ page }) => {
    const tabs = page.locator('.editor-tabs .tabs-container li')
    await expect(tabs).toHaveCount(1)
    const closeIcon = tabs.first().locator('.close-icon')
    await closeIcon.click()
    await expect(tabs).toHaveCount(0)
  })

  test('新建多个 tab 后切换 active 状态', async ({ page }) => {
    const tabs = page.locator('.editor-tabs .tabs-container li')
    await page.locator('.editor-tabs .new-file').click()
    await page.locator('.editor-tabs .new-file').click()
    await expect(tabs).toHaveCount(3)
    await expect(tabs.nth(2)).toHaveClass(/\bactive\b/)
    await tabs.nth(0).click()
    await expect(tabs.nth(0)).toHaveClass(/\bactive\b/)
    await expect(tabs.nth(2)).not.toHaveClass(/\bactive\b/)
  })

  test('关闭最后一个 tab 后 tabs-container 为空', async ({ page }) => {
    const tabs = page.locator('.editor-tabs .tabs-container li')
    await expect(tabs).toHaveCount(1)
    await tabs.first().locator('.close-icon').click()
    await expect(tabs).toHaveCount(0)
  })
})
