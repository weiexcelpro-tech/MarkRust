/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * L2 桥接契约测试：tauri-bridge.ts 的 mt::response-export 处理
 *
 * 测试目标：
 * 1. ★ 验证 HTML 导出修复点 —— `fs_write_file` 接收 number[] 而非 string（TextEncoder 编码）
 * 2. ★ 验证 dialog_save_file 收到 `exts: ['html']` 参数（之前未传，导致过滤器默认 md）
 * 3. 验证 dialog_save_file 返回 null（用户取消）时不调用 fs_write_file
 * 4. 验证中文 UTF-8 字节流经由 TextEncoder 正确编码
 * 5. 验证 mt::export-success 事件在写入成功后被 localEmit 触发
 *
 * 这一层是 fs_write_file 类型不匹配 bug 的直接回归保护网。
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@tauri-apps/api/core', () => ({
  // 默认返回 resolved Promise，防止 tauri-bridge 顶层 invoke 链式调用报错
  invoke: vi.fn().mockResolvedValue(null),
}))
vi.mock('@tauri-apps/api/event', () => ({
  // 默认返回 resolved Promise<unlisten>，防止 tauri-bridge 顶层 listen().catch() 报错
  listen: vi.fn().mockResolvedValue(() => {}),
  emit: vi.fn().mockResolvedValue(undefined),
}))

const mockWindowInstance = vi.hoisted(() => ({
  minimize: vi.fn(), maximize: vi.fn(), unmaximize: vi.fn(),
  toggleMaximize: vi.fn(), setFullscreen: vi.fn(), toggleFullscreen: vi.fn(),
}))
vi.mock('@tauri-apps/api/window', () => ({
  getCurrentWindow: () => mockWindowInstance,
}))
const mockConfirm = vi.hoisted(() => vi.fn())
vi.mock('@tauri-apps/plugin-dialog', () => ({
  confirm: (...args: unknown[]) => mockConfirm(...args),
}))

import { invoke } from '@tauri-apps/api/core'
import { emit as tauriEmit, listen } from '@tauri-apps/api/event'
import '../../src/renderer/src/tauri-bridge'
import { localEmit } from '../../src/renderer/src/tauri-bridge'

const win = window as unknown as Record<string, any>
const ipcRenderer = win.electron.ipcRenderer
const pathApi = win.path

const noopUnlisten = () => {}

beforeEach(() => {
  vi.mocked(invoke).mockReset()
  vi.mocked(listen).mockReset()
  vi.mocked(tauriEmit).mockReset()
  vi.mocked(listen).mockResolvedValue(noopUnlisten)
  vi.mocked(tauriEmit).mockResolvedValue(undefined as unknown as void)
})

afterEach(() => {
  vi.clearAllMocks()
})

function lastListenHandler(): ((e: any) => void) | undefined {
  const calls = vi.mocked(listen).mock.calls
  return calls.length ? calls[calls.length - 1]![1] : undefined
}

function flushMicrotasks(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0))
}

