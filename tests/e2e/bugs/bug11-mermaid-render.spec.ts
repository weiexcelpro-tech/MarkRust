/**
 * B11 导出 docx 时 mermaid 输出源码 —— 渲染基线 + 导出管线替换断言
 *
 * 修复（前端侧，与 Rust 契约）：导出 docx 前，editor.vue handleExport 的 docx 分支把
 * markdown 中每个 ```mermaid 代码块替换为 ![mermaid](data:image/png;base64,<b64>)
 * （util/mermaidExport.ts：每围栏独立走 MarkdownToHtml._renderMermaid 渲染出 svg，
 * 序列化后经 canvas 转 PNG data URI，2x 缩放、宽度上限 1600px；失败块保留源码继续）。
 * TC-B11-02C 捕获 export_docx 载荷，断言 mermaid 源码已被 data URI 图片替换。
 */
import { test, expect } from '@playwright/test'
import {
  openDoc,
  recordInvokes,
  getRecordedInvokes,
  emitBus,
  fatalErrors,
  collectPageErrors
} from './_helpers'


test.setTimeout(120_000)

const MERMAID_DOC = [
  '# Mermaid Demo',
  '',
  '```mermaid',
  'graph TD; A-->B; B-->C;',
  '```',
  '',
  '```mermaid',
  'sequenceDiagram',
  'A->>B: hello',
  '```',
  '',
  '```js',
  "console.log('plain code')",
  '```',
  '',
].join('\n')

test('TC-B11-02: 编辑器内 mermaid 渲染基线（svg 存在、diagram 块结构完整）', async ({ page }) => {
  const pageErrors = collectPageErrors(page)
  await openDoc(page, 'C:\\docs\\mermaid-demo.md', MERMAID_DOC)

  // mermaid 首次初始化较慢（本地 npm 包、可离线），放宽超时
  await expect(page.locator('.mu-editor svg').first()).toBeVisible({ timeout: 30000 })
  const svgCount = await page.locator('.mu-editor svg').count()
  // eslint-disable-next-line no-console
  console.log('[B11-02] 编辑器内 svg 数量:', svgCount)
  expect(svgCount, '两个 mermaid 块应至少渲染出 1 个 svg（编辑器渲染基线）').toBeGreaterThanOrEqual(1)

  // 基线说明（实测修正）：muya 的 diagram 块 = 可编辑代码区 + 渲染预览，
  // 编辑器 innerText 中保留 mermaid 源码文本是设计行为（代码区可见），
  // 「导出产物中是源码还是图片」的分界断言放在 TC-B11-02B 的导出管线检查中。
  // 此处锁定：svg 已渲染（预览存在）+ 普通 js 代码块仍是文本（不误转图片）。
  const editorText = await page.locator('.editor-component').innerText()
  expect(editorText).toContain('plain code') // 普通代码块保持文本

  const fatal = fatalErrors(pageErrors)
  expect(fatal, `致命 JS 错误:\n${fatal.join('\n')}`).toHaveLength(0)
})

test('TC-B11-02B(增补): styledHtml 导出管线中 mermaid 块应变为 svg 而非源码文本', async ({ page }) => {
  const pageErrors = collectPageErrors(page)
  await openDoc(page, 'C:\\docs\\mermaid-demo.md', MERMAID_DOC, {
    overrides: { dialog_save_file: 'C:\\export\\mermaid-export.html' },
  })
  await recordInvokes(page)

  // 先等编辑器内渲染基线就绪（导出链的 _renderMermaid 独立执行，不依赖此等待，仅稳定时序）
  await expect(page.locator('.mu-editor svg').first()).toBeVisible({ timeout: 30000 })

  await emitBus(page, 'export', { type: 'styledHtml' })
  await page.waitForTimeout(6000) // MarkdownToHtml + mermaid.run + DOMPurify + 图片处理

  const invokes = await getRecordedInvokes(page)
  const writes = invokes.filter((i) => i.cmd === 'fs_write_file')
  // eslint-disable-next-line no-console
  console.log('[B11-02B] invoke 序列:', invokes.map((i) => i.cmd).join(',') || '(空)')

  const problems: string[] = []
  if (writes.length === 0) {
    problems.push('styledHtml 导出未产生 fs_write_file（链路中断）')
  } else {
    const args = writes[0]!.args as { data?: unknown }
    let html = ''
    if (Array.isArray(args.data)) html = new TextDecoder().decode(new Uint8Array(args.data as number[]))
    else html = String(args.data ?? '')
    // eslint-disable-next-line no-console
    console.log(
      '[B11-02B] 导出 HTML 长度:', html.length,
      '| 含 <svg:', html.includes('<svg'),
      '| 含 graph TD 源码:', html.includes('graph TD'),
      '| 含 A--> 源码:', html.includes('A-->'),
    )
    if (!html.includes('<svg')) {
      problems.push('导出 HTML 中 mermaid 未渲染为 svg（_renderMermaid 未成功替换节点）')
    }
    if (html.includes('graph TD') || html.includes('A-->')) {
      problems.push('导出 HTML 中残留 mermaid 源码文本（「导出为源码而非图片」的复现形态）')
    }
    if (!html.includes('plain code')) problems.push('导出 HTML 丢失普通 js 代码块文本（不应被误转图片）')
  }
  const fatal = fatalErrors(pageErrors)
  if (fatal.length) problems.push(`致命 JS 错误:\n${fatal.join('\n')}`)

  expect(problems, `TC-B11-02B 断言失败:\n- ${problems.join('\n- ')}`).toEqual([])
})

