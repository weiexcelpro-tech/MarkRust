// keyboardShortcut.ts: DOM keydown → menuBridge dispatch.
//
// Tauri 2 limitation: menu accelerators do NOT trigger on_menu_event on Windows.
// (macOS works because of NSMenu integration; Windows WebView2 lacks equivalent.)
// Fix: intercept keydown in capture phase, build accelerator string, look up
// menu ID, and call handleMenuClick() — the same path as mouse-clicked menu items.
//
// All accelerators mirror src-tauri/src/commands/menu.rs exactly.
// PredefinedMenuItem (undo/redo/cut/copy/paste/select_all) are handled natively
// by WebView2 and intentionally NOT included here.

import { handleMenuClick } from './menuBridge'
import { isCompositionEvent } from './shims/electron-localshortcut'

/**
 * Accelerator string (e.g. "Ctrl+Shift+P") → menu item ID.
 * Must stay in sync with menu.rs build_*_menu functions.
 *
 * Merged from keyboardShortcuts.ts (System A) — now contains ALL 60 mappings.
 */
const ACCELERATOR_TO_MENU_ID: Record<string, string> = {
  // === File ===
  'Ctrl+N': 'file.new-window',
  'Ctrl+T': 'file.new-tab',
  'Ctrl+O': 'file.open-file',
  'Ctrl+Shift+O': 'file.open-folder',
  'Ctrl+S': 'file.save',
  'Ctrl+Shift+S': 'file.save-as',
  'Ctrl+Alt+E': 'file.export-file-pdf',
  'Ctrl+P': 'file.print',
  'Ctrl+,': 'file.preferences',
  'Ctrl+W': 'file.close-tab',
  'Ctrl+Shift+W': 'file.close-window',
  'Ctrl+Q': 'file.quit',

  // === Edit ===
  'Ctrl+F': 'edit.find',
  'F3': 'edit.find-next',
  'Shift+F3': 'edit.find-previous',
  'Ctrl+R': 'edit.replace',
  'Ctrl+Shift+F': 'edit.find-in-folder',
  'Ctrl+Z': 'edit.undo',
  'Ctrl+Shift+Z': 'edit.redo',
  'Ctrl+Shift+C': 'edit.copy-as-rich',
  'Ctrl+Shift+V': 'edit.paste-as-plaintext',
  'Ctrl+Alt+D': 'edit.duplicate',
  'Ctrl+Shift+N': 'edit.create-paragraph',
  'Ctrl+Shift+D': 'edit.delete-paragraph',

  // === Paragraph (previously missing — added from System A) ===
  'Ctrl+Plus': 'paragraph.upgrade-heading',
  'Ctrl+Minus': 'paragraph.degrade-heading',
  'Ctrl+Shift+T': 'paragraph.table',
  'Ctrl+Shift+K': 'paragraph.code-fence',
  'Ctrl+Shift+Q': 'paragraph.quote-block',
  'Ctrl+Alt+N': 'paragraph.math-formula',
  'Ctrl+Alt+H': 'paragraph.html-block',
  'Ctrl+G': 'paragraph.order-list',
  'Ctrl+H': 'paragraph.bullet-list',
  'Ctrl+Alt+X': 'paragraph.task-list',
  'Ctrl+Alt+L': 'paragraph.loose-list-item',
  'Ctrl+Shift+0': 'paragraph.paragraph',
  'Ctrl+Shift+U': 'paragraph.horizontal-line',
  'Ctrl+Alt+Y': 'paragraph.front-matter',

  // === View ===
  'Ctrl+Shift+P': 'view.command-palette',
  'Ctrl+E': 'sourceCodeModeMenuItem',
  'Ctrl+Shift+G': 'typewriterModeMenuItem',
  'Ctrl+Shift+J': 'focusModeMenuItem',
  'Ctrl+J': 'sideBarMenuItem',
  'Ctrl+Shift+B': 'tabBarMenuItem',
  'Ctrl+K': 'tocMenuItem',
  'F5': 'view.reload-images',

  // === Format (menuBridge FORMAT_MENU_MAP IDs) ===
  'Ctrl+B': 'strongMenuItem',
  'Ctrl+I': 'emphasisMenuItem',
  'Ctrl+U': 'underlineMenuItem',
  'Ctrl+Shift+H': 'highlightMenuItem',
  'Ctrl+`': 'inlineCodeMenuItem',
  'Ctrl+Shift+M': 'inlineMathMenuItem',
  'Ctrl+D': 'strikeMenuItem',
  'Ctrl+L': 'hyperlinkMenuItem',
  'Ctrl+Shift+I': 'imageMenuItem',
  'Ctrl+Shift+R': 'clearFormatMenuItem',

  // === Window ===
  'Ctrl+M': 'window.minimize',
  'F11': 'window.toggle-full-screen',

  // === Tabs ===
  'Ctrl+Tab': 'tabs.cycleForward',
  'Ctrl+Shift+Tab': 'tabs.cycleBackward',
}

