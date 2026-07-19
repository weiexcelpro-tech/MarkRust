/* eslint-disable @typescript-eslint/no-explicit-any */
// 单元测试覆盖 tauri-bridge.ts 的全部 channel 映射、ipcRenderer 事件系统、
// localEmit 本地分发、SENDSYNC/SEND_CHANNEL_EMIT 映射，以及 10 个 window.* 全局对象。
//
// 验证策略：
// 1. Mock `@tauri-apps/api/core` 和 `@tauri-apps/api/event`，拦截所有 invoke/emit/listen。
// 2. import 被测模块触发 window.* 注入；通过 window.* 间接驱动被测代码。
// 3. 对 INVOKE_CHANNEL_MAP 的 35 个条目逐一验证 cmd 名 + 参数打包结构。
// 4. 对 fileUtils/shell/clipboard/windowControl/commandExists/fonts/uploader/i18nUtils/ripgrep
//    验证直接方法调用映射到正确的 Tauri invoke/emit。

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// vi.mock 会被 vitest 自动提升到文件顶部，确保在 import tauri-bridge 之前生效。
vi.mock('@tauri-apps/api/core', () => ({
  invoke: vi.fn(),
}))
vi.mock('@tauri-apps/api/event', () => ({
  listen: vi.fn(),
  emit: vi.fn(),
}))

// Mock getCurrentWindow：源码 windowControl.minimize/maximize/toggleFullScreen 等通过
// getCurrentWindow() 调用 Tauri Window 实例方法。测试中用 vi.hoisted 提升实例引用，
// 让 mock factory 能引用、测试用例也能直接断言。
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

// Mock confirm：close-window-confirm 在有未保存改动时弹出确认对话框。
const mockConfirm = vi.hoisted(() => vi.fn())
vi.mock('@tauri-apps/plugin-dialog', () => ({
  confirm: (...args: unknown[]) => mockConfirm(...args),
}))

import { invoke } from '@tauri-apps/api/core'
import { emit as tauriEmit, listen } from '@tauri-apps/api/event'

// 触发 tauri-bridge 的副作用：注入 window.electron / window.fileUtils 等 10 个全局。
import '../../src/renderer/src/tauri-bridge'
// 同时显式 import localEmit 以验证 export 可用
import { localEmit } from '../../src/renderer/src/tauri-bridge'

const win = window as unknown as Record<string, any>
const electron = win.electron
const ipcRenderer = electron.ipcRenderer
const shell = electron.shell
const clipboard = electron.clipboard
const webFrame = electron.webFrame
const webUtils = electron.webUtils
const processShim = electron.process
const paths = electron.paths
const windowControl = electron.windowControl
const fileUtils = win.fileUtils
const commandExists = win.commandExists
const i18nUtils = win.i18nUtils
const ripgrep = win.ripgrep
const uploader = win.uploader
const fonts = win.fonts
const pathApi = win.path

const noopUnlisten = () => {}

beforeEach(() => {
  vi.mocked(invoke).mockReset()
  vi.mocked(listen).mockReset()
  vi.mocked(tauriEmit).mockReset()
  // listen 必须返回 Promise<UnlistenFn>，否则 on()/once() 的 then 链路会拿到 undefined。
  vi.mocked(listen).mockResolvedValue(noopUnlisten)
  // emit 返回 Promise<void>，避免未捕获 rejection。
  vi.mocked(tauriEmit).mockResolvedValue(undefined as unknown as void)
  // 重置 windowControl mock 实例的方法
  mockWindowInstance.minimize.mockReset()
  mockWindowInstance.maximize.mockReset()
  mockWindowInstance.unmaximize.mockReset()
  mockWindowInstance.toggleMaximize.mockReset()
  mockWindowInstance.setFullscreen.mockReset()
  mockWindowInstance.toggleFullscreen.mockReset()
  mockConfirm.mockReset()
})

afterEach(() => {
  vi.clearAllMocks()
})

// 取最近一次 listen() 注册的 handler（即被测代码内部包过的回调）。
function lastListenHandler(): ((e: any) => void) | undefined {
  const calls = vi.mocked(listen).mock.calls
  return calls.length ? calls[calls.length - 1]![1] : undefined
}

// 让 Promise.then 微任务链路刷新（用于 send→emit→localEmit 等异步路径）。
function flushMicrotasks(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0))
}

