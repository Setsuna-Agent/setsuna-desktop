import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  initializeSidebarBackgroundPreference,
  sidebarBackgroundOptions,
} from '../../../../src/shared/preferences/useSidebarBackgroundPreference.js';

describe('initializeSidebarBackgroundPreference', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('defaults to the opaque soft background style', () => {
    const environment = installPreferenceEnvironment({});

    initializeSidebarBackgroundPreference();

    expect(environment.dataset.sidebarBackgroundStyle).toBe('soft');
    expect(sidebarBackgroundOptions.map((option) => option.value)).toEqual(['soft', 'plain', 'contrast']);
  });

  it('restores a saved background style', () => {
    const environment = installPreferenceEnvironment({ 'setsuna-sidebar-background-style': 'contrast' });

    initializeSidebarBackgroundPreference();

    expect(environment.dataset.sidebarBackgroundStyle).toBe('contrast');
  });

  it('drops the legacy opacity setting and ignores unsupported background values', () => {
    const environment = installPreferenceEnvironment({
      'setsuna-sidebar-background-style': 'transparent',
      'setsuna-sidebar-opacity': '83',
    });

    initializeSidebarBackgroundPreference();

    expect(environment.dataset.sidebarBackgroundStyle).toBe('soft');
    expect(environment.removedKeys).toEqual(['setsuna-sidebar-opacity']);
  });
});

function installPreferenceEnvironment(items: Record<string, string>): { dataset: Record<string, string>; removedKeys: string[] } {
  const dataset: Record<string, string> = {};
  const removedKeys: string[] = [];
  vi.stubGlobal('window', {
    localStorage: {
      getItem: (key: string) => items[key] ?? null,
      removeItem: (key: string) => removedKeys.push(key),
    },
  });
  vi.stubGlobal('document', {
    documentElement: { dataset },
  });
  return { dataset, removedKeys };
}
