import { test, expect } from '@playwright/test'
import {
  injectTauriMock,
  bootstrapApp,
  emitTauriEvent,
  setMockResponse,
  startRecordingInvokes,
  getRecordedInvokes,
} from './mock-tauri'

const TEST_IMAGE = 'C:\\Users\\Lenovo\\Pictures\\Saved Pictures\\jinwei-sign.jpg'

test.beforeEach(async ({ page }) => {
  await injectTauriMock(page, {
    ask_for_image_path: TEST_IMAGE,
    clipboard_guess_file_path: TEST_IMAGE,
  })
  await bootstrapApp(page)
})

/**
 * 图片插入方式选择功能 E2E 测试（产品新需求）。
 *
 * 覆盖：
 * 1. UI 验证 — imageEditTool 弹出后含 .insert-mode div 和两个互斥 radio
 * 2. 路径插入模式 — Choose Image 后 markdown/渲染引用的是本地路径（非 data:），
 *    且不调用 image_to_data_uri 命令
 * 3. Base64 插入模式 — 切 radio 后 Choose Image，调用 image_to_data_uri 命令，
 *    img src 为 data:image/...
 * 4. 粘贴图片默认 Base64 — 触发 paste 事件后默认走 base64 路径，
 *    调用 image_to_data_uri，img src 为 data:image/...
 *
 * imageEditTool 默认 tab 是 'link'，测试 Choose Image 前需先点 Select tab header。
 */
