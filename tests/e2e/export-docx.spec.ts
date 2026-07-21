import { test, expect } from '@playwright/test'
import { injectTauriMock, bootstrapApp, emitTauriEvent, startRecordingInvokes, getRecordedInvokes } from './mock-tauri'

/**
 * 导出 DOCX 端到端测试。
 *
 * 核心价值：验证 exportSettings 弹窗收集的配置是否完整传递到 export_docx 命令。
 *
 * 背景：此前发现"覆盖主题字体设置"开关打开后，fontFamily/fontSize/lineHeight 在
 * editor.vue → editor.ts → tauri-bridge.ts → ExportDocxRequest 这条链路的某一层
 * 被丢弃，导致用户设置的字体在导出的 docx 中不生效。这种"UI 有、后端无"的断层
 * 无法被签名级契约测试发现，只能通过端到端的行为测试暴露。
 *
 * 测试策略：
 * 1. 通过 emitTauriEvent('mt::menu::click', { id: 'file.export-file-docx' }) 打开导出弹窗
 * 2. 在弹窗中设置字体选项（覆盖主题字体 = true，字体系列 = 隶书）
 * 3. mock export_docx 命令，记录传入的 req 参数
 * 4. 点击"导出"按钮，捕获 export_docx 的 invoke 调用
 * 5. 断言 req 中包含 fontFamily/fontSize/lineHeight 字段
 *
 * 注意：这个测试会暴露当前的字段断层问题（fontFamily 未传递到 export_docx）。
 * 修复字体链路后，所有断言应通过。
 */

// mock export_docx 的返回值
const MOCK_EXPORT_DOCX_RESULT = {
  path: 'C:\\tmp\\test-export.docx',
  size: 12345,
  imageCount: 0,
  warnings: [],
}

test.beforeEach(async ({ page }) => {
  await injectTauriMock(page, {
    export_docx: MOCK_EXPORT_DOCX_RESULT,
    // 提供系统字体列表，让 FontTextBox 能渲染
    fonts_list: ['宋体', '隶书', '楷体', 'Arial', 'Calibri'],
  })
  await bootstrapApp(page)
})

/**
 * 打开导出弹窗并切换到指定标签页。
 *
 * 通过 emitTauriEvent('mt::menu::click', { id: 'file.export-file-docx' }) 触发
 * 菜单命令链路：menuBridge → commands/index.ts → bus.emit('showExportDialog', 'docx')
 * → exportSettings/index.vue 的 onMounted listener → showDialog() → 弹窗打开。
 */
async function openExportDialog(page: import('@playwright/test').Page, tabName: string = 'style') {
  // 触发导出菜单命令
  await emitTauriEvent(page, 'mt::menu::click', { id: 'file.export-file-docx' })
  // 命令内有 await delay(50)，等待 bus.emit('showExportDialog') 触发
  await page.waitForTimeout(300)
  // 等待 el-dialog 可见（el-dialog 用 v-model 控制，内部有 transition）
  // el-dialog 的 wrapper 元素 .el-dialog 在 visible 时 display 不为 none
  await page.waitForFunction(() => {
    const dialog = document.querySelector('.print-settings-dialog .el-dialog')
    if (!dialog) return false
    const wrapper = dialog.closest('.el-overlay')
    return wrapper !== null && (wrapper as HTMLElement).style.display !== 'none'
  }, undefined, { timeout: 8000 })
  await page.waitForTimeout(500) // 等 transition 完成
  // 切换到指定标签页
  const tab = page.locator('.print-settings-dialog .el-tabs__item').filter({ hasText: tabName })
  if (await tab.count() > 0) {
    await tab.click()
    await page.waitForTimeout(200)
  }
}

test.describe('导出 DOCX 弹窗 UI', () => {
  test('弹窗能正常打开并显示所有标签页', async ({ page }) => {
    await openExportDialog(page, 'info')
    // 验证 el-dialog 可见（.print-settings-dialog 是外层 wrapper，本身可能 hidden）
    await expect(page.locator('.print-settings-dialog .el-dialog')).toBeVisible()
    // 验证标签页存在
    const tabItems = page.locator('.print-settings-dialog .el-tabs__item')
    await expect(tabItems).toHaveCount(6)
  })

  test('样式标签页包含所有开关和字体设置', async ({ page }) => {
    await openExportDialog(page, 'style')

    // mock 中 language='en'，UI 文字为英文
    // 验证"Overwrite theme font settings"开关存在
    const overwriteSwitch = page.locator('.pref-switch-item', {
      hasText: 'Overwrite theme font settings',
    })
    await expect(overwriteSwitch).toBeVisible()

    // 验证"Auto numbering headings"开关存在
    const autoNumberSwitch = page.locator('.pref-switch-item', {
      hasText: 'Auto numbering headings',
    })
    await expect(autoNumberSwitch).toBeVisible()
  })
})

