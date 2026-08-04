// Source-code mode search/replace for CodeMirror 5.
//
// In source-code mode the WYSIWYG (Muya) editor is hidden, so the search/replace
// operations from the search bar must act on the CodeMirror instance instead.
// This module implements:
//   - Text search with case-sensitive / whole-word / regexp options
//   - Highlight all matches via `markText`
//   - Navigate to prev/next match
//   - Replace current or all matches

type CMInstance = any // CodeMirror 5 instance (loosely typed)
type CMPosition = { line: number; ch: number }

export interface SearchOptions {
  isCaseSensitive?: boolean
  isWholeWord?: boolean
  isRegexp?: boolean
}

export interface SearchMatch {
  start: number // character offset from document start
  end: number
  match: string
}

export interface SearchResult {
  index: number // current match index (-1 if no matches)
  matches: SearchMatch[]
  value: string // the search query
}

/** CSS class applied to all search highlight markers. */
const HIGHLIGHT_CLASS = 'cm-source-search-highlight'
/** CSS class applied to the *current* (active) match. */
const ACTIVE_HIGHLIGHT_CLASS = 'cm-source-search-highlight-active'

/**
 * Build a RegExp from the search value and options.
 */
function buildSearchRegex(value: string, opt: SearchOptions): RegExp | null {
  if (!value) return null
  try {
    let flags = 'g'
    if (!opt.isCaseSensitive) flags += 'i'
    let source: string
    if (opt.isRegexp) {
      source = value
    } else {
      source = value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    }
    if (opt.isWholeWord) {
      source = `\\b${source}\\b`
    }
    return new RegExp(source, flags)
  } catch {
    return null
  }
}

/**
 * Find all matches in the CodeMirror document.
 */
export function cmSearch(cm: CMInstance, value: string, opt: SearchOptions): SearchResult {
  const regex = buildSearchRegex(value, opt)
  if (!regex) return { index: -1, matches: [], value }

  const text = cm.getValue()
  const matches: SearchMatch[] = []

  // Reset lastIndex for global regex
  regex.lastIndex = 0
  let match: RegExpExecArray | null
  while ((match = regex.exec(text)) !== null) {
    // Guard against zero-length matches (e.g. `^` or `\b`)
    if (match[0].length === 0) {
      regex.lastIndex++
      continue
    }
    matches.push({
      start: match.index,
      end: match.index + match[0].length,
      match: match[0]
    })
    // Prevent infinite loop on zero-width advances
    if (regex.lastIndex <= match.index) {
      regex.lastIndex = match.index + 1
    }
  }

  const index = matches.length > 0 ? 0 : -1
  return { index, matches, value }
}

/**
 * Clear all search highlight markers from the CodeMirror instance.
 */
export function cmClearSearchHighlights(cm: CMInstance): void {
  const marks = cm.getAllMarks()
  for (const mark of marks) {
    if (mark.className === HIGHLIGHT_CLASS || mark.className === ACTIVE_HIGHLIGHT_CLASS) {
      mark.clear()
    }
  }
}

/**
 * Apply search highlight markers to all matches, and scroll to the active one.
 * Returns the updated SearchResult with index set to `activeIndex`.
 */
export function cmApplySearchHighlights(
  cm: CMInstance,
  result: SearchResult,
  activeIndex: number,
  scrollContainer: HTMLElement | null | undefined
): void {
  cmClearSearchHighlights(cm)

  if (result.matches.length === 0) return

  // Highlight all matches
  cm.operation(() => {
    for (let i = 0; i < result.matches.length; i++) {
      const m = result.matches[i]
      const from = cm.posFromIndex(m.start)
      const to = cm.posFromIndex(m.end)
      const className = i === activeIndex ? ACTIVE_HIGHLIGHT_CLASS : HIGHLIGHT_CLASS
      cm.markText(from, to, { className, addToHistory: false })
    }
  })

  // Scroll to the active match
  if (activeIndex >= 0 && activeIndex < result.matches.length) {
    const m = result.matches[activeIndex]
    const from = cm.posFromIndex(m.start)
    cm.setCursor(from, null, { scroll: false })

    if (scrollContainer) {
      // Same calculation as scrollSourceEditorToLine: include CodeMirror margin-top
      const top = cm.heightAtLine(from.line, 'local') + 50
      scrollContainer.scrollTo({ top, behavior: 'smooth' })
    }
  }
}

/**
 * Replace the current match (at `activeIndex`) with `replacement` text.
 * Returns updated SearchResult (matches recomputed after replacement).
 */
export function cmReplaceCurrent(
  cm: CMInstance,
  result: SearchResult,
  activeIndex: number,
  replacement: string,
  opt: SearchOptions
): SearchResult {
  if (activeIndex < 0 || activeIndex >= result.matches.length) return result

  const m = result.matches[activeIndex]
  const from = cm.posFromIndex(m.start)
  const to = cm.posFromIndex(m.end)

  cm.replaceRange(replacement, from, to)

  // Re-search after replacement (positions have shifted)
  return cmSearch(cm, result.value, opt)
}

/**
 * Replace all matches with `replacement` text.
 * Returns updated SearchResult (empty, since all replaced).
 */
export function cmReplaceAll(
  cm: CMInstance,
  result: SearchResult,
  replacement: string,
  opt: SearchOptions
): SearchResult {
  if (result.matches.length === 0) return result

  // Replace from end to start to avoid offset shifts
  cm.operation(() => {
    for (let i = result.matches.length - 1; i >= 0; i--) {
      const m = result.matches[i]
      const from = cm.posFromIndex(m.start)
      const to = cm.posFromIndex(m.end)
      cm.replaceRange(replacement, from, to)
    }
  })

  return cmSearch(cm, result.value, opt)
}
