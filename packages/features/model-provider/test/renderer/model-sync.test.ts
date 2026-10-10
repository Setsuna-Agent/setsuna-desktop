import type { ProviderModelConfig, RuntimeAvailableModel } from '@setsuna-desktop/contracts';
import { describe, expect, it } from 'vitest';
import { mergeDiscoveredModels } from '../../src/renderer/model-sync.js';

describe('model synchronization', () => {
  it('imports new capabilities and fills missing fields without replacing saved overrides or selection', () => {
    const current: ProviderModelConfig = {
      id: 'saved-model', code: 'existing', name: 'My model', enabled: true,
      maxOutputTokens: 2_000, thinkingEnabled: false, thinkingEfforts: [], supportsImages: false,
    };
    const models = mergeDiscoveredModels([current], [discoveredModel('new'), discoveredModel('existing')], 'openai-compatible');

    expect(models[0]).toMatchObject({
      code: 'new', name: 'Remote new', enabled: false,
      contextWindowTokens: 256_000, maxOutputTokens: 32_000,
      thinkingEnabled: true, thinkingEfforts: ['low', 'medium', 'high'], defaultThinkingEffort: 'medium', supportsImages: true,
    });
    expect(models[1]).toEqual({ ...current, icon: undefined, contextWindowTokens: 256_000, defaultThinkingEffort: undefined });
    expect(current.contextWindowTokens).toBeUndefined();
  });

  it('retains custom budgets and thinking levels without adding an incompatible catalog default', () => {
    const current: ProviderModelConfig = {
      id: 'saved-model', code: 'existing', name: 'My model', enabled: true,
      contextWindowTokens: 64_000, maxOutputTokens: 8_000, thinkingEnabled: true, thinkingEfforts: ['custom'],
    };
    const [model] = mergeDiscoveredModels([current], [discoveredModel('existing')], 'openai-compatible');
    expect(model).toMatchObject({ ...current, supportsImages: true });
    expect(model?.defaultThinkingEffort).toBeUndefined();

    const [withDefault] = mergeDiscoveredModels([{ ...current, defaultThinkingEffort: 'custom' }], [discoveredModel('existing')], 'openai-compatible');
    expect(withDefault?.defaultThinkingEffort).toBe('custom');
  });

  it.each([
    { label: 'no effort list', thinkingEfforts: undefined, expectedDefault: 'high' },
    { label: 'an explicit empty list', thinkingEfforts: [], expectedDefault: undefined },
    { label: 'an incompatible list', thinkingEfforts: ['low'], expectedDefault: undefined },
    { label: 'a compatible list', thinkingEfforts: ['low', 'high'], expectedDefault: 'high' },
  ])('resolves a discovered default with $label', ({ thinkingEfforts, expectedDefault }) => {
    const [model] = mergeDiscoveredModels([], [{
      id: 'new', name: 'New model', defaultThinkingEffort: 'high', thinkingEfforts,
    }], 'openai-compatible');

    expect(model).toMatchObject({
      thinkingEnabled: true,
      thinkingEfforts: thinkingEfforts ?? [],
      defaultThinkingEffort: expectedDefault,
    });
  });
});

function discoveredModel(id: string): RuntimeAvailableModel {
  return {
    id, name: `Remote ${id}`, contextWindowTokens: 256_000, maxOutputTokens: 32_000,
    thinkingEnabled: true, thinkingEfforts: ['low', 'medium', 'high'], defaultThinkingEffort: 'medium', supportsImages: true,
  };
}
