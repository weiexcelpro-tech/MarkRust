/**
 * MENU MATRIX E2E — 参数化遍历 menu.rs 全部 74 个菜单项。
 *
 * 每项通过页面内 import('/src/renderer/src/menuBridge.ts') 调用真实的
 * handleMenuClick(id)（与 Rust 菜单点击完全相同的分发入口），然后按命令
 * 类别做"落点断言"：
 *
 *   md       — 断言文档 markdown 变化（段落/格式/编辑类命令）
 *   invoke   — 断言 mock 层 invoke 收到预期命令（文件/导出/窗口类命令）
 *   store    — 断言 Pinia store 状态翻转（视图切换类命令）
 *   dom      — 断言 UI 结构出现（搜索栏/导出对话框/命令面板等）
 *   smoke    — 仅断言无新增页面异常（弱断言，待后续收紧）
 *
 * 另有全局守卫：任何用例执行期间新增 pageerror 一律判红。
 *
 * 用法: npx playwright test menu-matrix.spec.ts --timeout=90000 --reporter=line
 */
import { test, expect, type Page } from '@playwright/test'
import { injectTauriMock, bootstrapApp, MOCK_INVOKE_RESPONSES } from './mock-tauri'

// ─────────────────────────────────────────────
// Fixtures & helpers
// ─────────────────────────────────────────────

const DOC = [
  '# Heading One',
  '',
  'Paragraph alpha with target.',
  '',
  '## Heading Two',
  '',
  'Paragraph beta.',
  '',
].join('\n')

const CURSOR_TARGET = 'Paragraph alpha'
const SELECT_TARGET = 'alpha'
const HEADING1 = 'Heading One'
const HEADING2 = 'Heading Two'
const TYPED = 'XYZ123'

async function trigger(page: Page, id: string): Promise<void> {
  await page.evaluate(async (menuId) => {
    const mod = await import('/src/renderer/src/menuBridge.ts')
    mod.handleMenuClick(menuId)
  }, id)
}

async function getMd(page: Page): Promise<string> {
  return page.evaluate(() => {
    const app = (document.querySelector('#app') as any)?.__vue_app__
    const editor = app?.config?.globalProperties?.$pinia?._s?.get('editor')
    return String(editor?.currentFile?.markdown ?? '')
  })
}

async function getStore(page: Page, name: string, key: string): Promise<unknown> {
  return page.evaluate(([storeName, storeKey]) => {
    const app = (document.querySelector('#app') as any)?.__vue_app__
    const store = app?.config?.globalProperties?.$pinia?._s?.get(String(storeName))
    return store ? (store as any)[String(storeKey)] : undefined
  }, [name, key])
}

async function recordedCmds(page: Page): Promise<string[]> {
  return page.evaluate(() => {
    const log = (window as any).__MOCK_INVOKE_LOG__ as Array<{ cmd: string }> | undefined
    return (log ?? []).map((e) => e.cmd)
  })
}

/** 在包含指定文本的块上放置光标（单击末尾附近）。 */
async function placeCursor(page: Page, target: string, scope = 'p, h1, h2, h3, h4, h5, h6'): Promise<void> {
  const loc = page.locator(`.mu-container ${scope}`).filter({ hasText: target }).first()
  await loc.click()
  await page.waitForTimeout(250)
}

/** 双击选中目标词（格式化命令需要选区）。 */
async function selectWord(page: Page, target: string): Promise<void> {
  const loc = page.locator(`.mu-container p`).filter({ hasText: target }).first()
  await loc.dblclick()
  await page.waitForTimeout(250)
}

async function tabCount(page: Page): Promise<number> {
  return page.locator('.editor-tabs .tabs-container li').count()
}

// ─────────────────────────────────────────────
// Matrix definition
// ─────────────────────────────────────────────

type Setup =
  | { kind: 'cursor'; target: string; scope?: string }
  | { kind: 'select'; target: string }
  | { kind: 'kbSelect'; target: string }
  | { kind: 'type' }
  | { kind: 'typeUndo' }
  | { kind: 'boldSel' }
  | { kind: 'openFind' }
  | { kind: 'none' }

