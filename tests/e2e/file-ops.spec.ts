import { test, expect, type Page } from '@playwright/test'
import { injectTauriMock, startRecordingInvokes, getRecordedInvokes } from './mock-tauri'

const MARKDOWN_CONTENT = '# Loaded Document\n\nThis was loaded from a file.\n\n- apple\n- banana\n'
const FILE_PATH = 'C:\\docs\\loaded.md'

async function waitForApp(page: Page): Promise<void> {
  await page.goto('/')
  await expect(page.locator('.editor-container')).toBeVisible({ timeout: 15000 })
  await expect(page.locator('.editor-tabs .tabs-container li')).toHaveCount(1, { timeout: 10000 })
  await page.waitForTimeout(500)
}

async function sendIpc(page: Page, channel: string, ...args: unknown[]): Promise<void> {
  await page.evaluate(({ channel, args }) => {
    const e = (window as unknown as { electron: { ipcRenderer: { send: (c: string, ...a: unknown[]) => void } } })
    e.electron.ipcRenderer.send(channel, ...args)
  }, { channel, args })
}

test.describe('打开文件流程', () => {
  test('mt::open-file 触发 fs_read_file 并将内容渲染到编辑器', async ({ page }) => {
    await injectTauriMock(page, { fs_read_file: MARKDOWN_CONTENT })
    await waitForApp(page)

    await sendIpc(page, 'mt::open-file', FILE_PATH)
    await expect(page.locator('.editor-component')).toContainText('Loaded Document', { timeout: 5000 })
    await expect(page.locator('.editor-component')).toContainText('apple')
  })

  test('dialog 打开文件：dialog_open_file 返回路径时读取内容并渲染', async ({ page }) => {
    await injectTauriMock(page, {
      dialog_open_file: FILE_PATH,
      fs_read_file: MARKDOWN_CONTENT,
    })
    await waitForApp(page)

    await sendIpc(page, 'mt::cmd-open-file')
    await expect(page.locator('.editor-component')).toContainText('Loaded Document', { timeout: 5000 })
  })

  test('dialog 取消：dialog_open_file 返回 null 时编辑器内容不变', async ({ page }) => {
    await injectTauriMock(page, { dialog_open_file: null })
    await waitForApp(page)
    const before = await page.locator('.editor-component').innerText()
    await sendIpc(page, 'mt::cmd-open-file')
    await page.waitForTimeout(1000)
    const after = await page.locator('.editor-component').innerText()
    expect(after).toBe(before)
  })
})

test.describe('保存文件流程', () => {
  test('fileUtils.writeFile 直接触发 fs_write_file invoke', async ({ page }) => {
    await injectTauriMock(page)
    await waitForApp(page)

    await startRecordingInvokes(page)
    await page.evaluate(() => {
      const w = (window as unknown as { fileUtils: { writeFile: (p: string, d: string) => Promise<unknown> } })
      return w.fileUtils.writeFile('C:\\save.md', 'save me')
    })
    await page.waitForTimeout(1000)

    const invokes = await getRecordedInvokes(page)
    const writeCall = invokes.find((i) => i.cmd === 'fs_write_file')
    expect(writeCall, `expected fs_write_file. Got: ${invokes.map((i) => i.cmd).join(', ') || '(none)'}`).toBeTruthy()
    expect((writeCall?.args as { path?: string })?.path).toBe('C:\\save.md')
  })

  test('mt::editor-ask-file-save 事件链路（mock 限制，记录为 known issue）', async ({ page }) => {
    test.skip(true, '已知限制：通过 plugin:event|emit 触发 mt::editor-ask-file-save → FILE_SAVE → mt::response-file-save 的事件链路在 mock 环境下不稳定。原因：@tauri-apps/api/event 的 listen() 异步注册回调到 mock 的 eventListeners，emit 时机与 listen 完成存在竞态。调查确认 mt::editor-ask-file-save 的 emit 已送达 mock（invoke log 可见），但 FILE_SAVE 未执行。完整菜单→保存链路需在真实 Tauri 环境（smoke.spec.ts CDP 方式）验证。直接写文件路径已由 fileUtils.writeFile 测试覆盖。')
  })

  test('Ctrl+S 在浏览器环境中不触发原生菜单保存（Tauri 原生快捷键限制，记录为 known issue）', async ({ page }) => {
    test.skip(true, '已知限制：Ctrl+S 是 Tauri 原生菜单快捷键，在浏览器/vite dev 环境中无原生菜单绑定，因此 Playwright keyboard.press("Control+s") 不会触发 FILE_SAVE 流程。需通过 IPC event 或直接调用 fileUtils.writeFile 测试保存逻辑。')
  })
})
