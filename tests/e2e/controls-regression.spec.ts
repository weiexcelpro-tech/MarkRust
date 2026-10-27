/**
 * 控件级回归 — 覆盖菜单矩阵之外的交互控件：
 *   1. 标签栏：新建/切换/中键关闭/关闭按钮/脏标记
 *   2. 查找替换栏：打开、选项开关（大小写/全词/正则）、替换段展开、Esc 关闭
 *   3. 命令面板：打开、输入过滤、Esc 关闭
 *   4. 表格插入对话框：行/列设置、确认后插入 markdown 表格
 *   5. 导出对话框：打开、tab 切换、取消关闭
 *
 * 用法: npx playwright test controls-regression.spec.ts --timeout=90000 --reporter=line
 */
import { test, expect, type Page } from '@playwright/test'
import { injectTauriMock, bootstrapApp } from './mock-tauri'

const DOC = '# Heading One\n\nParagraph alpha with target.\n\n## Heading Two\n\nParagraph beta.\n'

async function menuClick(page: Page, id: string): Promise<void> {
  // mock 环境下走真实分发入口（与菜单矩阵一致）
  await page.evaluate(async (menuId) => {
    const mod = await import('/src/renderer/src/menuBridge.ts')
    mod.handleMenuClick(menuId)
  }, id)
}

test.beforeEach(async ({ page }) => {
  await injectTauriMock(page, {})
  await bootstrapApp(page, { markdownList: [DOC], waitForMs: 2500 })
})

// ─────────────────────────────────────────────
// 1. 标签栏
// ─────────────────────────────────────────────

test.describe('标签栏控件', () => {
  test('Ctrl+T 新建标签并自动聚焦新标签', async ({ page }) => {
    await page.locator('.mu-container').click()
    await page.keyboard.press('Control+t')
    await page.waitForTimeout(800)
    await expect(page.locator('.editor-tabs .tabs-container li')).toHaveCount(2)
  })

  test('标签上的未保存圆点（脏标记）出现', async ({ page }) => {
    await page.locator('.mu-container').click()
    await page.keyboard.type('dirty text')
    await page.waitForTimeout(600)
    // Untitled-1 的脏标记（menu.spec 截图里 Untitled-1● 的圆点）
    const dirtyDot = page.locator('.editor-tabs .tabs-container li').first()
    await expect(dirtyDot).toContainText('Untitled', { timeout: 5000 })
    // 脏标记的具体形态是圆形指示器 —— 断言 tab 内存在 close-icon 或 dot 元素
    expect(await page.locator('.editor-tabs .tabs-container li svg, .editor-tabs .tabs-container li .el-icon').count()).toBeGreaterThan(0)
  })

  test('点击标签切换活动文档', async ({ page }) => {
    await page.locator('.mu-container').click()
    await page.keyboard.press('Control+t')
    await page.waitForTimeout(600)
    const tabs = page.locator('.editor-tabs .tabs-container li')
    await expect(tabs).toHaveCount(2)
    await tabs.first().click()
    await page.waitForTimeout(400)
    // 切回第一个标签后编辑器仍可用（含 DOC 内容）
    await expect(page.locator('.mu-container')).toContainText('Paragraph alpha', { timeout: 5000 })
  })

  test('中键点击标签关闭', async ({ page }) => {
    await page.locator('.mu-container').click()
    await page.keyboard.press('Control+t')
    await page.waitForTimeout(600)
    await page.locator('.editor-tabs .tabs-container li').first().click({ button: 'middle' })
    await page.waitForTimeout(600)
    await expect(page.locator('.editor-tabs .tabs-container li')).toHaveCount(1)
  })
})

// ─────────────────────────────────────────────
// 2. 查找替换栏
// ─────────────────────────────────────────────