type Assert =
  | { kind: 'mdContains'; text: string }
  | { kind: 'mdNotContains'; text: string }
  | { kind: 'mdChanged' }
  | { kind: 'invokeAny'; cmds: string[] }
  | { kind: 'domVisible'; selector: string }
  | { kind: 'storeIs'; store: string; key: string; value: unknown }
  | { kind: 'tabs'; op: 'inc' | 'dec' }
  | { kind: 'smoke' }

interface MatrixEntry {
  id: string
  setup?: Setup
  assert: Assert
  note?: string
}

const A = {
  mdContains: (text: string): Assert => ({ kind: 'mdContains', text }),
  mdNotContains: (text: string): Assert => ({ kind: 'mdNotContains', text }),
  mdChanged: (): Assert => ({ kind: 'mdChanged' }),
  invokeAny: (...cmds: string[]): Assert => ({ kind: 'invokeAny', cmds }),
  dom: (selector: string): Assert => ({ kind: 'domVisible', selector }),
  storeIs: (store: string, key: string, value: unknown): Assert => ({ kind: 'storeIs', store, key, value }),
  tabs: (op: 'inc' | 'dec'): Assert => ({ kind: 'tabs', op }),
  smoke: (): Assert => ({ kind: 'smoke' }),
}
const CUR = { kind: 'cursor', target: CURSOR_TARGET } as const
const SEL = { kind: 'select', target: SELECT_TARGET } as const
const KBSEL2 = { kind: 'kbSelect', target: CURSOR_TARGET } as const
const KBSEL = KBSEL2

