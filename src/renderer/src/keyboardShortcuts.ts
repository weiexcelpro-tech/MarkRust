// keyboardShortcuts.ts: 全局键盘快捷键处理器。
//
// Tauri 2 原生菜单 .accelerator() 仅在菜单 UI 中显示快捷键标签，
// 不拦截 WebView2 的键盘事件。WebView2 (Chromium) 会先消费键盘事件。
// 因此所有菜单快捷键通过键盘均无法触发。
//
// 本模块提供缺失的 keyboard → command 桥接：
//   用户按键 → keydown(capture) → 查表映射 → handleMenuClick(id)
//   → 与菜单点击走完全相同的分发链路。

import { handleMenuClick } from './menuBridge'

// ---------------------------------------------------------------------------
// Shortcut map: normalized key combo → command ID
//
// Command ID 与 handleMenuClick() 接受的 ID 一致：
//   - 大部分使用 keybindingsWindows.ts 中的 command ID (如 file.save, edit.undo)
//   - Format 菜单项使用 menuBridge 的 FORMAT_MENU_MAP 中的 ID (如 strongMenuItem)
//   - View 模式使用 CHECKBOX_MENU_MAP 中的 ID (如 sourceCodeModeMenuItem)
//   - Layout 使用 LAYOUT_MENU_MAP 中的 ID (如 sideBarMenuItem)
// ---------------------------------------------------------------------------

const SHORTCUT_MAP: Record<string, string> = {
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
  'Ctrl+Z': 'edit.undo',
  'Ctrl+Shift+Z': 'edit.redo',
  'Ctrl+Shift+C': 'edit.copy-as-rich',
  'Ctrl+Shift+V': 'edit.paste-as-plaintext',
  'Ctrl+Alt+D': 'edit.duplicate',
  'Ctrl+Shift+N': 'edit.create-paragraph',
  'Ctrl+Shift+D': 'edit.delete-paragraph',
  'Ctrl+F': 'edit.find',
  'F3': 'edit.find-next',
  'Shift+F3': 'edit.find-previous',
  'Ctrl+R': 'edit.replace',
  'Ctrl+Shift+F': 'edit.find-in-folder',

  // === Paragraph ===
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

  // === View (menuBridge CHECKBOX_MENU_MAP / LAYOUT_MENU_MAP / special IDs) ===
  'Ctrl+Shift+P': 'view.command-palette',
  'Ctrl+E': 'sourceCodeModeMenuItem',
  'Ctrl+Shift+G': 'typewriterModeMenuItem',
  'Ctrl+Shift+J': 'focusModeMenuItem',
  'Ctrl+J': 'sideBarMenuItem',
  'Ctrl+K': 'tocMenuItem',
  'Ctrl+Shift+B': 'tabBarMenuItem',
  'F5': 'view.reload-images',

  // === Window ===
  'Ctrl+M': 'window.minimize',
  'F11': 'window.toggle-full-screen',

  // === Tabs (not in native menu, but in keybindings) ===
  'Ctrl+Tab': 'tabs.cycleForward',
  'Ctrl+Shift+Tab': 'tabs.cycleBackward',
}

// ---------------------------------------------------------------------------
// Normalize a KeyboardEvent into a key combo string matching SHORTCUT_MAP keys.
//
// Format: Modifier+Modifier+Key (e.g. "Ctrl+Shift+Z", "Ctrl+Plus")
// Modifier order: Ctrl, Shift, Alt (matches Electron accelerator format).
//
// Special handling:
//   - "Equal" key (=/+) → always "Plus" (Shift implicit in pressing Plus)
//   - "Minus" key → "Minus" (Shift not a separate modifier)
//   - "Backquote" → "`" (Shift not a separate modifier)
//   - "Comma" → "," (Shift not a separate modifier)
//   - F-keys with Shift → "Shift+F3" etc.
// ---------------------------------------------------------------------------

const IMPLICIT_SHIFT_CODES = new Set(['Equal', 'Minus', 'Backquote', 'Comma', 'NumpadAdd', 'NumpadSubtract'])

function codeToKeyName(code: string): string | null {
  // Letter keys: KeyA → A
  if (code.startsWith('Key')) return code.slice(3)
  // Digit keys: Digit1 → 1
  if (code.startsWith('Digit')) return code.slice(5)
  // Function keys: F1–F24
  if (/^F\d{1,2}$/.test(code)) return code

  switch (code) {
    case 'Equal':       return 'Plus'
    case 'Minus':       return 'Minus'
    case 'NumpadAdd':   return 'Plus'
    case 'NumpadSubtract': return 'Minus'
    case 'Backquote':   return '`'
    case 'Comma':       return ','
    case 'Tab':         return 'Tab'
    case 'Space':       return 'Space'
    default:            return null
  }
}

