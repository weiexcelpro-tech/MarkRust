/**
 * B11: docx 导出前把 ```mermaid 代码块替换为 PNG data URI 图片（前端侧预处理）。
 *
 * 与 Rust 侧契约：markdown 中每个 ```mermaid 围栏被替换为
 *   ![mermaid](data:image/png;base64,<b64>)
 * Rust export_docx 按 image 事件内嵌 PNG，无需引入任何渲染器。
 *
 * 实现：每个围栏单独走 muya 的 MarkdownToHtml 渲染管线（与 styledHtml 导出同一条
 * _renderMermaid 路径，编辑器外独立容器、不受滚动虚拟化影响），把渲染出的 svg
 * 序列化后经 canvas 转 PNG data URI；宽度取 svg 实际宽、2x 缩放保证清晰度，上限 1600px。
 * 单个块渲染失败时保留源码并继续，不阻断导出（失败兜底）。
 */
import { MarkdownToHtml } from '@muyajs/core'
import type { Muya } from '@muyajs/core'

/** GFM 围栏：```mermaid（可带信息串）…```，捕获围栏内源码 */
const MERMAID_FENCE_RE = /^```mermaid[^\n]*\n([\s\S]*?)^```[ \t]*$/gm

/** 2x 缩放 + 画布宽度上限（毫秒级清晰度/体积折中） */
const PNG_SCALE = 2
const MAX_CANVAS_WIDTH = 1600

/** markdown 中 ```mermaid 围栏数量（0 时导出可跳过整条替换链路） */
export function countMermaidFences(markdown: string): number {
  return [...markdown.matchAll(MERMAID_FENCE_RE)].length
}

/**
 * 把 markdown 中所有 ```mermaid 围栏替换为 PNG data URI 图片语法。
 * @param markdown 原始 markdown（来自 editor.getMarkdown()）
 * @param muya     当前编辑器实例（MarkdownToHtml 需要它读主题等选项，可为 undefined）
 * @returns 替换后的 markdown；无围栏或全部失败时原样返回
 */
export async function replaceMermaidWithPngImages(
  markdown: string,
  muya?: Muya
): Promise<string> {
  if (!markdown || !markdown.includes('```mermaid')) return markdown
  const fences = [...markdown.matchAll(MERMAID_FENCE_RE)]
  if (fences.length === 0) return markdown

  interface Replacement {
    start: number
    end: number
    dataUri: string
  }
  const replacements: Replacement[] = []
  for (const match of fences) {
    const start = match.index
    if (start === undefined) continue
    try {
      const svg = await renderMermaidFenceSvg(match[1] ?? '', muya)
      if (!svg) continue
      const dataUri = await svgElementToPngDataUri(svg, PNG_SCALE, MAX_CANVAS_WIDTH)
      if (dataUri) {
        replacements.push({ start, end: start + match[0].length, dataUri })
      }
    } catch (err) {
      // 失败兜底：单个块渲染失败保留源码并继续（不阻断导出）
      console.warn('[mermaidExport] fence render failed, keeping source:', err)
    }
  }

  // 从后往前替换，避免前面的替换影响后面的下标
  let result = markdown
  for (let i = replacements.length - 1; i >= 0; i--) {
    const r = replacements[i]!
    result = result.slice(0, r.start) + `![mermaid](${r.dataUri})` + result.slice(r.end)
  }
  return result
}

/** 单围栏独立渲染：每个 ```mermaid 块走一次独立小文档渲染，失败只影响本块 */
async function renderMermaidFenceSvg(source: string, muya?: Muya): Promise<SVGSVGElement | null> {
  const miniDoc = '```mermaid\n' + source.replace(/\n$/, '') + '\n```'
  const html = await new MarkdownToHtml(miniDoc, muya).renderHtml()
  const template = document.createElement('template')
  template.innerHTML = html
  return (template.content.querySelector('.mermaid svg') as SVGSVGElement | null) ?? null
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