test.describe('图片插入方式选择功能', () => {
  test('UI 验证：imageEditTool 含路径/Base64 互斥单选项', async ({ page }) => {
    const editor = page.locator('.editor-component.mu-editor')
    await editor.click()
    await page.keyboard.type('test')
    await page.waitForTimeout(200)

    await emitTauriEvent(page, 'mt::menu::click', { id: 'imageMenuItem' })
    await page.waitForTimeout(800)

    const tool = page.locator('.mu-image-selector-wrapper')
    await expect(tool).toBeVisible({ timeout: 3000 })

    // .insert-mode 容器存在
    const insertModeDiv = tool.locator('div.insert-mode')
    await expect(insertModeDiv).toBeVisible({ timeout: 2000 })

    // 两个 radio 按钮
    const pathRadio = tool.locator('input[type=radio][name=mu-insert-mode][value=path]')
    const base64Radio = tool.locator('input[type=radio][name=mu-insert-mode][value=base64]')
    await expect(pathRadio).toBeVisible()
    await expect(base64Radio).toBeVisible()

    // 路径模式默认选中
    await expect(pathRadio).toBeChecked()
    await expect(base64Radio).not.toBeChecked()

    // 切换到 Base64
    await base64Radio.click()
    await page.waitForTimeout(300)
    await expect(base64Radio).toBeChecked()
    await expect(pathRadio).not.toBeChecked()
  })

  test('路径插入模式：Choose Image 后插入路径引用，不调用 image_to_data_uri', async ({ page }) => {
    const editor = page.locator('.editor-component.mu-editor')
    await editor.click()
    await page.keyboard.type('path mode test')
    await page.waitForTimeout(200)

    await emitTauriEvent(page, 'mt::menu::click', { id: 'imageMenuItem' })
    await page.waitForTimeout(800)

    const tool = page.locator('.mu-image-selector-wrapper')
    await expect(tool).toBeVisible({ timeout: 3000 })

    // 确认默认是路径模式（不切 radio）
    const pathRadio = tool.locator('input[type=radio][name=mu-insert-mode][value=path]')
    await expect(pathRadio).toBeChecked()

    // 切到 Select tab
    await tool.locator('ul.header li').first().locator('span').click()
    await page.waitForTimeout(300)

    await startRecordingInvokes(page)

    // 点 Choose Image
    await tool.locator('button.role-button.select').click()
    await page.waitForTimeout(1500)

    const invokes = await getRecordedInvokes(page)
    console.log('[E2E path-mode] invokes:', invokes.map(i => i.cmd))

    // 断言1：ask_for_image_path 被调用
    expect(invokes.some(i => i.cmd === 'ask_for_image_path'),
      '路径模式应调用 ask_for_image_path').toBe(true)

    // 断言2：image_to_data_uri 不被调用（路径模式不走 base64）
    expect(invokes.some(i => i.cmd === 'image_to_data_uri'),
      '路径模式不应调用 image_to_data_uri').toBe(false)

    // 断言3：路径已写入 markdown 源（data-raw）且非 data: URI
    // jsdom 无法加载本地图片，img 元素停留在 loading 状态不渲染
    // （image.ts: isSuccess=undefined → 无 <img>），故验证 data-raw
    const rawInfo = await page.evaluate(() => {
      const span = document.querySelector('.mu-inline-image') as HTMLElement | null
      return span ? (span.getAttribute('data-raw') || '') : null
    })
    console.log('[E2E path-mode] data-raw:', rawInfo)
    expect(rawInfo, '.mu-inline-image 应存在').not.toBeNull()
    expect(rawInfo!, '路径模式 data-raw 不应是 data: URI').not.toMatch(/^!\[\]\(data:image/)
  })

  test('Base64 插入模式：Choose Image 后插入 data: URI，调用 image_to_data_uri', async ({ page }) => {
    const editor = page.locator('.editor-component.mu-editor')
    await editor.click()
    await page.keyboard.type('base64 mode test')
    await page.waitForTimeout(200)

    await emitTauriEvent(page, 'mt::menu::click', { id: 'imageMenuItem' })
    await page.waitForTimeout(800)

    const tool = page.locator('.mu-image-selector-wrapper')
    await expect(tool).toBeVisible({ timeout: 3000 })

    // 切到 Base64 模式
    const base64Radio = tool.locator('input[type=radio][name=mu-insert-mode][value=base64]')
    await base64Radio.click()
    await page.waitForTimeout(300)
    await expect(base64Radio).toBeChecked()

    // 切到 Select tab
    await tool.locator('ul.header li').first().locator('span').click()
    await page.waitForTimeout(300)

    await startRecordingInvokes(page)

    // 点 Choose Image
    await tool.locator('button.role-button.select').click()
    await page.waitForTimeout(1500) // mock image_to_data_uri + replaceImage

    const invokes = await getRecordedInvokes(page)
    console.log('[E2E base64-mode] invokes:', invokes.map(i => i.cmd))

    // 断言1：ask_for_image_path 被调用（选文件）
    expect(invokes.some(i => i.cmd === 'ask_for_image_path'),
      'Base64 模式应调用 ask_for_image_path 选文件').toBe(true)

    // 断言2：image_to_data_uri 被调用（转 base64）
    expect(invokes.some(i => i.cmd === 'image_to_data_uri'),
      'Base64 模式应调用 image_to_data_uri').toBe(true)

    // 断言3：img src 为 data:image/...
    const imgSrc = await page.evaluate(() => {
      const img = document.querySelector('.mu-inline-image img') as HTMLImageElement | null
      return img ? (img.getAttribute('src') || img.src) : null
    })
    console.log('[E2E base64-mode] img src:', imgSrc?.substring(0, 60))
    expect(imgSrc, 'img 元素应存在').not.toBeNull()
    expect(imgSrc!, 'Base64 模式 img src 应为 data:image/...').toMatch(/^data:image\//)
  })

  test('粘贴图片默认以 Base64 插入', async ({ page }) => {
    const editor = page.locator('.editor-component.mu-editor')
    await editor.click()
    await page.keyboard.type('paste test')
    await page.waitForTimeout(300)

    // 确保 mock clipboard_guess_file_path 返回图片路径
    await setMockResponse(page, 'clipboard_guess_file_path', TEST_IMAGE)

    await startRecordingInvokes(page)

    // 触发 paste 事件 — muya 监听 document 级 paste
    // 构造 ClipboardEvent，clipboardData 用空 DataTransfer（图片路径通过 clipboardFilePath hook 解析）
    await page.evaluate(() => {
      const dt = new DataTransfer()
      dt.setData('text/plain', '')
      const event = new ClipboardEvent('paste', { bubbles: true, cancelable: true })
      Object.defineProperty(event, 'clipboardData', {
        value: dt,
        writable: false,
        configurable: true,
      })
      document.dispatchEvent(event)
    })

    // 等待 paste 流程: tryPasteImage → resolveClipboardImagePath → imageAction(base64) → image_to_data_uri
    await page.waitForTimeout(2000)

    const invokes = await getRecordedInvokes(page)
    console.log('[E2E paste] invokes:', invokes.map(i => i.cmd))

    // 断言1：clipboard_guess_file_path 被调用（解析粘贴图片路径）
    expect(invokes.some(i => i.cmd === 'clipboard_guess_file_path'),
      '粘贴图片应调用 clipboard_guess_file_path').toBe(true)

    // 断言2：image_to_data_uri 被调用（默认 base64 插入）
    expect(invokes.some(i => i.cmd === 'image_to_data_uri'),
      '粘贴图片默认应调用 image_to_data_uri（base64 模式）').toBe(true)

    // 断言3：img src 为 data:image/...
    const imgSrc = await page.evaluate(() => {
      const img = document.querySelector('.mu-inline-image img') as HTMLImageElement | null
      return img ? (img.getAttribute('src') || img.src) : null
    })
    console.log('[E2E paste] img src:', imgSrc?.substring(0, 60))
    expect(imgSrc, 'img 元素应存在').not.toBeNull()
    expect(imgSrc!, '粘贴图片 img src 应为 data:image/...').toMatch(/^data:image\//)
  })
})
