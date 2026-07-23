/**
 * 全量快捷键单元测试 — 覆盖 ACCELERATOR_TO_MENU_ID 中所有 60+ 个映射。
 *
 * 测试策略：对每个 (acceleratorString, menuId) 对，模拟对应的 KeyboardEvent，
 * 验证 handleMenuClick 被调用且参数正确。如果 toAccelerator() 对某些物理键
 * 生成与映射表不匹配的字符串，此测试会立即暴露。
 *
 * 同时验证：
 * - IME 组合事件被过滤
 * - 修饰键独按不分发
 * - 未知快捷键不分发
 * - ALWAYS_FIRE 白名单在 <input> 中仍然触发
 * - 非 ALWAYS_FIRE 在 <input> 中被抑制
 */

/* eslint-disable @typescript-eslint/no-explicit-any */
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'

const handleMenuClickMock = vi.hoisted(() => vi.fn())
vi.mock('../../src/renderer/src/menuBridge', () => ({
  handleMenuClick: (...args: unknown[]) => handleMenuClickMock(...args),
}))

vi.mock('../../src/renderer/src/shims/electron-localshortcut', () => ({
  isCompositionEvent: (e: KeyboardEvent) =>
    e.isComposing === true || e.keyCode === 229,
}))

import { setupKeyboardShortcuts } from '../../src/renderer/src/keyboardShortcut'

const fireKeydown = (init: Partial<KeyboardEvent> & { target?: EventTarget }): KeyboardEvent => {
  const target = init.target ?? document.body
  const event = new KeyboardEvent('keydown', {
    key: init.key ?? '',
    code: init.code ?? '',
    ctrlKey: init.ctrlKey ?? false,
    altKey: init.altKey ?? false,
    shiftKey: init.shiftKey ?? false,
    metaKey: init.metaKey ?? false,
    keyCode: init.keyCode ?? 0,
    isComposing: init.isComposing ?? false,
    bubbles: true,
    cancelable: true,
  })
  Object.defineProperty(event, 'target', { value: target, writable: false })
  document.dispatchEvent(event)
  return event
}

beforeAll(() => {
  setupKeyboardShortcuts()
})

afterEach(() => {
  handleMenuClickMock.mockClear()
})

// ─── 全量映射测试 ───
// 每个条目：[描述, 模拟按键参数, 期望的 menuId]

