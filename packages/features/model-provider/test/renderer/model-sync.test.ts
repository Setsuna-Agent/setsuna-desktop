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

    expect(models[1]).toMatchObject({
      code: 'new', name: 'Remote new', enabled: false,
      contextWindowTokens: 256_000, maxOutputTokens: 32_000,
      thinkingEnabled: true, thinkingEfforts: ['low', 'medium', 'high'], defaultThinkingEffort: 'medium', supportsImages: true,
    });
    expect(models[0]).toEqual({ ...current, icon: undefined, contextWindowTokens: 256_000, defaultThinkingEffort: undefined });
    expect(current.contextWindowTokens).toBeUndefined();
  });

  it('keeps unselected and unavailable models, imports only chosen models, and does not duplicate repeated imports', () => {
    const current: ProviderModelConfig = {
      id: 'local-only', code: 'local-only', name: 'My local model', enabled: true,
      maxOutputTokens: 8_000, thinkingEnabled: false, thinkingEfforts: [],
    };
    const first = mergeDiscoveredModels([current], [discoveredModel('chosen')], 'openai-compatible');
    expect(first).toEqual([
      current,
      expect.objectContaining({ code: 'chosen', enabled: false }),
    ]);
    expect(mergeDiscoveredModels(first, [discoveredModel('chosen')], 'openai-compatible')).toEqual(first);
    expect(mergeDiscoveredModels(first, [], 'openai-compatible')).toEqual(first);

    const fresh = mergeDiscoveredModels([], [discoveredModel('second-result'), discoveredModel('third-result')], 'openai-compatible');
    expect(fresh.map((model) => model.enabled)).toEqual([true, false]);
  });

  it.each([[true, false], [false, true], [false, false]])(
    'keeps same-code configurations independent with enabled states %s / %s',
    (firstEnabled, secondEnabled) => {
      const first: ProviderModelConfig = {
        id: 'fast-config', code: 'shared', name: 'Fast', enabled: firstEnabled,
        icon: { type: 'preset', key: 'openai' },
        contextWindowTokens: 64_000, maxOutputTokens: 2_000,
        thinkingEnabled: false, thinkingEfforts: [], supportsImages: false,
      };
      const second: ProviderModelConfig = {
        id: 'reasoning-config', code: 'shared', name: 'Reasoning', enabled: secondEnabled,
        icon: { type: 'preset', key: 'deepseek' },
        maxOutputTokens: 16_000, thinkingEnabled: true,
        thinkingEfforts: ['custom'], defaultThinkingEffort: 'custom',
      };
      const current = [first, second];
      const unchanged = structuredClone(current);
      const discovered = [discoveredModel('shared'), discoveredModel('new')];
      const models = mergeDiscoveredModels(current, discovered, 'openai-compatible');

      expect(models).toEqual([
        first,
        { ...second, contextWindowTokens: 256_000, supportsImages: true },
        expect.objectContaining({ code: 'new', enabled: !firstEnabled && !secondEnabled }),
      ]);
      expect(current).toEqual(unchanged);
      expect(mergeDiscoveredModels(models, discovered, 'openai-compatible')).toEqual(models);
      const existingOnly = mergeDiscoveredModels(current, [discoveredModel('shared')], 'openai-compatible');
      expect(existingOnly.map((model) => model.enabled)).toEqual([firstEnabled, secondEnabled]);
    },
  );

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