// ============================================================================
// INVOKE_CHANNEL_MAP（fs 系列，16 条）
// ============================================================================
describe('INVOKE_CHANNEL_MAP — fs::', () => {
  it('mt::fs::is-file → invoke("fs_is_file", { path })', async () => {
    vi.mocked(invoke).mockResolvedValue(true)
    await ipcRenderer.invoke('mt::fs::is-file', '/x')
    expect(invoke).toHaveBeenCalledWith('fs_is_file', { path: '/x' })
  })

  it('mt::fs::is-directory → invoke("fs_is_directory", { path })', async () => {
    await ipcRenderer.invoke('mt::fs::is-directory', '/x')
    expect(invoke).toHaveBeenCalledWith('fs_is_directory', { path: '/x' })
  })

  it('mt::fs::path-exists → invoke("fs_path_exists", { path })', async () => {
    await ipcRenderer.invoke('mt::fs::path-exists', '/x')
    expect(invoke).toHaveBeenCalledWith('fs_path_exists', { path: '/x' })
  })

  it('mt::fs::ensure-dir → invoke("fs_ensure_dir", { path })', async () => {
    await ipcRenderer.invoke('mt::fs::ensure-dir', '/x')
    expect(invoke).toHaveBeenCalledWith('fs_ensure_dir', { path: '/x' })
  })

  it('mt::fs::empty-dir → invoke("fs_empty_dir", { path })', async () => {
    await ipcRenderer.invoke('mt::fs::empty-dir', '/x')
    expect(invoke).toHaveBeenCalledWith('fs_empty_dir', { path: '/x' })
  })

  it('mt::fs::copy → invoke("fs_copy", { src, dest })', async () => {
    await ipcRenderer.invoke('mt::fs::copy', '/a', '/b')
    expect(invoke).toHaveBeenCalledWith('fs_copy', { src: '/a', dest: '/b' })
  })

  it('mt::fs::move → invoke("fs_move", { src, dest })', async () => {
    await ipcRenderer.invoke('mt::fs::move', '/a', '/b')
    expect(invoke).toHaveBeenCalledWith('fs_move', { src: '/a', dest: '/b' })
  })

  it('mt::fs::unlink → invoke("fs_unlink", { path })', async () => {
    await ipcRenderer.invoke('mt::fs::unlink', '/x')
    expect(invoke).toHaveBeenCalledWith('fs_unlink', { path: '/x' })
  })

  it('mt::fs::readdir → invoke("fs_readdir", { path })', async () => {
    await ipcRenderer.invoke('mt::fs::readdir', '/x')
    expect(invoke).toHaveBeenCalledWith('fs_readdir', { path: '/x' })
  })

  it('mt::fs::read-file → invoke("fs_read_file", { path, encoding })', async () => {
    await ipcRenderer.invoke('mt::fs::read-file', '/x', 'utf-8')
    expect(invoke).toHaveBeenCalledWith('fs_read_file', { path: '/x', encoding: 'utf-8' })
  })

  it('mt::fs::write-file → invoke("fs_write_file", { path, data })', async () => {
    await ipcRenderer.invoke('mt::fs::write-file', '/x', 'content')
    expect(invoke).toHaveBeenCalledWith('fs_write_file', { path: '/x', data: 'content' })
  })

  it('mt::fs::write-file with Uint8Array → data 为 number[]', async () => {
    await ipcRenderer.invoke('mt::fs::write-file', '/x', new Uint8Array([1, 2, 3]))
    expect(invoke).toHaveBeenCalledWith('fs_write_file', { path: '/x', data: [1, 2, 3] })
  })

  it('mt::fs::output-file → invoke("fs_output_file", { path, data })', async () => {
    await ipcRenderer.invoke('mt::fs::output-file', '/x', 'content')
    expect(invoke).toHaveBeenCalledWith('fs_output_file', { path: '/x', data: 'content' })
  })

  it('mt::fs::stat → invoke("fs_stat", { path })', async () => {
    await ipcRenderer.invoke('mt::fs::stat', '/x')
    expect(invoke).toHaveBeenCalledWith('fs_stat', { path: '/x' })
  })

  it('mt::fs::is-executable → invoke("fs_is_executable", { path })', async () => {
    await ipcRenderer.invoke('mt::fs::is-executable', '/x')
    expect(invoke).toHaveBeenCalledWith('fs_is_executable', { path: '/x' })
  })

  it('mt::fs::trash-item → invoke("fs_trash_item", { path })', async () => {
    await ipcRenderer.invoke('mt::fs::trash-item', '/x')
    expect(invoke).toHaveBeenCalledWith('fs_trash_item', { path: '/x' })
  })

  // 兼容历史命名（拼写不一致版本）
  it('mt::fs-trash-item (历史拼写) → 同样映射到 fs_trash_item', async () => {
    await ipcRenderer.invoke('mt::fs-trash-item', '/x')
    expect(invoke).toHaveBeenCalledWith('fs_trash_item', { path: '/x' })
  })
})

// ============================================================================
// INVOKE_CHANNEL_MAP — spellchecker（5 条）
// ============================================================================
describe('INVOKE_CHANNEL_MAP — spellchecker', () => {
  it('mt::spellchecker-set-enabled → invoke("spellchecker_set_enabled", { enabled })', async () => {
    await ipcRenderer.invoke('mt::spellchecker-set-enabled', true)
    expect(invoke).toHaveBeenCalledWith('spellchecker_set_enabled', { enabled: true })
  })

  it('mt::spellchecker-switch-language → invoke("spellchecker_switch_language", { lang })', async () => {
    await ipcRenderer.invoke('mt::spellchecker-switch-language', 'en-US')
    expect(invoke).toHaveBeenCalledWith('spellchecker_switch_language', { lang: 'en-US' })
  })

  it('mt::spellchecker-get-available-dictionaries', async () => {
    await ipcRenderer.invoke('mt::spellchecker-get-available-dictionaries')
    // map() 返回 {}（truthy），invoke 第二参数透传为 {}
    expect(invoke).toHaveBeenCalledWith('spellchecker_get_available_dictionaries', {})
  })

  it('mt::spellchecker-remove-word → invoke("spellchecker_remove_word", { word })', async () => {
    await ipcRenderer.invoke('mt::spellchecker-remove-word', 'foo')
    expect(invoke).toHaveBeenCalledWith('spellchecker_remove_word', { word: 'foo' })
  })

  it('mt::spellchecker-get-custom-dictionary-words', async () => {
    await ipcRenderer.invoke('mt::spellchecker-get-custom-dictionary-words')
    expect(invoke).toHaveBeenCalledWith('spellchecker_get_custom_dictionary_words', {})
  })
})

// ============================================================================
// INVOKE_CHANNEL_MAP — i18n（3 条）
// ============================================================================
describe('INVOKE_CHANNEL_MAP — i18n', () => {
  it('mt::i18n::load → invoke("i18n_load", { locale })', async () => {
    await ipcRenderer.invoke('mt::i18n::load', 'zh-CN')
    expect(invoke).toHaveBeenCalledWith('i18n_load', { locale: 'zh-CN' })
  })

  it('mt::i18n::is-supported → invoke("i18n_is_supported", { locale })', async () => {
    await ipcRenderer.invoke('mt::i18n::is-supported', 'zh-CN')
    expect(invoke).toHaveBeenCalledWith('i18n_is_supported', { locale: 'zh-CN' })
  })

  it('mt::i18n::supported → invoke("i18n_supported", {})', async () => {
    await ipcRenderer.invoke('mt::i18n::supported')
    // map() 返回 {}（truthy），invoke 第二参数透传为 {}
    expect(invoke).toHaveBeenCalledWith('i18n_supported', {})
  })
})

// ============================================================================
// INVOKE_CHANNEL_MAP — clipboard（3 条）
// ============================================================================
describe('INVOKE_CHANNEL_MAP — clipboard', () => {
  it('mt::clipboard::read-text → invoke("clipboard_read_text", {})', async () => {
    await ipcRenderer.invoke('mt::clipboard::read-text')
    // map() 返回 {}（truthy），invoke 第二参数透传为 {}
    expect(invoke).toHaveBeenCalledWith('clipboard_read_text', {})
  })

  it('mt::clipboard::write-text → invoke("clipboard_write_text", { text })', async () => {
    await ipcRenderer.invoke('mt::clipboard::write-text', 'hi')
    expect(invoke).toHaveBeenCalledWith('clipboard_write_text', { text: 'hi' })
  })

  it('mt::clipboard::guess-file-path → invoke("clipboard_guess_file_path", {})', async () => {
    await ipcRenderer.invoke('mt::clipboard::guess-file-path')
    // map() 返回 {}（truthy），invoke 第二参数透传为 {}
    expect(invoke).toHaveBeenCalledWith('clipboard_guess_file_path', {})
  })
})

