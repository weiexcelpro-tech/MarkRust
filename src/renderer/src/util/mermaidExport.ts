/**
 * B11: docx 导出前把 ```mermaid 代码块替换为 PNG data URI 图片（前端侧预处理）。
 *
 * 与 Rust 侧契约：markdown 中每个 ```mermaid 围栏被替换为
 *   ![mermaid](data:image/png;base64,<b64>)
 * Rust export_docx 按 image 事件内嵌 PNG，无需引入任何渲染器。
 *
 * 【实现 v2 —— 独立 mermaid 渲染器（真实事故修复）】
 * v1 借道 muya 的 MarkdownToHtml 渲染管线取 svg，但该管线的 mermaid 渲染是
 * 异步懒加载（首载需动态加载 mermaid 图形模块），renderHtml 返回时 svg 可能
 * 尚未就绪，查询落空即静默「保留源码」——真机导出因此回退为源码。
 * v2 直接调用 mermaid.render（编辑器的直接依赖，非 muya 内部懒加载）：
 * 全程 await、无竞态；flowchart 关闭 htmlLabels（foreignObject 会令 canvas
 * 光栅化空白）；单块失败保留源码并由调用方显式提示，不再无声降级。
 */
import mermaid from 'mermaid'

/** GFM 围栏：```mermaid（可带信息串）…```，捕获围栏内源码 */
const MERMAID_FENCE_RE = /^```mermaid[^\n]*\n([\s\S]*?)^```[ \t]*$/gm

/** 2x 缩放 + 画布宽度上限（清晰度/体积折中） */
const PNG_SCALE = 2
const MAX_CANVAS_WIDTH = 1600

/** mermaid.initialize 只需一次；主题变化时重置 */
let initializedTheme: string | null = null
function ensureMermaidInit(theme: 'light' | 'dark'): void {
  if (initializedTheme === theme) return
  mermaid.initialize({
    startOnLoad: false,
    theme: theme === 'dark' ? 'dark' : 'default',
    // foreignObject（htmlLabels）在 canvas 光栅化时可能空白，用纯文本标签保证 PNG 质量
    flowchart: { htmlLabels: false },
    sequence: { useMaxWidth: false }
  })
  initializedTheme = theme
}

/** 从应用根节点探测当前明暗主题（编辑器按主题挂 dark class） */
function detectTheme(): 'light' | 'dark' {
  const root = document.querySelector('.editor-component') ?? document.body
  if (
    root.closest('.dark') !== null ||
    root.classList.contains('dark') ||
    document.documentElement.classList.contains('dark')
  ) {
    return 'dark'
  }
  return 'light'
}

/** markdown 中 ```mermaid 围栏数量（0 时导出可跳过整条替换链路） */
export function countMermaidFences(markdown: string): number {
  return [...markdown.matchAll(MERMAID_FENCE_RE)].length
}

/**
 * 把 markdown 中所有 ```mermaid 围栏替换为 PNG data URI 图片语法。
 * @param markdown 原始 markdown（来自 editor.getMarkdown()）
 * @returns { markdown, replaced, failed } —— failed>0 时调用方应显式提示用户
 */
export async function replaceMermaidWithPngImages(
  markdown: string
): Promise<{ markdown: string; replaced: number; failed: number }> {
  const empty = { markdown, replaced: 0, failed: 0 }
  if (!markdown || !markdown.includes('```mermaid')) return empty
  const fences = [...markdown.matchAll(MERMAID_FENCE_RE)]
  if (fences.length === 0) return empty

  ensureMermaidInit(detectTheme())

  interface Replacement {
    start: number
    end: number
    dataUri: string
  }
  const replacements: Replacement[] = []
  let failed = 0
  for (const match of fences) {
    const start = match.index
    if (start === undefined) continue
    try {
      const svg = await renderMermaidCodeSvg(match[1] ?? '')
      if (!svg) {
        failed += 1
        continue
      }
      const dataUri = await svgElementToPngDataUri(svg, PNG_SCALE, MAX_CANVAS_WIDTH)
      if (dataUri) {
        replacements.push({ start, end: start + match[0].length, dataUri })
      } else {
        failed += 1
      }
    } catch (err) {
      // 单块失败：保留源码并计数（调用方显式提示，不再无声降级）
      console.warn('[mermaidExport] fence render failed, keeping source:', err)
      failed += 1
    }
  }

  // 从后往前替换，避免前面的替换影响后面的下标
  let result = markdown
  for (let i = replacements.length - 1; i >= 0; i--) {
    const r = replacements[i]!
    result = result.slice(0, r.start) + `![mermaid](${r.dataUri})` + result.slice(r.end)
  }
  return { markdown: result, replaced: replacements.length, failed }
}