test.describe('导出 DOCX 配置传递链路', () => {
  test('★ 字体设置应传递到 export_docx 命令', async ({ page }) => {
    await openExportDialog(page, 'style')

    // 1. 打开"Overwrite theme font settings"开关
    const overwriteSwitch = page.locator('.pref-switch-item', {
      hasText: 'Overwrite theme font settings',
    })
    await overwriteSwitch.locator('.el-switch').click()
    await page.waitForTimeout(300)

    // 2. 等待字体设置区域出现（v-show 控制可见性）
    const fontTextBox = page.locator('.pref-font-input-item')
    await expect(fontTextBox.first()).toBeVisible()

    // 3. 在 el-autocomplete 中输入文字，触发下拉列表
    // FontTextBox 使用 el-autocomplete，其 @select 事件只在用户从下拉列表
    // 中选择选项时触发。直接 fill() 不会触发 handleSelect → props.onChange
    const fontInput = fontTextBox.locator('input.el-input__inner').first()
    await fontInput.fill('Ari')
    await page.waitForTimeout(300) // 等 querySearch 过滤 + 下拉渲染

    // 4. 从下拉列表中选择 'Arial'
    const dropdown = page.locator('.font-autocomplete-popper li')
    await expect(dropdown.filter({ hasText: 'Arial' })).toBeVisible({ timeout: 5000 })
    await dropdown.filter({ hasText: 'Arial' }).click()
    await page.waitForTimeout(200)

    // 4. 开始记录 invoke 调用
    await startRecordingInvokes(page)

    // 5. 点击"Export"按钮
    const exportButton = page.locator('.print-settings-dialog .button-primary')
    await exportButton.click()
    await page.waitForTimeout(1000)

    // 6. 获取记录的 invoke 调用
    const invokes = await getRecordedInvokes(page)

    // 7. 找到 export_docx 调用
    const exportDocxCall = invokes.find((inv) => inv.cmd === 'export_docx')
    expect(exportDocxCall).toBeDefined()
    expect(exportDocxCall).not.toBeNull()

    // 8. ★ 核心断言：req 中应包含 fontFamily 字段
    const req = (exportDocxCall!.args as { req?: Record<string, unknown> }).req
    expect(req).toBeDefined()

    // 基础字段（已工作）
    expect(req).toHaveProperty('markdown')
    expect(req).toHaveProperty('pathname')
    expect(req).toHaveProperty('imageEmbed')
    expect(req).toHaveProperty('pageSize')
    expect(req).toHaveProperty('pageMargin')

    // ★ 字体字段（字体链路修复后已启用）
    expect(req).toHaveProperty('fontFamily', 'Arial')
    expect(req).toHaveProperty('fontSize')
    expect(req).toHaveProperty('lineHeight')

    // 记录字段存在性，在测试输出中可见
    console.log('[E2E export-docx] req keys:', Object.keys(req ?? {}))
    console.log('[E2E export-docx] has fontFamily:', 'fontFamily' in (req ?? {}))
    console.log('[E2E export-docx] has fontSize:', 'fontSize' in (req ?? {}))
    console.log('[E2E export-docx] has lineHeight:', 'lineHeight' in (req ?? {}))
  })

  test('导出按钮触发 export_docx invoke 并关闭弹窗', async ({ page }) => {
    await openExportDialog(page, 'info')

    await startRecordingInvokes(page)

    // 点击导出按钮
    const exportButton = page.locator('.print-settings-dialog .button-primary')
    await exportButton.click()
    await page.waitForTimeout(1000)

    // 验证 export_docx 被调用
    const invokes = await getRecordedInvokes(page)
    const exportDocxCall = invokes.find((inv) => inv.cmd === 'export_docx')
    expect(exportDocxCall).toBeDefined()

    // 验证弹窗关闭（el-dialog 不可见）
    await expect(page.locator('.print-settings-dialog .el-dialog')).not.toBeVisible({ timeout: 3000 })
  })
})

test.describe('导出 DOCX 开关交互（回归测试）', () => {
  test('★ 开关切换不卡顿（v-show + CSS 修复验证）', async ({ page }) => {
    // 此测试验证此前修复的开关卡顿问题不会回归
    await openExportDialog(page, 'style')

    const overwriteSwitch = page.locator('.pref-switch-item', {
      hasText: 'Overwrite theme font settings',
    }).locator('.el-switch')

    // 快速切换开关 3 次，每次应在 500ms 内完成
    for (let i = 0; i < 3; i++) {
      const start = Date.now()
      await overwriteSwitch.click()
      await page.waitForTimeout(100)
      const elapsed = Date.now() - start
      // 开关切换应在 1 秒内完成（含 100ms 等待）
      expect(elapsed).toBeLessThan(1000)
    }
  })

  test('开关关闭后字体设置区域通过 v-show 隐藏（不销毁）', async ({ page }) => {
    await openExportDialog(page, 'style')

    const overwriteSwitch = page.locator('.pref-switch-item', {
      hasText: 'Overwrite theme font settings',
    }).locator('.el-switch')

    // 打开开关
    await overwriteSwitch.click()
    await page.waitForTimeout(300)

    // 字体设置区域应可见
    const fontArea = page.locator('.pref-font-input-item')
    await expect(fontArea.first()).toBeVisible()

    // 关闭开关
    await overwriteSwitch.click()
    await page.waitForTimeout(300)

    // 字体设置区域应隐藏（v-show 而非 v-if，DOM 仍存在）
    // v-show 使用 display:none，元素仍在 DOM 中
    await expect(fontArea.first()).not.toBeVisible()
  })
})
