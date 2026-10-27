/**
 * 搜索框粘贴回归网。
 *
 * Bug（v1.1.5 后用户报告）：从文档里复制多段内容粘贴进搜索框，搜索永远
 * 0 命中。根因：剪贴板 text/plain 含换行，浏览器把它折叠成空格塞进单行
 * 输入框；而搜索引擎按 block.text 逐块子串匹配，跨块的"长句"不可能命中
 * 任何单块。修复：paste 事件归一化，多行只取第一个非空行（= 复制起点所
 * 在块）；替换框保留全部内容、换行折叠为单空格。
 */
import { test, expect, type Page } from '@playwright/test'
import { injectTauriMock, bootstrapApp } from './mock-tauri'

const DOC = [
  '# 粘贴搜索回归文档',
  '',
  '第一段：中国6月**原油进口**大降四成，另有[链接文字](https://example.com)以及行内样例。',
  '',
  '第二段：纯文本段落，没有格式。',
  '',
  '## 二级标题甲',
  '',
  '第三段：列表外的普通段落。',
  '',
].join('\n')

async function openSearch(page: Page): Promise<void> {
  await page.locator('.editor-component').click({ position: { x: 400, y: 300 } })
  await page.keyboard.press('Control+f')
  await page.waitForTimeout(400)
}

test.describe('搜索框粘贴', () => {
  test('多行剪贴板粘贴 → 取首个非空行并命中', async ({ page, context }) => {
    await context.grantPermissions(['clipboard-read', 'clipboard-write'])
    await injectTauriMock(page, {})
    await bootstrapApp(page, { markdownList: [DOC] })
    await openSearch(page)

    // 模拟从文档复制多段（真实 in-app 复制的 text/plain 是 markdown 源 + 换行）
    await page.evaluate(() => navigator.clipboard.writeText(
      '第二段：纯文本段落，没有格式。\n\n## 二级标题甲\n\n第三段：列表外的普通段落。\n',
    ))
    const input = page.locator('.search-bar input[type="text"]').first()
    await input.focus()
    await page.keyboard.press('Control+a')
    await page.keyboard.press('Control+v')
    await page.waitForTimeout(500)

    // 输入框只保留首个非空行，且搜索命中
    await expect(input).toHaveValue('第二段：纯文本段落，没有格式。')
    const counter = (await page.locator('.search-bar .search-result').innerText()).trim()
    expect(counter.startsWith('1 /'), `粘贴后必须命中，实际计数=${counter}`).toBeTruthy()
  })

  test('单行粘贴（含尾随换行）不受影响', async ({ page, context }) => {
    await context.grantPermissions(['clipboard-read', 'clipboard-write'])
    await injectTauriMock(page, {})
    await bootstrapApp(page, { markdownList: [DOC] })
    await openSearch(page)

    await page.evaluate(() => navigator.clipboard.writeText('原油进口\n'))
    const input = page.locator('.search-bar input[type="text"]').first()
    await input.focus()
    await page.keyboard.press('Control+a')
    await page.keyboard.press('Control+v')
    await page.waitForTimeout(500)

    await expect(input).toHaveValue('原油进口')
    const counter = (await page.locator('.search-bar .search-result').innerText()).trim()
    expect(counter.startsWith('1 /'), `单行粘贴必须命中，实际计数=${counter}`).toBeTruthy()
  })

  test('文档内复制 → 粘贴 → 命中（端到端）', async ({ page, context }) => {
    test.setTimeout(60000)
    await context.grantPermissions(['clipboard-read', 'clipboard-write'])
    await injectTauriMock(page, {})
    await bootstrapApp(page, { markdownList: [DOC] })

    // 用文本节点的精确坐标拖选"第二段"整行，Ctrl+C
    const pt = await page.evaluate(() => {
      const ps = [...document.querySelectorAll('.editor-component p')]
      const p = ps.find((el) => el.textContent?.includes('纯文本段落'))
      if (!p)
        return null
      const walker = document.createTreeWalker(p, NodeFilter.SHOW_TEXT)
      const t = walker.nextNode() as Text | null
      if (!t)
        return null
      const r = document.createRange()
      r.selectNodeContents(t)
      const rect = r.getBoundingClientRect()
      return { x: rect.left + 5, y: rect.top + rect.height / 2, x2: rect.right - 5 }
    })
    expect(pt).not.toBeNull()
    await page.mouse.move(pt!.x, pt!.y)
    await page.mouse.down()
    await page.mouse.move(pt!.x2, pt!.y, { steps: 6 })
    await page.mouse.up()
    await page.waitForTimeout(200)
    await page.keyboard.press('Control+c')
    await page.waitForTimeout(300)

    await openSearch(page)
    const input = page.locator('.search-bar input[type="text"]').first()
    await input.focus()
    await page.keyboard.press('Control+a')
    await page.keyboard.press('Control+v')
    await page.waitForTimeout(500)

    const counter = (await page.locator('.search-bar .search-result').innerText()).trim()
    expect(counter.startsWith('1 /'), `文档内复制粘贴必须命中，实际计数=${counter}，输入框值=${await input.inputValue()}`).toBeTruthy()
  })
})
