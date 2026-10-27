import { resolveLocalImageSrc } from '../util/resolveImageSrc'
import { embedImagesAsBase64 } from '../util/embedImage'

class MarkdownPrint {
  private container: HTMLElement | null = null

  /**
   * Prepare document export and append a hidden print container to the window.
   * Everything outside of this hidden print container will be hidden with display: none.
   *
   * @param html HTML string
   * @param renderStatic Render for static files like PDF documents
   * @param pathname v2.0: 当前文件路径（base64 内嵌时解析相对图片用）
   * @param embedImages v2.0: 是否将本地图片内嵌为 base64（默认 false，保持 v1.0 行为）
   * @param imageResizeMode v2.0: 图片缩放模式
   * @param imageMaxWidth v2.0: 自动缩放最大宽度
   */
  async renderMarkdown(
    html: string,
    renderStatic?: boolean,
    pathname?: string,
    embedImages?: boolean,
    imageResizeMode?: 'original' | 'auto',
    imageMaxWidth?: number
  ): Promise<void> {
    this.clearup()
    let processedHtml = html

    // v2.0 F3: 若启用 base64 内嵌，在挂载 DOM 前将图片转为 data URI
    // 这样打印渲染（window.print()）不依赖外部 file:// 文件（PRD AC-18）
    if (embedImages && pathname) {
      const embedResult = await embedImagesAsBase64(processedHtml, pathname, {
        mode: imageResizeMode ?? 'auto',
        maxWidth: imageMaxWidth ?? 1024
      })
      processedHtml = embedResult.html
      if (embedResult.failed > 0) {
        console.warn(`[printService] ${embedResult.failed} 张图片内嵌失败`)
      }
    }

    const printContainer = document.createElement('article')
    printContainer.classList.add('print-container')
    this.container = printContainer
    printContainer.innerHTML = processedHtml

    // Fix images when rendering for static files like PDF (GH#678).
    // 注意：若已 embedImages，此处 resolveLocalImageSrc 对 data: URI 是 no-op。
    if (renderStatic) {
      // Traverse through the DOM tree and fix all relative image sources.
      const images = printContainer.getElementsByTagName('img')
      for (const image of Array.from(images)) {
        const rawSrc = image.getAttribute('src') ?? ''
        image.src = resolveLocalImageSrc(rawSrc)
      }
    }

    document.body.appendChild(printContainer)
  }

  /**
   * Remove the print container from the window.
   */
  clearup(): void {
    if (this.container) {
      this.container.remove()
    }
  }
}

export default MarkdownPrint
