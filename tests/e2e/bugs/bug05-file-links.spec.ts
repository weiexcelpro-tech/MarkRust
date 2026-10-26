/**
 * B05 文件链接不能跳转 —— 跳转链路 + Typora 单击契约 + 目标缺失通知
 *
 * 修复内容（B05）：
 * - store FORMAT_LINK_CLICK：window.DIRNAME 为空/过期时以当前活动标签 pathname 现算
 *   dirname 兜底（真机三路静默失败的公共前端段根因）；目标不存在时通知而非静默；
 * - editor.vue：普通单击渲染态链接即跳转（对标 Typora，捕获阶段监听，不阻断 muya
 *   的光标放置）；Ctrl/Cmd+Click 契约保留（双通道并存）。
 * mock 层断言：format_link_click 调用可达、href/dirname 参数正确、由此可推导绝对路径；
 * 真正的开文件/shell_open_path 在 Rust 侧，mock 环境不可达（记录说明）。
 * 注：修复后前端在发送前会做 fs_path_exists 存在性检查，故本 spec 统一覆盖为 true
 * （缺失路径的通知行为由 TC-B05-05 单独验证）。
 */
import { test, expect, type Page } from '@playwright/test'
import { openDoc, recordInvokes, getRecordedInvokes, fatalErrors, collectPageErrors } from './_helpers'

test.setTimeout(120_000)

const DOC_DIR = 'C:\\link-demo'
const ENTRY_MD = [
  '# Link Demo',
  '',
  '[target](target.md)',
  '',
  '[child](./sub/child.md)',
  '',
  '[parent](../parent.md)',
  '',
  '[plain](sub/child.md)',
  '',
  '[space](my%20file.md)',
  '',
].join('\n')

const LINK_SEL = '.mu-editor span.mu-link'

/** Ctrl+点击第 i 个链接 */
async function ctrlClickLink(page: Page, index: number): Promise<void> {
  const link = page.locator(LINK_SEL).nth(index)
  await link.scrollIntoViewIfNeeded()
  await page.keyboard.down('Control')
  await link.click()
  await page.keyboard.up('Control')
  await page.waitForTimeout(400)
}