/**
 * Keys whose physical `e.code` implies Shift is already pressed on US keyboards.
 * For these, we normalize away Shift so the accelerator string matches
 * the map (e.g. Ctrl+Shift+Equal → "Ctrl+Plus", NOT "Ctrl+Shift+Plus").
 */
const IMPLICIT_SHIFT_CODES = new Set(['Equal', 'Minus', 'Backquote', 'Comma', 'NumpadAdd', 'NumpadSubtract'])

/**
 * Convert a physical key code to the key name used in our accelerator map.
 *
 * Uses `e.code` (physical key position, layout-independent) instead of
 * `e.key` (logical character, layout-dependent) so that:
 *   - Equal → "Plus" (regardless of keyboard layout)
 *   - Minus → "Minus"
 *   - Digit0 → "0"
 *   - KeyA → "A"
 *
 * This is ported from System A (keyboardShortcuts.ts) to fix the key-name
 * mismatch that caused Ctrl+Plus/Minus/Shift+0 to never match.
 */
const codeToKeyName = (code: string): string | null => {
  // Letter keys: KeyA → A
  if (code.startsWith('Key')) return code.slice(3)
  // Digit keys: Digit1 → 1
  if (code.startsWith('Digit')) return code.slice(5)
  // Function keys: F1–F24
  if (/^F\d{1,2}$/.test(code)) return code

  switch (code) {
    case 'Equal':         return 'Plus'
    case 'Minus':         return 'Minus'
    case 'NumpadAdd':     return 'Plus'
    case 'NumpadSubtract': return 'Minus'
    case 'Backquote':     return '`'
    case 'Comma':         return ','
    case 'Tab':           return 'Tab'
    case 'Space':         return 'Space'
    default:              return null
  }
}

/**
 * Convert a DOM KeyboardEvent to an Electron-style accelerator string.
 *
 * Now uses `e.code` (physical key) via `codeToKeyName()` so that:
 *   - Ctrl+= (US: Equal) → "Ctrl+Plus"  (matches map)
 *   - Ctrl+- (Minus)     → "Ctrl+Minus"  (matches map)
 *   - Ctrl+Shift+0      → "Ctrl+Shift+0" (matches map)
 *   - Ctrl+B            → "Ctrl+B"
 *   - F3 / Shift+F3     → "F3" / "Shift+F3"
 *
 * Modifier order: Ctrl → Alt → Shift → Key (matches Electron accelerator spec).
 * Shift is omitted when the physical key is in IMPLICIT_SHIFT_CODES
 * (e.g. pressing Equal with Shift gives "+", but we normalize to "Plus"
 * without the extra Shift modifier).
 */