// ============================================================================
// INVOKE_CHANNEL_MAP — shell（3 条）
// ============================================================================
describe('INVOKE_CHANNEL_MAP — shell', () => {
  it('mt::shell::open-external → invoke("shell_open_external", { url })', async () => {
    await ipcRenderer.invoke('mt::shell::open-external', 'https://example.com')
    expect(invoke).toHaveBeenCalledWith('shell_open_external', { url: 'https://example.com' })
  })

  it('mt::shell::open-path → invoke("shell_open_path", { path })', async () => {
    await ipcRenderer.invoke('mt::shell::open-path', '/x')
    expect(invoke).toHaveBeenCalledWith('shell_open_path', { path: '/x' })
  })
})

// ============================================================================
// INVOKE_CHANNEL_MAP — window（2 条，label 由 currentLabel() 推导）
// ============================================================================
describe('INVOKE_CHANNEL_MAP — win', () => {
  it('mt::win::is-maximized → invoke("window_is_maximized", { label })', async () => {
    await ipcRenderer.invoke('mt::win::is-maximized')
    expect(invoke).toHaveBeenCalledWith('window_is_maximized', expect.objectContaining({ label: expect.any(String) }))
  })

  it('mt::win::is-fullscreen → invoke("win_is_fullscreen", { label })', async () => {
    await ipcRenderer.invoke('mt::win::is-fullscreen')
    expect(invoke).toHaveBeenCalledWith('win_is_fullscreen', expect.objectContaining({ label: expect.any(String) }))
  })
})

// ============================================================================
// INVOKE_CHANNEL_MAP — 其他（6 条）
// ============================================================================
describe('INVOKE_CHANNEL_MAP — other', () => {
  it('mt::cmd::exists → invoke("cmd_exists", { command })', async () => {
    await ipcRenderer.invoke('mt::cmd::exists', 'rg')
    expect(invoke).toHaveBeenCalledWith('cmd_exists', { command: 'rg' })
  })

  it('mt::fonts::list → invoke("fonts_list", {})', async () => {
    await ipcRenderer.invoke('mt::fonts::list')
    // map() 返回 {}（truthy），invoke 第二参数透传为 {}
    expect(invoke).toHaveBeenCalledWith('fonts_list', {})
  })

  it('mt::ask-for-image-path → invoke("ask_for_image_path", {})', async () => {
    await ipcRenderer.invoke('mt::ask-for-image-path')
    // map() 返回 {}（truthy），invoke 第二参数透传为 {}
    expect(invoke).toHaveBeenCalledWith('ask_for_image_path', {})
  })

  it('mt::boot-info → invoke("boot_info_async", {})', async () => {
    await ipcRenderer.invoke('mt::boot-info')
    // map() 返回 {}（truthy），invoke 第二参数透传为 {}
    expect(invoke).toHaveBeenCalledWith('boot_info_async', {})
  })

  it('mt::paths::is-image → invoke("paths_is_image", { path })', async () => {
    await ipcRenderer.invoke('mt::paths::is-image', '/x.png')
    expect(invoke).toHaveBeenCalledWith('paths_is_image', { path: '/x.png' })
  })

  it('mt::paths::is-same → invoke("paths_is_same", { path_a, path_b })', async () => {
    await ipcRenderer.invoke('mt::paths::is-same', '/a', '/b')
    expect(invoke).toHaveBeenCalledWith('paths_is_same', { path_a: '/a', path_b: '/b' })
  })

  it('mt::uploader::upload → invoke("uploader_upload", { req })', async () => {
    await ipcRenderer.invoke('mt::uploader::upload', { foo: 1 })
    expect(invoke).toHaveBeenCalledWith('uploader_upload', { req: { foo: 1 } })
  })
})

// ============================================================================
// 未映射的 channel
// ============================================================================
describe('ipcRenderer.invoke unmapped channel', () => {
  it('未在映射表中的 channel 返回 null 且不调用 invoke', async () => {
    const result = await ipcRenderer.invoke('mt::unknown::channel', 1, 2)
    expect(result).toBeNull()
    expect(invoke).not.toHaveBeenCalled()
  })
})

// ============================================================================
// fileUtils 直接方法（绕过 INVOKE_CHANNEL_MAP，直接走 invoke）
// ============================================================================
describe('window.fileUtils direct methods', () => {
  it('readFile(p, encoding) → invoke("fs_read_file", { path, encoding })', async () => {
    vi.mocked(invoke).mockResolvedValue('# test')
    const r = await fileUtils.readFile('/test.md', 'utf-8')
    expect(r).toBe('# test')
    expect(invoke).toHaveBeenCalledWith('fs_read_file', { path: '/test.md', encoding: 'utf-8' })
  })

  it('readFile without encoding → encoding 为 undefined', async () => {
    await fileUtils.readFile('/x.md')
    expect(invoke).toHaveBeenCalledWith('fs_read_file', { path: '/x.md', encoding: undefined })
  })

  it('writeFile with string → data 透传', async () => {
    await fileUtils.writeFile('/x', 'content')
    expect(invoke).toHaveBeenCalledWith('fs_write_file', { path: '/x', data: 'content' })
  })

  it('writeFile with Uint8Array → data 转 number[]', async () => {
    await fileUtils.writeFile('/x', new Uint8Array([10, 20, 30]))
    expect(invoke).toHaveBeenCalledWith('fs_write_file', { path: '/x', data: [10, 20, 30] })
  })

  it('outputFile with string → invoke("fs_output_file", { path, data })', async () => {
    await fileUtils.outputFile('/x', 'content')
    expect(invoke).toHaveBeenCalledWith('fs_output_file', { path: '/x', data: 'content' })
  })

  it('isFile / isDirectory / pathExists / isExecutable 调用正确 cmd', async () => {
    vi.mocked(invoke).mockResolvedValue(true)
    await fileUtils.isFile('/x')
    expect(invoke).toHaveBeenLastCalledWith('fs_is_file', { path: '/x' })

    await fileUtils.isDirectory('/x')
    expect(invoke).toHaveBeenLastCalledWith('fs_is_directory', { path: '/x' })

    await fileUtils.pathExists('/x')
    expect(invoke).toHaveBeenLastCalledWith('fs_path_exists', { path: '/x' })

    await fileUtils.isExecutable('/x')
    expect(invoke).toHaveBeenLastCalledWith('fs_is_executable', { path: '/x' })
  })

  it('copy / move 调用 fs_copy / fs_move 并打包 { src, dest }', async () => {
    await fileUtils.copy('/a', '/b')
    expect(invoke).toHaveBeenLastCalledWith('fs_copy', { src: '/a', dest: '/b' })

    await fileUtils.move('/a', '/b')
    expect(invoke).toHaveBeenLastCalledWith('fs_move', { src: '/a', dest: '/b' })
  })

  it('unlink / readdir / stat / emptyDir / ensureDir 各自调用对应 cmd', async () => {
    await fileUtils.unlink('/x')
    expect(invoke).toHaveBeenLastCalledWith('fs_unlink', { path: '/x' })

    vi.mocked(invoke).mockResolvedValue([])
    await fileUtils.readdir('/x')
    expect(invoke).toHaveBeenLastCalledWith('fs_readdir', { path: '/x' })

    await fileUtils.stat('/x')
    expect(invoke).toHaveBeenLastCalledWith('fs_stat', { path: '/x' })

    await fileUtils.emptyDir('/x')
    expect(invoke).toHaveBeenLastCalledWith('fs_empty_dir', { path: '/x' })

    await fileUtils.ensureDir('/x')
    expect(invoke).toHaveBeenLastCalledWith('fs_ensure_dir', { path: '/x' })
  })

  it('isImageFile → invoke("paths_is_image", { path })', async () => {
    vi.mocked(invoke).mockResolvedValue(true)
    await fileUtils.isImageFile('/x.png')
    expect(invoke).toHaveBeenCalledWith('paths_is_image', { path: '/x.png' })
  })

  it('hasMarkdownExtension 识别 .md / .markdown / .mdx；MARKDOWN_EXTENSIONS 含 text/txt', () => {
    expect(fileUtils.hasMarkdownExtension('readme.md')).toBe(true)
    expect(fileUtils.hasMarkdownExtension('readme.MARKDOWN')).toBe(true)
    expect(fileUtils.hasMarkdownExtension('readme.mdx')).toBe(true)
    // 源码 MARKDOWN_EXTENSIONS 同时包含 'text' 和 'txt'，故下面两个也算 markdown
    expect(fileUtils.hasMarkdownExtension('readme.txt')).toBe(true)
    expect(fileUtils.hasMarkdownExtension('readme.text')).toBe(true)
    // 非列表中的扩展名返回 false
    expect(fileUtils.hasMarkdownExtension('readme.pdf')).toBe(false)
    expect(fileUtils.hasMarkdownExtension('')).toBe(false)
  })

  it('MARKDOWN_INCLUSIONS 含 *.md / *.markdown / *.mdx', () => {
    expect(fileUtils.MARKDOWN_INCLUSIONS).toContain('*.md')
    expect(fileUtils.MARKDOWN_INCLUSIONS).toContain('*.markdown')
    expect(fileUtils.MARKDOWN_INCLUSIONS).toContain('*.mdx')
  })
})

