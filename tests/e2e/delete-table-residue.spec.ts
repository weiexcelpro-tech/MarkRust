/**
 * 整段删除残留物回归网（表格场景）。
 *
 * Bug（v1.1.5 后用户报告）：预览模式选中多段内容按 Delete，"经常有残留物"。
 * 根因：当删除范围落在表格上时，`emptyCellContentsUntil` 只把单元格文本写进
 * json state（`.text = ''`），没有重新渲染块——DOM 里旧文本原样可见。修复后
 * 单元格与 state 同步清空；本文件用真实鼠标拖选 + 真实 Delete 键在 DOM 层
 * 断言无残留。
 */
import { test, expect, type Page } from '@playwright/test'
import { injectTauriMock, bootstrapApp } from './mock-tauri'

const DOC = [
  '# 表格删除回归文档',
  '',
  '## 总览',
  '',
  '| 指标 | 数值 |',
  '| --- | --- |',
  '| 总技能数 | 557 |',
  '| Popularity 1K-10K | 78 |',
  '| Popularity 100-999 | 396 |',
  '',
  '结尾段落，用于收尾。',
  '',
].join('\n')

/** 取包含指定文本的块内首个文本行的中心坐标（拖选起止点用）。 */
async function textCenter(page: Page, selector: string, needle: string): Promise<{ x: number, y: number, right: number }> {
  return page.evaluate(({ selector, needle }) => {
    const els = [...document.querySelectorAll(selector)]
    const el = els.find((e) => e.textContent?.includes(needle))
    if (!el)
      throw new Error(`not found: ${needle}`)
    const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT)
    let node = walker.nextNode() as Text | null
    let best: Text | null = null
    while (node) {
      if ((node.textContent ?? '').includes(needle)) {
        best = node
        break
      }
      node = walker.nextNode() as Text | null
    }
    const target = best ?? (walker.nextNode() as Text | null)
    if (!target)
      throw new Error(`no text node: ${needle}`)
    const r = document.createRange()
    r.selectNodeContents(target)
    const rect = r.getBoundingClientRect()
    return { x: rect.left + 4, y: rect.top + rect.height / 2, right: rect.right - 4 }
  }, { selector, needle })
}

test.describe('整段删除 — 表格残留物', () => {
  test('选区从标题拉到表格单元格内：被删单元格必须从 DOM 消失', async ({ page }) => {
    await injectTauriMock(page, {})
    await bootstrapApp(page, { markdownList: [DOC] })
    await page.waitForTimeout(500)

    const from = await textCenter(page, '.editor-component h2', '总览')
    const to = await textCenter(page, '.editor-component table td', 'Popularity 1K-10K')

    await page.mouse.move(from.x, from.y)
    await page.mouse.down()
    await page.mouse.move(to.x + (to.right - to.x) / 2, to.y, { steps: 10 })
    await page.mouse.up()
    await page.waitForTimeout(300)

    // 确认拖选确实产生了跨块选区（防止回归成"单击+Delete"）
    const selLen = await page.evaluate(() => window.getSelection()?.toString().length ?? 0)
    expect(selLen, '拖选必须产生选区').toBeGreaterThan(10)

    await page.keyboard.press('Delete')
    await page.waitForTimeout(500)

    const text = await page.evaluate(() => (document.querySelector('.editor-component') as HTMLElement).innerText)
    // 被删除范围（含 spanned 单元格）不得残留在 DOM
    expect(text).not.toContain('总技能数')
    expect(text).not.toContain('557')
    // 焦点单元格尾部并入标题；未选中的行保留
    expect(text).toContain('1K-10K')
    expect(text).toContain('396')
  })

  test('纯段落区间删除：无残留（对照组）', async ({ page }) => {
    const doc = [
      '# 段落删除回归',
      '',
      ...Array.from({ length: 10 }, (_, i) => [`段落MARKER-${i}：内容。`, '']).flat(),
    ].join('\n')
    await injectTauriMock(page, {})
    await bootstrapApp(page, { markdownList: [doc] })
    await page.waitForTimeout(500)

    const from = await textCenter(page, '.editor-component p', 'MARKER-2')
    const to = await textCenter(page, '.editor-component p', 'MARKER-6')

    await page.mouse.move(from.x, from.y)
    await page.mouse.down()
    await page.mouse.move(to.right - 10, to.y, { steps: 8 })
    await page.mouse.up()
    await page.waitForTimeout(300)
    await page.keyboard.press('Delete')
    await page.waitForTimeout(500)

    const text = await page.evaluate(() => (document.querySelector('.editor-component') as HTMLElement).innerText)
    for (const m of ['MARKER-2', 'MARKER-3', 'MARKER-4', 'MARKER-5', 'MARKER-6'])
      expect(text).not.toContain(m)
    expect(text).toContain('MARKER-1')
    expect(text).toContain('MARKER-7')
  })
})
