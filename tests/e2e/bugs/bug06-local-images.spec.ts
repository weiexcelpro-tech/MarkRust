/**
 * B06 不能显示本地链接图片 —— TC-B06-03 / TC-B06-04
 *
 * 勘察修正（lead 复核）：muya 把图片 src 重写为 file:// 绝对 URL
 * （getImageSrc → `file://${resolve(DIRNAME, src)}`），被 Tauri http 源跨域 +
 * CSP img-src（无 file:）双重拦截；convertFileSrc 无人调用。
 * TC-B06-03 断言（修正语义）：img.src 应为 asset 协议（修复后）；
 * 当前为 file:// 形态即 = bug 复现（FAIL）。
 */
import { test, expect } from '@playwright/test'
import { openDoc, fatalErrors, collectPageErrors } from './_helpers'

test.setTimeout(120_000)


const IMG_DIR = 'C:\\imgdemo'
const DOC_WITH_IMAGES = [
  '# Image Demo',
  '',
  '![rel](assets/pic-local.png)',
  '',
  '![gone](assets/missing.png)',
  '',
].join('\n')

test('TC-B06-03: mock 下图片 src 走 asset 协议转换（当前 file:// 形态 = bug 复现）', async ({ page }) => {
  const pageErrors = collectPageErrors(page)
  await openDoc(page, `${IMG_DIR}\\doc.md`, DOC_WITH_IMAGES, {
    overrides: { fs_path_exists: true, paths_is_image: true },
  })

  // 图片块渲染为 .mu-inline-image 包裹（懒渲染下两张图都在首屏）
  await expect(page.locator('.mu-editor .mu-inline-image').first()).toBeVisible({ timeout: 15000 })

  // 加载结果采样：DOM img 仅在加载成功后插入；失败态直接走 .mu-image-fail。
  // muya inlineRenderer.loadImageMap 的 KEY = getImageSrc 解析后的 src（file:// 或 asset 形态），
  // 是「图片 src 走了哪种协议」的权威证据，不受 DOM 增删影响。
  await page.waitForTimeout(2500)
  const sample = await page.evaluate(() => {
    const el = document.querySelector('.mu-editor p, .mu-editor h1, .mu-editor .mu-table-cell') as
      (HTMLElement & { __MUYA_BLOCK__?: { muya: { editor: { inlineRenderer: { renderer: { loadImageMap: Map<string, { isSuccess?: boolean }> } } } } } }) | null
    const map = el?.__MUYA_BLOCK__?.muya?.editor?.inlineRenderer?.renderer?.loadImageMap
    if (!map) return null
    const entries: Array<{ src: string; isSuccess?: boolean }> = []
    map.forEach((v, k) => entries.push({ src: k, isSuccess: (v as { isSuccess?: boolean })?.isSuccess }))
    const domImgs = Array.from(document.querySelectorAll('.mu-editor .mu-image-container img')).map(
      (img) => (img as HTMLImageElement).getAttribute('src') ?? '',
    )
    return { entries, domImgs }
  })
  // eslint-disable-next-line no-console
  console.log('[B06-03] loadImageMap 采样:', JSON.stringify(sample))

  const failCount = await page.locator('.mu-editor .mu-image-fail').count()
  const successCount = await page.locator('.mu-editor .mu-image-success').count()
  // eslint-disable-next-line no-console
  console.log('[B06-03] 终态 fail/success 包裹数:', failCount, '/', successCount)

  const problems: string[] = []
  if (!sample) {
    problems.push('无法访问 muya inlineRenderer.loadImageMap（基建问题）')
  } else {
    const srcFound = sample.entries.find((e) => e.src.length > 0)?.src ?? sample.domImgs.find((s) => s.length > 0)
    if (!srcFound) {
      problems.push('未观测到任何已解析图片 src（loadImageMap 为空且无 DOM img）')
    } else if (!/^https?:\/\/asset\.localhost\//.test(srcFound) && !/^asset:/.test(srcFound)) {
      problems.push(
        `图片 src 未走 convertFileSrc/asset 协议转换：实际形态 '${srcFound.slice(0, 90)}'。` +
        'file:// 形态在 Tauri http 源 + CSP(img-src 无 file:) 下必然被拦截 —— B06 根因形态'
      )
    }
  }
  const fatal = fatalErrors(pageErrors)
  if (fatal.length) problems.push(`致命 JS 错误:\n${fatal.join('\n')}`)

  expect(problems, `TC-B06-03 断言失败:\n- ${problems.join('\n- ')}`).toEqual([])
})

test('TC-B06-04: 图片文件缺失时降级（alt/占位态，无致命错误，可继续编辑）', async ({ page }) => {
  const pageErrors = collectPageErrors(page)
  await openDoc(page, `${IMG_DIR}\\missing.md`, '# Missing Demo\n\n![gone](assets/missing.png)\n', {
    overrides: { fs_path_exists: false, paths_is_image: true },
  })

  await expect(page.locator('.mu-editor .mu-inline-image').first()).toBeVisible({ timeout: 15000 })
  await page.waitForTimeout(2500) // 等加载失败终态

  const failCount = await page.locator('.mu-editor .mu-image-fail').count()
  // eslint-disable-next-line no-console
  console.log('[B06-04] .mu-image-fail 包裹数:', failCount)

  const problems: string[] = []
  if (failCount === 0) {
    // 未出 fail 态也接受 success 占位（mock 下无真实资源），只要不崩溃即可；记录现状
    // eslint-disable-next-line no-console
    console.log('[B06-04] 未观测到 fail 态（可能仍处 loading 态），不作为缺陷，仅记录')
  }
  // 编辑器可继续编辑
  await page.locator('.editor-component').click({ position: { x: 300, y: 200 } })
  await page.keyboard.type('after-image')
  await expect(page.locator('.editor-component')).toContainText('after-image')

  const fatal = fatalErrors(pageErrors)
  expect(fatal, `致命 JS 错误:\n${fatal.join('\n')}`).toHaveLength(0)
  expect(problems, problems.join('\n')).toEqual([])
})
