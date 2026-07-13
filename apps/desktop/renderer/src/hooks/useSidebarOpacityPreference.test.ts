import { afterEach, describe, expect, it, vi } from 'vitest';
import { initializeSidebarOpacityPreference } from './useSidebarOpacityPreference.js';

describe('initializeSidebarOpacityPreference', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('defaults to a fully opaque sidebar', () => {
    const styles = installPreferenceEnvironment({});

    initializeSidebarOpacityPreference();

    expect(styles.get('--app-sidebar-opacity')).toBe('100%');
  });

  it('migrates an existing partial opacity to the enabled 95% value', () => {
    const styles = installPreferenceEnvironment({ 'setsuna-sidebar-opacity': '83' });

    initializeSidebarOpacityPreference();

    expect(styles.get('--app-sidebar-opacity')).toBe('95%');
  });
});

function installPreferenceEnvironment(items: Record<string, string>): Map<string, string> {
  const styles = new Map<string, string>();
  vi.stubGlobal('window', {
    localStorage: {
      getItem: (key: string) => items[key] ?? null,
    },
  });
  vi.stubGlobal('document', {
    documentElement: {
      style: {
        setProperty: (name: string, value: string) => styles.set(name, value),
      },
    },
  });
  return styles;
}
