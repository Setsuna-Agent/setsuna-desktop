import { describe, expect, it } from 'vitest';
import { accentColorOptions, initializeAccentColorPreference } from './useAccentColorPreference.js';

describe('accent color preferences', () => {
  it('uses the neutral accent by default', () => {
    withAccentColorEnvironment({}, (dataset) => {
      initializeAccentColorPreference();
      expect(dataset.accentColor).toBe('neutral');
    });
  });

  it('restores a saved accent color', () => {
    withAccentColorEnvironment({ 'setsuna-accent-color': 'purple' }, (dataset) => {
      initializeAccentColorPreference();
      expect(dataset.accentColor).toBe('purple');
    });
  });

  it('falls back safely when the saved accent is unsupported', () => {
    withAccentColorEnvironment({ 'setsuna-accent-color': 'missing-color' }, (dataset) => {
      initializeAccentColorPreference();
      expect(dataset.accentColor).toBe('neutral');
    });
  });

  it('offers a compact set of accessible presets', () => {
    expect(accentColorOptions.map((option) => option.value)).toEqual(['neutral', 'blue', 'purple', 'green', 'orange']);
  });
});

function withAccentColorEnvironment(items: Record<string, string>, callback: (dataset: Record<string, string>) => void): void {
  const previousWindow = Object.getOwnPropertyDescriptor(globalThis, 'window');
  const previousDocument = Object.getOwnPropertyDescriptor(globalThis, 'document');
  const dataset: Record<string, string> = {};

  Object.defineProperty(globalThis, 'window', {
    configurable: true,
    value: { localStorage: { getItem: (key: string) => items[key] ?? null } },
  });
  Object.defineProperty(globalThis, 'document', {
    configurable: true,
    value: { documentElement: { dataset } },
  });

  try {
    callback(dataset);
  } finally {
    if (previousWindow) Object.defineProperty(globalThis, 'window', previousWindow);
    else Reflect.deleteProperty(globalThis, 'window');
    if (previousDocument) Object.defineProperty(globalThis, 'document', previousDocument);
    else Reflect.deleteProperty(globalThis, 'document');
  }
}
