/**
 * B02 点击左下角设置按钮闪一下黑窗 —— TC-B02-02 点击设置按钮的调用契约（修复后回归版）
 *
 * 契约演变：
 * - 用例设计时假设「齿轮 → window_open_settings 独立窗口」；勘察证实 v1.1.6 现行
 *   交互是同窗侧栏面板（tauri-bridge 将 'mt::open-setting-window' 映射为
 *   'mt::sidebar-show-settings' → layoutStore.SET_LAYOUT({ rightColumn:'settings' })）。
 * - 真机 17 帧连拍 0 黑帧（Docs/e2e/real-run-results.md）→ B02 判定未复现；
 *   黑闪机制仅存于已废弃的独立开窗路径（window.rs 已补 background_color 兜底）。
 * - 修复后本用例锁定健康契约：齿轮 → 侧栏设置面板出现、无致命错误、
 *   且不触发独立开窗命令（0 次窗口开放调用，从根上排除黑闪路径）。
 */
import { test, expect } from '@playwright/test'
import { launchEditor, recordInvokes, getRecordedInvokes, collectPageErrors, fatalErrors, } from './_helpers'


test.setTimeout(120_000)

test('TC-B02-02: 点击设置按钮打开同窗设置面板，无异常且不走独立开窗路径', async ({ page }) => {
  const pageErrors = collectPageErrors(page)
  await launchEditor(page)
  await recordInvokes(page)

  // 左下角齿轮按钮（side-bar 左列底部 ul.bottom 唯一 li）
  const gear = page.locator('.side-bar .left-column ul.bottom li')
  await expect(gear).toHaveCount(1)
  await gear.click()
  await page.waitForTimeout(800)

  // 修复后契约 ①：同窗侧栏设置面板出现（rightColumn === 'settings' → v-if 渲染）
  const settingsPanel = page.locator('.side-bar .sidebar-settings')
  await expect(
    settingsPanel,
    '点击齿轮应显示同窗侧栏设置面板（.sidebar-settings）',
  ).toBeVisible()

  // 修复后契约 ②：不触发独立设置窗口（0 次窗口开放调用；该路径已加 background_color 兜底）
  const invokes = await getRecordedInvokes(page)
  const settingsCalls = invokes.filter((i) => i.cmd === 'window_open_settings')
  // eslint-disable-next-line no-console
  console.log(
    '[B02-02] invoke 序列:', invokes.map((i) => i.cmd).join(',') || '(空)',
    '| window_open_settings 调用次数:', settingsCalls.length,
  )
  expect(
    settingsCalls.length,
    '现行契约：齿轮打开同窗面板，不应调用 window_open_settings 独立开窗（黑闪机制残留路径）',
  ).toBe(0)

  // 渲染层健康底线：无未处理异常
  const fatal = fatalErrors(pageErrors)
  expect(fatal, `致命 JS 错误:\n${fatal.join('\n')}`).toHaveLength(0)
})
