import { describe, expect, it } from 'vitest';
import {
  codeThemeOptions,
  getCodeFontFamilyOptionsForPlatform,
  initializeCodeAppearancePreference,
} from '../../../../src/shared/preferences/useCodeAppearancePreferences.js';

describe('code appearance preferences', () => {
  it('defaults to the recommended adaptive Pierre theme and system monospace font', () => {
    withCodeAppearanceEnvironment({}, ({ dataset, styles }) => {
      initializeCodeAppearancePreference();

      expect(dataset.codeTheme).toBe('pierre');
      expect(dataset.codeFontFamily).toBe('system');
      expect(styles.get('--app-code-font-family')).toContain('SFMono-Regular');
    });
  });

  it('restores a saved theme pair and code font', () => {
    withCodeAppearanceEnvironment(
      {
        'setsuna-code-font-family': 'geistMono',
        'setsuna-code-theme:v1': 'vscode',
      },
      ({ dataset, styles }) => {
        initializeCodeAppearancePreference();

        expect(dataset.codeTheme).toBe('vscode');
        expect(dataset.codeFontFamily).toBe('geistMono');
        expect(styles.get('--app-code-font-family')).toContain('Geist Mono');
      },
    );
  });

  it('migrates a compatible legacy highlight theme to its light and dark pair', () => {
    withCodeAppearanceEnvironment(
      { 'setsuna-code-highlight-theme': 'oneDark' },
      ({ dataset }) => {
        initializeCodeAppearancePreference();

        expect(dataset.codeTheme).toBe('one');
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

        expect(dataset.codeTheme).toBe('pierre');
        expect(dataset.codeFontFamily).toBe('system');
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

  it('offers intentional light and dark theme pairs', () => {
    const themes = codeThemeOptions.map((option) => option.value);

    expect(themes).toEqual([
      'pierre',
      'github',
      'one',
      'catppuccin',
      'solarized',
      'vscode',
      'material',
    ]);
    expect(codeThemeOptions[0]).toEqual({
      label: 'Pierre',
      themes: { dark: 'pierre-dark', light: 'pierre-light' },
      value: 'pierre',
    });
    expect(codeThemeOptions.every((option) => option.themes.dark && option.themes.light)).toBe(true);
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
