// v2.0 F4: CodeMirror 5 源码模式下 base64 内联图片的视觉折叠
//
// 在源码模式下，把 Markdown 源码里 `![alt](data:image/...;base64,...)` 中的
// base64 数据部分用 DOM widget 视觉替换为单行可读占位符：
//   【图片base64 · PNG · 12.3 KB · 请切换预览查看】
//
// 关键约束（PRD AC-37）：
// - 仅作用于 CodeMirror 视图层，cm.getValue() 仍返回原始 base64
// - 保存到磁盘的 .md 文件保留完整 base64 数据
// - 切换到 WYSIWYG 预览模式时 CM 实例销毁，widget 自动 GC
//
// 实现方式：用 CM5 的 markText + replacedWith + atomic
// （CM 官方 foldcode addon 同款 API）

// CM5 实例的最小类型定义（避免引入完整 @types/codemirror 的复杂度）
interface CMPosition {
  line: number
  ch: number
}
interface CMTextMarker {
  clear(): void
  find(): { from: CMPosition; to: CMPosition } | undefined
}
interface CMInstance {
  getValue(): string
  posFromIndex(index: number): CMPosition
  markText(from: CMPosition, to: CMPosition, options: {
    replacedWith?: HTMLElement
    atomic?: boolean
    readOnly?: boolean
    handleMouseEvents?: boolean
    addToHistory?: boolean
  }): CMTextMarker
  getAllMarks(): CMTextMarker[]
  operation<T>(fn: () => T): T
  on(event: string, handler: (instance: CMInstance, ...args: unknown[]) => void): void
}
// TextMarker 上挂自定义标志用的扩展接口
type MarkWithFlag = CMTextMarker & { __isBase64Placeholder?: boolean }

/**
 * 匹配 Markdown 图片 base64 内联语法：![alt](data:image/{subtype};base64,{data})
 *
 * 捕获组：
 *   1. alt 文本（用于 widget 的 title 属性）
 *   2. 完整的 data URI（包括 `data:` 前缀和 base64 数据）
 *   3. MIME 子类型（如 png、jpeg、svg+xml）
 *   4. base64 数据字符（不含 `=` padding 也匹配，因为 padding 在末尾）
 *
 * 注意：用 `[\s\S]` 替代 `.` 以兼容可能的换行（实际 base64 不会换行，但稳健起见）
 */
// eslint-disable-next-line no-useless-escape
export const BASE64_IMG_REG = /!\[([^\]]*)\]\((data:image\/([\w+\-.]+);base64,([A-Za-z0-9+/=\s]+))\)/g

/**
 * 将 MIME 子类型格式化为占位符显示用的短格式。
 * image/png → PNG；image/svg+xml → SVG；image/x-icon → X-ICON
 */
function formatMime(mimeSubtype: string): string {
  // 去掉 +xml、+atom 这类后缀的可读性优化
  const cleaned = mimeSubtype.replace(/\+.*$/, '')
  return cleaned.toUpperCase()
}

/**
 * 将字节数格式化为人类可读字符串。
 * < 1024 B   → "X B"
 * < 1 MB     → "X.X KB"
 * >= 1 MB    → "X.X MB"
 * >= 1 GB    → "X.X GB"
 */
function humanizeBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  const kb = bytes / 1024
  if (kb < 1024) return `${kb.toFixed(1)} KB`
  const mb = kb / 1024
  if (mb < 1024) return `${mb.toFixed(1)} MB`
  const gb = mb / 1024
  return `${gb.toFixed(1)} GB`
}

/**
 * 根据匹配结果构造占位符 DOM 元素。
 *
 * @param alt       图片 alt 文本（hover 时显示）
 * @param mimeSubtype MIME 子类型（如 "png"、"svg+xml"）
 * @param base64Data base64 数据字符（用于估算原始字节数）
 * @returns 一个 <span> 元素，已设置好 className、textContent、title
 */
function makePlaceholderEl(alt: string, mimeSubtype: string, base64Data: string): HTMLElement {
  // 估算原始字节数：base64 编码长度 × 3/4
  // 减去末尾 = padding（每个 = 代表 1 个被填充的字节）
  const paddingMatches = base64Data.match(/=+$/)
  const paddingLen = paddingMatches ? paddingMatches[0].length : 0
  const bytes = Math.floor((base64Data.length - paddingLen) * 3 / 4)

  const el = document.createElement('span')
  el.className = 'cm-base64-placeholder'
  el.textContent = `【图片base64 · ${formatMime(mimeSubtype)} · ${humanizeBytes(bytes)} · 请切换预览查看】`
  // hover 显示 alt 文本（若 alt 为空则提示用户在预览查看）
  el.title = alt ? `alt: ${alt}` : '请切换到预览模式查看图片'
  return el
}

/**
 * 清除 CodeMirror 中所有由本模块打的 base64 占位符标记。
 *
 * 用 `__isBase64Placeholder` 自定义标志识别（仿 CM foldcode 的 `__isFold` 模式）。
 */
export function clearBase64Widgets(cm: CMInstance): void {
  const marks = cm.getAllMarks() as MarkWithFlag[]
  for (const mark of marks) {
    if (mark.__isBase64Placeholder) {
      mark.clear()
    }
  }
}

/**
 * 全量扫描文档，对每个 base64 图片标记打上 widget。
 *
 * 在 cm.operation 内批量执行，避免每次 markText 触发重排（性能优化，AC-41）。
 * 内部会先调用 clearBase64Widgets 清理旧标记，保证幂等。
 *
 * @param cm CodeMirror 实例
 * @returns 本次打上的标记数量（用于调试/日志）
 */
