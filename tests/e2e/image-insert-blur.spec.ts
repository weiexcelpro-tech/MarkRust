import { test, expect } from '@playwright/test'
import { injectTauriMock, emitTauriEvent, bootstrapApp } from './mock-tauri'

/**
 * 失焦场景针对性测试：验证 muya.ts format() 的 getSelection() null fallback 修复。
 *
 * 真实 Tauri 菜单点击 → WebView 失焦 → document.getSelection() 被清空返回 null。
 * 修复前：format() 在此直接 return，图片插入静默失败。
 * 修复后：用缓存的 anchorBlock/focusBlock/anchor/focus 构造 fallback ISelection，
 *         setSelection() 重设 DOM 选区，anchorBlock.format('image') 正常调用。
 */
test.beforeEach(async ({ page }) => {
  await injectTauriMock(page)
  await bootstrapApp(page)
})

test.describe('菜单失焦场景 — getSelection null fallback 修复验证', () => {
  test('编辑器失焦后通过菜单插入图片仍能工作', async ({ page }) => {
    const editor = page.locator('.editor-component.mu-editor')

    // 1. 聚焦编辑器并输入文字 — 建立 muya 缓存选区 (anchorBlock/anchor)
    await editor.click()
    await page.keyboard.type('hello world')
    await page.waitForTimeout(300)

    // 把光标移到 'hello w|orld' 位置，确保 anchor 写入缓存
    for (let i = 0; i < 3; i++)
      await page.keyboard.press('ArrowLeft')
    await page.waitForTimeout(200)

    // 2. 验证失焦前 DOM 选区存在
    const selBeforeBlur = await page.evaluate(() => {
      const sel = document.getSelection()
      return { hasAnchor: !!sel && !!sel.anchorNode, rangeCount: sel?.rangeCount ?? 0 }
    })
    console.log('[E2E] 失焦前选区:', selBeforeBlur)

    // 3. 模拟 Tauri 原生菜单点击导致编辑器失焦 — 清空 DOM 选区 + blur
    await page.evaluate(() => {
      const sel = window.getSelection()
      if (sel)
        sel.removeAllRanges()
      const active = document.activeElement as HTMLElement | null
      if (active && typeof active.blur === 'function')
        active.blur()
    })
    await page.waitForTimeout(200)

    // 4. 验证失焦场景已建立 — document.getSelection() 应为空
    const selAfterBlur = await page.evaluate(() => {
      const sel = document.getSelection()
      return { hasAnchor: !!sel && !!sel.anchorNode, rangeCount: sel?.rangeCount ?? 0 }
    })
    console.log('[E2E] 失焦后选区:', selAfterBlur)
    // 关键前置条件：DOM 选区确实被清空（这正是修复要应对的场景）
    expect(selAfterBlur.rangeCount, 'blur 后 DOM 选区应被清空').toBe(0)

    // 5. 模拟 Tauri 菜单点击事件：imageMenuItem → menuBridge → format('image')
    //    链路：mt::menu::click {id:'imageMenuItem'}
    //    → menuBridge FORMAT_MENU_MAP['imageMenuItem']='image'
    //    → localEmit('mt::editor-format-action', {type:'image'})
    //    → listenForMain → bus.emit('format','image')
    //    → editor.vue handleInlineFormat → muya.format('image')
    await emitTauriEvent(page, 'mt::menu::click', { id: 'imageMenuItem' })
    await page.waitForTimeout(1000) // rAF + 浮窗渲染

    // 6. 断言：空图片标记 .mu-inline-image 已插入 DOM (format.ts _addFormat 执行)
    const hasEmptyImage = await page.locator('.editor-component').evaluate(el => {
      return el.querySelector('.mu-inline-image') !== null
    })
    expect(hasEmptyImage, '失焦后菜单插入：.mu-inline-image 应出现在编辑器中').toBe(true)

    // 7. 断言：imageEditTool 浮窗弹出 (requestAnimationFrame → muya-image-selector 事件)
    const tool = page.locator('.mu-image-selector-wrapper')
    await expect(tool).toBeVisible({ timeout: 3000 })
  })

  test('对照：聚焦状态下菜单插入图片也能工作', async ({ page }) => {
    const editor = page.locator('.editor-component.mu-editor')

    // 聚焦编辑器输入文字，但不失焦
    await editor.click()
    await page.keyboard.type('focus test')
    await page.waitForTimeout(300)

    // 确认选区存在
    const selState = await page.evaluate(() => {
      const sel = document.getSelection()
      return sel?.rangeCount ?? 0
    })
    expect(selState, '聚焦状态 DOM 选区应存在').toBeGreaterThan(0)

    // 触发菜单事件
    await emitTauriEvent(page, 'mt::menu::click', { id: 'imageMenuItem' })
    await page.waitForTimeout(1000)

    const hasEmptyImage = await page.locator('.editor-component').evaluate(el => {
      return el.querySelector('.mu-inline-image') !== null
    })
    expect(hasEmptyImage, '聚焦状态菜单插入：.mu-inline-image 应出现').toBe(true)

    const tool = page.locator('.mu-image-selector-wrapper')
    await expect(tool).toBeVisible({ timeout: 3000 })
  })
})
