import type { Input } from 'electron';
import { describe, expect, it } from 'vitest';
import { embeddedBrowserKeyboardShortcut } from '../../src/main/keyboard-shortcuts.js';

describe('embedded browser keyboard shortcuts', () => {
  it('forwards only bindings currently active in the host renderer', () => {
    const shortcut = embeddedBrowserKeyboardShortcut(
      keyInput({ code: 'KeyR', control: true, key: 'r' }),
      new Set(['Control+KeyR']),
      { kind: 'embedded-browser', tabId: 'bottom-browser' },
    );

    expect(shortcut).toEqual({
      binding: 'Control+KeyR',
      input: {
        altGraph: false,
        altKey: false,
        code: 'KeyR',
        ctrlKey: true,
        isComposing: false,
        key: 'r',
        metaKey: false,
        repeat: false,
        shiftKey: false,
        source: {
          kind: 'embedded-browser',
          tabId: 'bottom-browser',
        },
      },
    });
    expect(embeddedBrowserKeyboardShortcut(
      keyInput({ code: 'KeyR', control: true, key: 'r', shift: true }),
      new Set(['Control+KeyR']),
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