export function applyBase64Widgets(cm: CMInstance): number {
  let count = 0
  let textLen = 0
  cm.operation(() => {
    // 先清理旧标记，保证幂等
    clearBase64Widgets(cm)

    const text = cm.getValue()
    textLen = text.length
    // 用 exec + lastIndex 迭代，避免一次性 match 捕获所有结果占内存（AC-41）
    BASE64_IMG_REG.lastIndex = 0
    let match: RegExpExecArray | null
    while ((match = BASE64_IMG_REG.exec(text)) !== null) {
      const alt = match[1] ?? ''
      // match[2] 是完整 data URI（含 `data:` 前缀），match[3] 是 MIME 子类型，match[4] 是 base64 数据
      const mimeSubtype = match[3] ?? 'octet-stream'
      const base64Data = match[4] ?? ''
      const matchStart = match.index
      // 仅折叠 base64 数据部分（match[4]）所在的范围，保留 `![alt](data:image/png;base64,` 前缀可见
      // 这样用户能清楚看到这是图片语法 + 格式标识
      // 但为了视觉简洁，实际折叠的是 match[2]（完整 data URI），让前缀 `![alt](` 和后缀 `)` 都保留
      const dataUriStart = matchStart + match[0].indexOf(match[2])
      const dataUriEnd = dataUriStart + match[2].length

      const from = cm.posFromIndex(dataUriStart)
      const to = cm.posFromIndex(dataUriEnd)

      const placeholderEl = makePlaceholderEl(alt, mimeSubtype, base64Data)
      const mark = cm.markText(from, to, {
        replacedWith: placeholderEl,
        atomic: true,            // 光标整块跳过（AC-38）
        // 不设 readOnly：让用户能整张删除（AC-39）
        handleMouseEvents: false, // 点击无反应（AC-42）
        addToHistory: false       // widget 不进入 undo 栈
      }) as MarkWithFlag
      mark.__isBase64Placeholder = true
      count++
    }
  })
  // eslint-disable-next-line no-console
  console.log(`[F4] applyBase64Widgets: 文档长度 ${textLen} 字符，折叠 ${count} 张 base64 图片`)
  return count
}

/**
 * 对 CodeMirror 的某个文本范围（行）做增量扫描。
 *
 * 用于 `cm.on('change')` 时仅重扫变更行附近，不全量扫描（AC-41 性能优化）。
 * 注意：base64 图片可能跨多行，但实际 base64 不会换行，因此按行扫描足够。
 *
 * @param cm CodeMirror 实例
 * @param fromLine 起始行（0-based）
 * @param toLine 结束行（0-based，含）
 */
export function applyBase64WidgetsInRange(
  cm: CMInstance,
  fromLine: number,
  toLine: number
): void {
  cm.operation(() => {
    // 清理范围内的旧标记（避免重复）
    const marks = cm.getAllMarks() as MarkWithFlag[]
    for (const mark of marks) {
      if (!mark.__isBase64Placeholder) continue
      const range = mark.find()
      if (!range) continue
      // 范围内的标记清理（保险起见扩展 1 行）
      if (range.from.line >= fromLine - 1 && range.to.line <= toLine + 1) {
        mark.clear()
      }
    }

    // 构造范围文本（拼接 fromLine~toLine 的所有行）
    const text = cm.getValue()
    const lines = text.split('\n')
    const fromLineClamped = Math.max(0, fromLine)
    const toLineClamped = Math.min(lines.length - 1, toLine)
    if (fromLineClamped > toLineClamped) return

    // 用每行的起始索引计算字符位置
    let lineStartIndex = 0
    for (let i = 0; i < fromLineClamped; i++) {
      lineStartIndex += lines[i].length + 1 // +1 for \n
    }
    const rangeStartIndex = lineStartIndex
    let rangeEndIndex = rangeStartIndex
    for (let i = fromLineClamped; i <= toLineClamped; i++) {
      rangeEndIndex += lines[i].length + 1
    }
    const rangeText = text.substring(rangeStartIndex, rangeEndIndex)

    // 在范围文本内匹配
    // 注意：新建一个 RegExp 实例避免全局 lastIndex 污染
    const localReg = new RegExp(BASE64_IMG_REG.source, 'g')
    let match: RegExpExecArray | null
    while ((match = localReg.exec(rangeText)) !== null) {
      const alt = match[1] ?? ''
      const mimeSubtype = match[3] ?? 'octet-stream'
      const base64Data = match[4] ?? ''
      const dataUriStart = rangeStartIndex + match.index + match[0].indexOf(match[2])
      const dataUriEnd = dataUriStart + match[2].length

      const from = cm.posFromIndex(dataUriStart)
      const to = cm.posFromIndex(dataUriEnd)

      const placeholderEl = makePlaceholderEl(alt, mimeSubtype, base64Data)
      const mark = cm.markText(from, to, {
        replacedWith: placeholderEl,
        atomic: true,
        handleMouseEvents: false,
        addToHistory: false
      }) as MarkWithFlag
      mark.__isBase64Placeholder = true
    }
  })
}

/**
 * CodeMirror 'change' 事件处理器。
 *
 * 在用户输入/粘贴时触发，对变更范围附近的行做增量重扫。
 *
 * 用法：
 *   cm.on('change', handleBase64Change)
 */
export function handleBase64Change(cm: CMInstance, change: unknown): void {
  const ch = change as { from?: CMPosition; to?: CMPosition; text?: string[] }
  if (!ch.from || !ch.to) return
  // 增量扫描变更范围（扩展 1 行保险）
  applyBase64WidgetsInRange(cm, ch.from.line, ch.to.line + (ch.text?.length ?? 1))
}
