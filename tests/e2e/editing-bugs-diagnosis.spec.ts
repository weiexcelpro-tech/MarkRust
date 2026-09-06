/**
 * Regression spec for the v1.1.4→v1.1.5 editing-bug sweep. Each test was a
 * red diagnosis first; after the corresponding fix they must all stay green.
 *
 *   Bug 1: Ctrl+H opens Replace (was bound to bullet-list)
 *   Bug 2: Ctrl+F reliability (IME composition guard now passes Ctrl combos)
 *   Bug 3: TOC click navigation accuracy (front matter misalignment fixed)
 *   Bug 4: shortcuts dispatch exactly ONCE (legacy System A handler removed)
 *
 * Usage: npx playwright test editing-bugs-diagnosis.spec.ts --reporter=line
 */
import { test, expect, type Page } from '@playwright/test'
import { injectTauriMock, bootstrapApp } from './mock-tauri'

// ─────────────────────────────────────────────
// Fixtures
// ─────────────────────────────────────────────

/** Build a doc: optional YAML front matter, then N sections of heading+paragraphs. */
function buildDoc(opts: {
  frontMatter: boolean
  sections: number
  parasPerSection: number
}): { markdown: string; headings: Array<{ line: number; text: string }> } {
  const lines: string[] = []
  const headings: Array<{ line: number; text: string }> = []
  if (opts.frontMatter) {
    lines.push('---', 'title: Test Doc', 'draft: false', '---', '')
  }
  for (let s = 0; s < opts.sections; s++) {
    const text = `Heading ${s}`
    headings.push({ line: lines.length, text })
    lines.push(`# ${text}`)
    for (let p = 0; p < opts.parasPerSection; p++) {
      lines.push(`Paragraph ${s}-${p} with some filler text to give the block height.`)
      lines.push('')
    }
  }
  // trailing paragraphs after the LAST heading so the final TOC entry can
  // still scroll the heading to the top (no end-of-document clamping)
  for (let p = 0; p < 30; p++) {
    lines.push(`Trailing paragraph ${p} to give the document enough bottom padding.`)
    lines.push('')
  }
  return { markdown: lines.join('\n'), headings }
}

const SHORT_NO_FM = buildDoc({ frontMatter: false, sections: 8, parasPerSection: 6 })
const SHORT_WITH_FM = buildDoc({ frontMatter: true, sections: 8, parasPerSection: 6 })
const LONG_NO_FM = buildDoc({ frontMatter: false, sections: 30, parasPerSection: 12 })

async function switchToSourceMode(page: Page) {
  await page.evaluate(() => {
    const app = (document.querySelector('#app') as any)?.__vue_app__
    const pinia = app?.config?.globalProperties?.$pinia
    const prefs = pinia?._s.get('preferences')
    if (prefs?.setPreference) prefs.setPreference({ sourceCode: true })
    else if (prefs) prefs.sourceCode = true
  })
  await page.waitForTimeout(1000)
  await expect(page.locator('.source-code')).toBeVisible({ timeout: 10000 })
  await page.waitForTimeout(500)
}

async function searchBarState(page: Page) {
  return page.evaluate(() => {
    const bar = document.querySelector('.search-bar')
    if (!bar) return { present: false, visible: false, hasReplace: false }
    const rect = bar.getBoundingClientRect()
    const style = getComputedStyle(bar)
    return {
      present: true,
      visible: rect.width > 0 && rect.height > 0 && style.display !== 'none',
      hasReplace: !!bar.querySelector('.replace'),
    }
  })
}

async function bulletListAppeared(page: Page) {
  return page.evaluate(() => !!document.querySelector('.mu-container ul'))
}

// ─────────────────────────────────────────────
// Bug 1: Ctrl+H must open the Replace window
// ─────────────────────────────────────────────