/** 独立渲染：直接 mermaid.render 单围栏源码，全程 await 无竞态。
 *  首次渲染需动态加载 mermaid 图形 chunk（WebView2/tauri 协议下偶发瞬时失败），
 *  失败时延迟重试一次（Chromium 不缓存 dynamic import 失败，重试会重新拉取）。 */
async function renderMermaidCodeSvg(source: string): Promise<SVGSVGElement | null> {
  const id = 'mermaid-export-' + Date.now().toString(36) + Math.random().toString(36).slice(2, 8)
  let svg: string
  try {
    ;({ svg } = await mermaid.render(id, source))
  } catch (firstErr) {
    console.warn('[mermaidExport] first render attempt failed, retrying once:', firstErr)
    await new Promise((r) => setTimeout(r, 400))
    const retryId = id + '-retry'
    ;({ svg } = await mermaid.render(retryId, source))
  }
  const template = document.createElement('template')
  template.innerHTML = svg
  return (template.content.querySelector('svg') as SVGSVGElement | null) ?? null
}

/**
 * svg → PNG data URI：序列化（补 xmlns）→ data URI 装载 → canvas 绘制（白底兜底，
 * 避免 Word 中透明底被渲染为黑底）→ toDataURL('image/png')。
 */
async function svgElementToPngDataUri(
  svg: SVGSVGElement,
  scale: number,
  maxCanvasWidth: number
): Promise<string | null> {
  // 尺寸优先取 viewBox（mermaid 产出的 svg 一般带），其次 width/height 属性
  const vb = (svg.getAttribute('viewBox') ?? '').trim().split(/[\s,]+/).map(Number)
  let width = vb.length === 4 && vb.every((n) => Number.isFinite(n)) ? vb[2]! : 0
  let height = vb.length === 4 && vb.every((n) => Number.isFinite(n)) ? vb[3]! : 0
  if (!(width > 0 && height > 0)) {
    width = Number.parseFloat(svg.getAttribute('width') ?? '') || 0
    height = Number.parseFloat(svg.getAttribute('height') ?? '') || 0
  }
  if (!(width > 0 && height > 0)) return null

  const canvasWidth = Math.min(Math.round(width * scale), maxCanvasWidth)
  const canvasHeight = Math.max(1, Math.round((canvasWidth * height) / width))

  const clone = svg.cloneNode(true) as SVGSVGElement
  if (!clone.getAttribute('xmlns')) clone.setAttribute('xmlns', 'http://www.w3.org/2000/svg')
  if (!clone.getAttribute('xmlns:xlink')) {
    clone.setAttribute('xmlns:xlink', 'http://www.w3.org/1999/xlink')
  }
  clone.setAttribute('width', String(width))
  clone.setAttribute('height', String(height))
  const xml = new XMLSerializer().serializeToString(clone)
  const source = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(xml)

  const image = new Image()
  await new Promise<void>((resolve, reject) => {
    image.onload = () => resolve()
    image.onerror = () => reject(new Error('mermaid svg rasterize load failed'))
    image.src = source
  })

  const canvas = document.createElement('canvas')
  canvas.width = canvasWidth
  canvas.height = canvasHeight
  const ctx = canvas.getContext('2d')
  if (!ctx) return null
  ctx.fillStyle = '#ffffff'
  ctx.fillRect(0, 0, canvasWidth, canvasHeight)
  ctx.drawImage(image, 0, 0, canvasWidth, canvasHeight)
  return canvas.toDataURL('image/png')
}
