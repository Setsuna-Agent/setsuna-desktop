import { describe, expect, it } from 'vitest';
import { codeHighlightThemeOptions, getCodeFontFamilyOptionsForPlatform, initializeCodeAppearancePreference } from './useCodeAppearancePreferences.js';

describe('code appearance preferences', () => {
  it('defaults to the One Light theme and system monospace font', () => {
    withCodeAppearanceEnvironment({}, ({ dataset, styles }) => {
      initializeCodeAppearancePreference();

      expect(dataset.codeHighlightTheme).toBe('oneLight');
      expect(dataset.codeFontFamily).toBe('system');
      expect(styles.get('--app-code-font-family')).toContain('SFMono-Regular');
    });
  });

  it('restores a saved theme and code font', () => {
    withCodeAppearanceEnvironment(
      {
        'setsuna-code-font-family': 'geistMono',
        'setsuna-code-highlight-theme': 'oneDark',
      },
      ({ dataset, styles }) => {
        initializeCodeAppearancePreference();

        expect(dataset.codeHighlightTheme).toBe('oneDark');
        expect(dataset.codeFontFamily).toBe('geistMono');
        expect(styles.get('--app-code-font-family')).toContain('Geist Mono');
      },
    );
  });

  it('falls back safely when stored values are no longer supported', () => {
    withCodeAppearanceEnvironment(
      {
        'setsuna-code-font-family': 'missing-font',
        'setsuna-code-highlight-theme': 'missing-theme',
      },
      ({ dataset }) => {
        initializeCodeAppearancePreference();

        expect(dataset.codeHighlightTheme).toBe('oneLight');
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

  it('offers a balanced set of light and dark code themes', () => {
    const themes = codeHighlightThemeOptions.map((option) => option.value);

    expect(themes).toHaveLength(10);
    expect(themes).toContain('oneLight');
    expect(themes).toContain('solarizedLight');
    expect(themes).toContain('tokyoNight');
    expect(themes).toContain('catppuccinMocha');
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
