import { test, expect } from '@playwright/test'
import { injectTauriMock, emitTauriEvent } from './mock-tauri'

test('debug: dump app state after load', async ({ page }) => {
  const logs: string[] = []
  page.on('console', (msg) => logs.push(`[${msg.type()}] ${msg.text()}`))
  page.on('pageerror', (err) => logs.push(`[pageerror] ${err.message}`))

  await injectTauriMock(page)
  await page.goto('http://localhost:1420/')
  // 等待 Vue onMounted 完成（含 await），确保 LISTEN_FOR_BOOTSTRAP_WINDOW 已注册
  await page.waitForTimeout(3000)

  // Dump 初始状态
  const state1 = await page.evaluate(() => ({
    tabs: document.querySelectorAll('.editor-tabs .tabs-container li').length,
    bodyText: document.body.innerText.substring(0, 200),
  }))
  console.log('[DEBUG] initial state:', JSON.stringify(state1))

  // 尝试通过 emitTauriEvent（走 plugin:event|emit 通道）手动触发 bootstrap-editor
  await emitTauriEvent(page, 'mt::bootstrap-editor', {
    addBlankTab: true,
    markdownList: [],
    lineEnding: 'lf',
    sideBarVisibility: true,
    tabBarVisibility: true,
    sourceCodeModeEnabled: false,
  })
  await page.waitForTimeout(2000)

  const state2 = await page.evaluate(() => ({
    tabs: document.querySelectorAll('.editor-tabs .tabs-container li').length,
    editorComponent: !!document.querySelector('.editor-component.mu-editor, .mu-editor'),
    bodyText: document.body.innerText.substring(0, 200),
  }))
  console.log('[DEBUG] after bootstrap-editor emit:', JSON.stringify(state2))

  // 也试试正确的菜单命令 file.new-tab
  await emitTauriEvent(page, 'mt::menu::click', { id: 'file.new-tab' })
  await page.waitForTimeout(2000)

  const state3 = await page.evaluate(() => ({
    tabs: document.querySelectorAll('.editor-tabs .tabs-container li').length,
  }))
  console.log('[DEBUG] after file.new-tab menu click:', JSON.stringify(state3))

  console.log('[DEBUG] relevant logs:')
  logs.filter((l) =>
    /bootstrap|new-untitled|menuBridge|NEW_UNTITLED|tab|error|warn/i.test(l)
  ).slice(-30).forEach((l) => console.log('  ' + l))

  expect(true).toBe(true)
})
