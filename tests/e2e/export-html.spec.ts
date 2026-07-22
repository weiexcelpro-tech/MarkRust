import { test, expect, type Page } from '@playwright/test'
import {
  injectTauriMock,
  bootstrapApp,
  emitTauriEvent,
  startRecordingInvokes,
  getRecordedInvokes,
} from './mock-tauri'

/**
 * 导出 HTML 端到端测试（L3）。
 *
 * 核心价值：验证"导出 HTML"从菜单点击到文件写入的完整链路，特别是
 * tauri-bridge.ts 中 v2.0 修复的两个关键点：
 *
 * 1. fs_write_file 接收的 data 必须是 number[]（Vec<u8>），而非 string。
 *    此前直接传 string 会被 Rust serde 拒绝（"invalid type: string, expected
 *    a sequence"），导致 invoke reject，文件从未写入。
 * 2. dialog_save_file 必须收到 exts: ['html']，确保保存对话框过滤 HTML 类型。
 *
 * 测试策略：
 * 1. emitTauriEvent('mt::menu::click', { id: 'file.export-file-html' }) 打开导出弹窗
 * 2. mock dialog_save_file 返回保存路径，mock images_to_data_uris 返回空数组
 * 3. 点击"导出"按钮，记录所有 invoke 调用
 * 4. 断言 dialog_save_file 收到 exts: ['html']
 * 5. 断言 fs_write_file 的 data 是 number[]，且解码后包含 HTML 标签
 * 6. 断言导出后弹窗关闭
 *
 * 与 L1（exportHtml.test.ts，验证 exportStyledHTML 输出）和
 * L2（tauri-bridge-export.test.ts，验证 tauri-bridge 桥接层）的区别：
 * L3 验证 UI → editor.vue → editorStore.EXPORT → tauri-bridge → invoke 的
 * 完整端到端链路，能发现 L1/L2 无法暴露的集成问题（muya 实例未初始化、
 * bus 事件未正确传递、ipcRenderer.send 参数格式错误等）。
 */

const MOCK_SAVE_PATH = 'C:\\tmp\\test-export.html'

test.beforeEach(async ({ page }) => {
  await injectTauriMock(page, {
    // HTML 导出强制 embedImages=true → embedImagesAsBase64 → images_to_data_uris（批量版本）
    // 空文档无本地图片不会调用，但 mock 以防万一
    images_to_data_uris: [],
    // dialog_save_file 返回保存路径（非 null 表示用户确认保存）
    dialog_save_file: MOCK_SAVE_PATH,
    fs_write_file: null,
  })
  await bootstrapApp(page)
})

/**
 * 打开 HTML 导出弹窗。
 *
 * 链路：emitTauriEvent('mt::menu::click', { id: 'file.export-file-html' })
 *   → menuBridge → commands/index.ts → bus.emit('showExportDialog', 'html')
 *   → exportSettings/index.vue showDialog() → 弹窗打开
 */
async function openHtmlExportDialog(page: Page): Promise<void> {
  await emitTauriEvent(page, 'mt::menu::click', { id: 'file.export-file-html' })
  // 命令内有 await delay(50)，等待 bus.emit('showExportDialog') 触发
  await page.waitForTimeout(300)
  // 等待 el-dialog 可见
  await page.waitForFunction(
    () => {
      const dialog = document.querySelector('.print-settings-dialog .el-dialog')
      if (!dialog) return false
      const wrapper = dialog.closest('.el-overlay')
      return wrapper !== null && (wrapper as HTMLElement).style.display !== 'none'
    },
    undefined,
    { timeout: 8000 }
  )
  await page.waitForTimeout(500) // 等 transition 完成
}

test.describe('导出 HTML 弹窗 UI', () => {
  test('弹窗能正常打开', async ({ page }) => {
    await openHtmlExportDialog(page)
    await expect(page.locator('.print-settings-dialog .el-dialog')).toBeVisible()
  })
})

