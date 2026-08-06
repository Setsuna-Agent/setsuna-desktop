import { describe, expect, it, vi } from 'vitest';
import {
  KEYBOARD_SHORTCUTS_STORAGE_KEY,
  normalizeKeyboardShortcutPreferences,
  readKeyboardShortcutPreferences,
  resetKeyboardShortcutCommandPreferences,
  writeKeyboardShortcutPreferences,
} from '../../../../src/shared/shortcuts/KeyboardShortcutsProvider.js';

describe('keyboard shortcut preferences', () => {
  it('preserves explicit unbound commands and normalizes valid overrides', () => {
    expect(normalizeKeyboardShortcutPreferences({
      version: 9,
      platforms: {
        darwin: {
          'app.newChat': ['Meta+KeyJ', 'Meta+KeyJ', 'broken'],
          'app.searchChats': [],
          unknown: ['Meta+KeyU'],
        },
        win32: 'invalid',
      },
    })).toEqual({
      version: 1,
      platforms: {
        darwin: {
          'app.newChat': ['Meta+KeyJ'],
          'app.searchChats': [],
        },
      },
    });
  });

  it('falls back safely when persisted JSON is corrupt', () => {
    const storage = { getItem: () => '{not-json' };
    expect(readKeyboardShortcutPreferences(storage)).toEqual({ version: 1, platforms: {} });
  });

  it('writes a versioned platform map under one stable key', () => {
    const setItem = vi.fn();
    const preferences = {
      version: 1 as const,
      platforms: { win32: { 'layout.toggleSidebar': [] } },
    };

    writeKeyboardShortcutPreferences(preferences, { setItem });

    expect(setItem).toHaveBeenCalledWith(
      KEYBOARD_SHORTCUTS_STORAGE_KEY,
      JSON.stringify(preferences),
    );
  });

  it('transfers restored default bindings away from commands that claimed them', () => {
    const preferences = {
      version: 1 as const,
      platforms: {
        darwin: {
          'app.newChat': [],
          'app.searchChats': ['Meta+KeyK', 'Meta+KeyN'],
        },
      },
    };

    expect(resetKeyboardShortcutCommandPreferences(preferences, 'darwin', 'app.newChat'))
      .toEqual({
        version: 1,
        platforms: {
          darwin: {
            'app.searchChats': ['Meta+KeyK'],
          },
        },
      });
  });
});
