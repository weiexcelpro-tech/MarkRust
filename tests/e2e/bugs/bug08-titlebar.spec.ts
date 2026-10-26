/**
 * B08 窗口右上角两套窗口控制按钮 —— TC-B08-03 mock 下 custom/native 标题栏呈现
 *
 * v1.1.6 行为更正（实测 + 源码 titleBar/index.vue:88）：应用内窗口控制按钮已被整体移除
 * （"Window control buttons removed: use native system title bar buttons instead"），
 * 用例设计中「custom 时 min/max/close 各恰有一个」为 v1.0 时代契约。
 * 现行渲染层契约：
 * - custom → .title-bar 可见且带 frameless 类，但应用内控制按钮数为 0（按钮全权交回原生装饰）；
 * - native → .title-bar 整体隐藏。
 * 双按钮根因（tauri.conf decorations:true 与默认 custom 并存）由 STATIC 用例 TC-B08-02 锁定（当前 FAIL）。
 */
import { test, expect } from '@playwright/test'
import { injectTauriMock, bootstrapApp, MOCK_INVOKE_RESPONSES } from '../mock-tauri'

test.setTimeout(120_000)

test('TC-B08-03: titleBarStyle=custom 时应用内标题栏可见（v1.1.6：应用内控制按钮已移除）', async ({ page }) => {
  await injectTauriMock(page) // 默认 preferences_get_all.titleBarStyle='custom'
  await bootstrapApp(page)

  const titleBar = page.locator('.title-bar').first()
  await expect(titleBar).toBeVisible({ timeout: 15000 })
  await expect(titleBar).toHaveClass(/frameless/)

  // v1.1.6 契约：应用内不再渲染窗口控制按钮（交回系统装饰）
  await expect(page.locator('.frameless-titlebar-close')).toHaveCount(0)
  await expect(page.locator('.frameless-titlebar-toggle')).toHaveCount(0)
  await expect(page.locator('.frameless-titlebar-minimize')).toHaveCount(0)
})

test('TC-B08-03: titleBarStyle=native 时应用内标题栏按钮组隐藏', async ({ page }) => {
  const prefs = {
    ...(MOCK_INVOKE_RESPONSES.preferences_get_all as Record<string, unknown>),
    titleBarStyle: 'native',
  }
  await injectTauriMock(page, { preferences_get_all: prefs })
  await bootstrapApp(page)

  // native && 非 macOS：shouldShowInAppTitleBar=false → .title-bar 不渲染
  await expect(page.locator('.title-bar')).toHaveCount(0, { timeout: 15000 })
  await expect(page.locator('.frameless-titlebar-close')).toHaveCount(0)
  await expect(page.locator('.frameless-titlebar-toggle')).toHaveCount(0)
  await expect(page.locator('.frameless-titlebar-minimize')).toHaveCount(0)
})
