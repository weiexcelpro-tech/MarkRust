import { animatedScrollTo } from './index'

/** Minimal CodeMirror surface `scrollSourceEditorToLine` needs. */
interface ISourceEditor {
  setCursor: (
    pos: { line: number, ch: number },
    ch?: number | null,
    options?: { scroll?: boolean }
  ) => void
  heightAtLine: (line: number, mode: 'local' | 'page' | 'div') => number
  charCoords: (pos: { line: number, ch: number }, mode?: 'window' | 'page' | 'local') => {
    left: number, right: number, top: number, bottom: number
  }
}

/** Animatable token `animatedScrollTo` stamps on the element it drives. */
interface ScrollAnimHost extends HTMLElement {
  __scrollAnimToken?: symbol
}

/**
 * Fallback for the gap between the scroll container's content origin and
 * CodeMirror's document origin when the `.CodeMirror` wrapper can't be found.
 */
const FALLBACK_CONTENT_OFFSET = 50

/**
 * Measure the real gap between the scroll container's content origin and
 * CodeMirror's document origin. The `.CodeMirror` wrapper's margin-top lives
 * in CSS (currently 50px) and has changed across layouts — a hard-coded value
 * here once overshot every TOC jump by a whole line, so measure instead.
 */
export function measureSourceContentOffset(scrollContainer: HTMLElement): number {
  const wrapper = scrollContainer.querySelector('.CodeMirror')
  if (!wrapper) return FALLBACK_CONTENT_OFFSET
  return wrapper.getBoundingClientRect().top
    - scrollContainer.getBoundingClientRect().top
    + scrollContainer.scrollTop
}

/**
 * Nudge the container so the given line's top sits exactly at the container's
 * visible top. CodeMirror's `heightAtLine` reads its height map, which can be
 * stale for lines far from the viewport (measured before fonts settled or
 * before an edit-triggered reflow), so the animated scroll can land one or two
 * lines off. Once landed, the line IS in the viewport and `charCoords` returns
 * its real rendered position — correct the residual drift from that.
 */
export function snapSourceLineToTop(
  editor: ISourceEditor,
  line: number,
  scrollContainer: HTMLElement | null | undefined
): void {
  if (!scrollContainer) return
  const crect = scrollContainer.getBoundingClientRect()
  const { top } = editor.charCoords({ line, ch: 0 }, 'window')
  const delta = Math.round(top - crect.top)
  if (Math.abs(delta) > 1) scrollContainer.scrollTop += delta // browser clamps to [0, max]
}

/**
 * Scroll the source-code container so `line` sits at the TOP of the viewport,
 * animated, with a post-landing drift correction.
 *
 * The editor runs CodeMirror with `viewportMargin: Infinity`, so CodeMirror
 * renders the whole document at full height and its own `.CodeMirror-scroll`
 * never scrolls — the OUTER `.source-code` container (`scrollContainer`) is
 * the scrollable element. So neither `cm.scrollTo` nor `cm.scrollIntoView`
 * moves anything; we scroll the container directly to the line's local Y.
 */
export function scrollSourceContainerToLine(
  editor: ISourceEditor,
  line: number,
  scrollContainer: HTMLElement | null | undefined
): void {
  if (!scrollContainer) return
  const target = editor.heightAtLine(line, 'local') + measureSourceContentOffset(scrollContainer)
  animatedScrollTo(scrollContainer, target, 300)
  // Correct the residual drift once the animation has settled (and once more
  // in case a late reflow shifts things). A newer jump re-stamps the anim
  // token, which voids the pending corrections of the jump it replaced.
  const host = scrollContainer as ScrollAnimHost
  const token = host.__scrollAnimToken
  window.setTimeout(() => {
    if (host.__scrollAnimToken === token) snapSourceLineToTop(editor, line, scrollContainer)
  }, 320)
  window.setTimeout(() => {
    if (host.__scrollAnimToken === token) snapSourceLineToTop(editor, line, scrollContainer)
  }, 650)
}

/**
 * Set the caret to `line` and scroll the source-code editor so that line sits
 * at the top of the viewport. `setCursor` gets `scroll: false` so its native
 * caret-into-view scroll doesn't fight the animation.
 */
export function scrollSourceEditorToLine(
  editor: ISourceEditor,
  line: number,
  scrollContainer: HTMLElement | null | undefined
): void {
  editor.setCursor({ line, ch: 0 }, null, { scroll: false })
  scrollSourceContainerToLine(editor, line, scrollContainer)
}

/**
 * Find the 0-based line number of the `headingIndex`-th markdown heading
 * (ATX `# foo` or setext `foo\n===`) in document order, skipping fenced code
 * blocks. Returns -1 when not found.
 *
 * Used by Source Code mode to resolve a TOC entry (whose order matches the
 * document heading order muya builds the TOC from) to a CodeMirror line.
 */
export function findMarkdownHeadingLine(markdown: string, headingIndex: number): number {
  if (headingIndex < 0) return -1

  const lines = markdown.split('\n')

  // Skip a leading front-matter block (YAML `---`, TOML `+++`, JSON `;;;`).
  // muya parses front matter as its own block type, so getTOC never lists it —
  // counting the closing `---` as a setext heading (the underline regex also
  // matches `---`) shifted every TOC entry by one position.
  let start = 0
  const fmOpen = lines[0]?.match(/^ {0,3}(---|\+\+\+|;;;)\s*$/)
  if (fmOpen) {
    const marker = fmOpen[1]
    const closeRe = marker === '---'
      ? /^ {0,3}(?:---|\.\.\.)\s*$/ // YAML also allows `...` as terminator
      : new RegExp(`^ {0,3}${marker === '+++' ? '\\+\\+\\+' : ';;;'}\\s*$`)
    for (let i = 1; i < lines.length; i++) {
      const l = lines[i]
      if (l !== undefined && closeRe.test(l)) {
        start = i + 1
        break
      }
    }
    // No closing marker: not front matter (just a thematic break line), leave
    // `start` at 0 so the line is scanned as normal content.
  }

  let fence: string | null = null
  let count = 0

  for (let i = start; i < lines.length; i++) {
    const line = lines[i]
    if (line === undefined) continue

    // Fenced code blocks — CommonMark 4.3 rules: the closing fence must use
    // the SAME character, be AT LEAST as long as the opening fence, and carry
    // only trailing whitespace. Naive same-char/any-length matching desyncs on
    // nested fences (e.g. AI-chat exports where ````markdown wraps ``` blocks):
    // the inner ``` was treated as the closing fence, the state machine flipped,
    // and every real heading afterwards was skipped as "inside code" — source
    // TOC jumps all died with index out of range.
    const fenceMatch = line.match(/^ {0,3}(`{3,}|~{3,})(.*)$/)
    if (fenceMatch) {
      const marker = fenceMatch[1]
      const rest = fenceMatch[2] ?? ''
      if (marker !== undefined) {
        if (fence === null) {
          fence = marker
        } else if (marker[0] === fence[0] && marker.length >= fence.length && rest.trim() === '') {
          fence = null
        }
      }
      continue
    }
    if (fence !== null) continue

    // ATX heading.
    if (/^ {0,3}#{1,6}(?:\s|$)/.test(line)) {
      if (count === headingIndex) return i
      count++
      continue
    }

    // Setext heading: a non-blank line immediately followed by an `===`/`---`
    // underline.
    const next = lines[i + 1]
    if (line.trim() !== '' && next !== undefined && /^ {0,3}(?:=+|-+)\s*$/.test(next)) {
      if (count === headingIndex) return i
      count++
      i++ // consume the underline line
    }
  }

  return -1
}