// ============================================================================
// ★ HTML 导出桥接：mt::response-export type='html'
// ============================================================================
describe('★ HTML 导出桥接契约（修复 fs_write_file 类型不匹配）', () => {
  it('传 number[] 字节数组给 fs_write_file（非 string）', async () => {
    // mock dialog_save_file 返回保存路径
    vi.mocked(invoke).mockImplementation(async (cmd: string) => {
      if (cmd === 'dialog_save_file') return 'C:\\tmp\\test.html'
      if (cmd === 'fs_write_file') return null
      return null
    })

    // 触发 mt::response-export，type='html'
    ipcRenderer.send('mt::response-export', {
      type: 'html',
      content: '<!DOCTYPE html><html><body>Hello</body></html>',
      filename: 'test.md',
      pathname: 'C:\\docs\\test.md',
      })

    await flushMicrotasks()
    await new Promise((r) => setTimeout(r, 50))

    // ★ 核心断言：fs_write_file 收到的 data 是 number[] 而非 string
    const writeCall = vi.mocked(invoke).mock.calls.find(
      (c) => c[0] === 'fs_write_file'
    )
    expect(writeCall).toBeDefined()
    const args = writeCall![1] as { path: string; data: unknown }
    expect(args.path).toBe('C:\\tmp\\test.html')
    expect(Array.isArray(args.data)).toBe(true)
    expect(typeof args.data).toBe('object')
    expect(typeof args.data).not.toBe('string')
    // 字节内容应为 UTF-8 编码的 HTML
    const decoded = Buffer.from(args.data as number[]).toString('utf-8')
    expect(decoded).toBe('<!DOCTYPE html><html><body>Hello</body></html>')
  })

  it('★ dialog_save_file 收到 exts:["html"] 参数', async () => {
    vi.mocked(invoke).mockImplementation(async (cmd: string) => {
      if (cmd === 'dialog_save_file') return 'C:\\tmp\\out.html'
      return null
    })

    ipcRenderer.send('mt::response-export', {
      type: 'html',
      content: '<html></html>',
      filename: 'out.md',
      pathname: 'C:\\docs\\out.md',
      })

    await new Promise((r) => setTimeout(r, 50))

    const dialogCall = vi.mocked(invoke).mock.calls.find(
      (c) => c[0] === 'dialog_save_file'
    )
    expect(dialogCall).toBeDefined()
    const args = dialogCall![1] as { defaultName: string; exts: string[] }
    // ★ 修复点：exts 必须传 ['html']，否则 Rust 端默认走 md 过滤器
    expect(args.exts).toEqual(['html'])
    expect(args.defaultName).toBe('out.html')
  })

  it('用户取消保存对话框（返回 null）时不调用 fs_write_file', async () => {
    vi.mocked(invoke).mockImplementation(async (cmd: string) => {
      if (cmd === 'dialog_save_file') return null // 用户取消
      return null
    })

    ipcRenderer.send('mt::response-export', {
      type: 'html',
      content: '<html></html>',
      filename: 'cancel.md',
      pathname: 'C:\\docs\\cancel.md',
      })

    await new Promise((r) => setTimeout(r, 50))

    const writeCall = vi.mocked(invoke).mock.calls.find(
      (c) => c[0] === 'fs_write_file'
    )
    expect(writeCall).toBeUndefined()
  })

  it('中文 UTF-8 字节流完整编码（防 latin-1 回归）', async () => {
    vi.mocked(invoke).mockImplementation(async (cmd: string) => {
      if (cmd === 'dialog_save_file') return '/tmp/cn.html'
      return null
    })

    const html = '<!DOCTYPE html><p>你好世界 · 🚀🦀</p>'
    ipcRenderer.send('mt::response-export', {
      type: 'html',
      content: html,
      filename: 'cn.md',
      pathname: '/tmp/cn.md',
      })

    await new Promise((r) => setTimeout(r, 50))

    const writeCall = vi.mocked(invoke).mock.calls.find(
      (c) => c[0] === 'fs_write_file'
    )!
    const bytes = writeCall[1].data as number[]
    // TextEncoder 编码 "你好世界" 是 12 字节，每个汉字 3 字节
    const decoded = Buffer.from(bytes).toString('utf-8')
    expect(decoded).toBe(html)
    expect(decoded).toContain('你好世界')
    expect(decoded).toContain('🚀🦀')
    // 字节数应大于字符数（因为中文/emoji 占多字节）
    expect(bytes.length).toBeGreaterThan(html.length)
  })

  it('mt::export-success 事件在写入成功后被 localEmit 触发', async () => {
    vi.mocked(invoke).mockImplementation(async (cmd: string) => {
      if (cmd === 'dialog_save_file') return '/tmp/success.html'
      if (cmd === 'fs_write_file') return null
      return null
    })

    // localEmit 只触发 localListeners，不调 tauriEmit；
    // ipcRenderer.on 会同步注册到 localListeners，使 localEmit 能触发
    let successFired = false
    let successPath = ''
    ipcRenderer.on('mt::export-success', (_event, payload) => {
      successFired = true
      successPath = payload?.filePath ?? ''
    })

    ipcRenderer.send('mt::response-export', {
      type: 'html',
      content: '<html></html>',
      filename: 'success.md',
      pathname: '/tmp/success.md',
      })

    await new Promise((r) => setTimeout(r, 50))

    expect(successFired).toBe(true)
    expect(successPath).toBe('/tmp/success.html')
  })

  it('★ 复杂物料的字节流与 TextEncoder 独立编码一致', async () => {
    vi.mocked(invoke).mockImplementation(async (cmd: string) => {
      if (cmd === 'dialog_save_file') return '/tmp/stress.html'
      return null
    })

    // 构造包含 frontmatter/中文/emoji/数学符号的复杂 HTML
    const complexHtml = `<!DOCTYPE html>
<html lang="zh-CN">
<head><meta charset="UTF-8"><title>压力测试</title></head>
<body>
<article class="markdown-body">
<h1 id="一">一级标题：HTML 导出端到端测试</h1>
<p>E = mc² · ∫₀^∞ e^{-x²} dx = √π/2 · 🚀🦀🐱</p>
<table><thead><tr><th>命令</th><th>参数</th></tr></thead>
<tbody><tr><td>dialog_save_file</td><td>default_name, exts</td></tr></tbody></table>
<pre><code class="language-rust">pub fn fs_write_file(path: String, data: Vec&lt;u8&gt;) -&gt; AppResult&lt;()&gt;</code></pre>
</article>
</body>
</html>`

    ipcRenderer.send('mt::response-export', {
      type: 'html',
      content: complexHtml,
      filename: 'stress-test-complex.md',
      pathname: '/tmp/stress-test-complex.md',
      })

    await new Promise((r) => setTimeout(r, 50))

    const writeCall = vi.mocked(invoke).mock.calls.find(
      (c) => c[0] === 'fs_write_file'
    )!
    const bytes = writeCall[1].data as number[]
    // 期望字节流与独立用 TextEncoder 编码的结果一致
    const expectedBytes = Array.from(new TextEncoder().encode(complexHtml))
    expect(bytes).toEqual(expectedBytes)
    // 字节流解码回 HTML 应完整无错
    const decoded = Buffer.from(bytes).toString('utf-8')
    expect(decoded).toBe(complexHtml)
  })

  it('fs_write_file 失败时不触发 export-success', async () => {
    vi.mocked(invoke).mockImplementation(async (cmd: string) => {
      if (cmd === 'dialog_save_file') return '/tmp/fail.html'
      if (cmd === 'fs_write_file') throw new Error('disk full')
      return null
    })

    let successFired = false
    ipcRenderer.on('mt::export-success', () => {
      successFired = true
    })

    ipcRenderer.send('mt::response-export', {
      type: 'html',
      content: '<html></html>',
      filename: 'fail.md',
      pathname: '/tmp/fail.md',
      })

    await new Promise((r) => setTimeout(r, 50))

    // 失败时 export-success 不应触发（await throw 后续代码不会执行）
    expect(successFired).toBe(false)
  })
})

