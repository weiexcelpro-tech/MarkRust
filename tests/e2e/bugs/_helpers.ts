/**
 * bugs/ 用例共享助手：文档加载（带 pathname）、muya 实例访问、invoke 检索。
 *
 * 加载方式：bootstrapApp（v1.1.6 解决 mt::bootstrap-editor 时序竞态）先起编辑器，
 * 再经 mt::open-file → fs_read_markdown（mock 覆盖）打开带 pathname 的文档标签，
 * 使 window.DIRNAME 指向文档目录（B05 链接解析 / B06 图片锚定依赖它）。
 */
import { expect, type Page } from '@playwright/test'
import { injectTauriMock, bootstrapApp, type MockOverride } from '../mock-tauri'

export { injectTauriMock, bootstrapApp, setMockResponse, startRecordingInvokes, getRecordedInvokes, emitTauriEvent } from '../mock-tauri'
import { startRecordingInvokes, getRecordedInvokes } from '../mock-tauri'

/** Rust MarkdownFileResult 结构（与 tauri-bridge.ts 接口对齐） */
export function makeDocResult(pathname: string, markdown: string) {
  const filename = pathname.split(/[\\/]/).pop() ?? 'untitled.md'
  return {
    markdown,
    filename,
    pathname,
    encoding: { encoding: 'utf-8', isBom: false },
    lineEnding: 'lf',
    adjustLineEndingOnSave: false,
    trimTrailingNewline: 2,
    isMixedLineEndings: false,
  }
}

export interface LaunchOptions {
  overrides?: MockOverride
  /** bootstrap 等待 Vue onMounted 的毫秒数 */
  waitForMs?: number
}

/** 启动应用（空白草稿 tab），不带文档 */
export async function launchEditor(page: Page, options: LaunchOptions = {}): Promise<void> {
  await injectTauriMock(page, options.overrides ?? {})
  await bootstrapApp(page, { waitForMs: options.waitForMs ?? 2500 })
}

/**
 * 启动应用并打开一个带 pathname 的文档（fs_read_markdown 覆盖注入，不落盘）。
 * marker：文档中必然出现在编辑器里的文本片段，用于等待渲染完成。
 */
export async function openDoc(
  page: Page,
  pathname: string,
  markdown: string,
  options: LaunchOptions = {},
): Promise<void> {
  const overrides: MockOverride = {
    ...(options.overrides ?? {}),
  }
  // fs_read_markdown 可能被用例自身覆盖为按路径分发的函数式响应结构 ——
  // 这里仅在未提供时注入单文档响应（mock 响应表只支持静态值）。
  if (!overrides.fs_read_markdown) {
    overrides.fs_read_markdown = makeDocResult(pathname, markdown)
  }
  await launchEditor(page, { ...options, overrides })
  const marker = (markdown.match(/^.+$/m)?.[0] ?? '').replace(/^[#\s>*-]+/, '').trim().slice(0, 18)
  await page.evaluate((p) => window.electron.ipcRenderer.send('mt::open-file', p), pathname)
  if (marker) {
    await expect(page.locator('.editor-component')).toContainText(marker, { timeout: 15000 })
  }
  await page.waitForTimeout(600)
}

/** 收集页面致命 JS 错误（pageerror），返回原始数组 */
export function collectPageErrors(page: Page): string[] {
  const errors: string[] = []
  page.on('pageerror', (err) => errors.push(err.message))
  return errors
}

/** 过滤已知噪音（与 render.spec 的忽略清单一致 + vite dev 动态导入告警） */
export function fatalErrors(errors: string[]): string[] {
  const ignored = [
    'ElementPlusError',
    '[intlify]',
    'title slot is about to be deprecated',
    'unhandled invoke',
    'unmapped ipcRenderer',
    'ResizeObserver loop',
    // vite dev 模式 prismjs 按需加载语言组件的良性告警（pageerror 形态出现）
    'Unknown variable dynamic import',
  ]
  return errors.filter((e) => !ignored.some((p) => e.includes(p)))
}

/** 通过 muya 块 DOM 反向引用（__MUYA_BLOCK__.muya）取当前文档 markdown */
export async function getMarkdown(page: Page): Promise<string> {
  return page.evaluate(() => {
    const el = document.querySelector(
      '.mu-editor p, .mu-editor h1, .mu-editor h2, .mu-editor th, .mu-editor td',
    ) as (HTMLElement & { __MUYA_BLOCK__?: { muya: { getMarkdown(): string } } }) | null
    const block = el?.__MUYA_BLOCK__
    if (!block?.muya) throw new Error('无法通过 __MUYA_BLOCK__ 访问 muya 实例')
    return block.muya.getMarkdown()
  })
}

/** 页面内动态导入渲染层 bus（vite dev 模式按源路径可达），触发事件 */
export async function emitBus(page: Page, event: string, payload?: unknown): Promise<void> {
  await page.evaluate(({ event, payload }) => {
    return import('/src/renderer/src/bus/index.ts').then(({ default: bus }) => {
      bus.emit(event, payload)
    })
  }, { event, payload })
}

/** 取已记录 invoke 中指定命令的调用列表 */
export async function invocationsOf(page: Page, cmd: string) {
  const invokes = await getRecordedInvokes(page)
  return invokes.filter((i) => i.cmd === cmd)
}

/** 开启 invoke 记录（语义化再导出） */
export async function recordInvokes(page: Page): Promise<void> {
  await startRecordingInvokes(page)
}