test.describe('Bug1: Ctrl+H 打开替换窗口', () => {
  test('WYSIWYG 模式按 Ctrl+H 应显示替换输入框', async ({ page }) => {
    await injectTauriMock(page, {})
    await bootstrapApp(page, { markdownList: [SHORT_NO_FM.markdown] })
    await page.locator('.mu-container').click()
    await page.waitForTimeout(400)

    await page.keyboard.press('Control+h')
    await page.waitForTimeout(600)

    const state = await searchBarState(page)
    const bullet = await bulletListAppeared(page)
    console.log('[diag] Ctrl+H (wysiwyg):', JSON.stringify({ ...state, bulletListAppeared: bullet }))
    expect(state.visible, '搜索栏应可见').toBe(true)
    expect(state.hasReplace, '应显示替换（replace）输入段').toBe(true)
  })

  test('源码模式按 Ctrl+H 应显示替换输入框', async ({ page }) => {
    await injectTauriMock(page, {})
    await bootstrapApp(page, { markdownList: [SHORT_NO_FM.markdown] })
    await switchToSourceMode(page)
    await page.locator('.source-code').click()
    await page.waitForTimeout(400)

    await page.keyboard.press('Control+h')
    await page.waitForTimeout(600)

    const state = await searchBarState(page)
    console.log('[diag] Ctrl+H (source):', JSON.stringify(state))
    expect(state.visible, '搜索栏应可见').toBe(true)
    expect(state.hasReplace, '应显示替换（replace）输入段').toBe(true)
  })
})

// ─────────────────────────────────────────────
// Bug 2: Ctrl+F must reliably open the Find window
// ─────────────────────────────────────────────

test.describe('Bug2: Ctrl+F 稳定性', () => {
  test('WYSIWYG 模式连续 开→Esc→开 20 轮全部成功', async ({ page }) => {
    await injectTauriMock(page, {})
    await bootstrapApp(page, { markdownList: [SHORT_NO_FM.markdown] })
    await page.locator('.mu-container').click()
    await page.waitForTimeout(400)

    const failures: number[] = []
    for (let i = 0; i < 20; i++) {
      await page.keyboard.press('Control+f')
      await page.waitForTimeout(450)
      const open = (await searchBarState(page)).visible
      if (!open) failures.push(i)
      await page.keyboard.press('Escape')
      await page.waitForTimeout(200)
    }
    console.log('[diag] Ctrl+F WYSIWYG open failures:', JSON.stringify(failures))
    expect(failures, `第 ${failures} 轮未打开查找窗口`).toEqual([])
  })

  test('源码模式（焦点在 CodeMirror）连续 20 轮全部成功', async ({ page }) => {
    await injectTauriMock(page, {})
    await bootstrapApp(page, { markdownList: [SHORT_NO_FM.markdown] })
    await switchToSourceMode(page)
    await page.locator('.source-code').click()
    await page.waitForTimeout(400)

    const failures: number[] = []
    for (let i = 0; i < 20; i++) {
      // click back into the CodeMirror editor so focus leaves the search bar
      await page.locator('.source-code').click()
      await page.keyboard.press('Control+f')
      await page.waitForTimeout(450)
      const open = (await searchBarState(page)).visible
      if (!open) failures.push(i)
      await page.keyboard.press('Escape')
      await page.waitForTimeout(200)
    }
    console.log('[diag] Ctrl+F source-mode open failures:', JSON.stringify(failures))
    expect(failures, `第 ${failures} 轮未打开查找窗口`).toEqual([])
  })

  test('回归：IME 组合态下 Ctrl+F 仍可打开查找（Ctrl 修饰键放行）', async ({ page }) => {
    await injectTauriMock(page, {})
    await bootstrapApp(page, { markdownList: [SHORT_NO_FM.markdown] })
    await page.locator('.mu-container').click()
    await page.waitForTimeout(400)

    // Simulate what a Chinese IME does to keydown events mid-composition.
    await page.evaluate(() => {
      const ev = new KeyboardEvent('keydown', {
        key: 'f',
        code: 'KeyF',
        ctrlKey: true,
        bubbles: true,
        cancelable: true,
      })
      Object.defineProperty(ev, 'isComposing', { get: () => true })
      window.dispatchEvent(ev)
    })
    await page.waitForTimeout(700)
    const state = await searchBarState(page)
    console.log('[diag] Ctrl+F with isComposing=true →', JSON.stringify(state))
    expect(state.visible, '组合态下 Ctrl 修饰快捷键必须放行').toBe(true)
  })
})

// ─────────────────────────────────────────────
// Bug 3: TOC click navigation accuracy
// ─────────────────────────────────────────────

