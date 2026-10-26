/**
 * B10 导出 docx 有时丢失表头 —— TC-B10-02 导出管线中间产物保留表头标记
 *
 * 勘察修正（v1.1.6 分支）：仓库现含真实 docx 导出链：
 *   bus 'export' {type:'docx'} → editor.handleExport → editorStore.EXPORT({type, content: markdown})
 *   → send 'mt::response-export' → bridge invoke('export_docx', {req:{markdown, pathname, ...}})。
 * 中间产物 = 传给 Rust 的 **markdown** 载荷 → 按用例设计断言「完整保留表头行 + 分隔行」；
 * 另测 styledHtml 管线（HTML 中间产物，经 dialog_save_file → fs_write_file 字节落盘）
 * 断言 <thead>/<th> 存在 → 把「丢表头」定界到 docx 生成环节（Rust 侧，REAL 用例范围）。
 */
import { test, expect } from '@playwright/test'
import { openDoc, recordInvokes, getRecordedInvokes, emitBus, fatalErrors, collectPageErrors, } from './_helpers'


test.setTimeout(120_000)

const TABLE_DOC = [
  '# Table Export Demo',
  '',
  '| A | B | C |',
  '| --- | --- | --- |',
  '| a1 | b1 | c1 |',
  '| a2 | b2 | c2 |',
  '',
  '| 姓名 | 数量 | 备注 |',
  '| :--- | :---: | ---: |',
  '| 张三 | 3 | ok |',
  '',
  '段落定位锚：两个表格之间不得串位。',
  '',
].join('\n')

test('TC-B10-02: 触发导出 docx，捕获提交给 Rust 的 markdown 载荷并断言表头保留', async ({ page }) => {
  const pageErrors = collectPageErrors(page)
  await openDoc(page, 'C:\\docs\\table-export.md', TABLE_DOC)
  await recordInvokes(page)

  // 与导出菜单（commands/index.ts 'file.export-file-docx' → bus showExportDialog('docx')
  // → 导出对话框确认）等效的最短触发路径：直接 emit bus 'export'
  await emitBus(page, 'export', { type: 'docx' })
  await page.waitForTimeout(2500)

  const invokes = await getRecordedInvokes(page)
  const docxInvokes = invokes.filter((i) => i.cmd === 'export_docx')
  // eslint-disable-next-line no-console
  console.log(
    '[B10-02] invoke 序列:', invokes.map((i) => i.cmd).join(',') || '(空)',
    '| export_docx 次数:', docxInvokes.length,
  )

  const problems: string[] = []
  if (docxInvokes.length === 0) {
    problems.push('触发 docx 导出后未记录到 export_docx invoke（导出链未到达 Rust 边界）')
  } else {
    const req = (docxInvokes[0]!.args as { req?: { markdown?: string; pathname?: string } }).req ?? {}
    const markdown = req.markdown ?? ''
    // eslint-disable-next-line no-console
    console.log('[B10-02] 载荷 markdown 前 200 字:\n', markdown.slice(0, 200))
    // 表头行 + 分隔行完整保留（进入 docx 生成器之前未丢失）。
    // 序列化会按列宽补齐空格（如 | A | B | C | → | A  | B  | C  |），用容差正则。
    if (!/\|\s*A\s*\|\s*B\s*\|\s*C\s*\|/.test(markdown)) problems.push('docx 载荷丢失表头行 A/B/C')
    if (!/\|\s*---\s*\|\s*---\s*\|\s*---\s*\|/.test(markdown)) problems.push('docx 载荷丢失分隔行 "| --- | --- | --- |"')
    if (!/\|\s*姓名\s*\|\s*数量\s*\|\s*备注\s*\|/.test(markdown)) problems.push('docx 载荷丢失中文表头行')
    for (const cell of ['a1', 'b2', '张三', 'ok']) {
      if (!markdown.includes(cell)) problems.push(`docx 载荷丢失数据单元格: ${cell}`)
    }
    if (req.pathname !== 'C:\\docs\\table-export.md') {
      problems.push(`docx 载荷 pathname 应为文档路径，实际 '${String(req.pathname)}'`)
    }
  }
  const fatal = fatalErrors(pageErrors)
  if (fatal.length) problems.push(`致命 JS 错误:\n${fatal.join('\n')}`)

  expect(problems, `TC-B10-02 断言失败:\n- ${problems.join('\n- ')}`).toEqual([])
})

test('TC-B10-02B: styledHtml 管线中间产物（HTML）含 thead/th 表头标记', async ({ page }) => {
  const pageErrors = collectPageErrors(page)
  await openDoc(page, 'C:\\docs\\table-export.md', TABLE_DOC, {
    overrides: { dialog_save_file: 'C:\\export\\table-export.html' },
  })
  await recordInvokes(page)

  await emitBus(page, 'export', { type: 'styledHtml' })
  await page.waitForTimeout(4000) // exportStyledHTML: MarkdownToHtml + DOMPurify + 图片处理

  const invokes = await getRecordedInvokes(page)
  const writes = invokes.filter((i) => i.cmd === 'fs_write_file')
  // eslint-disable-next-line no-console
  console.log(
    '[B10-02B] invoke 序列:', invokes.map((i) => i.cmd).join(',') || '(空)',
    '| fs_write_file 次数:', writes.length,
  )

  const problems: string[] = []
  if (writes.length === 0) {
    problems.push('styledHtml 导出未产生 fs_write_file（dialog_save_file 已 mock 为有效路径，链路不应中断）')
  } else {
    const args = writes[0]!.args as { path?: string; data?: unknown }
    let html = ''
    if (Array.isArray(args.data)) html = new TextDecoder().decode(new Uint8Array(args.data as number[]))
    else html = String(args.data ?? '')
    // eslint-disable-next-line no-console
    console.log('[B10-02B] 导出 HTML 长度:', html.length, '| 含 thead:', html.includes('<thead'), '| 含 <th:', html.includes('<th'))
    if (!html.includes('<thead')) problems.push('导出 HTML 中间产物缺少 <thead>')
    if (!html.includes('<th')) problems.push('导出 HTML 中间产物缺少 <th> 表头单元格')
    if (!html.includes('| A | B | C |') && !html.includes('>A</th>')) {
      problems.push('导出 HTML 中间产物丢失表头内容 A/B/C')
    }
    if (!html.includes('张三')) problems.push('导出 HTML 中间产物丢失中文表体内容')
  }
  const fatal = fatalErrors(pageErrors)
  if (fatal.length) problems.push(`致命 JS 错误:\n${fatal.join('\n')}`)

  expect(problems, `TC-B10-02B 断言失败:\n- ${problems.join('\n- ')}`).toEqual([])
})
