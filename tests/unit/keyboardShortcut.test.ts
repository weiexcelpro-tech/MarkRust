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

describe('keyboardShortcut — accelerator dispatch', () => {
  it('Ctrl+S → file.save', () => {
    fireKeydown({ key: 's', code: 'KeyS', ctrlKey: true })
    expect(handleMenuClickMock).toHaveBeenCalledWith('file.save')
  })

  it('Ctrl+B → strongMenuItem (format)', () => {
    fireKeydown({ key: 'b', code: 'KeyB', ctrlKey: true })
    expect(handleMenuClickMock).toHaveBeenCalledWith('strongMenuItem')
  })

  it('Ctrl+Shift+P → view.command-palette', () => {
    fireKeydown({ key: 'p', code: 'KeyP', ctrlKey: true, shiftKey: true })
    expect(handleMenuClickMock).toHaveBeenCalledWith('view.command-palette')
  })

  it('Ctrl+O → file.open-file', () => {
    fireKeydown({ key: 'o', code: 'KeyO', ctrlKey: true })
    expect(handleMenuClickMock).toHaveBeenCalledWith('file.open-file')
  })

  it('Ctrl+Shift+S → file.save-as', () => {
    fireKeydown({ key: 's', code: 'KeyS', ctrlKey: true, shiftKey: true })
    expect(handleMenuClickMock).toHaveBeenCalledWith('file.save-as')
  })

  it('Ctrl+` → inlineCodeMenuItem', () => {
    fireKeydown({ key: '`', code: 'Backquote', ctrlKey: true })
    expect(handleMenuClickMock).toHaveBeenCalledWith('inlineCodeMenuItem')
  })

  it('F3 → edit.find-next (no modifiers)', () => {
    fireKeydown({ key: 'F3', code: 'F3' })
    expect(handleMenuClickMock).toHaveBeenCalledWith('edit.find-next')
  })

  it('Shift+F3 → edit.find-previous', () => {
    fireKeydown({ key: 'F3', code: 'F3', shiftKey: true })
    expect(handleMenuClickMock).toHaveBeenCalledWith('edit.find-previous')
  })

  it('Ctrl+, → file.preferences', () => {
    fireKeydown({ key: ',', code: 'Comma', ctrlKey: true })
    expect(handleMenuClickMock).toHaveBeenCalledWith('file.preferences')
  })
})

describe('keyboardShortcut — guard clauses', () => {
  it('skips IME composition events', () => {
    fireKeydown({ key: 's', ctrlKey: true, isComposing: true })
    expect(handleMenuClickMock).not.toHaveBeenCalled()
  })

  it('skips modifier-only keydown (Ctrl alone)', () => {
    fireKeydown({ key: 'Control', code: 'ControlLeft', ctrlKey: true })
    expect(handleMenuClickMock).not.toHaveBeenCalled()
  })

  it('skips unknown accelerators (Ctrl+X not in map)', () => {
    fireKeydown({ key: 'x', code: 'KeyX', ctrlKey: true })
    expect(handleMenuClickMock).not.toHaveBeenCalled()
  })

  it('does not dispatch for plain letter without modifiers', () => {
    fireKeydown({ key: 'b', code: 'KeyB' })
    expect(handleMenuClickMock).not.toHaveBeenCalled()
  })
})

describe('keyboardShortcut — preventDefault on match', () => {
  it('calls preventDefault when shortcut matches', () => {
    const event = fireKeydown({ key: 's', code: 'KeyS', ctrlKey: true })
    expect(event.defaultPrevented).toBe(true)
  })

  it('does not preventDefault for non-matching key', () => {
    const event = fireKeydown({ key: 'x', code: 'KeyX', ctrlKey: true })
    expect(event.defaultPrevented).toBe(false)
  })
})

describe('keyboardShortcut — text input suppression', () => {
  it('suppresses format shortcuts in <input> elements', () => {
    const input = document.createElement('input')
    document.body.appendChild(input)
    fireKeydown({ key: 'b', code: 'KeyB', ctrlKey: true, target: input })
    expect(handleMenuClickMock).not.toHaveBeenCalled()
    document.body.removeChild(input)
  })

  it('allows whitelisted shortcuts in <input> (Ctrl+S)', () => {
    const input = document.createElement('input')
    document.body.appendChild(input)
    fireKeydown({ key: 's', code: 'KeyS', ctrlKey: true, target: input })
    expect(handleMenuClickMock).toHaveBeenCalledWith('file.save')
    document.body.removeChild(input)
  })
})