const toAccelerator = (e: KeyboardEvent): string => {
  const parts: string[] = []
  if (e.ctrlKey || e.metaKey) parts.push('Ctrl')

  // Shift: only include as modifier if NOT implicit
  const includeShift = e.shiftKey && !IMPLICIT_SHIFT_CODES.has(e.code)
  if (includeShift) parts.push('Shift')

  if (e.altKey) parts.push('Alt')

  // Main key: use physical code for layout-independent mapping
  const keyName = codeToKeyName(e.code)
  if (!keyName) return ''

  parts.push(keyName)
  return parts.join('+')
}

/**
 * Check if the keyboard event target is inside a text-editing element where
 * most shortcuts should be suppressed (settings inputs, dialog text fields).
 *
 * Format shortcuts (Ctrl+B/I/U etc.) SHOULD still fire in the editor itself
 * (which is a contenteditable or muya-managed element), so we only block
 * <input>, <textarea>, and [contenteditable] outside of muya's editor.
 */
const isTextInputTarget = (target: EventTarget | null): boolean => {
  if (!(target instanceof HTMLElement)) return false
  const tag = target.tagName
  if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return true
  // contenteditable inside muya editor should NOT be blocked
  if (target.isContentEditable) {
    return !target.closest('.mu-editor')
  }
  return false
}

/**
 * Keydown handler: converts KeyboardEvent → accelerator → menu dispatch.
 *
 * Uses capture phase to fire BEFORE muya's RxJS bubble-phase handler.
 * On match: preventDefault + stopPropagation to avoid double-handling.
 */
const ALWAYS_FIRE = new Set([
  // File — always meaningful
  'file.new-window', 'file.new-tab', 'file.open-file', 'file.open-folder',
  'file.save', 'file.save-as', 'file.export-file-pdf', 'file.print',
  'file.preferences', 'file.close-tab', 'file.close-window', 'file.quit',
  // Edit — find/replace is useful everywhere
  'edit.find', 'edit.find-next', 'edit.find-previous', 'edit.replace', 'edit.find-in-folder',
  // View — layout toggles and mode switches (must work in CodeMirror textarea too)
  'sourceCodeModeMenuItem', 'typewriterModeMenuItem', 'focusModeMenuItem',
  'sideBarMenuItem', 'tocMenuItem', 'tabBarMenuItem',
  'view.command-palette', 'view.reload-images',
  // Window
  'window.minimize', 'window.toggle-full-screen',
  // Tabs
  'tabs.cycleForward', 'tabs.cycleBackward',
])

const onKeyDown = (event: KeyboardEvent): void => {
  // Skip IME composition (Chinese/Japanese/Korean input)
  if (isCompositionEvent(event)) return

  const accelerator = toAccelerator(event)
  if (!accelerator) return

  const menuId = ACCELERATOR_TO_MENU_ID[accelerator]
  if (!menuId) return

  // For text-editing shortcuts that the browser/WebView2 handles natively
  // (Ctrl+B/I/U for rich text editing), we must preventDefault to stop
  // the browser from applying its own formatting AND stopPropagation to
  // prevent muya from receiving a stale keydown.
  //
  // For non-editing shortcuts (Ctrl+S/O/F etc.), preventDefault stops the
  // browser default (e.g. Ctrl+S would trigger browser save dialog).
  event.preventDefault()
  event.stopPropagation()

  if (isTextInputTarget(event.target) && !ALWAYS_FIRE.has(menuId)) {
    return
  }

  console.log('[keyboardShortcut] dispatch:', accelerator, '→', menuId)
  handleMenuClick(menuId)
}

/**
 * Register the global keyboard shortcut listener.
 * Call once during renderer initialization.
 *
 * Uses capture phase (third arg = true) to intercept before muya's handlers.
 */
export const setupKeyboardShortcuts = (): void => {
  window.addEventListener('keydown', onKeyDown, true)
  console.log(
    '[keyboardShortcut] registered',
    Object.keys(ACCELERATOR_TO_MENU_ID).length,
    'accelerators'
  )
}

export default setupKeyboardShortcuts
