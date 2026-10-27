/**
 * B03 复制到 Word 没有格式 —— TC-B03-02 copy 事件剪贴板必须携带 text/html
 *
 * 勘察根因（lead 复核）：muya copyData.ts CopyType.NORMAL 分支刻意
 * setData('text/html', '')，只写 markdown 纯文本；渲染 HTML 能力存在
 * （COPY_AS_RICH 分支 / 右键「复制为富文本」bus: copyAsRich）。
 * - 主断言：Ctrl+C 形态（NORMAL）copy 事件 text/html 非空且含 h1/strong/table → 应 FAIL = bug 复现；
 * - 对照断言（lead 增补）：copyAsRich 路径 text/html 非空 → 应 PASS，证明引擎能力在、默认路径被置空。
 */
import { test, expect, type Page } from '@playwright/test'
import { openDoc, emitBus, fatalErrors, collectPageErrors } from './_helpers'

test.setTimeout(120_000)


const RICH_DOC = [
  '# 一级标题',
  '',
  '**粗体** 与 *斜体*',
  '',
  '| 姓名 | 数量 | 备注 |',
  '| --- | --- | --- |',
  '| 张三 | 3 | ok |',
  '',
].join('\n')

/** 页面内注册一次性 copy 捕捉器（muya 的 document 级 copy 监听先注册先执行，本捕捉器读到写入后的槽） */
async function armCopyCapture(page: Page): Promise<void> {
  await page.evaluate(() => {
    const w = window as unknown as { __copyPayload?: { html: string; text: string } | null }
    w.__copyPayload = null
    document.addEventListener('copy', (e) => {
      const evt = e as ClipboardEvent
      if (!evt.clipboardData) return
      w.__copyPayload = {
        html: evt.clipboardData.getData('text/html'),
        text: evt.clipboardData.getData('text/plain'),
      }
    })
  })
}

async function readCopyPayload(page: Page) {
  return page.evaluate(() => (window as unknown as { __copyPayload?: { html: string; text: string } | null }).__copyPayload)
}

test('TC-B03-02: copy 事件剪贴板必须携带 text/html（含标题/粗体/表格标记）', async ({ page }) => {
  const pageErrors = collectPageErrors(page)
  await openDoc(page, 'C:\\docs\\rich.md', RICH_DOC)
  await armCopyCapture(page)

  // 聚焦编辑器并全选（bus 'selectAll' 与应用菜单同路径 → muya selection.selectAll）
  await page.locator('.editor-component').click()
  await emitBus(page, 'selectAll')
  await page.waitForTimeout(400)

  // 派发合成 copy 事件（muya 的 document 级 copy 处理器接管并写入槽）
  await page.evaluate(() => {
    const dt = new DataTransfer()
    document.dispatchEvent(
      new ClipboardEvent('copy', { bubbles: true, cancelable: true, clipboardData: dt }),
    )
  })
  await page.waitForTimeout(300)

  const payload = await readCopyPayload(page)
  expect(payload, 'copy 事件未被 muya 处理器接管（__copyPayload 为空，基建问题）').not.toBeNull()
  const { html, text } = payload!

  // eslint-disable-next-line no-console
  console.log('[B03-02] text/plain 前 120 字:', JSON.stringify(text.slice(0, 120)), '| text/html 长度:', html.length)

  // 先做文本槽健全性（应 PASS）：text/plain 为 markdown 源
  expect(text).toContain('一级标题')
  expect(text).toContain('**粗体**')
  expect(text).toContain('| 姓名 | 数量 | 备注 |')

  // bug 断言：text/html 非空且携带格式标记（当前 NORMAL 分支置空 → FAIL = bug 复现）
  expect(
    html,
    'copy 事件 text/html 为空 —— Word 只能拿到无格式文本（CopyType.NORMAL 刻意置空，bug 复现）',
  ).not.toBe('')
  expect(html).toContain('<h1')
  expect(html).toMatch(/<(strong|b)[ >]/)
  expect(html).toContain('<table')

  const fatal = fatalErrors(pageErrors)
  expect(fatal, `致命 JS 错误:\n${fatal.join('\n')}`).toHaveLength(0)
})

test('TC-B03-02B(对照): 右键「复制为富文本」路径 text/html 非空（引擎能力存在）', async ({ page }) => {
  await openDoc(page, 'C:\\docs\\rich.md', RICH_DOC)
  await armCopyCapture(page)

  await page.locator('.editor-component').click()
  await emitBus(page, 'selectAll')
  await page.waitForTimeout(400)

  // 与右键菜单同路径：bus.emit('copyAsRich', 'copyAsRich') → handleCopyPaste('copyAsRich')
  // → muya.copyAsRich() → 置 COPY_AS_RICH → 内部 execCommand('copy') → copy 事件
  // （捕捉器读取）。注意 bus 载荷必须是方法名（COPY_PASTE_METHOD_MAP 查表）。
  await emitBus(page, 'copyAsRich', 'copyAsRich')
  await page.waitForTimeout(500)

  const payload = await readCopyPayload(page)
  if (!payload) {
    // execCommand('copy') 在 headless 下若未派发事件，属基建限制，显式报告
    throw new Error('execCommand("copy") 未触发 copy 事件（headless 基建限制），无法完成对照断言')
  }
  // eslint-disable-next-line no-console
  console.log('[B03-02B] copyAsRich text/html 长度:', payload.html.length)
  expect(
    payload.html,
    'copyAsRich 路径应把渲染 HTML 写入 text/html（证明引擎能力在、默认路径被置空）',
  ).not.toBe('')
})