// ============================================================================
// window.electron.shell / clipboard / webFrame / webUtils / paths
// ============================================================================
describe('window.electron.shell', () => {
  it('openExternal(url) → invoke("shell_open_external", { url })', async () => {
    await shell.openExternal('https://example.com')
    expect(invoke).toHaveBeenCalledWith('shell_open_external', { url: 'https://example.com' })
  })

  it('openPath(p) → invoke("shell_open_path", { path })', async () => {
    await shell.openPath('/x')
    expect(invoke).toHaveBeenCalledWith('shell_open_path', { path: '/x' })
  })

  it('showItemInFolder(p) → invoke("shell_show_item", { path })', async () => {
    await shell.showItemInFolder('/x')
    expect(invoke).toHaveBeenCalledWith('shell_show_item', { path: '/x' })
  })
})

describe('window.electron.clipboard', () => {
  it('writeText(t) → invoke("clipboard_write_text", { text })', async () => {
    await clipboard.writeText('hello')
    expect(invoke).toHaveBeenCalledWith('clipboard_write_text', { text: 'hello' })
  })

  it('readText() → invoke("clipboard_read_text")', async () => {
    vi.mocked(invoke).mockResolvedValue('clip')
    const r = await clipboard.readText()
    expect(r).toBe('clip')
    expect(invoke).toHaveBeenCalledWith('clipboard_read_text')
  })

  it('guessFilePath() → invoke("clipboard_guess_file_path")', async () => {
    await clipboard.guessFilePath()
    expect(invoke).toHaveBeenCalledWith('clipboard_guess_file_path')
  })
})

describe('window.electron.webFrame', () => {
  it('getZoomFactor returns 1', () => {
    expect(webFrame.getZoomFactor()).toBe(1)
  })
  it('getZoomLevel returns 0', () => {
    expect(webFrame.getZoomLevel()).toBe(0)
  })
  it('setZoomFactor / setZoomLevel 是 noop', () => {
    expect(() => {
      webFrame.setZoomFactor(1.5)
      webFrame.setZoomLevel(2)
    }).not.toThrow()
  })
})

describe('window.electron.webUtils', () => {
  it('getPathForFile 返回空字符串', () => {
    expect(webUtils.getPathForFile(new File([], 'x'))).toBe('')
  })
})

describe('window.electron.paths', () => {
  it('初始 ripgrepBinary 为 "rg"', () => {
    expect(paths.ripgrepBinary).toBe('rg')
  })
  it('初始 userData 为空字符串', () => {
    expect(paths.userData).toBe('')
  })
  it('isUpdatable 为 false', () => {
    expect(electron.isUpdatable).toBe(false)
  })
})

// ============================================================================
// windowControl
// ============================================================================
describe('window.electron.windowControl', () => {
  it('close() → invoke("window_close", { label })', () => {
    windowControl.close()
    expect(invoke).toHaveBeenCalledWith('window_close', expect.objectContaining({ label: expect.any(String) }))
  })

  it('isMaximized() → invoke("window_is_maximized", { label })', async () => {
    vi.mocked(invoke).mockResolvedValue(false)
    await windowControl.isMaximized()
    expect(invoke).toHaveBeenCalledWith('window_is_maximized', expect.objectContaining({ label: expect.any(String) }))
  })

  it('isFullScreen() → invoke("win_is_fullscreen", { label })', async () => {
    vi.mocked(invoke).mockResolvedValue(false)
    await windowControl.isFullScreen()
    expect(invoke).toHaveBeenCalledWith('win_is_fullscreen', expect.objectContaining({ label: expect.any(String) }))
  })

  it('minimize / maximize / unmaximize / toggleMaximize / setFullScreen / toggleFullScreen 调用 getCurrentWindow() 对应方法', () => {
    windowControl.minimize()
    expect(mockWindowInstance.minimize).toHaveBeenCalledTimes(1)

    windowControl.maximize()
    expect(mockWindowInstance.maximize).toHaveBeenCalledTimes(1)

    windowControl.unmaximize()
    expect(mockWindowInstance.unmaximize).toHaveBeenCalledTimes(1)

    windowControl.toggleMaximize()
    expect(mockWindowInstance.toggleMaximize).toHaveBeenCalledTimes(1)

    windowControl.setFullScreen(true)
    expect(mockWindowInstance.setFullscreen).toHaveBeenCalledWith(true)

    windowControl.toggleFullScreen()
    expect(mockWindowInstance.toggleFullscreen).toHaveBeenCalledTimes(1)
  })

  it('popupApplicationMenu(position) → emit("renderer:mt::menu::popup-application", { position })', () => {
    windowControl.popupApplicationMenu({ x: 3, y: 4 })
    expect(tauriEmit).toHaveBeenCalledWith('renderer:mt::menu::popup-application', expect.objectContaining({ position: { x: 3, y: 4 } }))
  })
})

