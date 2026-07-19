/* eslint-disable @typescript-eslint/no-explicit-any */
// popupMenu 单元测试：验证 windowControl.popupMenu 直接在 DOM 中渲染菜单项，
// 支持 separator / visible=false / enabled=false 分支，点击触发 localEmit 并关闭。
//
// 验证策略：
// 1. 与 tauri-bridge.test.ts 相同的 mock 套件（core/event/window/dialog）。
// 2. 通过 import tauri-bridge 获得 window.electron.windowControl.popupMenu。
// 3. happy-dom 提供 document.body，渲染后用 querySelector 检查 DOM 结构。
// 4. 通过 window.electron.ipcRenderer.on(channel, cb) 注册 listener 捕获 localEmit，
//    因为 popupMenu 内部调用的 localEmit 走 tauri-bridge 的 localListeners Map。

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@tauri-apps/api/core', () => ({ invoke: vi.fn() }))
vi.mock('@tauri-apps/api/event', () => ({
  listen: vi.fn(),
  emit: vi.fn(),
}))

const mockWindowInstance = vi.hoisted(() => ({
  minimize: vi.fn(),
  maximize: vi.fn(),
  unmaximize: vi.fn(),
  toggleMaximize: vi.fn(),
  setFullscreen: vi.fn(),
  toggleFullscreen: vi.fn(),
}))
vi.mock('@tauri-apps/api/window', () => ({
  getCurrentWindow: () => mockWindowInstance,
}))
vi.mock('@tauri-apps/plugin-dialog', () => ({ confirm: vi.fn() }))

import { invoke } from '@tauri-apps/api/core'
import { listen } from '@tauri-apps/api/event'
import '../../src/renderer/src/tauri-bridge'

const win = window as unknown as Record<string, any>
const windowControl = win.electron.windowControl
const ipcRenderer = win.electron.ipcRenderer

function flushMicrotasks(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0))
}

// 只取叶子 div（无子元素）匹配文字，排除父容器（其 textContent 会聚合所有子元素文字）
function findLeafItem(text: string): HTMLElement | undefined {
  const all = Array.from(document.body.querySelectorAll('div')) as HTMLElement[]
  return all.find((el) => el.children.length === 0 && el.textContent === text)
}

beforeEach(() => {
  document.body.innerHTML = ''
  vi.mocked(invoke).mockReset()
  vi.mocked(listen).mockReset()
  // listen 必须返回 Promise<UnlistenFn>，否则 ipcRenderer.on() 内部 .then 链路报错
  vi.mocked(listen).mockResolvedValue(() => {})
})

afterEach(async () => {
  // 等待 popupMenu 的 setTimeout(0) 注册 document click 监听后再清理
  await flushMicrotasks()
  // 触发并清理残留的 document click ({ once: true }) 监听器，防止跨用例泄漏
  document.dispatchEvent(new Event('click'))
  document.body.innerHTML = ''
  vi.clearAllMocks()
})

describe('windowControl.popupMenu — DOM 渲染', () => {
  it('传入 template 数组时创建并插入 DOM 容器', () => {
    windowControl.popupMenu([{ label: 'Item A' }], { x: 100, y: 200 })
    const menus = document.body.querySelectorAll('div')
    expect(menus.length).toBeGreaterThan(0)
    const menu = menus[0] as HTMLElement
    expect(menu.style.position).toBe('fixed')
    expect(menu.style.zIndex).toBe('99999')
    expect(menu.style.left).toBe('100px')
    expect(menu.style.top).toBe('200px')
  })

  it('菜单项显示 label 文字', () => {
    windowControl.popupMenu([{ label: 'Save', id: 'save' }, { label: 'Open', id: 'open' }])
    const items = Array.from(document.body.querySelectorAll('div')) as HTMLElement[]
    const labels = items.map((el) => el.textContent)
    expect(labels).toContain('Save')
    expect(labels).toContain('Open')
  })

  it('separator (type=separator) 渲染为分隔线', () => {
    windowControl.popupMenu([
      { label: 'A' },
      { type: 'separator' },
      { label: 'B' },
    ])
    const separators = Array.from(document.body.querySelectorAll('div')) as HTMLElement[]
    // 找到样式 height:1px 的分隔元素
    const sep = separators.find((el) => el.style.height === '1px')
    expect(sep).toBeDefined()
    expect(sep!.style.background).toContain('#e0e0e0')
  })

  it('separator (isSeparator=true) 同样渲染为分隔线', () => {
    windowControl.popupMenu([{ label: 'A' }, { isSeparator: true }, { label: 'B' }])
    const separators = Array.from(document.body.querySelectorAll('div')) as HTMLElement[]
    const sep = separators.find((el) => el.style.height === '1px')
    expect(sep).toBeDefined()
  })

  it('visible=false 的项不渲染', () => {
    windowControl.popupMenu([
      { label: 'Visible', id: 'v' },
      { label: 'Hidden', id: 'h', visible: false },
    ])
    const labels = Array.from(document.body.querySelectorAll('div')).map((el) => el.textContent)
    expect(labels).toContain('Visible')
    expect(labels).not.toContain('Hidden')
  })

  it('enabled=false 的项被渲染但样式为禁用且不响应点击', () => {
    const cb = vi.fn()
    ipcRenderer.on('mt::menu::click', cb)

    windowControl.popupMenu([{ label: 'Disabled', id: 'd', enabled: false }])
    const disabled = findLeafItem('Disabled')
    expect(disabled).toBeDefined()
    // opacity:0.4 + cursor:default 表示禁用样式
    expect(disabled!.style.opacity).toBe('0.4')
    expect(disabled!.style.cursor).toBe('default')

    disabled!.click()
    expect(cb).not.toHaveBeenCalled()
  })
})

