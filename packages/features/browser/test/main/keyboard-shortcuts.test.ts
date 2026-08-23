import type { Input } from 'electron';
import { describe, expect, it } from 'vitest';
import { embeddedBrowserKeyboardShortcut } from '../../src/main/keyboard-shortcuts.js';

describe('embedded browser keyboard shortcuts', () => {
  it('forwards only bindings currently active in the host renderer', () => {
    const shortcut = embeddedBrowserKeyboardShortcut(
      keyInput({ code: 'KeyB', control: true, shift: true }),
      new Set(['Control+Shift+KeyB']),
    );

    expect(shortcut).toEqual({
      binding: 'Control+Shift+KeyB',
      input: {
        altGraph: false,
        altKey: false,
        code: 'KeyB',
        ctrlKey: true,
        isComposing: false,
        key: 'b',
        metaKey: false,
        repeat: false,
        shiftKey: true,
      },
    });
    expect(embeddedBrowserKeyboardShortcut(
      keyInput({ code: 'KeyB', control: true }),
      new Set(['Control+Shift+KeyB']),
    )).toBeNull();
  });

  it('does not intercept repeats, composition, or AltGraph text input', () => {
    const activeBindings = new Set(['Control+Alt+KeyQ']);

    expect(embeddedBrowserKeyboardShortcut(
      keyInput({ alt: true, code: 'KeyQ', control: true, isAutoRepeat: true }),
      activeBindings,
    )).toBeNull();
    expect(embeddedBrowserKeyboardShortcut(
      keyInput({ alt: true, code: 'KeyQ', control: true, isComposing: true }),
      activeBindings,
    )).toBeNull();
    expect(embeddedBrowserKeyboardShortcut(
      keyInput({ alt: true, code: 'KeyQ', control: true, modifiers: ['altgr'] as Input['modifiers'] }),
      activeBindings,
    )).toBeNull();
  });
});

function keyInput(overrides: Partial<Input> = {}): Input {
  return {
    alt: false,
    code: '',
    control: false,
    isAutoRepeat: false,
    isComposing: false,
    key: 'b',
    location: 0,
    meta: false,
    modifiers: [],
    shift: false,
    type: 'keyDown',
    ...overrides,
  };
}
