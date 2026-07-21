/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * L1 单元测试：exportStyledHTML 纯函数 + embedImagesAsBase64
 *
 * 测试目标：
 * 1. 验证复杂物料 Markdown 经过 muya 引擎渲染后产生合法的完整 HTML 文档
 * 2. 验证 base64 图片内嵌逻辑：本地路径替换、远程 URL/data URI 保留、invoke 调用契约
 * 3. 验证关键回归点：CSS 内联（PG7）、heading id 注入（PG8）、DOCTYPE、UTF-8 字节正确
 *
 * 测试不依赖 Tauri runtime，全部通过 vi.mock 拦截 @tauri-apps/api/core.invoke。
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

vi.mock('@tauri-apps/api/core', () => ({
  invoke: vi.fn(),
}))

import { invoke } from '@tauri-apps/api/core'
import { exportStyledHTML } from '../../src/renderer/src/util/exportHtml'
import { embedImagesAsBase64 } from '../../src/renderer/src/util/embedImage'

const __dirname_local = dirname(fileURLToPath(import.meta.url))
const FIXTURE_PATH = join(__dirname_local, '..', 'fixtures', 'stress-test-complex.md')

function readFixture(): string {
  return readFileSync(FIXTURE_PATH, 'utf-8')
}

beforeEach(() => {
  vi.mocked(invoke).mockReset()
  // embedImage.ts 用到 window.path.dirname
  ;(window as any).path = {
    dirname: (p: string) => {
      const idx = p.replace(/\\/g, '/').lastIndexOf('/')
      return idx === -1 ? '' : p.slice(0, idx)
    },
    basename: (p: string) => p.replace(/\\/g, '/').split('/').pop() ?? p,
  }
})

afterEach(() => {
  vi.clearAllMocks()
  delete (window as any).path
})

// ============================================================================
// exportStyledHTML — 纯函数渲染（不传 muya 实例）
// ============================================================================
describe('exportStyledHTML — 复杂物料渲染', () => {
  it('产出以 <!DOCTYPE html> 开头的完整文档', async () => {
    const md = '# 标题\n\n正文\n'
    const html = await exportStyledHTML(undefined as any, md, { title: 'Test' })
    expect(html.startsWith('<!DOCTYPE html>')).toBe(true)
    expect(html).toContain('</html>')
  })

  it('产出 markdown-body article 容器（PG7 不依赖 CDN link）', async () => {
    const html = await exportStyledHTML(undefined as any, '# H1\n', { title: 'T' })
    // article 容器必存在
    expect(html).toMatch(/<article[^>]*class="[^"]*markdown-body/)
    // happy-dom 下 ?inline CSS 注入受限，但不应该硬编码 CDN link
    expect(html).not.toMatch(/<link[^>]+href="https:\/\/cdnjs\.cloudflare\.com[^>]+github-markdown-css/)
  })

  it('heading 渲染（happy-dom 下注入 id）', async () => {
    const md = '段落前导\n\n### 三级\n\n#### 四级\n'
    const html = await exportStyledHTML(undefined as any, md, {})
    expect(html).toMatch(/<h3[^>]*id="[^"]*"/)
    expect(html).toMatch(/<h4[^>]*id="[^"]*"/)
  })

  it('正确渲染复杂物料（frontmatter + table + code + math + footnote）', async () => {
    const md = readFixture()
    const html = await exportStyledHTML(undefined as any, md, { title: 'Stress Test' })

    // frontmatter 不应原样出现在正文中（被 muya 引擎消费）
    expect(html).not.toContain('---\ntitle:')

    // 表格渲染
    expect(html).toMatch(/<table/)
    expect(html).toMatch(/<thead/)
    expect(html).toMatch(/<tbody/)

    // 代码块渲染（多语言）
    expect(html).toMatch(/<pre[\s\S]*?class="[^"]*language-rust"/)
    expect(html).toMatch(/<pre[\s\S]*?class="[^"]*language-typescript"/)
    expect(html).toMatch(/<pre[\s\S]*?class="[^"]*language-python"/)
    expect(html).toMatch(/<pre[\s\S]*?class="[^"]*language-json"/)

    // 数学公式渲染到 KaTeX
    expect(html).toContain('katex')
    expect(html).toMatch(/E\s*=\s*mc/)

    // 任务列表
    expect(html).toMatch(/<input[^>]+type="checkbox"/)

    // 引用块
    expect(html).toMatch(/<blockquote/)

    // 标题层级
    for (let i = 1; i <= 6; i++) {
      expect(html).toMatch(new RegExp(`<h${i}[\\s>]`))
    }
  })

  it('中文 UTF-8 字符完整保留（防 latin-1 编码回归）', async () => {
    const md = '# 中文标题\n\n正文内容 with 中文\n'
    const html = await exportStyledHTML(undefined as any, md, {})
    expect(html).toContain('中文标题')
    expect(html).toContain('正文内容 with 中文')
  })

  it('注入 [TOC] 占位符为目录 HTML', async () => {
    const md = '[TOC]\n\n# H1\n\n## H2\n'
    const tocHtml = '<ul class="toc"><li><a href="#h1">H1</a></li></ul>'
    const html = await exportStyledHTML(undefined as any, md, { toc: tocHtml })
    expect(html).not.toContain('[TOC]')
    expect(html).toContain('class="toc"')
  })

  it('printOptimization=true 时注入 page-container 表', async () => {
    const md = '# H\n'
    const header = { left: 'Header Left', center: 'Title', right: 'Page' }
    const footer = { left: '', center: '', right: '1' }
    const html = await exportStyledHTML(undefined as any, md, {
      printOptimization: true,
      header,
      footer,
    })
    expect(html).toContain('page-container')
    expect(html).toContain('Header Left')
  })
})

