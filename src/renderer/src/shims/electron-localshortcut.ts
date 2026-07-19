// @hfelix/electron-localshortcut shim：Tauri 无 Electron globalShortcut 等价物。
// 渲染层仅用到键盘工具函数（isCompositionEvent/isValidElectronAccelerator/
// getAcceleratorFromKeyboardEvent）和布局通知（setKeyboardLayout）。
// 键盘工具从原包源码提取（纯 JS，不涉及 Electron），布局通知 noop。

// ── isCompositionEvent ──（源码：event-helper.js）
// keyCode 229 = IME composition marker（已废弃但最可靠的 IME 检测方式）
export const isCompositionEvent = (keyboardEvent: KeyboardEvent): boolean => {
  return keyboardEvent.isComposing || (keyboardEvent.keyCode === 229 && keyboardEvent.key !== 'Dead')
}

// ── isValidElectronAccelerator ──（源码：convert-accelerator.js）
const MODIFIERS = /^(Command|Cmd|Control|Ctrl|CommandOrControl|CmdOrCtrl|Alt|Option|AltGr|Shift|Super|Meta)$/
const KEY_CODES = /^([0-9A-Z)!@#$%^&*(:+<_>?}{|"';,./~`-]|[a-z]|[A-Z0-9]{1,2})$/

export const isValidElectronAccelerator = (accelerator: string): boolean => {
  if (!accelerator) {
    return false
  }
  const parts = accelerator.split('+')
  let keyFound = false
  return parts.every((val, index) => {
    const isKey = KEY_CODES.test(val)
    const isModifier = MODIFIERS.test(val)
    if (isKey) {
      if (keyFound) {
        return false
      }
      keyFound = true
    }
    if (index === parts.length - 1 && !keyFound) {
      return false
    }
    return isKey || isModifier
  })
}

// ── getAcceleratorFromKeyboardEvent ──（简化版，完整版依赖 atom-keymap）
// 从 DOM KeyboardEvent 提取 Electron accelerator 字符串。
// 完整实现见原包 atom-keymap/，此处提供简化版用于 preference keybinding 录制。
export const getAcceleratorFromKeyboardEvent = (keyboardEvent: KeyboardEvent): {
  accelerator: string
  isValid: boolean
} => {
  const parts: string[] = []
  if (keyboardEvent.ctrlKey) parts.push('Ctrl')
  if (keyboardEvent.altKey) parts.push('Alt')
  if (keyboardEvent.shiftKey) parts.push('Shift')
  if (keyboardEvent.metaKey) parts.push('Super')

  const key = keyboardEvent.key
  if (key && key.length === 1) {
    parts.push(key.toUpperCase())
  } else if (key && key !== 'Control' && key !== 'Alt' && key !== 'Shift' && key !== 'Meta') {
    // 功能键（F1-F12、Arrow、Enter 等）原样保留
    parts.push(key)
  }

  const accelerator = parts.join('+')
  return { accelerator, isValid: isValidElectronAccelerator(accelerator) }
}

// ── 布局通知（noop，Tauri 无全局快捷键系统）──
export const setKeyboardLayout = (): void => {}
export const onKeyboardLayoutChange = (): (() => void) => () => {}
export const getCurrentKeyboardLayout = (): string => ''
export const getKeyMap = (): Record<string, string> => ({})

export default {
  isCompositionEvent,
  isValidElectronAccelerator,
  getAcceleratorFromKeyboardEvent,
  setKeyboardLayout,
  onKeyboardLayoutChange,
  getCurrentKeyboardLayout,
  getKeyMap
}
