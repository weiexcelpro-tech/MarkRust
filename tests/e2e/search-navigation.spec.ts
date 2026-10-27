/**
 * Search navigation on a SPARSE large document.
 *
 * Regression net for two shipped bugs that small-document tests could never
 * trigger (both require matches beyond muya's lazy-render pre-render margin,
 * i.e. jumps of thousands of pixels):
 *
 *   Bug A (v1.1.5): clicking 下一个/上一个 on a match in an unrendered block
 *   did not scroll at all — the search highlight was patched into the block
 *   without recording the lazy state, the pre-scroll flush re-rendered the
 *   block bare and wiped the highlight, and the reveal measured a detached
 *   node. Symptom: "sometimes the match is visible, usually not".
 *
 *   Bug B (v1.1.5 follow-up): the reveal scroll moved newly-rendered blocks
 *   into the IntersectionObserver window; their lazy patches wrote the
 *   document selection (K5 apply-immediate), stealing focus from the search
 *   input after the first character.
 *
 * The postconditions asserted here are the class net, not just the two bugs:
 * after ANY reveal (initial search, next, prev, wrap) the active highlight
 * must exist AND sit inside the editor viewport, and focus must stay in the
 * search input.
 */
import { test, expect, type Page } from '@playwright/test'
import { injectTauriMock, bootstrapApp } from './mock-tauri'

/** Sparse doc: only sections 60/120/180 contain the needle — every jump
 * crosses ~40 unrendered sections (~6k px), far beyond the 800px pre-render
 * margin, which is exactly the condition that killed the old reveal. */
function buildSparseDoc(): string {
  const target = new Set([60, 120, 180])
  const lines: string[] = ['# 稀疏搜索回归文档', '']
  for (let s = 1; s <= 200; s++) {
    lines.push(`## 第${s}节`, '')
    for (let p = 0; p < 3; p++) {
      lines.push(`第${s}段的填充内容，用于撑起文档高度，让匹配之间隔着大量未渲染块。`, '')
    }
    if (target.has(s)) {
      lines.push('这里有一个稀疏目标：香蕉。', '')
    }
  }
  return lines.join('\n')
}

async function highlightInViewport(page: Page): Promise<{ exists: boolean; visible: boolean; top: number }> {
  return page.evaluate(() => {
    const container = document.querySelector('.editor-component')
    const hl = document.querySelector('.mu-highlight')
    if (!container || !hl) return { exists: false, visible: false, top: -1 }
    const crect = container.getBoundingClientRect()
    const hrect = hl.getBoundingClientRect()
    return {
      exists: true,
      visible: hrect.top >= crect.top - 2 && hrect.bottom <= crect.bottom + 2,
      top: Math.round(hrect.top),
    }
  })
}

test.describe('搜索导航 — 稀疏大文档（懒渲染窗口外的匹配）', () => {
  let markdown: string

  test.beforeAll(() => {
    markdown = buildSparseDoc()
  })

  test('输入搜索词：活动高亮落入视口，且焦点保持在搜索框', async ({ page }) => {
    await injectTauriMock(page, {})
    await bootstrapApp(page, { markdownList: [markdown] })

    await page.locator('.editor-component').click({ position: { x: 400, y: 300 } })
    await page.keyboard.press('Control+f')
    await page.waitForTimeout(400)
    await page.keyboard.type('香蕉')
    await page.waitForTimeout(800)

    const hl = await highlightInViewport(page)
    expect(hl.exists, '输入后必须存在活动高亮').toBe(true)
    expect(hl.visible, '输入后活动高亮必须在编辑器视口内').toBe(true)

    // Bug B net: the reveal must not steal focus from the search input.
    await page.waitForTimeout(700) // 动画 + 落位校正全部结束后再查
    const focus = await page.evaluate(() => {
      const el = document.activeElement
      return {
        tag: el?.tagName,
        inSearchBar: !!el?.closest?.('.search-bar'),
      }
    })
    expect(focus.inSearchBar, '定位后焦点必须仍在搜索框内（用户可继续输入）').toBe(true)
    expect(focus.tag).toBe('INPUT')
  })

  test('连续 下一个 跨越未渲染区：每次命中都可见', async ({ page }) => {
    await injectTauriMock(page, {})
    await bootstrapApp(page, { markdownList: [markdown] })

    await page.locator('.editor-component').click({ position: { x: 400, y: 300 } })
    await page.keyboard.press('Control+f')
    await page.waitForTimeout(400)
    await page.keyboard.type('香蕉')
    await page.waitForTimeout(800)

    const nextBtn = page.locator('.search-bar .button-group button.button:not(.right)').first()
    // 3 个匹配 → next 两次到末条，第三次回卷到第一条，各跳一次远端
    for (let i = 1; i <= 3; i++) {
      await nextBtn.click()
      await page.waitForTimeout(700)
      const hl = await highlightInViewport(page)
      expect(hl.exists, `next#${i} 后必须存在活动高亮`).toBe(true)
      expect(hl.visible, `next#${i} 后活动高亮必须在视口内（曾完全不滚动）`).toBe(true)
    }
  })

  test('上一个 同样保持命中可见', async ({ page }) => {
    await injectTauriMock(page, {})
    await bootstrapApp(page, { markdownList: [markdown] })

    await page.locator('.editor-component').click({ position: { x: 400, y: 300 } })
    await page.keyboard.press('Control+f')
    await page.waitForTimeout(400)
    await page.keyboard.type('香蕉')
    await page.waitForTimeout(800)

    const prevBtn = page.locator('.search-bar .button-group button.button.right').first()
    await prevBtn.click() // 回卷到最后一个匹配（远端）
    await page.waitForTimeout(700)
    const hl = await highlightInViewport(page)
    expect(hl.exists).toBe(true)
    expect(hl.visible, '上一个（回卷到远端匹配）后高亮必须在视口内').toBe(true)
  })
})