/** win32 语义 join（与 Rust 侧 dirname + 相对路径拼接一致的最小推导） */
function joinWin(dir: string, href: string): string {
  const clean = href.replace(/^\.\//, '')
  // pathe 产出的 dirname 可能是正斜杠形态（C:/link-demo），统一按两种分隔符切分
  const parts = `${dir}\\${clean}`.split(/[\\/]/)
  const out: string[] = []
  for (const part of parts) {
    if (part === '' || part === '.') continue
    if (part === '..') { out.pop(); continue }
    out.push(part)
  }
  return out.join('\\')
}

// pathe（渲染层 window.path）在 Windows 上产出正斜杠目录（C:/link-demo），
// 与 Rust 侧反斜杠形态等价 —— 比较前统一分隔符。
const norm = (p: string): string => p.replace(/[\\/]+/g, '/')

test('TC-B05-01: 点击相对链接触发 format_link_click 且参数足以解析出绝对路径', async ({ page }) => {
  const pageErrors = collectPageErrors(page)
  await openDoc(page, `${DOC_DIR}\\entry.md`, ENTRY_MD, {
    overrides: { fs_path_exists: true }
  })
  await recordInvokes(page)

  // link wrapper 渲染为 span.mu-link（预览态）
  await expect(page.locator(LINK_SEL).first()).toBeVisible({ timeout: 10000 })
  await ctrlClickLink(page, 0)

  const invokes = await getRecordedInvokes(page)
  const clicks = invokes.filter((i) => i.cmd === 'format_link_click')
  // eslint-disable-next-line no-console
  console.log('[B05-01] format_link_click 调用:', JSON.stringify(clicks.map((c) => c.args)))

  const problems: string[] = []
  if (clicks.length !== 1) {
    problems.push(`期望恰好 1 次 format_link_click，实际 ${clicks.length} 次`)
  } else {
    const args = clicks[0]!.args as { data?: { href?: string }; dirname?: string }
    const href = args?.data?.href
    const dirname = args?.dirname
    if (href !== 'target.md') problems.push(`href 应为原始相对串 'target.md'，实际 '${String(href)}'`)
    if (!dirname || !/^[A-Za-z]:[\\/]/.test(dirname)) {
      problems.push(`dirname 应为文档绝对目录 '${DOC_DIR}'，实际 '${String(dirname)}'（缺失则 Rust 侧无法解析相对路径）`)
    } else {
      const resolved = joinWin(dirname, href ?? '')
      if (norm(resolved) !== norm(`${DOC_DIR}\\target.md`)) {
        problems.push(`由 dirname+href 推导的绝对路径应为 '${DOC_DIR}\\target.md'，实际 '${resolved}'`)
      }
    }
  }
  const fatal = fatalErrors(pageErrors)
  if (fatal.length) problems.push(`致命 JS 错误:\n${fatal.join('\n')}`)

  expect(problems, `TC-B05-01 断言失败:\n- ${problems.join('\n- ')}`).toEqual([])
})

test('TC-B05-04: 子目录/上级目录/普通相对/百分号编码路径的参数矩阵', async ({ page }) => {
  const pageErrors = collectPageErrors(page)
  await openDoc(page, `${DOC_DIR}\\entry.md`, ENTRY_MD, {
    overrides: { fs_path_exists: true }
  })
  await recordInvokes(page)
  await expect(page.locator(LINK_SEL)).toHaveCount(5, { timeout: 10000 })

  // 文档序：target / ./sub/child / ../parent / sub/child / my%20file
  const cases = [
    { href: './sub/child.md', expectedAbs: `${DOC_DIR}\\sub\\child.md` },
    { href: '../parent.md', expectedAbs: 'C:\\parent.md' },
    { href: 'sub/child.md', expectedAbs: `${DOC_DIR}\\sub\\child.md` },
    { href: 'my%20file.md', expectedAbs: `${DOC_DIR}\\my file.md` }, // %20 解码在 Rust 侧，mock 层验证原始 href + 可解码性
  ]
  for (let i = 1; i <= 4; i++) {
    await ctrlClickLink(page, i)
  }

  const invokes = await getRecordedInvokes(page)
  const clicks = invokes.filter((i) => i.cmd === 'format_link_click')
  // eslint-disable-next-line no-console
  console.log('[B05-04] 全部调用:', JSON.stringify(clicks.map((c) => c.args)))

  const problems: string[] = []
  if (clicks.length !== 4) {
    problems.push(`期望 4 次 format_link_click，实际 ${clicks.length} 次`)
  } else {
    for (let i = 0; i < 4; i++) {
      const args = clicks[i]!.args as { data?: { href?: string }; dirname?: string }
      const href = args?.data?.href ?? ''
      const dirname = args?.dirname ?? ''
      if (href !== cases[i]!.href) {
        problems.push(`第 ${i + 1} 次点击 href 应为 '${cases[i]!.href}'，实际 '${href}'`)
      }
      if (norm(dirname) !== norm(DOC_DIR)) {
        problems.push(`第 ${i + 1} 次点击 dirname 应为 '${DOC_DIR}'，实际 '${dirname}'`)
      }
      // my%20file.md：渲染层传原始编码串（URL 解码归 Rust），验证解码后可得到目标路径
      const decoded = decodeURIComponent(href)
      const resolved = joinWin(dirname, decoded)
      if (norm(resolved) !== norm(cases[i]!.expectedAbs)) {
        problems.push(`第 ${i + 1} 次点击推导绝对路径应为 '${cases[i]!.expectedAbs}'，实际 '${resolved}'`)
      }
    }
  }
  const fatal = fatalErrors(pageErrors)
  if (fatal.length) problems.push(`致命 JS 错误:\n${fatal.join('\n')}`)

  expect(problems, `TC-B05-04 断言失败:\n- ${problems.join('\n- ')}`).toEqual([])
})

test('TC-B05-EXTRA: 普通单击渲染态链接即跳转（对标 Typora 单击契约；Ctrl+Click 保留）', async ({ page }) => {
  const pageErrors = collectPageErrors(page)
  await openDoc(page, `${DOC_DIR}\\entry.md`, ENTRY_MD, {
    overrides: { fs_path_exists: true }
  })
  await recordInvokes(page)
  await expect(page.locator(LINK_SEL).first()).toBeVisible({ timeout: 10000 })

  // 普通左键单击（无修饰键）—— 修复后契约：单击渲染态链接即走跳转管线（Typora 行为）
  await page.locator(LINK_SEL).first().click()
  await page.waitForTimeout(600)

  const invokes = await getRecordedInvokes(page)
  const clicks = invokes.filter((i) => i.cmd === 'format_link_click')
  // eslint-disable-next-line no-console
  console.log('[B05-EXTRA] 普通单击后 format_link_click 调用:', JSON.stringify(clicks.map((c) => c.args)))

  const problems: string[] = []
  if (clicks.length !== 1) {
    problems.push(`普通单击渲染态链接应恰好触发 1 次 format_link_click（Typora 单击契约），实际 ${clicks.length} 次`)
  } else {
    const args = clicks[0]!.args as { data?: { href?: string }; dirname?: string }
    if (args?.data?.href !== 'target.md') {
      problems.push(`href 应为 'target.md'，实际 '${String(args?.data?.href)}'`)
    }
    if (norm(args?.dirname ?? '') !== norm(DOC_DIR)) {
      problems.push(`dirname 应为 '${DOC_DIR}'，实际 '${String(args?.dirname)}'`)
    }
  }
  const fatal = fatalErrors(pageErrors)
  if (fatal.length) problems.push(`致命 JS 错误:\n${fatal.join('\n')}`)

  expect(problems, `TC-B05-EXTRA 断言失败:\n- ${problems.join('\n- ')}`).toEqual([])
})

test('TC-B05-05: 链接目标不存在时给出通知而非静默（不发 format_link_click）', async ({ page }) => {
  const pageErrors = collectPageErrors(page)
  // fs_path_exists=false（mock 默认）：模拟链接目标在磁盘上缺失
  await openDoc(page, `${DOC_DIR}\\entry.md`, ENTRY_MD)
  await recordInvokes(page)
  await expect(page.locator(LINK_SEL).first()).toBeVisible({ timeout: 10000 })

  await ctrlClickLink(page, 0)
  await page.waitForTimeout(600)

  const invokes = await getRecordedInvokes(page)
  const clicks = invokes.filter((i) => i.cmd === 'format_link_click')
  // eslint-disable-next-line no-console
  console.log('[B05-05] format_link_click 次数:', clicks.length)

  const problems: string[] = []
  if (clicks.length !== 0) {
    problems.push(`目标不存在时不应把链接交给 Rust 打开（预期 0 次 format_link_click），实际 ${clicks.length} 次`)
  }
  // 通知而非静默：mt-notification（error 形态）应出现并包含目标信息
  const notice = page.locator('.mt-notification.mt-error', { hasText: 'Link target not found' })
  if ((await notice.count()) === 0) {
    problems.push('目标不存在时应弹出「Link target not found」错误通知（.mt-notification.mt-error），实际未见')
  }
  const fatal = fatalErrors(pageErrors)
  if (fatal.length) problems.push(`致命 JS 错误:\n${fatal.join('\n')}`)

  expect(problems, `TC-B05-05 断言失败:\n- ${problems.join('\n- ')}`).toEqual([])
})
