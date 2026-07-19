/* eslint-disable @typescript-eslint/no-explicit-any */
// bootstrap 单元测试：验证 URL 参数解析、错误监听注册、window.marktext 初始化结构。
//
// 验证策略：
// 1. electron-log/renderer 通过 vitest.config.ts 的 resolve.alias 指向 tests/stubs，
//    无需 vi.mock；stub 提供 bootstrap.ts 用到的 transports.console.level / error。
// 2. 用 window.history.replaceState 设置 URL query，验证 parseUrlArgs 各字段。
//    parseUrlArgs 不导出，故通过调用 bootstrapRenderer 间接断言其输出。
// 3. 验证 bootstrapRenderer 注册 'error' / 'unhandledrejection' 监听。
// 4. 验证 window.marktext 的 initialState / env / paths 结构。

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import bootstrapRenderer from '../../src/renderer/src/bootstrap'

const ORIGINAL_SEARCH = window.location.search

function setUrlParams(query: string): void {
  window.history.replaceState(null, '', `/${query}`)
}

beforeEach(() => {
  // configureLogger() 读取 window.electron.process.env.NODE_ENV；
  // handleRendererError 通过 ipcRenderer.send 上报，虽不主动触发但需存在以防 throw。
  ;(window as any).electron = {
    process: { env: { NODE_ENV: 'test' } },
    ipcRenderer: { send: vi.fn() },
  }
})

afterEach(() => {
  // 还原 URL；删除 marktext 避免跨用例污染。
  window.history.replaceState(null, '', ORIGINAL_SEARCH || '/')
  delete (window as any).marktext
  delete (window as any).electron
  vi.restoreAllMocks()
})

describe('bootstrap — parseUrlArgs（经 bootstrapRenderer 间接验证）', () => {
  it('正常解析 wid/type/udp/theme 等字段', () => {
    setUrlParams('?wid=42&type=editor&udp=/tmp/marktext&theme=dark&debug=1')
    bootstrapRenderer()

    const mt = (window as any).marktext
    expect(mt.env.windowId).toBe(42)
    expect(mt.env.type).toBe('editor')
    expect(mt.env.debug).toBe(true)
    expect(mt.initialState.theme).toBe('dark')
    expect(mt.env.paths).toBeDefined()
  })

  it('debug=0 / 缺省时 debug 为 false', () => {
    setUrlParams('?wid=0&type=editor&udp=/tmp/x')
    bootstrapRenderer()
    expect((window as any).marktext.env.debug).toBe(false)
  })

  it('initialState 解析 cff/cfs/hsb/tbs 字段', () => {
    setUrlParams('?wid=0&type=editor&udp=/tmp/x&cff=Mono&cfs=14&hsb=1&tbs=native')
    bootstrapRenderer()
    const init = (window as any).marktext.initialState
    expect(init.codeFontFamily).toBe('Mono')
    expect(init.codeFontSize).toBe('14')
    expect(init.hideScrollbar).toBe(true)
    expect(init.titleBarStyle).toBe('native')
  })

  it('userDataPath 缺失时抛 "No user data path is given."（RendererPaths 守卫）', () => {
    setUrlParams('?wid=0&type=editor')
    expect(() => bootstrapRenderer()).toThrow(/user data path/i)
  })
})

describe('bootstrap — windowId 守卫', () => {
  // 注意：parseUrlArgs 用 Number(params.get('wid'))；Number(null)/Number('') 均为 0，
  // 故"完全缺省 wid"不会触发 NaN 守卫。只有 wid 为非数字字符串（如 "abc"）才抛错。
  it('非数字 wid（"abc"）触发 windowId 解析异常', () => {
    setUrlParams('?wid=abc&type=editor&udp=/tmp/x')
    expect(() => bootstrapRenderer()).toThrow(/windowId/)
  })

  it('parseUrlArgs 早于 RendererPaths 抛错（wid=xyz 时不进入 RendererPaths）', () => {
    setUrlParams('?wid=xyz')
    let thrown: unknown = null
    try {
      bootstrapRenderer()
    } catch (e) {
      thrown = e
    }
    expect(thrown).toBeInstanceOf(Error)
    expect((thrown as Error).message).toMatch(/windowId/)
  })
})