test('TC-B11-02C(修复验证): docx 导出载荷中 mermaid 源码已被 data URI 图片替换', async ({ page }) => {
  const pageErrors = collectPageErrors(page)
  // export_docx 覆盖：记录 req（捕获导出载荷）并返回成功结构
  await openDoc(page, 'C:\\docs\\mermaid-demo.md', MERMAID_DOC, {
    overrides: {
      export_docx: { path: 'C:\\export\\mermaid-export.docx', size: 12345, imageCount: 2, warnings: [] }
    }
  })
  await recordInvokes(page)

  // 先等编辑器内渲染基线就绪（仅稳定时序；导出链的 mermaid 渲染独立执行）
  await expect(page.locator('.mu-editor svg').first()).toBeVisible({ timeout: 30000 })

  await emitBus(page, 'export', { type: 'docx' })

  // mermaid 渲染 + canvas 光栅化在首次执行时较慢（动态 import mermaid），放宽轮询上限
  await expect
    .poll(
      async () => {
        const inv = await getRecordedInvokes(page)
        return inv.filter((i) => i.cmd === 'export_docx').length
      },
      { timeout: 60_000, intervals: [1000, 2000, 5000] }
    )
    .toBeGreaterThanOrEqual(1)

  const invokes = await getRecordedInvokes(page)
  const exports = invokes.filter((i) => i.cmd === 'export_docx')
  // eslint-disable-next-line no-console
  console.log('[B11-02C] invoke 序列:', invokes.map((i) => i.cmd).join(',') || '(空)')

  const problems: string[] = []
  const req = (exports[0]!.args as { req?: { markdown?: string } }).req
  const markdown = req?.markdown ?? ''
  // eslint-disable-next-line no-console
  console.log(
    '[B11-02C] 载荷长度:', markdown.length,
    '| 含 data:image/png;base64:', markdown.includes('data:image/png;base64,'),
    '| 含 ![mermaid](:', markdown.includes('![mermaid]('),
    '| 含 graph TD 源码:', markdown.includes('graph TD'),
    '| 含 A--> 源码:', markdown.includes('A-->'),
    '| 含 sequenceDiagram 源码:', markdown.includes('sequenceDiagram'),
    '| js 代码块保留:', markdown.includes('plain code')
  )
  if (!markdown.includes('![mermaid](data:image/png;base64,')) {
    problems.push('导出载荷中未发现 ![mermaid](data:image/png;base64,…) 图片替换（mermaid→PNG 预处理未生效）')
  }
  if (markdown.includes('graph TD') || markdown.includes('A-->') || markdown.includes('sequenceDiagram')) {
    problems.push('导出载荷中残留 mermaid 源码文本（```mermaid 块未被图片替换 → docx 内将输出源码）')
  }
  if (!markdown.includes('plain code')) {
    problems.push('导出载荷丢失普通 js 代码块文本（不应被误替换）')
  }
  const mermaidImageCount = markdown.split('![mermaid](data:image/png;base64,').length - 1
  if (mermaidImageCount !== 2) {
    problems.push(`两个 mermaid 块都应替换为图片，实际替换 ${mermaidImageCount} 个`)
  }
  const fatal = fatalErrors(pageErrors)
  if (fatal.length) problems.push(`致命 JS 错误:\n${fatal.join('\n')}`)

  expect(problems, `TC-B11-02C 断言失败:\n- ${problems.join('\n- ')}`).toEqual([])
})