// ============================================================================
// window.commandExists / fonts / uploader / i18nUtils / ripgrep
// ============================================================================
describe('window.commandExists', () => {
  it('exists(name) → invoke("cmd_exists", { command })', async () => {
    vi.mocked(invoke).mockResolvedValue(true)
    const r = await commandExists.exists('rg')
    expect(r).toBe(true)
    expect(invoke).toHaveBeenCalledWith('cmd_exists', { command: 'rg' })
  })
})

describe('window.fonts', () => {
  it('list() → invoke("fonts_list")', async () => {
    vi.mocked(invoke).mockResolvedValue(['Arial', 'Helvetica'])
    const r = await fonts.list()
    expect(r).toEqual(['Arial', 'Helvetica'])
    expect(invoke).toHaveBeenCalledWith('fonts_list')
  })
})

describe('window.uploader', () => {
  it('uploadImage(req) → invoke("uploader_upload", { req })', async () => {
    vi.mocked(invoke).mockResolvedValue('https://up/example.png')
    const r = await uploader.uploadImage({ file: 'x' })
    expect(r).toBe('https://up/example.png')
    expect(invoke).toHaveBeenCalledWith('uploader_upload', { req: { file: 'x' } })
  })
})

describe('window.i18nUtils', () => {
  it('loadTranslations(language) → invoke("i18n_load", { locale })', async () => {
    await i18nUtils.loadTranslations('en')
    expect(invoke).toHaveBeenCalledWith('i18n_load', { locale: 'en' })
  })
})

describe('window.ripgrep', () => {
  it('start(req) → invoke("rg_start", { req })', async () => {
    vi.mocked(invoke).mockResolvedValue('search-1')
    const r = await ripgrep.start({ query: 'foo' })
    expect(r).toBe('search-1')
    expect(invoke).toHaveBeenCalledWith('rg_start', { req: { query: 'foo' } })
  })

  it('cancel(id) → emit("rg_cancel", { search_id })', () => {
    ripgrep.cancel('abc')
    expect(tauriEmit).toHaveBeenCalledWith('rg_cancel', { search_id: 'abc' })
  })

  it('onMatch / onProgress / onDone / onError / onCancelled 注册到对应事件', () => {
    ripgrep.onMatch(() => {})
    expect(listen).toHaveBeenCalledWith('rg_match', expect.any(Function))

    ripgrep.onProgress(() => {})
    expect(listen).toHaveBeenCalledWith('rg_progress', expect.any(Function))

    ripgrep.onDone(() => {})
    expect(listen).toHaveBeenCalledWith('rg_done', expect.any(Function))

    ripgrep.onError(() => {})
    expect(listen).toHaveBeenCalledWith('rg_error', expect.any(Function))

    ripgrep.onCancelled(() => {})
    expect(listen).toHaveBeenCalledWith('rg_cancelled', expect.any(Function))
  })

  it('onMatch handler 收到 event 时以 payload 触发 callback', async () => {
    vi.mocked(listen).mockClear()
    vi.mocked(listen).mockResolvedValue(noopUnlisten)
    const cb = vi.fn()
    const off = ripgrep.onMatch(cb)
    const handler = lastListenHandler()
    expect(handler).toBeDefined()
    handler!({ event: 'rg_match', payload: { match: 'foo' }, id: 0 })
    expect(cb).toHaveBeenCalledWith({ match: 'foo' })
    off()
  })

  it('onMatch 返回的 off 取消订阅后 handler 不再触发', async () => {
    vi.mocked(listen).mockClear()
    vi.mocked(listen).mockResolvedValue(noopUnlisten)
    const cb = vi.fn()
    const off = ripgrep.onMatch(cb)
    off()
    const handler = lastListenHandler()
    handler!({ event: 'rg_match', payload: 'x', id: 0 })
    expect(cb).not.toHaveBeenCalled()
  })
})

// ============================================================================
// ipcRenderer event 系统（on / off / once）
// ============================================================================
describe('ipcRenderer.on / off / once', () => {
  it('on() 注册 listener，Tauri listen 回调时以 (event, payload) 触发', async () => {
    const cb = vi.fn()
    const off = ipcRenderer.on('test-event', cb)
    const handler = lastListenHandler()
    expect(handler).toBeDefined()

    handler!({ event: 'test-event', payload: { data: 42 }, id: 0 })
    expect(cb).toHaveBeenCalledWith({ event: 'test-event', payload: { data: 42 }, id: 0 }, { data: 42 })
    off()
  })

  it('on() payload 为 undefined 时传 null 给 listener', () => {
    const cb = vi.fn()
    ipcRenderer.on('test-event', cb)
    const handler = lastListenHandler()
    handler!({ event: 'test-event', payload: undefined, id: 0 })
    expect(cb).toHaveBeenCalledWith(expect.any(Object), null)
  })

  it('off() 后 Tauri listen 回调不再触发 listener', () => {
    const cb = vi.fn()
    const off = ipcRenderer.on('test-event', cb)
    const handler = lastListenHandler()
    off()
    handler!({ event: 'test-event', payload: 'x', id: 0 })
    expect(cb).not.toHaveBeenCalled()
  })

  it('once() 只触发一次，第二次回调被吞掉', () => {
    const cb = vi.fn()
    ipcRenderer.once('once-event', cb)
    const handler = lastListenHandler()
    handler!({ event: 'once-event', payload: 'first', id: 0 })
    handler!({ event: 'once-event', payload: 'second', id: 0 })
    expect(cb).toHaveBeenCalledTimes(1)
    expect(cb).toHaveBeenLastCalledWith(expect.any(Object), 'first')
  })

  it('off / removeListener / removeAllListeners / postMessage 均为 noop，不抛错', () => {
    expect(() => {
      ipcRenderer.off('x', () => {})
      ipcRenderer.removeListener('x', () => {})
      ipcRenderer.removeAllListeners('x')
      ipcRenderer.postMessage('x')
    }).not.toThrow()
  })
})