// ============================================================================
// embedImagesAsBase64 — base64 内嵌逻辑
// ============================================================================
describe('embedImagesAsBase64 — 图片内嵌策略', () => {
  const REMOTE_URL = 'https://example.com/logo.png'
  const DATA_URI = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAAC0lEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg=='
  const LOCAL_REL = './screenshots/editor.png'
  const LOCAL_FILE = 'file:///C:/Users/test/img.png'

  it('无图片时直接返回原 HTML', async () => {
    const html = '<p>no image</p>'
    const r = await embedImagesAsBase64(html, '/tmp/test.md')
    expect(r.embedded).toBe(0)
    expect(r.failed).toBe(0)
    expect(r.html).toBe(html)
    expect(invoke).not.toHaveBeenCalled()
  })

  it('远程 URL 触发 invoke，data: URI 被跳过', async () => {
    const remoteDataUri = 'data:image/png;base64,AAAA'
    vi.mocked(invoke).mockResolvedValue([
      {
        originalSrc: REMOTE_URL,
        dataUri: remoteDataUri,
        originalWidth: 100, resizedWidth: 100, originalSize: 100, finalSize: 80, error: null,
      },
    ])
    const html = `<img src="${REMOTE_URL}" alt="r"><img src="${DATA_URI}" alt="d">`
    const r = await embedImagesAsBase64(html, '/tmp/test.md')
    // invoke 被调用（远程 URL 传给后端下载）
    expect(invoke).toHaveBeenCalledTimes(1)
    expect(r.embedded).toBe(1)
    // 远程 URL 被替换为 data URI
    expect(r.html).not.toContain(REMOTE_URL)
    expect(r.html).toContain(remoteDataUri)
    // data: URI 保留原样
    expect(r.html).toContain(DATA_URI)
  })

  it('本地路径触发 invoke("images_to_data_uris") 并批量替换', async () => {
    const png1x1 = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAAC0lEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg=='
    vi.mocked(invoke).mockResolvedValue([
      {
        originalSrc: LOCAL_REL,
        dataUri: png1x1,
        originalWidth: 100,
        resizedWidth: 100,
        originalSize: 100,
        finalSize: 80,
        error: null,
      },
    ])

    const html = `<p>text</p><img src="${LOCAL_REL}" alt="local">`
    const r = await embedImagesAsBase64(html, '/tmp/test.md')

    expect(invoke).toHaveBeenCalledTimes(1)
    const [cmd, args] = vi.mocked(invoke).mock.calls[0]!
    expect(cmd).toBe('images_to_data_uris')
    const a = args as { sources: Array<{ src: string; baseDir: string; resize: unknown }> }
    expect(a.sources).toHaveLength(1)
    expect(a.sources[0]!.src).toBe(LOCAL_REL)
    expect(a.sources[0]!.baseDir).toBe('/tmp')
    expect(r.embedded).toBe(1)
    expect(r.failed).toBe(0)
    expect(r.html).not.toContain(LOCAL_REL)
    expect(r.html).toContain(png1x1)
  })

  it('后端 invoke 抛错时不替换任何 src，failed = sources.length', async () => {
    vi.mocked(invoke).mockRejectedValue(new Error('disk read failed'))
    const html = `<img src="${LOCAL_REL}" alt="a"><img src="${LOCAL_FILE}" alt="b">`
    const r = await embedImagesAsBase64(html, '/tmp/test.md')
    expect(r.embedded).toBe(0)
    expect(r.failed).toBe(2)
    // 原 src 保留
    expect(r.html).toContain(LOCAL_REL)
    expect(r.html).toContain(LOCAL_FILE)
  })

  it('混合场景：远程替换 + 本地替换 + data URI 保留', async () => {
    const png1x1 = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAAC0lEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg=='
    const remoteDataUri = 'data:image/png;base64,BBBBBBBB'
    vi.mocked(invoke).mockResolvedValue([
      {
        originalSrc: REMOTE_URL,
        dataUri: remoteDataUri,
        originalWidth: 200, resizedWidth: 200, originalSize: 200, finalSize: 150, error: null,
      },
      {
        originalSrc: LOCAL_REL,
        dataUri: png1x1,
        originalWidth: 50, resizedWidth: 50, originalSize: 50, finalSize: 40, error: null,
      },
    ])
    const html = `<img src="${REMOTE_URL}"><img src="${LOCAL_REL}"><img src="${DATA_URI}">`
    const r = await embedImagesAsBase64(html, '/tmp/x.md')

    expect(r.embedded).toBe(2)
    expect(r.failed).toBe(0)
    // invoke 处理远程 + 本地（data: URI 跳过）
    expect((vi.mocked(invoke).mock.calls[0]![1] as any).sources).toHaveLength(2)
    // 远程 URL 被替换
    expect(r.html).not.toContain(REMOTE_URL)
    expect(r.html).toContain(remoteDataUri)
    // 本地路径被替换
    expect(r.html).not.toContain(LOCAL_REL)
    expect(r.html).toContain(png1x1)
    // data: URI 保留
    expect(r.html).toContain(DATA_URI)
  })

  it('resize 选项被透传到 invoke sources', async () => {
    vi.mocked(invoke).mockResolvedValue([])
    const html = `<img src="${LOCAL_REL}">`
    await embedImagesAsBase64(html, '/tmp/x.md', { mode: 'auto', maxWidth: 800 })

    const args = vi.mocked(invoke).mock.calls[0]![1] as { sources: Array<{ resize: any }> }
    // 前端 ImageResizeOptions 是 camelCase；后端反序列化时由 serde rename 处理
    expect(args.sources[0]!.resize).toEqual({ mode: 'auto', maxWidth: 800 })
  })
})

