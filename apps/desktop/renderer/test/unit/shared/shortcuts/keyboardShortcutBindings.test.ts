import { describe, expect, it } from 'vitest';
import {
  captureKeyboardShortcut,
  formatKeyboardShortcutBinding,
  keyboardEventMatchesBinding,
  normalizeKeyboardShortcutBinding,
} from '../../../../src/shared/shortcuts/keyboardShortcutBindings.js';
import {
  KEYBOARD_SHORTCUT_PLATFORMS,
  keyboardShortcutCommand,
  keyboardShortcutCommands,
} from '../../../../src/shared/shortcuts/keyboardShortcutCommands.js';

describe('keyboard shortcut bindings', () => {
  it('normalizes modifier order and rejects malformed bindings', () => {
    expect(normalizeKeyboardShortcutBinding('Shift+Control+KeyK')).toBe('Control+Shift+KeyK');
    expect(normalizeKeyboardShortcutBinding('Control+Control+KeyK')).toBeNull();
    expect(normalizeKeyboardShortcutBinding('KeyK')).toBeNull();
    expect(normalizeKeyboardShortcutBinding('F12')).toBe('F12');
  });

  it('captures physical key combinations and keeps platform-reserved keys unavailable', () => {
    expect(captureKeyboardShortcut(keyEvent({ code: 'KeyB', metaKey: true, shiftKey: true }), 'darwin'))
      .toEqual({ status: 'captured', binding: 'Shift+Meta+KeyB' });
    expect(captureKeyboardShortcut(keyEvent({ code: 'KeyQ', metaKey: true }), 'darwin'))
      .toEqual({ status: 'invalid', reason: 'reserved' });
    expect(captureKeyboardShortcut(keyEvent({ altKey: true, code: 'F4' }), 'win32'))
      .toEqual({ status: 'invalid', reason: 'reserved' });
    expect(captureKeyboardShortcut(keyEvent({ code: 'Tab', metaKey: true }), 'darwin'))
      .toEqual({ status: 'invalid', reason: 'reserved' });
    expect(captureKeyboardShortcut(keyEvent({ code: 'KeyC', metaKey: true }), 'darwin'))
      .toEqual({ status: 'invalid', reason: 'reserved' });
    expect(captureKeyboardShortcut(keyEvent({ code: 'KeyZ', metaKey: true, shiftKey: true }), 'darwin'))
      .toEqual({ status: 'invalid', reason: 'reserved' });
    expect(captureKeyboardShortcut(keyEvent({ altKey: true, code: 'KeyI', metaKey: true }), 'darwin'))
      .toEqual({ status: 'invalid', reason: 'reserved' });
    expect(captureKeyboardShortcut(keyEvent({ altKey: true, code: 'Space' }), 'win32'))
      .toEqual({ status: 'invalid', reason: 'reserved' });
    expect(captureKeyboardShortcut(keyEvent({ code: 'KeyB', ctrlKey: true, metaKey: true, shiftKey: true }), 'win32'))
      .toEqual({ status: 'invalid', reason: 'reserved' });
    expect(captureKeyboardShortcut(keyEvent({ code: 'KeyA' }), 'win32'))
      .toEqual({ status: 'invalid', reason: 'modifier-required' });
  });

  it('rejects AltGraph so international text input is not intercepted', () => {
    expect(captureKeyboardShortcut({
      ...keyEvent({ altKey: true, code: 'KeyQ', ctrlKey: true }),
      getModifierState: (modifier) => modifier === 'AltGraph',
    }, 'win32')).toEqual({ status: 'invalid', reason: 'alt-graph' });
  });

  it('matches every modifier exactly', () => {
    expect(keyboardEventMatchesBinding(
      keyEvent({ code: 'KeyK', ctrlKey: true }),
      'Control+KeyK',
    )).toBe(true);
    expect(keyboardEventMatchesBinding(
      keyEvent({ code: 'KeyK', ctrlKey: true, shiftKey: true }),
      'Control+KeyK',
    )).toBe(false);
    expect(keyboardEventMatchesBinding({
      ...keyEvent({ altKey: true, code: 'KeyQ', ctrlKey: true }),
      getModifierState: (modifier) => modifier === 'AltGraph',
    }, 'Control+Alt+KeyQ')).toBe(false);
    expect(keyboardEventMatchesBinding({
      ...keyEvent({ altKey: true, code: 'KeyQ', ctrlKey: true }),
      altGraph: true,
    }, 'Control+Alt+KeyQ')).toBe(false);
  });

  it('formats macOS and Windows key names independently', () => {
    expect(formatKeyboardShortcutBinding('Shift+Meta+KeyB', 'darwin')).toBe('⇧⌘B');
    expect(formatKeyboardShortcutBinding('Control+Shift+KeyB', 'win32')).toBe('Ctrl+Shift+B');
    expect(formatKeyboardShortcutBinding('Alt+Comma', 'darwin', true)).toBe('Option + ,');
  });

  it('provides platform-specific defaults for the same command', () => {
    const newChat = keyboardShortcutCommand('app.newChat');
    expect(newChat.defaultBindings.darwin).toEqual(['Meta+KeyN']);
    expect(newChat.defaultBindings.win32).toEqual(['Control+KeyN']);
    expect(newChat.defaultBindings.linux).toEqual(['Control+KeyN']);
    expect(keyboardShortcutCommand('browser.reload').defaultBindings).toEqual({
      darwin: ['Meta+KeyR'],
      linux: ['Control+KeyR'],
      win32: ['Control+KeyR'],
    });
    expect(keyboardShortcutCommand('browser.hardReload').defaultBindings.win32)
      .toEqual(['Control+Shift+KeyR']);
  });

  it('keeps every platform default canonical and conflict-free', () => {
    for (const platform of KEYBOARD_SHORTCUT_PLATFORMS) {
      const owners = new Map<string, string>();
      for (const command of keyboardShortcutCommands) {
        for (const binding of command.defaultBindings[platform]) {
          expect(normalizeKeyboardShortcutBinding(binding)).toBe(binding);
          expect(owners.get(binding), `${platform} ${binding}`).toBeUndefined();
          owners.set(binding, command.id);
        }
      }
    }
  });
});

function keyEvent(overrides: Partial<KeyboardEvent> = {}): KeyboardEvent {
  return {
    altKey: false,
    code: '',
    ctrlKey: false,
    getModifierState: () => false,
    key: '',
    metaKey: false,
    shiftKey: false,
    ...overrides,
  } as KeyboardEvent;
}