// ============================================================================
// localEmit — 通过 SEND_CHANNEL_EMIT_MAP 链路间接验证
// ============================================================================
describe('localEmit (via SEND_CHANNEL_EMIT_MAP)', () => {
  it('send("mt::cmd-open-folder") 触发 localEmit("mt::open-directory", dir)', async () => {
    vi.mocked(invoke).mockResolvedValue('/resolved/dir')
    const cb = vi.fn()
    ipcRenderer.on('mt::open-directory', cb)

    ipcRenderer.send('mt::cmd-open-folder')

    // 等待 emitFn 内部 await invoke + localEmit 微任务链路刷新
    await vi.waitFor(() => expect(cb).toHaveBeenCalled())
    expect(invoke).toHaveBeenCalledWith('dialog_open_directory')
    // localEmit 回调签名：fn({ __local: true }, ...args)
    expect(cb).toHaveBeenCalledWith(expect.objectContaining({ __local: true }), '/resolved/dir')
  })

  it('send("mt::cmd-open-file") 读取文件后 localEmit("mt::open-new-tab", payload, {}, true)', async () => {
    vi.mocked(invoke)
      .mockResolvedValueOnce('/resolved/file.md')
      .mockResolvedValueOnce('# hello')
    const cb = vi.fn()
    ipcRenderer.on('mt::open-new-tab', cb)

    ipcRenderer.send('mt::cmd-open-file')

    await vi.waitFor(() => expect(cb).toHaveBeenCalled())
    expect(invoke).toHaveBeenCalledWith('dialog_open_file')
    expect(invoke).toHaveBeenCalledWith('fs_read_file', { path: '/resolved/file.md', encoding: 'utf-8' })
    // 源码 localEmit('mt::open-new-tab', payload, {}, true) — 4 参数；用 calls[0] 检查前两参
    const callArgs = cb.mock.calls[0]!
    expect(callArgs[0]).toMatchObject({ __local: true })
    expect(callArgs[1]).toMatchObject({ markdown: '# hello', pathname: '/resolved/file.md', isMixedLineEndings: false })
    expect(callArgs[2]).toEqual({})
    expect(callArgs[3]).toBe(true)
  })

  it('send("mt::cmd-open-folder") 当 dialog 返回 null 时不触发 localEmit', async () => {
    vi.mocked(invoke).mockResolvedValue(null)
    const cb = vi.fn()
    ipcRenderer.on('mt::open-directory', cb)

    ipcRenderer.send('mt::cmd-open-folder')
    await flushMicrotasks()
    expect(cb).not.toHaveBeenCalled()
  })
})

// ============================================================================
// SEND_CHANNEL_EMIT_MAP — emit / invoke 直转
// ============================================================================
describe('SEND_CHANNEL_EMIT_MAP', () => {
  it('send("mt::rg::cancel", id) → emit("rg_cancel", { search_id })', () => {
    ipcRenderer.send('mt::rg::cancel', 'search-123')
    expect(tauriEmit).toHaveBeenCalledWith('rg_cancel', { search_id: 'search-123' })
  })

  it('send("mt::clipboard::write-text", t) → invoke("clipboard_write_text", { text })', async () => {
    vi.mocked(invoke).mockResolvedValue(undefined)
    ipcRenderer.send('mt::clipboard::write-text', 'clip')
    await vi.waitFor(() => expect(invoke).toHaveBeenCalledWith('clipboard_write_text', { text: 'clip' }))
  })

  it('未映射的 send → emit("renderer:<channel>", args)', () => {
    ipcRenderer.send('mt::some-unmapped', 1, 2)
    expect(tauriEmit).toHaveBeenCalledWith('renderer:mt::some-unmapped', [1, 2])
  })
})