// ============================================================================
// 端到端物料回归：exportStyledHTML + embedImagesAsBase64 联动
// ============================================================================
describe('导出链路联动：复杂物料 + embedImages:true', () => {
  it('复杂物料下 embedImages=true 触发 invoke 但失败时保留原 HTML 内容', async () => {
    const md = readFixture()
    vi.mocked(invoke).mockRejectedValue(new Error('rust command failed'))

    const html = await exportStyledHTML(undefined as any, md, {
      title: 'Stress',
      embedImages: true,
      pathname: '/tmp/stress.md',
      imageResizeMode: 'auto',
      imageMaxWidth: 1024,
    })

    // 即使图片内嵌失败，HTML 主体（标题/表格/代码块）应保留
    expect(html).toContain('<!DOCTYPE html>')
    expect(html).toMatch(/<table/)
    expect(html).toMatch(/<pre[\s\S]*?language-rust/)
    // 远程图片应保留
    expect(html).toContain('https://v2.tauri.app/_next/static/media/tauri')
    // data URI 保留
    expect(html).toContain('data:image/png;base64,iVBORw0KG')
  })

  it('复杂物料下 embedImages=true 成功时本地图片被替换为 data URI', async () => {
    const md = readFixture()
    const fakePng = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAAC0lEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg=='
    vi.mocked(invoke).mockImplementation(async (cmd: string, args?: any) => {
      if (cmd === 'images_to_data_uris') {
        return (args.sources as Array<{ src: string }>).map(s => ({
          originalSrc: s.src,
          dataUri: fakePng,
          originalWidth: 10, resizedWidth: 10, originalSize: 10, finalSize: 8, error: null,
        }))
      }
      return null
    })

    const html = await exportStyledHTML(undefined as any, md, {
      title: 'Stress',
      embedImages: true,
      pathname: '/tmp/stress.md',
    })

    // 本地相对路径应被替换
    expect(html).not.toContain('./screenshots/editor.png')
    // fakePng 应出现在被内嵌的位置
    expect(html).toContain(fakePng)
    // 远程 URL 也应被替换为 fakePng（不再保留原 URL）
    expect(html).not.toContain('https://v2.tauri.app/_next/static/media/tauri')
  })
})