test.describe('Bug3: TOC 点击导航准确性（源码模式）', () => {
  test('无 front matter 的文档全部条目落点正确（对照组）', async ({ page }) => {
    await injectTauriMock(page, {})
    await bootstrapApp(page, {
      markdownList: [SHORT_NO_FM.markdown],
      sourceCodeModeEnabled: true,
    })
    await expect(page.locator('.source-code')).toBeVisible({ timeout: 10000 })
    await runTocAccuracyCheckSourceMode(page, SHORT_NO_FM.headings)
  })

  test('回归：带 YAML front matter 的文档全部条目落点正确（曾整体错位一位）', async ({ page }) => {
    await injectTauriMock(page, {})
    await bootstrapApp(page, {
      markdownList: [SHORT_WITH_FM.markdown],
      sourceCodeModeEnabled: true,
    })
    await expect(page.locator('.source-code')).toBeVisible({ timeout: 10000 })
    await runTocAccuracyCheckSourceMode(page, SHORT_WITH_FM.headings)
  })
})

/**
 * Click every TOC entry; assert the container scrolls exactly to the heading's
 * true line (independent oracle: heading line numbers come from the fixture,
 * not from the app). End-of-document clamping is modeled explicitly.
 */
async function runTocAccuracyCheckSourceMode(
  page: Page,
  headings: Array<{ line: number; text: string }>,
) {
  const entries = page.locator('.side-bar-toc .el-tree-node__content')
  const count = await entries.count()
  expect(count, 'TOC 条目数量应等于标题数量').toBe(headings.length)

  const wrong: Array<{ entry: number; expectedText: string; sawAtTop: string | null; expectedScrollTop: number; actualScrollTop: number }> = []
  for (let i = 0; i < count; i++) {
    // reset scroll to top so every jump is independent
    await page.evaluate(() => {
      const c = document.querySelector('.source-code') as HTMLElement | null
      if (c) c.scrollTop = 0
    })
    await page.waitForTimeout(200)
    await entries.nth(i).click()
    await page.waitForTimeout(1000) // smooth scroll settle

    const r = await page.evaluate((trueLine) => {
      const cmAny = (document.querySelector('.CodeMirror') as any)?.CodeMirror
      const container = document.querySelector('.source-code') as HTMLElement | null
      if (!cmAny || !container) return null
      const maxScroll = container.scrollHeight - container.clientHeight
      const headingTop = cmAny.heightAtLine(trueLine, 'local') + 50
      const expectedScrollTop = Math.min(headingTop, maxScroll)
      const topLine = cmAny.lineAtHeight(container.scrollTop - 50 + 5, 'local')
      return {
        expectedScrollTop,
        actualScrollTop: container.scrollTop,
        topText: (cmAny.getLine(topLine) ?? '').trim(),
      }
    }, headings[i].line)

    if (!r) throw new Error('CodeMirror/container not found')
    const scrollErr = Math.abs(r.actualScrollTop - r.expectedScrollTop)
    // expectedScrollTop models end-of-document clamping exactly, so a small
    // scroll error is the authoritative pass/fail signal
    if (scrollErr > 8) {
      wrong.push({
        entry: i,
        expectedText: headings[i].text,
        sawAtTop: r.topText,
        expectedScrollTop: Math.round(r.expectedScrollTop),
        actualScrollTop: Math.round(r.actualScrollTop),
      })
    }
  }
  console.log('[diag] TOC(source) wrong entries:', JSON.stringify(wrong, null, 1))
  expect(wrong, '以下 TOC 条目点击后落点与目标标题位置不符').toEqual([])
}

