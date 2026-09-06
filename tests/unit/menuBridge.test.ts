/* eslint-disable @typescript-eslint/no-explicit-any */
// menuBridge 单元测试：验证菜单点击 → 命令查找/分发/告警的全部分支。
//
// 验证策略：
// 1. Mock bus，避免 mitt 实例真实事件扩散。
// 2. 在 import menuBridge 前注入 window.electron.ipcRenderer，并用 on() 钩子
//    捕获 'mt::menu::click' 的注册 handler，后续测试直接调用该 handler。
// 3. 通过 vi.spyOn 替换真实 commands 中目标命令的 execute/executeSubcommand，
//    断言分发命中正确分支。
// 4. payload 同时覆盖 { id } 对象与纯字符串两种 Rust 侧协议形态。

import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest'

// vi.mock 会被 vitest 自动提升到文件顶部，确保在 import menuBridge 之前生效。
vi.mock('../../src/renderer/src/bus', () => ({
  default: { on: vi.fn(), emit: vi.fn(), off: vi.fn() },
}))

// Mock localEmit：menuBridge 的 LAYOUT/FORMAT/CHECKBOX 分支都通过 localEmit 触发事件；
// 直接 mock 让测试能断言 emit 参数，而不必通过 tauri-bridge 内部 listener Map 间接验证。
const localEmitMock = vi.hoisted(() => vi.fn())
vi.mock('../../src/renderer/src/tauri-bridge', () => ({
  localEmit: (...args: unknown[]) => localEmitMock(...args),
}))

// help.about 分支调用 getVersion()（@tauri-apps/api/app）并在成功/失败回调里 alert()。
// 不 mock 时真实 getVersion 会 reject，alert 又未定义 → unhandled rejection。
vi.mock('@tauri-apps/api/app', () => ({
  getVersion: vi.fn(() => Promise.resolve('1.1.5')),
}))

// 静态 import：commands 与 menuBridge 共享同一份模块缓存，commands 的真实数据
// 即 menuBridge 内部 findCommand() 所查询的数据。
import commands from '../../src/renderer/src/commands'
import bus from '../../src/renderer/src/bus'

// 捕获 'mt::menu::click' 注册回调；menuBridge 在模块加载时即注册。
let menuClickHandler: ((_event: unknown, payload: unknown) => void) | undefined
const openExternalMock = vi.fn()
const invokeMock = vi.fn()

beforeAll(async () => {
  // help.about 弹窗用 alert（happy-dom 未实现）→ 提供桩避免 unhandled rejection
  vi.stubGlobal('alert', vi.fn())
  // 在 menuBridge 加载前注入 ipcRenderer + shell；on() 返回 unsubscribe 函数。
  ;(window as any).electron = {
    ipcRenderer: {
      on: vi.fn((channel: string, handler: (...a: unknown[]) => void) => {
        if (channel === 'mt::menu::click') {
          menuClickHandler = handler as (_e: unknown, payload: unknown) => void
        }
        return () => {}
      }),
      send: vi.fn(),
      invoke: invokeMock,
    },
    shell: {
      openExternal: openExternalMock,
    },
  }

  // 动态 import 确保 window.electron 在模块副作用运行前已就绪；
  // ES 模块缓存保证整个测试套件只真正执行一次副作用。
  await import('../../src/renderer/src/menuBridge')
})

beforeEach(() => {
  // hoisted vi.fn() 不受 vi.restoreAllMocks() 影响，需要手动 clear 防止调用计数跨用例泄漏
  localEmitMock.mockClear()
  openExternalMock.mockClear()
  invokeMock.mockClear()
})

afterEach(() => {
  // 在用例间恢复 spyOn 替换，避免相邻 it 之间 spy 调用计数累加。
  vi.restoreAllMocks()
})

afterAll(() => {
  delete (window as any).electron
})

function findCmd(id: string): any {
  const cmd = commands.find((c) => c.id === id)
  if (!cmd) throw new Error(`commands 中未找到 "${id}"`)
  return cmd as any
}

describe('menuBridge — ipcRenderer handler 注册', () => {
  it("注册了 'mt::menu::click' 监听器", () => {
    const onSpy = (window as any).electron.ipcRenderer.on as ReturnType<typeof vi.fn>
    const channels = onSpy.mock.calls.map((c: unknown[]) => c[0])
    expect(channels).toContain('mt::menu::click')
    expect(typeof menuClickHandler).toBe('function')
  })
})