describe('bootstrap — bootstrapRenderer 副作用', () => {
  it("注册 'error' 与 'unhandledrejection' 监听", () => {
    setUrlParams('?wid=0&type=editor&udp=/tmp/x')
    const spy = vi.spyOn(window, 'addEventListener')

    bootstrapRenderer()

    const channels = spy.mock.calls.map((c) => c[0])
    expect(channels).toContain('error')
    expect(channels).toContain('unhandledrejection')
    const handlers = spy.mock.calls.filter((c) => c[0] === 'error' || c[0] === 'unhandledrejection')
    for (const call of handlers) {
      expect(typeof call[1]).toBe('function')
    }
  })

  it('初始化后 window.marktext 暴露 initialState / env / paths 三个域', () => {
    setUrlParams('?wid=7&type=editor&udp=/tmp/x')
    bootstrapRenderer()

    const mt = (window as any).marktext
    expect(mt).toBeDefined()
    expect(mt.initialState).toBeDefined()
    expect(mt.env).toBeDefined()
    expect(mt.paths).toBeDefined()
    expect(mt.env.windowId).toBe(7)
    expect(mt.env.type).toBe('editor')
  })

  it('configureLogger 不抛错（log.transports.console.level 写入受控）', () => {
    setUrlParams('?wid=0&type=editor&udp=/tmp/x')
    expect(() => bootstrapRenderer()).not.toThrow()
  })
})

describe('bootstrap — CodeMirror 竞态抑制（isCodeMirrorRaceCondition 经 handleRendererError 间接验证）', () => {
  it('非 CodeMirror 错误经 addEventListener 注册的 handler 上报', () => {
    setUrlParams('?wid=0&type=editor&udp=/tmp/x')
    const addSpy = vi.spyOn(window, 'addEventListener')
    bootstrapRenderer()

    const errorCall = addSpy.mock.calls.find((c) => c[0] === 'error')
    const handler = errorCall![1] as EventListener

    const realError = new Error('boom')
    const event = new ErrorEvent('error', { error: realError })
    // 错误路径：handleRendererError 调用 exceptionLogger（stub 的 log.error）+ ipcRenderer.send；
    // 不会抛出。这里仅断言 handler 正常执行完毕，未漏掉 error 字段分支。
    expect(() => handler(event)).not.toThrow()
  })

  it('CodeMirror 竞态错误被抑制（console.warn 而非 error）', () => {
    setUrlParams('?wid=0&type=editor&udp=/tmp/x')
    const addSpy = vi.spyOn(window, 'addEventListener')
    bootstrapRenderer()

    const errorCall = addSpy.mock.calls.find((c) => c[0] === 'error')
    const handler = errorCall![1] as EventListener

    // 构造 CodeMirror 竞态错误：message + stack 同时命中三个关键字
    // (message="...reading 'map'" + stack 含 "prepareMeasureForLine" + 含 "coordsChar")。
    // 满足时 isCodeMirrorRaceCondition 返回 true，handleRendererError 走抑制分支。
    const cmError = new Error("Cannot read properties of undefined (reading 'map')")
    cmError.stack =
      'Error: Cannot read properties of undefined (reading map)\n' +
      '    at prepareMeasureForLine (codemirror.js:1)\n' +
      '    at coordsChar (codemirror.js:2)\n'

    const event = new ErrorEvent('error', { error: cmError })
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {})

    handler(event)

    expect(warnSpy).toHaveBeenCalled()
    // 抑制路径不应触发 console.error 上报
    expect(errSpy).not.toHaveBeenCalled()
  })
})
