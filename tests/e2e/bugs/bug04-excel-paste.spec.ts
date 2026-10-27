/**
 * B04 Excel 复制到 MarkRust 不能转换表格 —— TC-B04-01 / TC-B04-03
 *
 * 管线：合成 paste 事件（text/html Excel 风格 + text/plain TSV）→ muya pasteSelection
 * → normalizePastedHTML（colspan 展开/首行 td→th）→ HtmlToMarkdown → GFM 表格块。
 * 勘察：引擎转换逻辑有单测覆盖；本用例在渲染层隔离验证「HTML 送达即转换正确」。
 */
import { test, expect, type Page } from '@playwright/test'
import { openDoc, getMarkdown, fatalErrors, collectPageErrors } from './_helpers'

test.setTimeout(120_000)


const BLANK_DOC = '# Paste Demo\n\n光标锚点段落。\n'

// F-05-A：Excel 真实复制产物样例（StartFragment 注释 + x:str/x:num 属性）
const F05A_HTML =
  '<!--StartFragment--><table border=0 cellpadding=0 cellspacing=0 width=192 style=\'border-collapse:collapse\'>' +
  '<colgroup><col width=64 span=3></colgroup>' +
  '<tr height=18><td x:str>姓名</td><td x:str>数量</td><td x:str>备注</td></tr>' +
  '<tr><td x:str>张三</td><td x:num>3</td><td></td></tr>' +
  '<tr><td x:str>李四</td><td x:num>5</td><td x:str>ok</td></tr>' +
  '</table><!--EndFragment-->'
// F-05-B：等价 TSV（→ 处为真实制表符）
const F05B_TSV = '姓名\t数量\t备注\n张三\t3\t\n李四\t5\tok'

async function paste(page: Page, html: string, text: string): Promise<void> {
  await page.evaluate(({ html, text }) => {
    const dt = new DataTransfer()
    if (html) dt.setData('text/html', html)
    if (text) dt.setData('text/plain', text)
    document.dispatchEvent(
      new ClipboardEvent('paste', { bubbles: true, cancelable: true, clipboardData: dt }),
    )
  }, { html, text })
  // 粘贴管线含 async（DOMPurify / HtmlToMarkdown）
  await page.waitForTimeout(1000)
}

test('TC-B04-01: 粘贴 Excel 形态剪贴板（HTML table 优先）转 Markdown 表格', async ({ page }) => {
  const pageErrors = collectPageErrors(page)
  await openDoc(page, 'C:\\docs\\paste-demo.md', BLANK_DOC)

  // 光标落进正文段落
  await page.locator('.editor-component').click()
  await paste(page, F05A_HTML, F05B_TSV)

  const table = page.locator('.mu-editor table')
  await expect(table).toHaveCount(1)

  const md = await getMarkdown(page)
  // eslint-disable-next-line no-console
  console.log('[B04-01] getMarkdown 表格段:\n', md.split('\n').filter((l) => l.includes('|')).join('\n') || '(无)')

  // 序列化可能按列宽补齐空格与连字符，用容差正则
  expect(md).toMatch(/\|\s*姓名\s*\|\s*数量\s*\|\s*备注\s*\|/)
  expect(md).toMatch(/\|\s*-{3,}\s*\|\s*-{3,}\s*\|\s*-{3,}\s*\|/)
  expect(md).toContain('张三')
  expect(md).toContain('李四')

  // 表头行为「第一个非空行」；并显式检查 DOM 首行是否被空行占据（粘贴保真度）
  const contentRows = table.locator('tr', { hasText: /\S/ })
  await expect(contentRows, '内容行数应为 3（与源一致）').toHaveCount(3)
  const headerCells = contentRows.nth(0).locator('th, td')
  await expect(headerCells, '表头列数应为 3').toHaveCount(3)
  await expect(headerCells.nth(0)).toHaveText('姓名')
  await expect(headerCells.nth(1)).toHaveText('数量')
  await expect(headerCells.nth(2)).toHaveText('备注')

  const firstDomRowText = (await table.locator('tr').first().innerText()).trim()
  expect(
    firstDomRowText,
    '粘贴生成的表格 DOM 首行应为表头（姓名/数量/备注），实际为空行 —— 粘贴保真度缺陷',
  ).toContain('姓名')

  const fatal = fatalErrors(pageErrors)
  expect(fatal, `致命 JS 错误:\n${fatal.join('\n')}`).toHaveLength(0)
})

test('TC-B04-03: TSV-only 与异常形态（引号包裹换行/空单元格）不丢数据不崩溃', async ({ page }) => {
  const pageErrors = collectPageErrors(page)
  await openDoc(page, 'C:\\docs\\paste-demo.md', BLANK_DOC)
  await page.locator('.editor-component').click()

  // ① TSV-only：引号包裹含换行的单元格 + 空单元格（无 text/html）
  const tsvQuoted = '姓名\t备注\n"第一行\n第二行"\t\n李四\tok'
  await paste(page, '', tsvQuoted)

  const editorText = await page.locator('.editor-component').innerText()
  // eslint-disable-next-line no-console
  console.log('[B04-03] TSV-only 后编辑器文本前 160 字:', JSON.stringify(editorText.slice(0, 160)))

  const problems: string[] = []
  // 不得静默丢弃：所有单元格值都要在文档里（表格或降级文本均可）
  for (const token of ['姓名', '备注', '第一行', '第二行', '李四', 'ok']) {
    if (!editorText.includes(token)) problems.push(`TSV-only 粘贴后丢失内容: ${token}`)
  }

  // ② 空 TSV / 空白粘贴不崩溃
  await paste(page, '', '\t\n\t')
  const fatal = fatalErrors(pageErrors)
  if (fatal.length) problems.push(`致命 JS 错误:\n${fatal.join('\n')}`)

  expect(problems, `TC-B04-03 断言失败:\n- ${problems.join('\n- ')}`).toEqual([])
})

test('TC-B04-03: 异常形态（HTML colspan 合并单元格）展开为占位列', async ({ page }) => {
  const pageErrors = collectPageErrors(page)
  await openDoc(page, 'C:\\docs\\paste-demo.md', BLANK_DOC)
  await page.locator('.editor-component').click()

  // rowspan/colspan 合并：Excel 合并单元格导出为 colspan=2；引擎应展开为占位列而非崩溃
  const colspanHtml =
    '<table><tr><td colspan="2">合并</td><td>C</td></tr>' +
    '<tr><td>a</td><td>b</td><td>c</td></tr></table>'
  await paste(page, colspanHtml, '合并\tC\na\tb\tc')

  const table = page.locator('.mu-editor table')
  await expect(table, 'colspan 粘贴应生成表格块').toHaveCount(1)
  const firstRowCells = table.locator('tr').first().locator('th, td')
  await expect(firstRowCells, 'colspan=2 应展开为 3 个独立单元格').toHaveCount(3)

  const fatal = fatalErrors(pageErrors)
  expect(fatal, `致命 JS 错误:\n${fatal.join('\n')}`).toHaveLength(0)
})
