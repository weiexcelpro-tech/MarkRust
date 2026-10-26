/**
 * B01 不支持拖拽打开文件 —— TC-B01-02 原生 drag-drop 桥接 / TC-B01-02B 合成 DOM drop 回归
 *
 * 修复方案（走原生桥接，未改 tauri.conf.json）：
 * - 真机 Tauri 默认 dragDropEnabled=true 拦截 WebView2 的 DOM drop，页面收不到 drop；
 * - tauri-bridge.ts 激活 getCurrentWebview().onDragDropEvent：收到 tauri://drag-drop 的
 *   payload.paths 后过滤 markdown 文件，走既有打开管线 mt::open-file
 *   （fs_read_markdown → mt::open-new-tab → recent_add）；多文件逐个打开、非 md 忽略。
 * mock 环境：用 emitTauriEvent('tauri://drag-drop', { paths, position }) 模拟原生事件。
 */
import { test, expect } from '@playwright/test'
import {
  launchEditor,
  makeDocResult,
  recordInvokes,
  getRecordedInvokes,
  emitTauriEvent,
  collectPageErrors,
  fatalErrors
} from './_helpers'

test.setTimeout(120_000)

test('TC-B01-02: tauri://drag-drop 原生拖拽事件（paths）→ 打开管线（.md 打开、非 md 忽略）', async ({ page }) => {
  const pageErrors = collectPageErrors(page)
  // fs_read_markdown 覆盖：返回拖入文件内容，模拟 Rust 侧读盘
  await launchEditor(page, {
    overrides: {
      fs_read_markdown: makeDocResult('C:\\dropped\\drop.md', '# Drag Test\n\nNative bridge drop.\n')
    }
  })
  await recordInvokes(page)

  // 模拟 Tauri 原生 drag-drop：一次拖入两个文件（.md + .png），
  // 期望仅 .md 走一次打开管线（多文件逐个打开、非 md 忽略）
  await emitTauriEvent(page, 'tauri://drag-drop', {
    paths: ['C:\\dropped\\drop.md', 'C:\\dropped\\photo.png'],
    position: { x: 200, y: 200 }
  })

  // 等待打开管线完成：fs_read_markdown → mt::open-new-tab → 编辑器渲染内容
  await expect(page.locator('.editor-component')).toContainText('Drag Test', { timeout: 15000 })

  const invokes = await getRecordedInvokes(page)
  const reads = invokes.filter((i) => i.cmd === 'fs_read_markdown')
  // eslint-disable-next-line no-console
  console.log(
    '[B01-02] invoke 序列:',
    invokes.map((i) => i.cmd).join(',') || '(空)'
  )

  const problems: string[] = []
  if (reads.length !== 1) {
    problems.push(`期望恰好 1 次 fs_read_markdown（仅 .md，非 md 忽略），实际 ${reads.length} 次`)
  } else {
    const path = (reads[0]!.args as { path?: string }).path
    if (path !== 'C:\\dropped\\drop.md') {
      problems.push(`fs_read_markdown 的 path 应为 'C:\\dropped\\drop.md'，实际 '${String(path)}'`)
    }
  }
  const fatal = fatalErrors(pageErrors)
  if (fatal.length) problems.push(`致命 JS 错误:\n${fatal.join('\n')}`)

  expect(problems, `TC-B01-02 断言失败:\n- ${problems.join('\n- ')}`).toEqual([])
})

test('TC-B01-02B: 合成 DataTransfer drop（真机 DOM drop 被 Tauri 拦截，由原生事件接管；浏览器态回归不崩溃）', async ({ page }) => {
  const pageErrors = collectPageErrors(page)
  await launchEditor(page)
  await recordInvokes(page)

  // 构造 DataTransfer + File，向 body 依次派发 dragenter → dragover → drop。
  // 注意（修复后契约）：真机 WebView2 的 OS 文件拖放被 Tauri 拦截（dragDropEnabled 默认 true），
  // DOM drop 事件根本不会触发——打开文件由 tauri://drag-drop 原生事件桥接（TC-B01-02）。
  // 本用例仅在浏览器/mock 环境有 DOM drop，回归目标 = 合成拖拽序列不产生致命 JS 错误。
  await page.evaluate(() => {
    const dt = new DataTransfer()
    dt.items.add(new File(['# Drag Test'], 'drop.md', { type: 'text/markdown' }))
    const target = document.body
    for (const type of ['dragenter', 'dragover', 'drop']) {
      target.dispatchEvent(
        new DragEvent(type, { bubbles: true, cancelable: true, dataTransfer: dt })
      )
    }
  })
  await page.waitForTimeout(1000)

  const invokes = await getRecordedInvokes(page)
  // eslint-disable-next-line no-console
  console.log('[B01-02B] invoke 序列:', invokes.map((i) => i.cmd).join(',') || '(空)')

  const problems: string[] = []
  // 文档化契约：DOM drop 不再是打开通道（浏览器态不触发打开管线，真机被 Tauri 拦截）。
  // 若未来有人在渲染层加回 DOM Files drop 打开逻辑，请同步更新本注释与用例。
  const domDropOpens = invokes.filter(
    (i) => i.cmd === 'fs_read_markdown' || i.cmd === 'fs_read_file'
  )
  if (domDropOpens.length > 0) {
    problems.push(
      '合成 DOM drop 触发了打开管线调用——与「真机由 Tauri 原生 drag-drop 事件接管」的契约不一致，请核对实现'
    )
  }
  const fatal = fatalErrors(pageErrors)
  if (fatal.length) problems.push(`致命 JS 错误:\n${fatal.join('\n')}`)

  expect(problems, `TC-B01-02B 断言失败:\n- ${problems.join('\n- ')}`).toEqual([])
})