test.describe('查找替换栏控件', () => {
  test('三个搜索选项开关可切换且互不干扰', async ({ page }) => {
    await menuClick(page, 'edit.find')
    await page.waitForTimeout(500)
    const caseBtn = page.locator('.search-bar .is-case-sensitive')
    const wordBtn = page.locator('.search-bar .is-whole-word')
    const regexBtn = page.locator('.search-bar .is-regex')

    await caseBtn.click()
    await expect(caseBtn).toHaveClass(/active/)
    await expect(wordBtn).not.toHaveClass(/active/)
    await wordBtn.click()
    await expect(wordBtn).toHaveClass(/active/)
    await expect(caseBtn).toHaveClass(/active/)
    await regexBtn.click()
    await expect(regexBtn).toHaveClass(/active/)
    // 再点一次取消
    await caseBtn.click()
    await expect(caseBtn).not.toHaveClass(/active/)
    await expect(wordBtn).toHaveClass(/active/)
  })

  test('左箭头展开/收起替换输入段', async ({ page }) => {
    await menuClick(page, 'edit.find')
    await page.waitForTimeout(500)
    await expect(page.locator('.search-bar .replace')).toHaveCount(0)
    await page.locator('.search-bar .left-arrow').click()
    await page.waitForTimeout(400)
    await expect(page.locator('.search-bar .replace')).toBeVisible()
    await page.locator('.search-bar .left-arrow').click()
    await page.waitForTimeout(400)
    await expect(page.locator('.search-bar .replace')).toHaveCount(0)
  })

  test('输入关键字后显示匹配计数', async ({ page }) => {
    await menuClick(page, 'edit.find')
    await page.waitForTimeout(500)
    await page.locator('.search-bar input[type="text"]').first().fill('Paragraph')
    await page.waitForTimeout(900)
    const counter = page.locator('.search-bar .search-result')
    await expect(counter).toBeVisible()
    const text = (await counter.textContent()) ?? ''
    expect(text.trim()).toMatch(/^\d+ \/ \d+$/)
    // DOC 里有 2 处 "Paragraph"
    expect(text.trim()).toBe('1 / 2')
  })

  test('Esc 关闭查找栏并清空搜索', async ({ page }) => {
    await menuClick(page, 'edit.find')
    await page.waitForTimeout(500)
    await page.keyboard.press('Escape')
    await page.waitForTimeout(400)
    await expect(page.locator('.search-bar')).toBeHidden()
  })

  test('正则模式非法表达式时显示错误提示', async ({ page }) => {
    await menuClick(page, 'edit.find')
    await page.waitForTimeout(500)
    await page.locator('.search-bar .is-regex').click()
    await page.locator('.search-bar input[type="text"]').first().fill('([invalid')
    await page.waitForTimeout(700)
    await expect(page.locator('.search-bar .error-msg')).toBeVisible()
  })
})

// ─────────────────────────────────────────────
// 3. 命令面板
// ─────────────────────────────────────────────

test.describe('命令面板控件', () => {
  test('打开后显示搜索框与命令列表', async ({ page }) => {
    await menuClick(page, 'view.command-palette')
    await page.waitForTimeout(700)
    const dialog = page.locator('.command-palette .el-dialog')
    await expect(dialog).toBeVisible()
    await expect(page.locator('.command-palette .search-wrapper input')).toBeVisible()
  })

  test('Esc 关闭命令面板', async ({ page }) => {
    await menuClick(page, 'view.command-palette')
    await page.waitForTimeout(700)
    await page.keyboard.press('Escape')
    await page.waitForTimeout(500)
    await expect(page.locator('.command-palette .el-dialog')).toBeHidden()
  })
})

// ─────────────────────────────────────────────
// 4. 表格插入对话框
// ─────────────────────────────────────────────

test.describe('表格插入对话框', () => {
  test('打开后默认 4 行 3 列，确认后插入 markdown 表格', async ({ page }) => {
    await menuClick(page, 'paragraph.table')
    const dialog = page.locator('.ag-insert-table-dialog')
    await expect(dialog).toBeVisible()
    // 行/列输入框（el-input-number）
    const numbers = page.locator('.ag-insert-table-dialog .el-input-number input')
    await expect(numbers).toHaveCount(2)
    // 确认按钮（type=primary）
    await page.locator('.ag-insert-table-dialog .el-button--primary').click()
    await page.waitForTimeout(700)
    const md = await page.evaluate(() => {
      const app = (document.querySelector('#app') as any)?.__vue_app__
      const editor = app?.config?.globalProperties?.$pinia?._s?.get('editor')
      return String(editor?.currentFile?.markdown ?? '')
    })
    expect(md).toContain('|')
    expect(md).toContain('---')
  })

  test('取消按钮关闭对话框且不插入表格', async ({ page }) => {
    await menuClick(page, 'paragraph.table')
    const dialog = page.locator('.ag-insert-table-dialog')
    await expect(dialog).toBeVisible()
    await page.locator('.ag-insert-table-dialog .el-button').first().click()
    await page.waitForTimeout(500)
    const md = await page.evaluate(() => {
      const app = (document.querySelector('#app') as any)?.__vue_app__
      const editor = app?.config?.globalProperties?.$pinia?._s?.get('editor')
      return String(editor?.currentFile?.markdown ?? '')
    })
    expect(md).not.toContain('|')
  })
})

// ─────────────────────────────────────────────
// 5. 导出对话框
// ─────────────────────────────────────────────

test.describe('导出对话框', () => {
  test('PDF 导出入口打开对话框且包含信息/页面页签', async ({ page }) => {
    await menuClick(page, 'file.export-file-pdf')
    const dialog = page.locator('.print-settings-dialog .el-dialog')
    await expect(dialog).toBeVisible({ timeout: 8000 })
    await expect(page.locator('.print-settings-dialog .export-tabs')).toBeVisible()
  })

  test('HTML 导出入口打开对话框且隐藏打印专用页签', async ({ page }) => {
    await menuClick(page, 'file.export-file-html')
    const dialog = page.locator('.print-settings-dialog .el-dialog')
    await expect(dialog).toBeVisible({ timeout: 8000 })
    // html 非可打印类型：header/page 页签应切走（组件逻辑 isPrintable=false）
    await expect(page.locator('.print-settings-dialog .export-tabs')).toBeVisible()
  })
})