// ============================================================================
// SEND_CHANNEL_EMIT_MAP — 新增 window / preferences / updater 通道
// ============================================================================
describe('SEND_CHANNEL_EMIT_MAP — window & preferences & updater', () => {
  it('send("mt::cmd-new-editor-window") → invoke("window_new_editor")', async () => {
    vi.mocked(invoke).mockResolvedValue(undefined)
    ipcRenderer.send('mt::cmd-new-editor-window')
    await vi.waitFor(() => expect(invoke).toHaveBeenCalledWith('window_new_editor'))
  })

  it('send("mt::cmd-close-window") → invoke("window_close", { label })', async () => {
    vi.mocked(invoke).mockResolvedValue(undefined)
    ipcRenderer.send('mt::cmd-close-window')
    await vi.waitFor(() =>
      expect(invoke).toHaveBeenCalledWith('window_close', expect.objectContaining({ label: expect.any(String) })),
    )
  })

  it('send("mt::set-user-preference", partial) → invoke("preferences_set", {...partial}) 并 localEmit', async () => {
    vi.mocked(invoke).mockResolvedValue(undefined)
    const cb = vi.fn()
    ipcRenderer.on('mt::user-preference', cb)

    ipcRenderer.send('mt::set-user-preference', { theme: 'dark' })
    await vi.waitFor(() => expect(cb).toHaveBeenCalled())
    expect(invoke).toHaveBeenCalledWith('preferences_set', { theme: 'dark' })
    expect(cb).toHaveBeenCalledWith(expect.objectContaining({ __local: true }), { theme: 'dark' })
  })

  it('send("mt::cmd-toggle-autosave") 反转 autoSave 并 preferences_set + localEmit', async () => {
    vi.mocked(invoke).mockResolvedValue({ autoSave: false })
    const cb = vi.fn()
    ipcRenderer.on('mt::set-user-preference', cb)

    ipcRenderer.send('mt::cmd-toggle-autosave')
    await vi.waitFor(() => expect(cb).toHaveBeenCalled())
    expect(invoke).toHaveBeenCalledWith('preferences_get_all')
    expect(invoke).toHaveBeenCalledWith('preferences_set', { autoSave: true })
    expect(cb).toHaveBeenCalledWith(expect.objectContaining({ __local: true }), { autoSave: true })
  })

  it('send("mt::open-setting-window") → invoke("window_open_settings")', async () => {
    vi.mocked(invoke).mockResolvedValue(undefined)
    ipcRenderer.send('mt::open-setting-window')
    await vi.waitFor(() => expect(invoke).toHaveBeenCalledWith('window_open_settings'))
  })

  it('send("mt::window-toggle-always-on-top") → invoke("window_toggle_always_on_top", { label })', async () => {
    vi.mocked(invoke).mockResolvedValue(undefined)
    ipcRenderer.send('mt::window-toggle-always-on-top')
    await vi.waitFor(() =>
      expect(invoke).toHaveBeenCalledWith('window_toggle_always_on_top', expect.objectContaining({ label: expect.any(String) })),
    )
  })

  it('send("mt::check-for-update") 有更新时 localEmit UPDATE_AVAILABLE', async () => {
    vi.mocked(invoke).mockResolvedValue({ has_update: true, version: '2.0' })
    const cb = vi.fn()
    ipcRenderer.on('mt::UPDATE_AVAILABLE', cb)

    ipcRenderer.send('mt::check-for-update')
    await vi.waitFor(() => expect(cb).toHaveBeenCalled())
    expect(invoke).toHaveBeenCalledWith('updater_check_latest')
    expect(cb).toHaveBeenCalledWith(expect.objectContaining({ __local: true }), { has_update: true, version: '2.0' })
  })

  it('send("mt::check-for-update") 无更新时 localEmit UPDATE_NOT_AVAILABLE', async () => {
    vi.mocked(invoke).mockResolvedValue({ has_update: false })
    const cb = vi.fn()
    ipcRenderer.on('mt::UPDATE_NOT_AVAILABLE', cb)

    ipcRenderer.send('mt::check-for-update')
    await vi.waitFor(() => expect(cb).toHaveBeenCalled())
    expect(cb).toHaveBeenCalledWith(expect.objectContaining({ __local: true }), {})
  })

  it('send("mt::ask-for-user-preference") → preferences_get_all + localEmit("mt::user-preference")', async () => {
    vi.mocked(invoke).mockResolvedValue({ theme: 'light' })
    const cb = vi.fn()
    ipcRenderer.on('mt::user-preference', cb)

    ipcRenderer.send('mt::ask-for-user-preference')
    await vi.waitFor(() => expect(cb).toHaveBeenCalled())
    expect(invoke).toHaveBeenCalledWith('preferences_get_all')
    expect(cb).toHaveBeenCalledWith(expect.objectContaining({ __local: true }), { theme: 'light' })
  })

  it('send("mt::get-current-language") → preferences_get_all + localEmit("mt::current-language")', async () => {
    vi.mocked(invoke).mockResolvedValue({ language: 'zh-CN' })
    const cb = vi.fn()
    ipcRenderer.on('mt::current-language', cb)

    ipcRenderer.send('mt::get-current-language')
    await vi.waitFor(() => expect(cb).toHaveBeenCalled())
    expect(cb).toHaveBeenCalledWith(expect.objectContaining({ __local: true }), 'zh-CN')
  })

  it('send("mt::get-current-language") 无 language 字段时默认 "en"', async () => {
    vi.mocked(invoke).mockResolvedValue({})
    const cb = vi.fn()
    ipcRenderer.on('mt::current-language', cb)

    ipcRenderer.send('mt::get-current-language')
    await vi.waitFor(() => expect(cb).toHaveBeenCalled())
    expect(cb).toHaveBeenCalledWith(expect.objectContaining({ __local: true }), 'en')
  })

  it('send("mt::open-file", path) → fs_read_file + localEmit("mt::open-new-tab")', async () => {
    vi.mocked(invoke).mockResolvedValue('# content')
    const cb = vi.fn()
    ipcRenderer.on('mt::open-new-tab', cb)

    ipcRenderer.send('mt::open-file', '/path/to/file.md')
    await vi.waitFor(() => expect(cb).toHaveBeenCalled())
    expect(invoke).toHaveBeenCalledWith('fs_read_file', { path: '/path/to/file.md', encoding: 'utf-8' })
    expect(cb).toHaveBeenCalledWith(
      expect.objectContaining({ __local: true }),
      expect.objectContaining({ markdown: '# content', pathname: '/path/to/file.md', isMixedLineEndings: false }),
      {},
      true,
    )
  })

  it('send("mt::open-file") 路径为空时不调用 fs_read_file', async () => {
    ipcRenderer.send('mt::open-file', '')
    await flushMicrotasks()
    expect(invoke).not.toHaveBeenCalled()
  })

  it('send("mt::window::drop", [...md files]) 循环 fs_read_file 每个 .md', async () => {
    vi.mocked(invoke).mockResolvedValue('# md')
    const cb = vi.fn()
    ipcRenderer.on('mt::open-new-tab', cb)

    ipcRenderer.send('mt::window::drop', ['/a.md', '/b.txt', '/c.md'])
    await vi.waitFor(() => expect(cb).toHaveBeenCalledTimes(2))
    expect(invoke).toHaveBeenCalledWith('fs_read_file', expect.objectContaining({ path: '/a.md', encoding: 'utf-8' }))
    expect(invoke).toHaveBeenCalledWith('fs_read_file', expect.objectContaining({ path: '/c.md', encoding: 'utf-8' }))
  })

  it('send("mt::app-try-quit") → invoke("window_close", { label })', async () => {
    vi.mocked(invoke).mockResolvedValue(undefined)
    ipcRenderer.send('mt::app-try-quit')
    await vi.waitFor(() =>
      expect(invoke).toHaveBeenCalledWith('window_close', expect.objectContaining({ label: expect.any(String) })),
    )
  })

  it('send("mt::close-window-confirm") 无未保存时直接 invoke window_close', async () => {
    vi.mocked(invoke).mockResolvedValue(undefined)
    ipcRenderer.send('mt::close-window-confirm', [])
    await vi.waitFor(() =>
      expect(invoke).toHaveBeenCalledWith('window_close', expect.objectContaining({ label: expect.any(String) })),
    )
    expect(mockConfirm).not.toHaveBeenCalled()
  })

  it('send("mt::close-window-confirm") 有未保存且用户确认 → invoke window_close', async () => {
    vi.mocked(invoke).mockResolvedValue(undefined)
    mockConfirm.mockResolvedValue(true)

    ipcRenderer.send('mt::close-window-confirm', [{ path: '/unsaved.md' }])
    await vi.waitFor(() =>
      expect(invoke).toHaveBeenCalledWith('window_close', expect.objectContaining({ label: expect.any(String) })),
    )
    expect(mockConfirm).toHaveBeenCalledTimes(1)
  })

  it('send("mt::close-window-confirm") 有未保存且用户取消 → 不调用 window_close', async () => {
    vi.mocked(invoke).mockResolvedValue(undefined)
    mockConfirm.mockResolvedValue(false)

    ipcRenderer.send('mt::close-window-confirm', [{ path: '/unsaved.md' }])
    await vi.waitFor(() => expect(mockConfirm).toHaveBeenCalled())
    // 仅可能被其他测试影响；这里验证 window_close 没有被这次链路调用
    expect(invoke).not.toHaveBeenCalledWith('window_close', expect.anything())
  })

  it('send("mt::handle-renderer-error", err) 调用 console.error', () => {
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    const err = new Error('render boom')
    ipcRenderer.send('mt::handle-renderer-error', err)
    expect(errSpy).toHaveBeenCalledWith('[renderer-error]', err)
    errSpy.mockRestore()
  })

  it('send("mt::keybinding-debug-dump-keyboard-info") → invoke("keybinding_dump_keyboard_info")', async () => {
    vi.mocked(invoke).mockResolvedValue(undefined)
    ipcRenderer.send('mt::keybinding-debug-dump-keyboard-info')
    await vi.waitFor(() => expect(invoke).toHaveBeenCalledWith('keybinding_dump_keyboard_info'))
  })

  it('send("mt::make-screenshot") / "mt::save-tabs" 等 noop channel 不调用 invoke', () => {
    ipcRenderer.send('mt::make-screenshot')
    ipcRenderer.send('mt::save-tabs')
    ipcRenderer.send('mt::window-initialized')
    ipcRenderer.send('mt::NEED_UPDATE')
    expect(invoke).not.toHaveBeenCalled()
  })
})

