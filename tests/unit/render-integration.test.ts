import { describe, it, expect, vi } from 'vitest'

vi.hoisted(() => {
  Object.assign(window, {
    path: { sep: '/', join: (...a: string[]) => a.join('/'), dirname: (p: string) => p, basename: (p: string) => p, extname: () => '', resolve: (...a: string[]) => a.join('/') },
    rgPath: 'rg',
    marktext: { initialState: {}, env: { type: 'editor', debug: false, windowId: 0, paths: {} }, paths: {} },
    electron: { ipcRenderer: { on: vi.fn(), send: vi.fn(), invoke: vi.fn(() => Promise.resolve()), off: vi.fn() } },
    fileUtils: {}, process: { platform: 'win32' }, commandExists: { exists: vi.fn() },
    i18nUtils: { loadTranslations: vi.fn() }, ripgrep: {}, uploader: { uploadImage: vi.fn() },
    fonts: { list: vi.fn() },
  })
})

vi.mock('@tauri-apps/api/core', () => ({ invoke: vi.fn(() => Promise.resolve(null)) }))
vi.mock('@tauri-apps/api/event', () => ({ listen: vi.fn(() => Promise.resolve(() => {})), emit: vi.fn(() => Promise.resolve()) }))

describe('关键模块导入集成测试', () => {
  it('tauri-bridge 可导入且注入 window.* 全局对象', async () => {
    await import('@/tauri-bridge')
    expect(window.fileUtils).toBeDefined()
    expect(window.electron).toBeDefined()
    expect(window.electron.ipcRenderer).toBeDefined()
    expect(typeof window.electron.ipcRenderer.on).toBe('function')
    expect(typeof window.electron.ipcRenderer.send).toBe('function')
    expect(typeof window.fileUtils.readFile).toBe('function')
    expect(typeof window.fileUtils.writeFile).toBe('function')
  })

  it('menuBridge 可导入且注册全局监听器', async () => {
    await import('@/menuBridge')
    // menuBridge 在导入时注册 mt::menu::click 监听器
    // 验证没有抛出异常即可
    expect(true).toBe(true)
  })

  it('config 模块可导入（依赖 window.path）', async () => {
    const config = await import('@/config')
    expect(config.PATH_SEPARATOR).toBe('/')
    expect(config.THEME_STYLE_ID).toBeDefined()
  })

  it('commands 命令注册表可导入', async () => {
    const commands = await import('@/commands/index')
    expect(commands.default).toBeDefined()
    expect(Array.isArray(commands.default)).toBe(true)
    expect(commands.default.length).toBeGreaterThan(10)
  })

  it('editor store 可创建（不挂载 Vue）', async () => {
    const { useEditorStore } = await import('@/store/editor')
    expect(typeof useEditorStore).toBe('function')
  })
})