// ============================================================================
// filename 后缀剥离逻辑
// ============================================================================
describe('filename 后缀剥离', () => {
  it('filename 含 .md 后缀时被剥离，加 .html', async () => {
    vi.mocked(invoke).mockImplementation(async (cmd: string) => {
      if (cmd === 'dialog_save_file') return '/tmp/x.html'
      return null
    })

    ipcRenderer.send('mt::response-export', {
      type: 'html', content: '<html></html>',
      filename: 'my-note.md', pathname: '/tmp/my-note.md',
      })

    await new Promise((r) => setTimeout(r, 50))

    const dialogCall = vi.mocked(invoke).mock.calls.find(
      (c) => c[0] === 'dialog_save_file'
    )!
    expect((dialogCall[1] as any).defaultName).toBe('my-note.html')
  })

  it('filename 含 .markdown 后缀时被剥离', async () => {
    vi.mocked(invoke).mockImplementation(async () => '/tmp/x.html')

    ipcRenderer.send('mt::response-export', {
      type: 'html', content: '<html></html>',
      filename: 'notes.markdown', pathname: '/tmp/notes.markdown',
      })

    await new Promise((r) => setTimeout(r, 50))

    const dialogCall = vi.mocked(invoke).mock.calls.find(
      (c) => c[0] === 'dialog_save_file'
    )!
    expect((dialogCall[1] as any).defaultName).toBe('notes.html')
  })

  it('filename 为空时从 pathname 取 basename', async () => {
    vi.mocked(invoke).mockImplementation(async () => '/tmp/x.html')

    ipcRenderer.send('mt::response-export', {
      type: 'html', content: '<html></html>',
      filename: '', pathname: '/tmp/from-pathname.md',
      })

    await new Promise((r) => setTimeout(r, 50))

    const dialogCall = vi.mocked(invoke).mock.calls.find(
      (c) => c[0] === 'dialog_save_file'
    )!
    expect((dialogCall[1] as any).defaultName).toBe('from-pathname.html')
  })

  it('filename 和 pathname 都为空时 fallback 到 export', async () => {
    vi.mocked(invoke).mockImplementation(async () => '/tmp/x.html')

    ipcRenderer.send('mt::response-export', {
      type: 'html', content: '<html></html>',
      filename: '', pathname: '',
      })

    await new Promise((r) => setTimeout(r, 50))

    const dialogCall = vi.mocked(invoke).mock.calls.find(
      (c) => c[0] === 'dialog_save_file'
    )!
    expect((dialogCall[1] as any).defaultName).toBe('export.html')
  })
})