describe('menuBridge — 已知命令查找与 execute 调用', () => {
  it("file.save 命中后调用其 execute()", () => {
    const cmd = findCmd('file.save')
    const spy = vi.spyOn(cmd, 'execute').mockImplementation(() => {})
    menuClickHandler!({}, { id: 'file.save' })
    expect(spy).toHaveBeenCalledTimes(1)
  })

  it('payload 为字符串时同样能解析 id 并执行', () => {
    const cmd = findCmd('file.new-tab')
    const spy = vi.spyOn(cmd, 'execute').mockImplementation(() => {})
    menuClickHandler!({}, 'file.new-tab')
    expect(spy).toHaveBeenCalledTimes(1)
  })

  it('view.toggle-sidebar 命中后调用其 execute()', () => {
    const cmd = findCmd('view.toggle-sidebar')
    const spy = vi.spyOn(cmd, 'execute').mockImplementation(() => {})
    menuClickHandler!({}, { id: 'view.toggle-sidebar' })
    expect(spy).toHaveBeenCalledTimes(1)
  })
})

describe('menuBridge — 子命令分发', () => {
  it("file.zoom-3 命中 file.zoom 父命令的 executeSubcommand(id)", () => {
    // file.zoom 是典型的 parent-executeSubcommand 模式：sub 自身无 execute，
    // 父命令的 executeSubcommand 接管所有子 id 分发。
    const parent = findCmd('file.zoom')
    const spy = vi.spyOn(parent, 'executeSubcommand').mockImplementation(() => {})
    menuClickHandler!({}, { id: 'file.zoom-3' })
    expect(spy).toHaveBeenCalledWith('file.zoom-3')
  })

  it("file.export-file-html 命中 sub 自身的 execute（parent 无 executeSubcommand）", () => {
    // file.export-file 走 sub-execute 模式：parent 仅有 subcommands 数组，
    // 每个 sub 自带 execute；menuBridge 退到 cmd.execute() 分支。
    const parent = findCmd('file.export-file')
    expect(parent.executeSubcommand).toBeUndefined()
    const sub = parent.subcommands.find((s: any) => s.id === 'file.export-file-html')
    expect(sub).toBeTruthy()

    const spy = vi.spyOn(sub, 'execute').mockImplementation(() => {})
    menuClickHandler!({}, { id: 'file.export-file-html' })
    expect(spy).toHaveBeenCalledTimes(1)
  })
})

describe('menuBridge — 异常分支', () => {
  it('未知 id 触发 console.warn 告警', () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
    menuClickHandler!({}, { id: 'totally.unknown.id' })
    expect(warnSpy).toHaveBeenCalledWith(
      '[menuBridge] no command for menu id:',
      'totally.unknown.id'
    )
  })

  it('命令顶层缺少 execute 时告警（file.export-file 无 execute/executeSubcommand）', () => {
    const cmd = findCmd('file.export-file')
    expect(cmd.execute).toBeUndefined()
    expect(cmd.executeSubcommand).toBeUndefined()

    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
    // 顶层直接命中 file.export-file：parent 未定义 → 跳过 executeSubcommand 分支；
    // cmd.execute 未定义 → 跳过 execute 分支；落入 "command has no execute" 告警。
    menuClickHandler!({}, { id: 'file.export-file' })
    expect(warnSpy).toHaveBeenCalledWith(
      '[menuBridge] command has no execute:',
      'file.export-file'
    )
  })

  it('execute 抛错时被捕获并由 console.error 报告', () => {
    const cmd = findCmd('file.save')
    const boom = new Error('boom')
    vi.spyOn(cmd, 'execute').mockImplementation(() => {
      throw boom
    })
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {})

    menuClickHandler!({}, { id: 'file.save' })
    expect(errSpy).toHaveBeenCalledWith('[menuBridge] execution error:', 'file.save', boom)
  })

  it('payload.id 缺失时不触发任何查找', () => {
    const cmd = findCmd('file.save')
    const spy = vi.spyOn(cmd, 'execute').mockImplementation(() => {})

    // payload 为空对象 → handler 内 typeof payload !== 'string' → payload?.id ?? ''
    // 得到 '' → if (id) 短路，不进入 handleMenuClick。
    menuClickHandler!({}, {})
    expect(spy).not.toHaveBeenCalled()
  })
})

// ============================================================================
// CHECKBOX_MENU_MAP — view mode 切换
// ============================================================================
describe('menuBridge — CHECKBOX_MENU_MAP', () => {
  it('sourceCodeModeMenuItem → localEmit("mt::toggle-view-mode-entry", "sourceCode")', () => {
    menuClickHandler!({}, { id: 'sourceCodeModeMenuItem' })
    expect(localEmitMock).toHaveBeenCalledWith('mt::toggle-view-mode-entry', 'sourceCode')
  })

  it('typewriterModeMenuItem → localEmit(..., "typewriter")', () => {
    menuClickHandler!({}, { id: 'typewriterModeMenuItem' })
    expect(localEmitMock).toHaveBeenCalledWith('mt::toggle-view-mode-entry', 'typewriter')
  })

  it('focusModeMenuItem → localEmit(..., "focus")', () => {
    menuClickHandler!({}, { id: 'focusModeMenuItem' })
    expect(localEmitMock).toHaveBeenCalledWith('mt::toggle-view-mode-entry', 'focus')
  })
})