test.describe('Bug3: TOC 点击导航准确性（WYSIWYG 长文档 + 懒渲染）', () => {
  test('长文档（30 节）点击目录后章节名顶对齐（与源码模式一致，HEADER_TOP_PAD±40）', async ({ page }) => {
    await injectTauriMock(page, {})
    await bootstrapApp(page, { markdownList: [LONG_NO_FM.markdown] })
    await page.waitForTimeout(1500) // let lazy observer settle initial viewport

    const entries = page.locator('.side-bar-toc .el-tree-node__content')
    const count = await entries.count()
    expect(count).toBe(LONG_NO_FM.headings.length)

    const wrong: Array<{ entry: number; topOffset: number | null }> = []
    // entry 0 is skipped: at scrollTop 0 it sits above STANDAR_Y and the jump
    // legitimately clamps at document start
    for (const i of [5, 10, 15, 20, 25, 29]) {
      await page.evaluate(() => {
        // scroll container = muya domNode, which carries .editor-component
        const c = document.querySelector('.editor-component') as HTMLElement | null
        if (c) c.scrollTop = 0
      })
      await page.waitForTimeout(300)
      await entries.nth(i).click()
      await page.waitForTimeout(1200) // animated scroll (300ms) + lazy flush settle

      const topOffset = await page.evaluate((idx) => {
        const container = document.querySelector('.editor-component')
        const headings = document.querySelectorAll(
          '.mu-container > h1, .mu-container > h2, .mu-container > h3, .mu-container > h4, .mu-container > h5, .mu-container > h6',
        )
        const el = headings[idx]
        if (!container || !el) return null
        // design: 章节名顶对齐——落在滚动容器顶边下方 HEADER_TOP_PAD(16px) 处
        return el.getBoundingClientRect().top - container.getBoundingClientRect().top
      }, i)
      console.log(`[diag] TOC(wysiwyg) entry ${i} containerTopOffset=`, topOffset)
      if (topOffset === null || Math.abs(topOffset - 16) > 40) {
        wrong.push({ entry: i, topOffset })
      }
    }
    expect(wrong, '以下条目落点偏离顶对齐位置(16px)±40px').toEqual([])
  })

  test('诊断：目标标题上方有未加载图片时，落点因图片异步撑高而漂移', async ({ page }) => {
    // 600px-tall SVG so the <img> has a large intrinsic height that only
    // exists AFTER the async image load — same as a real doc with local images
    const tallSvg = Buffer.from(
      '<svg xmlns="http://www.w3.org/2000/svg" width="800" height="600"><rect width="800" height="600" fill="red"/></svg>',
    ).toString('base64')
    await injectTauriMock(page, {
      image_to_data_uri: {
        originalSrc: '',
        dataUri: `data:image/svg+xml;base64,${tallSvg}`,
        originalWidth: null,
        resizedWidth: null,
        originalSize: null,
        finalSize: null,
        error: null,
      },
    })
    const lines: string[] = ['![tall](./a.png)', '', '![tall](./b.png)', '']
    const imgDocHeadings: Array<{ line: number; text: string }> = []
    for (let s = 0; s < 6; s++) {
      imgDocHeadings.push({ line: lines.length, text: `Heading ${s}` })
      lines.push(`# Heading ${s}`, '')
      for (let p = 0; p < 10; p++) {
        lines.push(`Filler ${s}-${p}.`, '')
      }
    }
    await bootstrapApp(page, { markdownList: [lines.join('\n')] })
    await page.waitForTimeout(2500) // let images load & layout shift

    const entries = page.locator('.side-bar-toc .el-tree-node__content')
    const count = await entries.count()
    expect(count).toBe(imgDocHeadings.length)

    const offsets: Array<{ entry: number; topOffset: number | null }> = []
    for (const i of [3, 5]) {
      await page.evaluate(() => {
        const c = document.querySelector('.editor-component') as HTMLElement | null
        if (c) c.scrollTop = 0
      })
      await page.waitForTimeout(300)
      await entries.nth(i).click()
      await page.waitForTimeout(1200)
      const topOffset = await page.evaluate((idx) => {
        const container = document.querySelector('.editor-component')
        const headings = document.querySelectorAll(
          '.mu-container > h1, .mu-container > h2, .mu-container > h3',
        )
        const el = headings[idx]
        if (!container || !el) return null
        return el.getBoundingClientRect().top
      }, i)
      console.log(`[diag] TOC(images) entry ${i} viewportY=`, topOffset, '(design: ~320)')
      offsets.push({ entry: i, topOffset })
    }
    // Diagnostic only: documents whether async image heights shift the landing.
    expect(offsets.length).toBe(2)
  })
})

// ─────────────────────────────────────────────
// Bug 4: every keyboard shortcut must dispatch exactly once.
// The legacy keyboardShortcuts.ts (System A) handler was registered on the
// same document capture phase as keyboardShortcut.ts (System B); both ran for
// every keydown, double-firing every command (Ctrl+T opened two tabs).
// ─────────────────────────────────────────────

test.describe('Bug4: 快捷键单次派发（双系统去重）', () => {
  test('按一次 Ctrl+T 只新建一个标签', async ({ page }) => {
    await injectTauriMock(page, {})
    await bootstrapApp(page, { markdownList: [SHORT_NO_FM.markdown] })

    const initial = await page.locator('.editor-tabs .tabs-container li').count()
    expect(initial).toBeGreaterThanOrEqual(1)

    await page.locator('.mu-container').click()
    await page.keyboard.press('Control+t')
    await page.waitForTimeout(1000)

    const after = await page.locator('.editor-tabs .tabs-container li').count()
    console.log(`[diag] tabs: initial=${initial} after_one_ctrl_t=${after}`)
    expect(after, '一次 Ctrl+T 只应新增一个标签（双派发会新增两个）').toBe(initial + 1)
  })
})