test.describe('导出 HTML 核心链路（v2.0 修复回归测试）', () => {
  test('★ dialog_save_file 收到 exts:["html"] 且 fs_write_file 收到 number[]', async ({ page }) => {
    await openHtmlExportDialog(page)

    await startRecordingInvokes(page)

    // 点击"Export"按钮触发完整导出链路
    const exportButton = page.locator('.print-settings-dialog .button-primary')
    await exportButton.click()

    // 等待 fs_write_file 被调用（链路：handleClicked → bus.emit('export')
    // → handleExport → exportStyledHTML（muya 渲染）→ editorStore.EXPORT
    // → ipcRenderer.send('mt::response-export') → tauri-bridge
    // → dialog_save_file → fs_write_file）
    await page.waitForFunction(
      () =>
        !!(window as unknown as { __MOCK_INVOKE_LOG__?: Array<{ cmd: string }> })
          .__MOCK_INVOKE_LOG__?.some((i) => i.cmd === 'fs_write_file'),
      undefined,
      { timeout: 15000 }
    )

    const invokes = await getRecordedInvokes(page)

    // ---- 断言 1：dialog_save_file 被调用且 exts 包含 'html' ----
    const dialogCall = invokes.find((inv) => inv.cmd === 'dialog_save_file')
    expect(dialogCall, 'dialog_save_file 应被调用').toBeDefined()
    const dialogArgs = dialogCall!.args as { defaultName?: string; exts?: string[] }
    expect(dialogArgs.exts, 'exts 参数应存在').toBeDefined()
    expect(dialogArgs.exts).toEqual(['html'])

    // ---- 断言 2：fs_write_file 被调用且 data 是 number[] ----
    const fsWriteCall = invokes.find((inv) => inv.cmd === 'fs_write_file')
    expect(fsWriteCall, 'fs_write_file 应被调用').toBeDefined()
    const fsArgs = fsWriteCall!.args as { path?: string; data?: unknown }
    expect(fsArgs.path, 'path 应为 mock 保存路径').toBe(MOCK_SAVE_PATH)
    // ★ 核心修复验证：data 必须是数组（number[] → Vec<u8>），不能是 string
    expect(Array.isArray(fsArgs.data), 'data 必须是 number[]（Vec<u8>），不能是 string').toBe(true)
    const dataArr = fsArgs.data as number[]
    expect(dataArr.length, 'data 不应为空').toBeGreaterThan(0)
    // 每个元素应为数字（字节值 0-255）
    expect(dataArr.every((b) => typeof b === 'number' && b >= 0 && b <= 255)).toBe(true)

    // ---- 断言 3：解码后包含 HTML 文档结构 ----
    const html = new TextDecoder().decode(new Uint8Array(dataArr))
    expect(html, '解码后应包含 HTML 内容').toContain('</html>')
    expect(html.toLowerCase()).toContain('<html')

    console.log('[E2E export-html] data 字节数:', dataArr.length)
    console.log('[E2E export-html] dialog_save_file.exts:', dialogArgs.exts)
    console.log('[E2E export-html] HTML 前 200 字符:', html.slice(0, 200))
  })

  test('导出后弹窗关闭', async ({ page }) => {
    await openHtmlExportDialog(page)

    await startRecordingInvokes(page)

    const exportButton = page.locator('.print-settings-dialog .button-primary')
    await exportButton.click()

    // handleClicked 中 showExportSettingsDialog.value = false 在 bus.emit('export') 之前
    // 所以弹窗应立即开始关闭动画
    await expect(page.locator('.print-settings-dialog .el-dialog')).not.toBeVisible({
      timeout: 5000,
    })
  })
})

/**
 * TOC 侧边栏选项 (includeTocSidebar) — v2.0 新功能 E2E 测试。
 *
 * 验证链路：UI 开关 → handleClicked 传参 → editor.vue case 'html' →
 * exportStyledHTML(includeTocSidebar) → buildTocSidebarHtml + injectTocSidebar →
 * fs_write_file 写入带侧边栏的 HTML。
 *
 * 注意：当 includeTocSidebar=true 但文档无标题时，buildTocSidebarHtml 返回空
 * 字符串，侧边栏不会注入。因此"开启侧边栏"测试必须在编辑器中输入多级标题。
 */