// ============================================================================
// FORMAT_MENU_MAP — 11 项格式 checkbox
// ============================================================================
describe('menuBridge — FORMAT_MENU_MAP', () => {
  const cases: Array<[string, string]> = [
    ['strongMenuItem', 'strong'],
    ['emphasisMenuItem', 'em'],
    ['underlineMenuItem', 'u'],
    ['superscriptMenuItem', 'sup'],
    ['subscriptMenuItem', 'sub'],
    ['highlightMenuItem', 'mark'],
    ['inlineCodeMenuItem', 'inline_code'],
    ['strikeMenuItem', 'del'],
    ['hyperlinkMenuItem', 'link'],
    ['imageMenuItem', 'image'],
    ['inlineMathMenuItem', 'inline_math'],
    ['clearFormatMenuItem', 'clear'],
  ]

  for (const [menuId, formatType] of cases) {
    it(`${menuId} → localEmit("mt::editor-format-action", { type: "${formatType}" })`, () => {
      menuClickHandler!({}, { id: menuId })
      expect(localEmitMock).toHaveBeenCalledWith('mt::editor-format-action', { type: formatType })
    })
  }
})

// ============================================================================
// LAYOUT_MENU_MAP — layout 切换
// （实现已从 localEmit("mt::set-view-layout") 改为 bus.emit("view:toggle-layout-entry")，
//   监听者在 store/layout.ts:174；这里跟随实现断言 bus 事件。）
// ============================================================================
describe('menuBridge — LAYOUT_MENU_MAP', () => {
  it('sideBarMenuItem → bus.emit("view:toggle-layout-entry", "showSideBar")', () => {
    menuClickHandler!({}, { id: 'sideBarMenuItem' })
    expect(bus.emit).toHaveBeenCalledWith('view:toggle-layout-entry', 'showSideBar')
  })

  it('tabBarMenuItem → bus.emit(..., "showTabBar")', () => {
    menuClickHandler!({}, { id: 'tabBarMenuItem' })
    expect(bus.emit).toHaveBeenCalledWith('view:toggle-layout-entry', 'showTabBar')
  })

  it('tocMenuItem → bus.emit(..., "rightColumn")', () => {
    menuClickHandler!({}, { id: 'tocMenuItem' })
    expect(bus.emit).toHaveBeenCalledWith('view:toggle-layout-entry', 'rightColumn')
  })
})

// ============================================================================
// HELP_MENU_MAP — 外部链接
// ============================================================================
describe('menuBridge — HELP_MENU_MAP', () => {
  it('help.markdown-reference → shell.openExternal(commonmark URL)', () => {
    menuClickHandler!({}, { id: 'help.markdown-reference' })
    expect(openExternalMock).toHaveBeenCalledWith('https://commonmark.org/help/')
  })

  it('help.view-source → shell.openExternal(github URL)', () => {
    menuClickHandler!({}, { id: 'help.view-source' })
    expect(openExternalMock).toHaveBeenCalledWith('https://github.com/marktext/marktext')
  })

  it('help.report-bug → shell.openExternal(issues URL)', () => {
    menuClickHandler!({}, { id: 'help.report-bug' })
    expect(openExternalMock).toHaveBeenCalledWith('https://github.com/marktext/marktext/issues')
  })

  it('help.changelog → shell.openExternal(releases URL)', () => {
    menuClickHandler!({}, { id: 'help.changelog' })
    expect(openExternalMock).toHaveBeenCalledWith('https://github.com/marktext/marktext/releases')
  })

  it('help.about 不触发 openExternal 也不触发 localEmit', () => {
    menuClickHandler!({}, { id: 'help.about' })
    expect(openExternalMock).not.toHaveBeenCalled()
    expect(localEmitMock).not.toHaveBeenCalled()
  })
})

// ============================================================================
// 特殊 view 菜单：command-palette / reload-images
// ============================================================================
describe('menuBridge — view special menus', () => {
  it('view.command-palette → bus.emit("show-command-palette")', () => {
    const busEmit = (bus.emit as ReturnType<typeof vi.fn>)
    busEmit.mockClear()
    menuClickHandler!({}, { id: 'view.command-palette' })
    expect(busEmit).toHaveBeenCalledWith('show-command-palette')
  })

  it('view.reload-images → window.location.reload()', () => {
    const reloadSpy = vi.fn()
    // happy-dom 的 location.reload 不可写，用 defineProperty 强制覆盖一次
    const original = (window.location as unknown as { reload: unknown }).reload
    Object.defineProperty(window.location, 'reload', { value: reloadSpy, configurable: true })
    try {
      menuClickHandler!({}, { id: 'view.reload-images' })
      expect(reloadSpy).toHaveBeenCalledTimes(1)
    } finally {
      Object.defineProperty(window.location, 'reload', { value: original, configurable: true })
    }
  })
})
