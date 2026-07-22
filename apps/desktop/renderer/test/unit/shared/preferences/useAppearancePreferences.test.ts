import { describe, expect, it } from 'vitest';
import { initializeAppearancePreference } from '../../../../src/shared/preferences/useAppearancePreferences.js';

describe('appearance preferences', () => {
  it('uses the system interface font as the global default', () => {
    withAppearanceEnvironment({}, ({ dataset, styles }) => {
      initializeAppearancePreference();

      expect(dataset.fontFamily).toBe('system');
      expect(dataset.fontSize).toBe('100');
      expect(dataset.fontWeight).toBe('500');
      expect(styles.get('--app-font-family')).toContain('PingFang SC');
      expect(styles.get('--app-font-weight')).toBe('500');
    });
  });

  it('restores a saved interface font and scale before rendering', () => {
    withAppearanceEnvironment(
      {
        'setusna-font-family': 'geist',
        'setusna-font-size': '110',
        'setusna-font-weight': '400',
      },
      ({ dataset, styles }) => {
        initializeAppearancePreference();

        expect(dataset.fontFamily).toBe('geist');
        expect(dataset.fontSize).toBe('110');
        expect(dataset.fontWeight).toBe('400');
        expect(styles.get('--app-font-family')).toContain('Geist');
        expect(styles.get('--app-font-weight')).toBe('400');
      },
    );
  });

  it('falls back to the current font weight when the saved value is invalid', () => {
    withAppearanceEnvironment({ 'setusna-font-weight': '950' }, ({ dataset, styles }) => {
      initializeAppearancePreference();

      expect(dataset.fontWeight).toBe('500');
      expect(styles.get('--app-font-weight')).toBe('500');
    });
  });
});

function withAppearanceEnvironment(items: Record<string, string>, callback: (state: { dataset: Record<string, string>; styles: Map<string, string> }) => void): void {
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
          removeProperty: (name: string) => styles.delete(name),
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