const ALL_SHORTCUTS: Array<[string, Partial<KeyboardEvent>, string]> = [
  // ── File ──
  ['Ctrl+N → file.new-window', { key: 'n', code: 'KeyN', ctrlKey: true }, 'file.new-window'],
  ['Ctrl+T → file.new-tab', { key: 't', code: 'KeyT', ctrlKey: true }, 'file.new-tab'],
  ['Ctrl+O → file.open-file', { key: 'o', code: 'KeyO', ctrlKey: true }, 'file.open-file'],
  ['Ctrl+Shift+O → file.open-folder', { key: 'O', code: 'KeyO', ctrlKey: true, shiftKey: true }, 'file.open-folder'],
  ['Ctrl+S → file.save', { key: 's', code: 'KeyS', ctrlKey: true }, 'file.save'],
  ['Ctrl+Shift+S → file.save-as', { key: 'S', code: 'KeyS', ctrlKey: true, shiftKey: true }, 'file.save-as'],
  ['Ctrl+Alt+E → file.export-file-pdf', { key: 'e', code: 'KeyE', ctrlKey: true, altKey: true }, 'file.export-file-pdf'],
  ['Ctrl+P → file.print', { key: 'p', code: 'KeyP', ctrlKey: true }, 'file.print'],
  ['Ctrl+, → file.preferences', { key: ',', code: 'Comma', ctrlKey: true }, 'file.preferences'],
  ['Ctrl+W → file.close-tab', { key: 'w', code: 'KeyW', ctrlKey: true }, 'file.close-tab'],
  ['Ctrl+Shift+W → file.close-window', { key: 'W', code: 'KeyW', ctrlKey: true, shiftKey: true }, 'file.close-window'],
  ['Ctrl+Q → file.quit', { key: 'q', code: 'KeyQ', ctrlKey: true }, 'file.quit'],

  // ── Edit ──
  ['Ctrl+F → edit.find', { key: 'f', code: 'KeyF', ctrlKey: true }, 'edit.find'],
  ['F3 → edit.find-next', { key: 'F3', code: 'F3' }, 'edit.find-next'],
  ['Shift+F3 → edit.find-previous', { key: 'F3', code: 'F3', shiftKey: true }, 'edit.find-previous'],
  ['Ctrl+R → edit.replace', { key: 'r', code: 'KeyR', ctrlKey: true }, 'edit.replace'],
  ['Ctrl+Shift+F → edit.find-in-folder', { key: 'F', code: 'KeyF', ctrlKey: true, shiftKey: true }, 'edit.find-in-folder'],
  ['Ctrl+Alt+D → edit.duplicate', { key: 'd', code: 'KeyD', ctrlKey: true, altKey: true }, 'edit.duplicate'],
  ['Ctrl+Shift+N → edit.create-paragraph', { key: 'N', code: 'KeyN', ctrlKey: true, shiftKey: true }, 'edit.create-paragraph'],
  ['Ctrl+Shift+D → edit.delete-paragraph', { key: 'D', code: 'KeyD', ctrlKey: true, shiftKey: true }, 'edit.delete-paragraph'],

  // ── Paragraph (系统 B 原本缺失，修复后应生效) ──
  ['Ctrl+Plus → paragraph.upgrade-heading', { key: '+', code: 'Equal', ctrlKey: true }, 'paragraph.upgrade-heading'],
  ['Ctrl+Minus → paragraph.degrade-heading', { key: '-', code: 'Minus', ctrlKey: true }, 'paragraph.degrade-heading'],
  ['Ctrl+Shift+T → paragraph.table', { key: 'T', code: 'KeyT', ctrlKey: true, shiftKey: true }, 'paragraph.table'],
  ['Ctrl+Shift+K → paragraph.code-fence', { key: 'K', code: 'KeyK', ctrlKey: true, shiftKey: true }, 'paragraph.code-fence'],
  ['Ctrl+Shift+Q → paragraph.quote-block', { key: 'Q', code: 'KeyQ', ctrlKey: true, shiftKey: true }, 'paragraph.quote-block'],
  ['Ctrl+Alt+N → paragraph.math-formula', { key: 'n', code: 'KeyN', ctrlKey: true, altKey: true }, 'paragraph.math-formula'],
  ['Ctrl+Alt+H → paragraph.html-block', { key: 'h', code: 'KeyH', ctrlKey: true, altKey: true }, 'paragraph.html-block'],
  ['Ctrl+G → paragraph.order-list', { key: 'g', code: 'KeyG', ctrlKey: true }, 'paragraph.order-list'],
  ['Ctrl+H → paragraph.bullet-list', { key: 'h', code: 'KeyH', ctrlKey: true }, 'paragraph.bullet-list'],
  ['Ctrl+Alt+X → paragraph.task-list', { key: 'x', code: 'KeyX', ctrlKey: true, altKey: true }, 'paragraph.task-list'],
  ['Ctrl+Alt+L → paragraph.loose-list-item', { key: 'l', code: 'KeyL', ctrlKey: true, altKey: true }, 'paragraph.loose-list-item'],
  ['Ctrl+Shift+0 → paragraph.paragraph', { key: '0', code: 'Digit0', ctrlKey: true, shiftKey: true }, 'paragraph.paragraph'],
  ['Ctrl+Shift+U → paragraph.horizontal-line', { key: 'U', code: 'KeyU', ctrlKey: true, shiftKey: true }, 'paragraph.horizontal-line'],
  ['Ctrl+Alt+Y → paragraph.front-matter', { key: 'y', code: 'KeyY', ctrlKey: true, altKey: true }, 'paragraph.front-matter'],

  // ── Format ──
  ['Ctrl+B → strongMenuItem', { key: 'b', code: 'KeyB', ctrlKey: true }, 'strongMenuItem'],
  ['Ctrl+I → emphasisMenuItem', { key: 'i', code: 'KeyI', ctrlKey: true }, 'emphasisMenuItem'],
  ['Ctrl+U → underlineMenuItem', { key: 'u', code: 'KeyU', ctrlKey: true }, 'underlineMenuItem'],
  ['Ctrl+Shift+H → highlightMenuItem', { key: 'H', code: 'KeyH', ctrlKey: true, shiftKey: true }, 'highlightMenuItem'],
  ['Ctrl+` → inlineCodeMenuItem', { key: '`', code: 'Backquote', ctrlKey: true }, 'inlineCodeMenuItem'],
  ['Ctrl+Shift+M → inlineMathMenuItem', { key: 'M', code: 'KeyM', ctrlKey: true, shiftKey: true }, 'inlineMathMenuItem'],
  ['Ctrl+D → strikeMenuItem', { key: 'd', code: 'KeyD', ctrlKey: true }, 'strikeMenuItem'],
  ['Ctrl+L → hyperlinkMenuItem', { key: 'l', code: 'KeyL', ctrlKey: true }, 'hyperlinkMenuItem'],
  ['Ctrl+Shift+I → imageMenuItem', { key: 'I', code: 'KeyI', ctrlKey: true, shiftKey: true }, 'imageMenuItem'],
  ['Ctrl+Shift+R → clearFormatMenuItem', { key: 'R', code: 'KeyR', ctrlKey: true, shiftKey: true }, 'clearFormatMenuItem'],

  // ── View ──
  ['Ctrl+Shift+P → view.command-palette', { key: 'P', code: 'KeyP', ctrlKey: true, shiftKey: true }, 'view.command-palette'],
  ['Ctrl+E → sourceCodeModeMenuItem', { key: 'e', code: 'KeyE', ctrlKey: true }, 'sourceCodeModeMenuItem'],
  ['Ctrl+Shift+G → typewriterModeMenuItem', { key: 'G', code: 'KeyG', ctrlKey: true, shiftKey: true }, 'typewriterModeMenuItem'],
  ['Ctrl+Shift+J → focusModeMenuItem', { key: 'J', code: 'KeyJ', ctrlKey: true, shiftKey: true }, 'focusModeMenuItem'],
  ['Ctrl+J → sideBarMenuItem', { key: 'j', code: 'KeyJ', ctrlKey: true }, 'sideBarMenuItem'],
  ['Ctrl+Shift+B → tabBarMenuItem', { key: 'B', code: 'KeyB', ctrlKey: true, shiftKey: true }, 'tabBarMenuItem'],
  ['Ctrl+K → tocMenuItem', { key: 'k', code: 'KeyK', ctrlKey: true }, 'tocMenuItem'],
  ['F5 → view.reload-images', { key: 'F5', code: 'F5' }, 'view.reload-images'],

  // ── Window ──
  ['Ctrl+M → window.minimize', { key: 'm', code: 'KeyM', ctrlKey: true }, 'window.minimize'],
  ['F11 → window.toggle-full-screen', { key: 'F11', code: 'F11' }, 'window.toggle-full-screen'],

  // ── Tabs ──
  ['Ctrl+Tab → tabs.cycleForward', { key: 'Tab', code: 'Tab', ctrlKey: true }, 'tabs.cycleForward'],
  ['Ctrl+Shift+Tab → tabs.cycleBackward', { key: 'Tab', code: 'Tab', ctrlKey: true, shiftKey: true }, 'tabs.cycleBackward'],
]