describe('windowControl.popupMenu — 点击行为', () => {
  it('点击 enabled 菜单项 → localEmit("mt::menu::click", { id, windowId: 0 })', async () => {
    const cb = vi.fn()
    ipcRenderer.on('mt::menu::click', cb)

    windowControl.popupMenu([{ label: 'Save', id: 'file.save' }])
    const item = findLeafItem('Save')
    expect(item).toBeDefined()

    item!.click()
    expect(cb).toHaveBeenCalledTimes(1)
    expect(cb).toHaveBeenCalledWith(
      expect.objectContaining({ __local: true }),
      expect.objectContaining({ id: 'file.save', windowId: 0 }),
    )
  })

  it('点击 enabled 菜单项后菜单从 DOM 移除并 localEmit("mt::menu::closed")', async () => {
    const closedCb = vi.fn()
    ipcRenderer.on('mt::menu::closed', closedCb)

    windowControl.popupMenu([{ label: 'A', id: 'a' }])
    expect(document.body.querySelectorAll('div').length).toBeGreaterThan(0)

    const item = findLeafItem('A')!
    item.click()

    expect(closedCb).toHaveBeenCalledTimes(1)
    // 菜单已被 remove()
    expect(document.body.querySelectorAll('div').length).toBe(0)
  })

  it('点击菜单外部（document click）→ 关闭菜单 + localEmit("mt::menu::closed")', async () => {
    const closedCb = vi.fn()
    ipcRenderer.on('mt::menu::closed', closedCb)

    windowControl.popupMenu([{ label: 'A', id: 'a' }])
    expect(document.body.querySelectorAll('div').length).toBeGreaterThan(0)

    // setTimeout(0) 内注册 document click 监听；flush 后再触发外部点击
    await flushMicrotasks()
    document.dispatchEvent(new Event('click'))

    expect(closedCb).toHaveBeenCalledTimes(1)
    expect(document.body.querySelectorAll('div').length).toBe(0)
  })

  it('template 为 undefined 时直接返回不渲染', () => {
    windowControl.popupMenu(undefined as unknown as any[])
    expect(document.body.querySelectorAll('div').length).toBe(0)
  })

  it('无 label 的项渲染为空字符串', () => {
    windowControl.popupMenu([{ id: 'no-label' }])
    const items = Array.from(document.body.querySelectorAll('div')) as HTMLElement[]
    const item = items.find((el) => el.textContent === '')
    expect(item).toBeDefined()
  })

  it('多个菜单项 + 多个 separator 按顺序渲染', () => {
    windowControl.popupMenu([
      { label: 'A', id: 'a' },
      { type: 'separator' },
      { label: 'B', id: 'b' },
      { type: 'separator' },
      { label: 'C', id: 'c' },
    ])
    const allDivs = Array.from(document.body.querySelectorAll('div')) as HTMLElement[]
    // 只取叶子 div（无子元素）+ 非分隔线（height !== 1px），按 DOM 顺序得到菜单项 label
    const labels = allDivs
      .filter((el) => el.children.length === 0 && el.style.height !== '1px')
      .map((el) => el.textContent)
    expect(labels).toEqual(['A', 'B', 'C'])
  })
})