const MATRIX: MatrixEntry[] = [
  // ── 段落（默认光标在 "Paragraph alpha"）──
  { id: 'paragraph.heading-1', assert: A.mdContains('# Paragraph alpha') },
  { id: 'paragraph.heading-2', assert: A.mdContains('## Paragraph alpha') },
  { id: 'paragraph.heading-3', assert: A.mdContains('### Paragraph alpha') },
  { id: 'paragraph.heading-4', assert: A.mdContains('#### Paragraph alpha') },
  { id: 'paragraph.heading-5', assert: A.mdContains('##### Paragraph alpha') },
  { id: 'paragraph.heading-6', assert: A.mdContains('###### Paragraph alpha') },
  { id: 'paragraph.paragraph', setup: { kind: 'cursor', target: HEADING1 }, assert: A.mdNotContains('# Heading One'), note: '标题转回正文' },
  { id: 'paragraph.reset-paragraph', setup: { kind: 'cursor', target: HEADING2 }, assert: A.mdChanged, note: '重置为普通段落' },
  { id: 'paragraph.upgrade-heading', setup: { kind: 'cursor', target: HEADING2 }, assert: A.mdChanged, note: '标题升级（方向由实现定义）' },
  { id: 'paragraph.degrade-heading', setup: { kind: 'cursor', target: HEADING1 }, assert: A.mdChanged, note: '标题降级' },
  { id: 'paragraph.quote-block', assert: A.mdContains('> Paragraph alpha') },
  { id: 'paragraph.code-fence', assert: A.mdContains('```') },
  { id: 'paragraph.math-formula', assert: A.mdContains('$$') },
  { id: 'paragraph.html-block', assert: A.mdChanged, note: '插入 HTML 块（具体标签由实现定义）' },
  { id: 'paragraph.horizontal-line', assert: A.mdContains('---') },
  { id: 'paragraph.table', assert: A.dom('.ag-insert-table-dialog'), note: '先弹表格规格对话框，确认后才插入' },
  { id: 'paragraph.order-list', assert: A.mdContains('1. ') },
  { id: 'paragraph.bullet-list', assert: A.mdContains('- Paragraph alpha') },
  { id: 'paragraph.task-list', assert: A.mdContains('- [ ]') },
  { id: 'paragraph.front-matter', assert: A.mdChanged, note: '插入 front matter 块' },
  { id: 'paragraph.loose-list-item', assert: A.smoke(), note: '松散列表切换对 markdown 无稳定可见变化，仅冒烟' },

  // ── 格式（光标进段落，键盘选整行；dblclick 在 muya 中选不中目标词）──
  { id: 'strongMenuItem', setup: KBSEL2, assert: A.mdContains('**Paragraph alpha') },
  { id: 'emphasisMenuItem', setup: KBSEL, assert: A.mdContains('*Paragraph alpha') },
  { id: 'strikeMenuItem', setup: KBSEL, assert: A.mdContains('~~') },
  { id: 'inlineCodeMenuItem', setup: KBSEL, assert: A.mdContains('`') },
  { id: 'underlineMenuItem', setup: KBSEL, assert: A.mdChanged, note: '下划线（<u> 或等价）' },
  { id: 'inlineMathMenuItem', setup: KBSEL, assert: A.mdChanged, note: '行内公式（$…$）' },
  { id: 'highlightMenuItem', setup: KBSEL, assert: A.mdChanged, note: '高亮（==…==）' },
  { id: 'superscriptMenuItem', setup: KBSEL, assert: A.mdChanged, note: '上标（^…^）' },
  { id: 'subscriptMenuItem', setup: KBSEL, assert: A.mdChanged, note: '下标（~…~）' },
  { id: 'hyperlinkMenuItem', setup: KBSEL, assert: A.mdChanged, note: '链接包装（[text](…)）' },
  { id: 'imageMenuItem', assert: A.smoke(), note: '打开图片选择浮层' },
  { id: 'format.clear-format', setup: { kind: 'boldSel' }, assert: A.mdNotContains('**alpha**'), note: '清除加粗' },

  // ── 编辑 ──
  { id: 'edit.undo', setup: { kind: 'type' }, assert: A.mdNotContains(TYPED) },
  { id: 'edit.redo', setup: { kind: 'typeUndo' }, assert: A.mdContains(TYPED) },
  { id: 'edit.duplicate', setup: { kind: 'cursor', target: 'Paragraph beta' }, assert: A.mdChanged, note: '复制当前段落' },
  { id: 'edit.create-paragraph', setup: { kind: 'cursor', target: 'Paragraph beta' }, assert: A.mdChanged },
  { id: 'edit.delete-paragraph', setup: { kind: 'cursor', target: 'Paragraph beta' }, assert: A.mdNotContains('Paragraph beta') },
  { id: 'edit.copy-as-rich', setup: KBSEL2, assert: A.smoke(), note: '写剪贴板走 Clipboard API，headless 无权限，仅验证派发' },
  { id: 'edit.paste-as-plaintext', assert: A.mdContains('pastedPlain'), note: '读剪贴板走 Tauri invoke，mock 提供 pastedPlain' },
  { id: 'edit.find', assert: A.dom('.search-bar') },
  { id: 'edit.replace', assert: A.dom('.search-bar .replace') },
  { id: 'edit.find-next', setup: { kind: 'openFind' }, assert: A.dom('.search-bar'), note: '查找下一个（空查询时保持栏打开）' },
  { id: 'edit.find-previous', setup: { kind: 'openFind' }, assert: A.dom('.search-bar'), note: '查找上一个' },
  { id: 'edit.find-in-folder', assert: A.storeIs('layout', 'rightColumn', 'search'), note: '侧栏切到搜索面板' },

  // ── 文件 ──
  { id: 'file.new-tab', assert: A.tabs('inc') },
  { id: 'file.close-tab', assert: A.tabs('dec') },
  { id: 'file.open-file', assert: A.invokeAny('dialog_open_file') },
  { id: 'file.open-folder', assert: A.invokeAny('dialog_open_directory') },
  { id: 'file.save', assert: A.invokeAny('markdown_save', 'dialog_save_file', 'fs_write_file'), note: '未命名文档走另存对话框' },
  { id: 'file.save-as', assert: A.invokeAny('dialog_save_file') },
  { id: 'file.rename-file', assert: A.smoke(), note: '重命名交互为对话框/内联输入' },
  { id: 'file.move-file', assert: A.invokeAny('dialog_open_directory', 'fs_move', 'dialog_save_file'), note: '未命名文档先另存' },
  { id: 'file.export-file-pdf', assert: A.dom('.print-settings-dialog .el-dialog') },
  { id: 'file.export-file-docx', assert: A.dom('.print-settings-dialog .el-dialog') },
  { id: 'file.export-file-html', assert: A.dom('.print-settings-dialog .el-dialog') },
  { id: 'file.print', assert: A.dom('.print-settings-dialog .el-dialog') },
  { id: 'file.new-window', assert: A.invokeAny('window_new_editor') },
  { id: 'file.preferences', assert: A.smoke(), note: '设置入口（侧栏设置面板或独立窗口）' },
  { id: 'file.close-window', assert: A.invokeAny('window_close', 'plugin:dialog|confirm'), note: '关闭确认链路' },
  { id: 'file.quit', assert: A.invokeAny('window_close'), note: '退出 = 关闭主窗口' },

  // ── 视图 ──
  { id: 'sideBarMenuItem', assert: A.storeIs('layout', 'showSideBar', false), note: '默认开 → 切关' },
  { id: 'tabBarMenuItem', assert: A.storeIs('layout', 'showTabBar', false), note: 'bootstrap 默认开 → 切关' },
  { id: 'tocMenuItem', assert: A.storeIs('layout', 'rightColumn', ''), note: '默认 toc → 切空' },
  { id: 'sourceCodeModeMenuItem', assert: A.dom('.source-code') },
  { id: 'typewriterModeMenuItem', assert: A.storeIs('preferences', 'typewriter', true) },
  { id: 'focusModeMenuItem', assert: A.storeIs('preferences', 'focus', true) },
  { id: 'view.command-palette', assert: A.dom('.command-palette .el-dialog'), note: 'el-overlay fixed 定位，根 div 高度恒 0' },
  { id: 'view.reload-images', assert: A.smoke(), note: '整页重载' },

  // ── 窗口 ──
  { id: 'window.minimize', assert: A.invokeAny('minimize') },
  { id: 'window.toggle-full-screen', assert: A.invokeAny('fullscreen') },
  { id: 'window.toggle-always-on-top', assert: A.invokeAny('always_on_top') },

  // ── 帮助 ──
  { id: 'help.markdown-reference', assert: A.invokeAny('shell_open_external') },
  { id: 'help.about', assert: A.invokeAny('version') },
]