describe('keyboardShortcut — 全量快捷键映射测试', () => {
  // 统计通过/失败，最后汇总
  const results: Array<{ name: string; ok: boolean }> = []

  afterAll(() => {
    const passed = results.filter(r => r.ok).length
    const failed = results.filter(r => !r.ok).length
    console.log(`\n${'='.repeat(60)}`)
    console.log(`全量快捷键测试: ${passed}/${results.length} passed`)
    if (failed > 0) {
      console.log('失败列表:')
      results.filter(r => !r.ok).forEach(r => console.log(`  ❌ ${r.name}`))
    }
  })

  for (const [desc, keyInit, expectedId] of ALL_SHORTCUTS) {
    it(desc, () => {
      fireKeydown(keyInit)
      const ok = handleMenuClickMock.mock.calls.length > 0 &&
        handleMenuClickMock.mock.calls[0][0] === expectedId
      results.push({ name: desc, ok })
      expect(handleMenuClickMock).toHaveBeenCalledWith(expectedId)
    })
  }
})

describe('keyboardShortcut — 防护逻辑', () => {
  it('IME 组合事件不分发', () => {
    fireKeydown({ key: 's', ctrlKey: true, isComposing: true })
    expect(handleMenuClickMock).not.toHaveBeenCalled()
  })

  it('单独修饰键不分发', () => {
    fireKeydown({ key: 'Control', code: 'ControlLeft', ctrlKey: true })
    expect(handleMenuClickMock).not.toHaveBeenCalled()
  })

  it('未知快捷键不分发 (Ctrl+X 不在映射表中)', () => {
    fireKeydown({ key: 'x', code: 'KeyX', ctrlKey: true })
    expect(handleMenuClickMock).not.toHaveBeenCalled()
  })

  it('匹配时调用 preventDefault', () => {
    const event = fireKeydown({ key: 's', code: 'KeyS', ctrlKey: true })
    expect(event.defaultPrevented).toBe(true)
  })

  it('不匹配时不调用 preventDefault', () => {
    const event = fireKeydown({ key: 'x', code: 'KeyX', ctrlKey: true })
    expect(event.defaultPrevented).toBe(false)
  })
})

describe('keyboardShortcut — 文本输入抑制', () => {
  it('<input> 中抑制格式快捷键 (Ctrl+B)', () => {
    const input = document.createElement('input')
    document.body.appendChild(input)
    fireKeydown({ key: 'b', code: 'KeyB', ctrlKey: true, target: input })
    expect(handleMenuClickMock).not.toHaveBeenCalled()
    document.body.removeChild(input)
  })

  it('<input> 中允许白名单快捷键 (Ctrl+S)', () => {
    const input = document.createElement('input')
    document.body.appendChild(input)
    fireKeydown({ key: 's', code: 'KeyS', ctrlKey: true, target: input })
    expect(handleMenuClickMock).toHaveBeenCalledWith('file.save')
    document.body.removeChild(input)
  })

  it('<input> 中允许查找快捷键 (Ctrl+F)', () => {
    const input = document.createElement('input')
    document.body.appendChild(input)
    fireKeydown({ key: 'f', code: 'KeyF', ctrlKey: true, target: input })
    expect(handleMenuClickMock).toHaveBeenCalledWith('edit.find')
    document.body.removeChild(input)
  })

  it('<input> 中允许替换快捷键 (Ctrl+R)', () => {
    const input = document.createElement('input')
    document.body.appendChild(input)
    fireKeydown({ key: 'r', code: 'KeyR', ctrlKey: true, target: input })
    expect(handleMenuClickMock).toHaveBeenCalledWith('edit.replace')
    document.body.removeChild(input)
  })
})