test.describe('TOC 侧边栏选项 (includeTocSidebar)', () => {
  /**
   * 切换到 Page 标签页（TOC 侧边栏开关位于此标签页内）。
   * 弹窗默认打开 Info 标签页，需手动切换。
   */
  async function switchToPageTab(page: Page): Promise<void> {
    await page.locator('#tab-page').click()
    // 等 isTabLoading overlay 消失（double-rAF ≈ 32ms + 余量）
    await page.waitForTimeout(300)
  }

  /**
   * 定位 TOC 侧边栏开关（兼容英文/中文/原始 key 三种文本）。
   */
  function tocSwitchLocator(page: Page) {
    return page
      .locator('.pref-switch-item')
      .filter({ hasText: /Include table of contents|htmlIncludeToc|目录侧边栏/ })
  }

  /**
   * 在编辑器中输入多级标题，供导出测试使用。
   * muya WYSIWYG 模式下，行首输入 "# " 自动转换为 h1 标题块。
   */
  async function typeHeadings(page: Page): Promise<void> {
    const editor = page.locator('.editor-component.mu-editor')
    await editor.click()
    await page.keyboard.type('# First Heading')
    await page.keyboard.press('Enter')
    await page.keyboard.press('Enter')
    await page.keyboard.type('## Second Heading')
    await page.keyboard.press('Enter')
    await page.keyboard.press('Enter')
    await page.keyboard.type('### Third Heading')
    await page.keyboard.press('Enter')
    await page.keyboard.press('Enter')
    await page.keyboard.type('Some body text here.')
    // 等 muya 完成块类型转换和 DOM 渲染
    await page.waitForTimeout(800)
  }

  /**
   * 等待 fs_write_file 被调用并返回解码后的 HTML 字符串。
   */
  async function waitForExportHtml(page: Page): Promise<string> {
    await page.waitForFunction(
      () =>
        !!(window as unknown as { __MOCK_INVOKE_LOG__?: Array<{ cmd: string }> })
          .__MOCK_INVOKE_LOG__?.some((i) => i.cmd === 'fs_write_file'),
      undefined,
      { timeout: 15000 }
    )
    const invokes = await getRecordedInvokes(page)
    const fsWriteCall = invokes.find((inv) => inv.cmd === 'fs_write_file')
    expect(fsWriteCall, 'fs_write_file 应被调用').toBeDefined()
    const dataArr = (fsWriteCall!.args as { data?: unknown }).data as number[]
    expect(Array.isArray(dataArr), 'data 应为 number[]').toBe(true)
    return new TextDecoder().decode(new Uint8Array(dataArr))
  }

  test('导出弹窗中显示 TOC 侧边栏开关（默认关闭）', async ({ page }) => {
    await openHtmlExportDialog(page)
    await switchToPageTab(page)
    const tocItem = tocSwitchLocator(page)
    await expect(tocItem).toBeVisible()
    // 验证默认状态为关闭
    const switchEl = tocItem.locator('.el-switch')
    await expect(switchEl).not.toHaveClass(/is-checked/)
  })

  test('默认关闭时导出的 HTML 不包含侧边栏', async ({ page }) => {
    await openHtmlExportDialog(page)

    await startRecordingInvokes(page)
    await page.locator('.print-settings-dialog .button-primary').click()

    const html = await waitForExportHtml(page)

    // 不应包含任何侧边栏相关 CSS 类
    expect(html).not.toContain('toc-sidebar-layout')
    expect(html).not.toContain('class="toc-sidebar')
    expect(html).not.toContain('toc-sidebar-toggle')
  })

  test('开启且编辑器含多级标题时导出的 HTML 包含完整侧边栏结构', async ({ page }) => {
    // 1. 在编辑器中输入多级标题
    await typeHeadings(page)

    // 2. 打开导出弹窗，切换到 Page tab 并开启 TOC 侧边栏开关
    await openHtmlExportDialog(page)
    await switchToPageTab(page)
    const tocItem = tocSwitchLocator(page)
    const switchEl = tocItem.locator('.el-switch')
    await switchEl.click()
    await expect(switchEl).toHaveClass(/is-checked/)

    // 3. 导出
    await startRecordingInvokes(page)
    await page.locator('.print-settings-dialog .button-primary').click()

    const html = await waitForExportHtml(page)

    // ---- 断言侧边栏容器结构 ----
    expect(html).toContain('toc-sidebar-layout')
    expect(html).toContain('class="toc-sidebar"')
    expect(html).toContain('toc-sidebar-toggle')
    expect(html).toContain('toc-sidebar-nav')
    expect(html).toContain('toc-sidebar-title')
    expect(html).toContain('目录')

    // ---- 断言侧边栏 CSS 注入到 <head> ----
    expect(html).toContain('toc-sidebar-layout { display: flex')

    // ---- 断言导航条目 ----
    // 导航链接格式: <li style="padding-left:Npx"><a href="#id">Text</a></li>
    const linkMatches = html.match(/<li[^>]*><a href="#[^"]*">/g) || []
    expect(linkMatches.length, '应至少有 3 个导航链接').toBeGreaterThanOrEqual(3)

    // 导航条目应包含标题文本
    expect(html).toContain('First Heading')
    expect(html).toContain('Second Heading')
    expect(html).toContain('Third Heading')

    // ---- 断言缩进层级（h2 比 h1 缩进更多）----
    const indentRegex = /<li style="padding-left:(\d+)px"><a href="#([^"]*)">([^<]+)<\/a><\/li>/g
    const entries: Array<{ indent: number; id: string; text: string }> = []
    let m: RegExpExecArray | null
    while ((m = indentRegex.exec(html)) !== null) {
      entries.push({ indent: parseInt(m[1], 10), id: m[2], text: m[3] })
    }
    expect(entries.length).toBeGreaterThanOrEqual(3)

    // h1（First Heading）缩进应最小
    const firstEntry = entries.find((e) => e.text === 'First Heading')
    expect(firstEntry, '应找到 First Heading 条目').toBeDefined()
    // h2（Second Heading）缩进应比 h1 大
    const secondEntry = entries.find((e) => e.text === 'Second Heading')
    expect(secondEntry, '应找到 Second Heading 条目').toBeDefined()
    expect(secondEntry!.indent).toBeGreaterThan(firstEntry!.indent)
    // h3（Third Heading）缩进应比 h2 大
    const thirdEntry = entries.find((e) => e.text === 'Third Heading')
    expect(thirdEntry, '应找到 Third Heading 条目').toBeDefined()
    expect(thirdEntry!.indent).toBeGreaterThan(secondEntry!.indent)

    console.log('[E2E toc-sidebar] 导航条目数:', entries.length)
    console.log('[E2E toc-sidebar] 缩进层级:', entries.map((e) => `${e.text}=${e.indent}px`).join(', '))
  })
})
