import { describe, expect, it } from 'vitest';
import {
  codeColorSchemeOptions,
  codeHighlightThemeOptions,
  getCodeFontFamilyOptionsForPlatform,
  initializeCodeAppearancePreference,
} from '../../../../src/shared/preferences/useCodeAppearancePreferences.js';

describe('code appearance preferences', () => {
  it('defaults to the recommended adaptive ChatGPT theme and system monospace font', () => {
    withCodeAppearanceEnvironment({}, ({ dataset, styles }) => {
      initializeCodeAppearancePreference();

      expect(dataset.codeHighlightTheme).toBe('chatgpt');
      expect(dataset.codeFontFamily).toBe('system');
      expect(dataset.codeColorScheme).toBe('theme');
      expect(styles.get('--app-code-font-family')).toContain('SFMono-Regular');
    });
  });

  it('restores a saved theme and code font', () => {
    withCodeAppearanceEnvironment(
      {
        'setsuna-code-font-family': 'geistMono',
        'setsuna-code-highlight-theme': 'oneDark',
        'setsuna-code-color-scheme': 'vscode',
      },
      ({ dataset, styles }) => {
        initializeCodeAppearancePreference();

        expect(dataset.codeHighlightTheme).toBe('one');
        expect(dataset.codeFontFamily).toBe('geistMono');
        expect(dataset.codeColorScheme).toBe('vscode');
        expect(styles.get('--app-code-font-family')).toContain('Geist Mono');
      },
    );
  });

  it('falls back safely when stored values are no longer supported', () => {
    withCodeAppearanceEnvironment(
      {
        'setsuna-code-font-family': 'missing-font',
        'setsuna-code-highlight-theme': 'missing-theme',
        'setsuna-code-color-scheme': 'missing-scheme',
      },
      ({ dataset }) => {
        initializeCodeAppearancePreference();

        expect(dataset.codeHighlightTheme).toBe('chatgpt');
        expect(dataset.codeFontFamily).toBe('system');
        expect(dataset.codeColorScheme).toBe('theme');
      },
    );
  });

  it('only includes platform-specific fonts on their supported platform', () => {
    const macOptions = getCodeFontFamilyOptionsForPlatform('mac').map((option) => option.value);
    const windowsOptions = getCodeFontFamilyOptionsForPlatform('windows').map((option) => option.value);

    expect(macOptions).toContain('sfMono');
    expect(macOptions).not.toContain('consolas');
    expect(windowsOptions).toContain('consolas');
    expect(windowsOptions).not.toContain('sfMono');
  });

  it('offers theme suites that adapt to light and dark appearance', () => {
    const themes = codeHighlightThemeOptions.map((option) => option.value);

    expect(themes).toEqual([
      'chatgpt',
      'one',
      'github',
      'monokai',
      'dracula',
      'nord',
      'tokyoNight',
      'catppuccin',
      'solarized',
    ]);
    expect(codeHighlightThemeOptions[0]).toEqual({ label: 'ChatGPT（推荐）', value: 'chatgpt' });
  });

  it('offers independent semantic token color schemes', () => {
    const schemes = codeColorSchemeOptions.map((option) => option.value);

    expect(schemes).toEqual([
      'theme',
      'one',
      'vscode',
      'github',
      'material',
      'monokai',
      'dracula',
      'nord',
      'tokyoNight',
      'catppuccin',
      'solarized',
    ]);
  });
});

function withCodeAppearanceEnvironment(items: Record<string, string>, callback: (state: { dataset: Record<string, string>; styles: Map<string, string> }) => void): void {
  const previousWindow = Object.getOwnPropertyDescriptor(globalThis, 'window');
  const previousDocument = Object.getOwnPropertyDescriptor(globalThis, 'document');
  const dataset: Record<string, string> = {};
  const styles = new Map<string, string>();

  Object.defineProperty(globalThis, 'window', {
    configurable: true,
    value: {
      localStorage: {
        getItem: (key: string) => items[key] ?? null,
      },
    },
  });
  Object.defineProperty(globalThis, 'document', {
    configurable: true,
    value: {
      documentElement: {
        dataset,
        style: {
          setProperty: (name: string, value: string) => styles.set(name, value),
        },
      },
    },
  });

  try {
    callback({ dataset, styles });
  } finally {
    if (previousWindow) Object.defineProperty(globalThis, 'window', previousWindow);
    else Reflect.deleteProperty(globalThis, 'window');
    if (previousDocument) Object.defineProperty(globalThis, 'document', previousDocument);
    else Reflect.deleteProperty(globalThis, 'document');
  }
}