// ============================================================================
// NOOP_CHANNELS — invoke("update-buffer-state") 直接返回 null
// ============================================================================
describe('NOOP_CHANNELS', () => {
  it('invoke("update-buffer-state") 返回 null 且不触发未映射告警', async () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const r = await ipcRenderer.invoke('update-buffer-state', { foo: 1 })
    expect(r).toBeNull()
    expect(invoke).not.toHaveBeenCalled()
    expect(warnSpy).not.toHaveBeenCalled()
    warnSpy.mockRestore()
  })
})

// ============================================================================
// localEmit 直接 export
// ============================================================================
describe('localEmit export', () => {
  it('localEmit 是可调用的函数', () => {
    expect(typeof localEmit).toBe('function')
  })

  it('localEmit(channel, ...args) 触发已注册的 on() listener', () => {
    const cb = vi.fn()
    ipcRenderer.on('manual-channel', cb)
    localEmit('manual-channel', 'payload-1', 'payload-2')
    expect(cb).toHaveBeenCalledWith(expect.objectContaining({ __local: true }), 'payload-1', 'payload-2')
  })

  it('localEmit 未注册 channel 时不抛错', () => {
    expect(() => localEmit('unlistened-channel', 'x')).not.toThrow()
  })
})

// ============================================================================
// SENDSYNC_CHANNEL_MAP — Tauri 无同步 IPC，恒返回 null
// ============================================================================
describe('ipcRenderer.sendSync', () => {
  it('sendSync 始终返回 null', () => {
    expect(ipcRenderer.sendSync('mt::paths::is-same-sync', '/a', '/b')).toBeNull()
    expect(ipcRenderer.sendSync('mt::boot-info')).toBeNull()
    expect(ipcRenderer.sendSync<any, number>('any-channel')).toBeNull()
  })

  it('sendSync 不调用 invoke / emit', () => {
    ipcRenderer.sendSync('any-channel')
    expect(invoke).not.toHaveBeenCalled()
    expect(tauriEmit).not.toHaveBeenCalled()
  })
})

// ============================================================================
// 静态全局对象
// ============================================================================
describe('window.process', () => {
  it('platform is win32', () => {
    expect(processShim.platform).toBe('win32')
  })
  it('arch is x64', () => {
    expect(processShim.arch).toBe('x64')
  })
  it('versions 含 chrome / electron / node', () => {
    expect(processShim.versions).toHaveProperty('chrome')
    expect(processShim.versions).toHaveProperty('electron')
    expect(processShim.versions).toHaveProperty('node')
  })
  it('env 是对象', () => {
    expect(typeof processShim.env).toBe('object')
    expect(processShim.env).not.toBeNull()
  })
  it('resourcesPath 为空字符串', () => {
    expect(processShim.resourcesPath).toBe('')
  })
  it('cwd() 返回空字符串', () => {
    expect(processShim.cwd()).toBe('')
  })
  it('nextTick 通过微任务调用 fn', async () => {
    const fn = vi.fn()
    processShim.nextTick(fn, 1, 2)
    await flushMicrotasks()
    expect(fn).toHaveBeenCalledWith(1, 2)
  })
})

describe('window.rgPath', () => {
  it('is the string "rg"', () => {
    expect(win.rgPath).toBe('rg')
    expect(typeof win.rgPath).toBe('string')
  })
})

describe('window.path (pathe 兼容)', () => {
  it('join / dirname / basename / extname 行为正确', () => {
    expect(pathApi.join('a', 'b', 'c')).toBe(['a', 'b', 'c'].join(pathApi.sep))
    expect(pathApi.basename('/foo/bar.txt')).toBe('bar.txt')
    expect(pathApi.dirname('/foo/bar.txt')).toBe('/foo')
    expect(pathApi.extname('/foo/bar.txt')).toBe('.txt')
  })
  it('isAbsolute / normalize', () => {
    expect(pathApi.isAbsolute('/x')).toBe(true)
    expect(typeof pathApi.normalize('a/../b')).toBe('string')
  })
  it('sep / delimiter 是字符串', () => {
    expect(typeof pathApi.sep).toBe('string')
    expect(typeof pathApi.delimiter).toBe('string')
  })
  it('relative / parse / format 可调用', () => {
    expect(typeof pathApi.relative('/a', '/a/b')).toBe('string')
    expect(pathApi.parse('/x/y.txt')).toHaveProperty('base')
    expect(pathApi.format({ dir: '/x', name: 'y', ext: '.txt' })).toContain('y')
  })
})

describe('window.marktext namespace', () => {
  it('存在且为对象', () => {
    expect(win.marktext).toEqual({})
  })
})

// ============================================================================
// bootstrap timer（tauri-bridge 顶层 setTimeout 800ms 后 localEmit bootstrap-editor）
// ============================================================================
describe('bootstrap timer', () => {
  it('localEmit("mt::bootstrap-editor") listener 接收预期 payload', async () => {
    const cb = vi.fn()
    ipcRenderer.on('mt::bootstrap-editor', cb)
    // 源码在 import 时已 setTimeout(800ms) 启动 bootstrap-editor localEmit。
    // 此测试位于文件末尾，800ms timer 可能已在其他用例执行期间触发（listener 未注册）。
    // 手动重新 emit 验证 localEmit → listener 的 wiring 与 payload 结构。
    localEmit('mt::bootstrap-editor', {
      addBlankTab: true,
      markdownList: [],
      lineEnding: 'lf',
      sideBarVisibility: true,
      tabBarVisibility: true,
      sourceCodeModeEnabled: false
    })
    expect(cb).toHaveBeenCalledWith(
      expect.objectContaining({ __local: true }),
      expect.objectContaining({ addBlankTab: true, lineEnding: 'lf' }),
    )
  })
})