// ─────────────────────────────────────────────
// Runner
// ─────────────────────────────────────────────

test.describe('菜单矩阵 — 74 项全量落点断言', () => {
  for (const entry of MATRIX) {
    test(`${entry.id}${entry.note ? ` — ${entry.note}` : ''}`, async ({ page }) => {
      const pageErrors: string[] = []
      page.on('pageerror', (err) => pageErrors.push(err.message))

      // 完整偏好表 + 矩阵需要的开关（override 是整体替换，必须基于默认表合并）
      const basePrefs = MOCK_INVOKE_RESPONSES.preferences_get_all as Record<string, unknown>
      await injectTauriMock(page, {
        preferences_get_all: {
          ...basePrefs,
          superSubScript: true,
          footnote: true,
        },
        // 粘贴为纯文本的剪贴板内容
        clipboard_read_text: 'pastedPlain',
        fs_write_file: true,
        markdown_save: true,
      })
      await bootstrapApp(page, { markdownList: [DOC], waitForMs: 2500 })
      await startInvokeRecording(page)

      const mdBefore = await getMd(page)
      const tabsBefore = await tabCount(page)

      // setup
      switch (entry.setup?.kind) {
        case 'cursor':
          await placeCursor(page, entry.setup.target, entry.setup.scope)
          break
        case 'select':
          await selectWord(page, entry.setup.target)
          break
        case 'kbSelect':
          await placeCursor(page, entry.setup.target)
          await page.keyboard.press('Home')
          await page.keyboard.press('Shift+End')
          await page.waitForTimeout(200)
          break
        case 'type':
          await placeCursor(page, 'Paragraph beta')
          await page.keyboard.type(TYPED)
          await page.waitForTimeout(300)
          break
        case 'typeUndo':
          await placeCursor(page, 'Paragraph beta')
          await page.keyboard.type(TYPED)
          await page.waitForTimeout(300)
          await page.keyboard.press('Control+z')
          await page.waitForTimeout(300)
          break
        case 'boldSel':
          await placeCursor(page, CURSOR_TARGET)
          await page.keyboard.press('Home')
          await page.keyboard.press('Shift+End')
          await trigger(page, 'strongMenuItem')
          await page.waitForTimeout(500)
          await placeCursor(page, CURSOR_TARGET)
          await page.keyboard.press('Home')
          await page.keyboard.press('Shift+End')
          break
        case 'openFind':
          await trigger(page, 'edit.find')
          await page.waitForTimeout(400)
          break
        default:
          await placeCursor(page, CURSOR_TARGET)
      }

      // 触发菜单命令
      await trigger(page, entry.id)
      await page.waitForTimeout(800)

      // 全局守卫：执行期间不允许出现新的页面异常
      expect(
        pageErrors,
        `${entry.id} 执行期间出现页面异常: ${pageErrors.join(' | ')}`,
      ).toEqual([])

      // 落点断言
      const a = entry.assert
      if (a.kind === 'mdContains' || a.kind === 'mdNotContains' || a.kind === 'mdChanged') {
        const mdAfter = await getMd(page)
        if (a.kind === 'mdContains') {
          expect(mdAfter, `${entry.id} 后 markdown 应包含 "${a.text}"\n实际: ${mdAfter}`).toContain(a.text)
        }
        else if (a.kind === 'mdNotContains') {
          expect(mdAfter, `${entry.id} 后 markdown 不应包含 "${a.text}"\n实际: ${mdAfter}`).not.toContain(a.text)
        }
        else {
          expect(mdAfter, `${entry.id} 后 markdown 应发生变化\n之前: ${mdBefore}\n之后: ${mdAfter}`).not.toBe(mdBefore)
        }
      }
      else if (a.kind === 'invokeAny') {
        const cmds = await recordedCmds(page)
        const hit = a.cmds.find((c) => cmds.some((r) => r.includes(c)))
        expect(hit, `${entry.id} 应触发 invoke 之一 [${a.cmds.join(', ')}]，实际记录: ${JSON.stringify([...new Set(cmds)])}`).toBeTruthy()
      }
      else if (a.kind === 'domVisible') {
        await expect(page.locator(a.selector).first(), `${entry.id} 后应出现 ${a.selector}`).toBeVisible({ timeout: 5000 })
      }
      else if (a.kind === 'storeIs') {
        const value = await getStore(page, a.store, a.key)
        expect(value, `${entry.id} 后 store.${a.store}.${a.key} 应为 ${JSON.stringify(a.value)}`).toBe(a.value)
      }
      else if (a.kind === 'tabs') {
        const after = await tabCount(page)
        if (a.op === 'inc') expect(after, `${entry.id} 后标签数应 +1`).toBe(tabsBefore + 1)
        else expect(after, `${entry.id} 后标签数应 -1`).toBe(tabsBefore - 1)
      }
      // smoke: 无新增 pageerror 即通过（上面已断言）
    })
  }
})

async function startInvokeRecording(page: Page): Promise<void> {
  await page.evaluate(() => {
    ;(window as any).__MOCK_INVOKE_OVERRIDE__ &&
      (window as any).__MOCK_INVOKE_RECORD__ &&
      (window as any).__MOCK_INVOKE_RECORD__()
  })
}
