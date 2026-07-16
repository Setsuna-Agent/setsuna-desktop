import { describe, expect, it } from 'vitest';
import type { ProviderModelConfig } from '@setsuna-desktop/contracts';
import { providerModelListsEqual, providerModelReplacementDecision } from './providerModelReplacement.js';

describe('provider model replacement', () => {
  it('applies discovered models directly when the provider only has an empty placeholder', () => {
    expect(providerModelReplacementDecision(
      [model({ id: 'placeholder', name: 'New model', code: '' })],
      [model({ id: 'kimi', name: 'Kimi', code: 'kimi-for-coding' })],
    )).toBe('apply');
  });

  it('requires confirmation before replacing a configured model list', () => {
    expect(providerModelReplacementDecision(
      [model({ id: 'old', name: 'Old', code: 'old-model' })],
      [model({ id: 'new', name: 'New', code: 'new-model' })],
    )).toBe('confirm');
  });

  it('does not save when discovery produces the existing configuration', () => {
    const current = [model({ id: 'same', name: 'Same', code: 'same-model', supportsImages: true })];

    expect(providerModelListsEqual(current, current.map((item) => ({ ...item })))).toBe(true);
    expect(providerModelReplacementDecision(current, current.map((item) => ({ ...item })))).toBe('unchanged');
  });

  it('treats capability changes as a replacement requiring confirmation', () => {
    const current = [model({ id: 'same', name: 'Same', code: 'same-model', supportsImages: false })];
    const next = [model({ id: 'same', name: 'Same', code: 'same-model', supportsImages: true })];

    expect(providerModelReplacementDecision(current, next)).toBe('confirm');
  });
});

function model(overrides: Partial<ProviderModelConfig>): ProviderModelConfig {
  return {
    id: 'model',
    name: 'Model',
    code: 'model',
    enabled: true,
    maxOutputTokens: 8192,
    thinkingEnabled: false,
    thinkingEfforts: [],
    supportsImages: false,
    ...overrides,
  };
}
