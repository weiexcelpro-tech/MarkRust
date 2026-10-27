import { test, expect } from '@playwright/test'
import { injectTauriMock, bootstrapApp, emitTauriEvent, startRecordingInvokes, getRecordedInvokes } from './mock-tauri'

const TEST_IMAGE = 'C:\\Users\\Lenovo\\Pictures\\Saved Pictures\\jinwei-sign.jpg'

test.beforeEach(async ({ page }) => {
  await injectTauriMock(page, {
    ask_for_image_path: TEST_IMAGE,
  })
  await bootstrapApp(page)
})

/**
 * 基础图片插入 E2E 测试。
 *
 * 覆盖：
 * 1. 菜单 format('image') 插入空图片标记 + imageEditTool 弹窗（用 Tauri 事件触发，
 *    与真实菜单点击链路一致）
 * 2. Select tab → Choose Image → 调用 ask_for_image_path 命令 → 图片写入 DOM
 *
 * 注意：imageEditTool 默认 active tab 是 'link'（不是 'select'），
 * 测试 "Choose Image" 按钮前必须先点击 header 切换到 Select tab。
 */
test.describe('菜单插入图片基础 E2E', () => {
  test('format("image") 插入空图片标记并弹出 imageEditTool', async ({ page }) => {
    const editor = page.locator('.editor-component.mu-editor')
    await editor.click()
    await page.keyboard.type('test')
    await page.waitForTimeout(200)

    // 通过 Tauri 菜单事件触发 format('image')
    // 链路: mt::menu::click {id:'imageMenuItem'} → menuBridge → bus.emit('format','image') → muya.format('image')
    await emitTauriEvent(page, 'mt::menu::click', { id: 'imageMenuItem' })
    await page.waitForTimeout(800) // rAF + 浮窗渲染

    // 空图片标记 ![]() 已插入 DOM (format.ts _addFormat)
    const hasEmptyImage = await page.locator('.editor-component').evaluate(el => {
      return el.querySelector('.mu-inline-image') !== null
    })
    expect(hasEmptyImage, '空图片标记 .mu-inline-image 应出现在编辑器中').toBe(true)

    // imageEditTool 浮窗弹出 (rAF → muya-image-selector 事件 → show + render)
    const tool = page.locator('.mu-image-selector-wrapper')
    await expect(tool).toBeVisible({ timeout: 3000 })
  })

  test('Select tab → Choose Image 调用 ask_for_image_path 并写入图片', async ({ page }) => {
    const editor = page.locator('.editor-component.mu-editor')
    await editor.click()
    await page.keyboard.type('img here')
    await page.waitForTimeout(200)

    // 触发 format('image') 弹出 imageEditTool
    await emitTauriEvent(page, 'mt::menu::click', { id: 'imageMenuItem' })
    await page.waitForTimeout(800)

    const tool = page.locator('.mu-image-selector-wrapper')
    await expect(tool).toBeVisible({ timeout: 3000 })

    // 默认 tab 是 'link'，需要先切换到 'select' tab
    // header 结构: ul.header > li > span ("Select") | li > span ("Embed link")
    const selectTabSpan = tool.locator('ul.header li').first().locator('span')
    await selectTabSpan.click()
    await page.waitForTimeout(300)

    // 确认 Choose Image 按钮现已可见（select tab body）
    const chooseBtn = tool.locator('button.role-button.select')
    await expect(chooseBtn).toBeVisible({ timeout: 2000 })

    // 开始记录 invoke 调用
    await startRecordingInvokes(page)

    // 点击 Choose Image —— 触发 imagePathPicker → ask_for_image_path mock → _replaceImageAsync
    await chooseBtn.click()
    await page.waitForTimeout(1500) // mock 返回 + imageAction + replaceImage

    // 断言1：ask_for_image_path 被调用
    const invokes = await getRecordedInvokes(page)
    console.log('[E2E] recorded invokes:', invokes.map(i => i.cmd))
    const hasAskForImage = invokes.some(i => i.cmd === 'ask_for_image_path')
    expect(hasAskForImage, '应调用 ask_for_image_path 命令').toBe(true)

    // 断言2：图片路径已写入 markdown 源（.mu-inline-image 的 data-raw 属性）
    // 注：路径模式下 imageAction 返回本地路径，muya 将 ![](path) 写入源码。
    // jsdom 无法真正加载本地图片文件，img 元素会停留在 loading 状态不渲染
    // （image.ts: isSuccess=undefined → 只渲染空 container，无 <img>），
    // 因此验证 data-raw（token.raw）含选择的路径，证明路径模式写入成功，
    // 而非依赖 img 元素是否渲染。base64 模式靠 urlMap 命中才能渲染 img。
    await page.waitForTimeout(500)
    const rawInfo = await page.evaluate(() => {
      const span = document.querySelector('.mu-inline-image') as HTMLElement | null
      return span ? (span.getAttribute('data-raw') || '') : null
    })
    console.log('[E2E] data-raw after Choose Image:', rawInfo)
    expect(rawInfo, '.mu-inline-image 应存在且含 data-raw').not.toBeNull()
    expect(rawInfo!, 'data-raw 应含选择的图片文件名').toContain('jinwei-sign')
    expect(rawInfo!, '路径模式 data-raw 不应是 data: URI').not.toMatch(/^!\[\]\(data:image/)
  })
})