function buildKeyCombo(e: KeyboardEvent): string | null {
  const parts: string[] = []

  // Ctrl (or Meta on macOS; we don't target macOS but handle it defensively)
  if (e.ctrlKey || e.metaKey) parts.push('Ctrl')

  // Shift: only include as modifier if NOT implicit (e.g. Plus requires Shift
  // on US keyboards, but we normalize Equal→Plus without requiring Shift)
  const includeShift = e.shiftKey && !IMPLICIT_SHIFT_CODES.has(e.code)
  if (includeShift) parts.push('Shift')

  // Alt
  if (e.altKey) parts.push('Alt')

  // Main key
  const keyName = codeToKeyName(e.code)
  if (!keyName) return null

  parts.push(keyName)
  return parts.join('+')
}

// ---------------------------------------------------------------------------
// ALWAYS_FIRE: command IDs that should fire even when focus is in a text input.
//
// When the user is typing in a regular <INPUT>, <TEXTAREA>, or contenteditable
// that is NOT the muya editor (e.g. find/replace bar, preferences dialog),
// most editor-specific shortcuts (bold, italic, heading…) should be skipped so
// native text editing (insertChar, native undo, etc.) works normally.
// But global actions like save, find, switch-tab must still fire.
// ---------------------------------------------------------------------------
const ALWAYS_FIRE = new Set([
  // File — always meaningful
  'file.new-window', 'file.new-tab', 'file.open-file', 'file.open-folder',
  'file.save', 'file.save-as', 'file.export-file-pdf', 'file.print',
  'file.preferences', 'file.close-tab', 'file.close-window', 'file.quit',
  // Edit — find/replace is useful everywhere
  'edit.find', 'edit.find-next', 'edit.find-previous', 'edit.replace', 'edit.find-in-folder',
  // View — layout toggles and mode switches
  'sourceCodeModeMenuItem', 'typewriterModeMenuItem', 'focusModeMenuItem',
  'sideBarMenuItem', 'tocMenuItem', 'tabBarMenuItem',
  'view.command-palette', 'view.reload-images',
  // Window
  'window.minimize', 'window.toggle-full-screen',
  // Tabs
  'tabs.cycleForward', 'tabs.cycleBackward',
])

// ---------------------------------------------------------------------------
// Detect whether the keyboard event target is a "text input" that should block
// editor-specific shortcuts (bold, heading, etc.).
//
// The muya editor uses contenteditable divs inside .mu-editor; those are NOT
// considered "text inputs" — all shortcuts must fire there.
// Regular <INPUT>, <TEXTAREA>, <SELECT>, or a contenteditable outside .mu-editor
// (rare but possible) ARE text inputs.
// ---------------------------------------------------------------------------
function isTextInputTarget(target: HTMLElement): boolean {
  const tag = target.tagName
  if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return true
  // contenteditable inside .mu-editor = the editor itself → not a "text input"
  if (target.isContentEditable) {
    return !target.closest('.mu-editor')
  }
  return false
}

// ---------------------------------------------------------------------------
// Initialization
// ---------------------------------------------------------------------------

export function initKeyboardShortcuts(): void {
  document.addEventListener('keydown', (e: KeyboardEvent) => {
    const target = e.target as HTMLElement | null
    if (!target) return

    const combo = buildKeyCombo(e)
    if (!combo) return

    const commandId = SHORTCUT_MAP[combo]
    if (!commandId) return

    // If focus is in a text input field, only fire ALWAYS_FIRE shortcuts
    if (isTextInputTarget(target) && !ALWAYS_FIRE.has(commandId)) return

    // All intercepted shortcuts: prevent Chromium default + stop propagation
    // to avoid double-handling (e.g. muya's own Ctrl+Z handler, or Chromium's
    // native find bar, bold/italic in contenteditable, etc.)
    e.preventDefault()
    e.stopPropagation()

    console.log('[keyboardShortcuts]', combo, '→', commandId)
    handleMenuClick(commandId)
  }, true) // capture phase — intercept before Chromium/muya handlers
}

console.log('[keyboardShortcuts] module loaded')
