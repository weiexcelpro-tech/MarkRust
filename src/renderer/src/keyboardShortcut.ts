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
 */
const ACCELERATOR_TO_MENU_ID: Record<string, string> = {
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

  'Ctrl+F': 'edit.find',
  F3: 'edit.find-next',
  'Shift+F3': 'edit.find-previous',
  'Ctrl+R': 'edit.replace',
  'Ctrl+Shift+F': 'edit.find-in-folder',
  'Ctrl+Alt+D': 'edit.duplicate',
  'Ctrl+Shift+N': 'edit.create-paragraph',
  'Ctrl+Shift+D': 'edit.delete-paragraph',

  'Ctrl+Shift+P': 'view.command-palette',
  'Ctrl+E': 'sourceCodeModeMenuItem',
  'Ctrl+Shift+G': 'typewriterModeMenuItem',
  'Ctrl+Shift+J': 'focusModeMenuItem',
  'Ctrl+J': 'sideBarMenuItem',
  'Ctrl+Shift+B': 'tabBarMenuItem',
  'Ctrl+K': 'tocMenuItem',
  F5: 'view.reload-images',

  'Ctrl+B': 'strongMenuItem',
  'Ctrl+I': 'emphasisMenuItem',
  'Ctrl+U': 'underlineMenuItem',
  'Ctrl+Shift+H': 'highlightMenuItem',
  'Ctrl+`': 'inlineCodeMenuItem',
  'Ctrl+Shift+M': 'inlineMathMenuItem',
  'Ctrl+D': 'strikeMenuItem',
  'Ctrl+L': 'hyperlinkMenuItem',
  'Ctrl+Shift+I': 'imageMenuItem',
  'Ctrl+Shift+R': 'format.clear-format',

  'Ctrl+M': 'window.minimize',
  F11: 'window.toggle-full-screen',

  'Ctrl+Tab': 'tabs.cycleForward',
  'Ctrl+Shift+Tab': 'tabs.cycleBackward',
}

/**
 * Convert a DOM KeyboardEvent to an Electron-style accelerator string.
 *
 * Produces strings like "Ctrl+B", "Ctrl+Shift+P", "F3", "Shift+F3", "Ctrl+`".
 * Order: Ctrl → Alt → Shift → Super → Key (matches Electron accelerator spec).
 */
const toAccelerator = (e: KeyboardEvent): string => {
  const parts: string[] = []
  if (e.ctrlKey) parts.push('Ctrl')
  if (e.altKey) parts.push('Alt')
  if (e.shiftKey) parts.push('Shift')
  if (e.metaKey) parts.push('Super')

  const key = e.key
  // Skip pure modifier keys (no final key component)
  if (
    key === 'Control' ||
    key === 'Alt' ||
    key === 'Shift' ||
    key === 'Meta'
  ) {
    return ''
  }

  if (key === ' ') {
    parts.push('Space')
  } else if (key.length === 1) {
    // Single-char: uppercase to match accelerator format (e.g. "B" not "b")
    parts.push(key.toUpperCase())
  } else {
    // Multi-char keys: F1-F12, ArrowLeft, Enter, Escape, Backspace, etc.
    parts.push(key)
  }

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
  const tag = target.tagName.toLowerCase()
  if (tag === 'input' || tag === 'textarea') return true
  // contenteditable inside muya editor should NOT be blocked
  if (target.isContentEditable) {
    // Check if we're inside the muya editor container
    const editor = target.closest('.mu-editor')
    if (editor) return false
    return true
  }
  return false
}

/**
 * Keydown handler: converts KeyboardEvent → accelerator → menu dispatch.
 *
 * Uses capture phase to fire BEFORE muya's RxJS bubble-phase handler.
 * On match: preventDefault + stopPropagation to avoid double-handling.
 */
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

  // Suppress shortcuts when typing in preference inputs/dialogs — EXCEPT
  // for a whitelist of shortcuts that should always work (save, find, etc.)
  const ALWAYS_FIRE = new Set([
    'file.save',
    'file.save-as',
    'file.open-file',
    'file.open-folder',
    'file.preferences',
    'file.quit',
    'file.close-tab',
    'file.close-window',
    'edit.find',
    'edit.find-next',
    'edit.find-previous',
    'edit.replace',
    'edit.find-in-folder',
    'view.command-palette',
    // View/layout toggles must fire in ANY context — including inside the
    // source-code editor (textarea/CodeMirror) so the user can Ctrl+E back
    // to render mode. Without this, isTextInputTarget swallows the keydown.
    'sourceCodeModeMenuItem',
    'typewriterModeMenuItem',
    'focusModeMenuItem',
    'sideBarMenuItem',
    'tabBarMenuItem',
    'tocMenuItem',
  ])

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
