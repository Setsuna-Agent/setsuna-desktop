import { defineRuntimeCodec } from '@setsuna-desktop/feature-core/codec';
import { defineFeatureDefinition } from '@setsuna-desktop/feature-core/definition';
import { createFeatureScope } from '@setsuna-desktop/feature-core/scope';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  RendererSettingsViewRegistry,
  RendererToolResultViewRegistry,
} from '../../../src/composition/feature-view-registries.js';

describe('Renderer Feature view registries', () => {
  afterEach(() => vi.restoreAllMocks());

  it('orders settings contributions, rejects conflicts, and removes scope-owned entries', async () => {
    const registry = new RendererSettingsViewRegistry();
    const first = scope('first-feature');
    const second = scope('second-feature');
    registry.register(first.scope, {
      sectionId: 'later',
      location: 'capabilities',
      order: 20,
      titleKey: 'feature.first.title',
      render: () => null,
    });
    registry.register(second.scope, {
      sectionId: 'earlier',
      location: 'capabilities',
      order: 10,
      titleKey: 'feature.second.title',
      render: () => null,
    });

    expect(registry.list('capabilities').map(({ sectionId }) => sectionId)).toEqual(['earlier', 'later']);
    expect(() => registry.register(second.scope, {
      sectionId: 'later',
      location: 'capabilities',
      order: 30,
      titleKey: 'feature.second.conflict',
      render: () => null,
    })).toThrow('Settings view conflict');

    await first.finishDispose();
    expect(registry.find('capabilities', 'later')).toBeUndefined();
    await second.finishDispose();
  });

  it('uses exact result kind and major, fails closed on bad payloads, and unregisters on dispose', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const registry = new RendererToolResultViewRegistry();
    const owner = scope('result-feature');
    registry.register(owner.scope, {
      id: 'result-feature.view',
      resultKind: 'result-feature.output',
      major: 2,
      payload: defineRuntimeCodec<{ count: number }>((value) => {
        if (!value || typeof value !== 'object' || (value as { count?: unknown }).count !== 2) {
          throw new Error('invalid fixture payload');
        }
        return { count: 2 };
      }),
      render: () => null,
    });

    expect(registry.resolve({
      resultKind: 'result-feature.output',
      resultMajor: 2,
      payload: { count: 2 },
    })).toMatchObject({ featureId: 'result-feature', payload: { count: 2 } });
    expect(registry.resolve({
      resultKind: 'result-feature.output',
      resultMajor: 1,
      payload: { count: 2 },
    })).toBeNull();
    expect(registry.resolve({
      resultKind: 'result-feature.output',
      resultMajor: 2,
      payload: { count: 1 },
    })).toBeNull();

    await owner.finishDispose();
    expect(registry.resolve({
      resultKind: 'result-feature.output',
      resultMajor: 2,
      payload: { count: 2 },
    })).toBeNull();
  });
});

function scope(featureId: string) {
  const definition = defineFeatureDefinition({ id: featureId, version: '1.0.0' });
  return createFeatureScope({
    featureId: definition.id,
    scopeId: `${featureId}:renderer`,
    process: 'renderer',
  });
}
