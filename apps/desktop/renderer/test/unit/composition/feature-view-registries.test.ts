import { defineRuntimeCodec } from '@setsuna-desktop/feature-core/codec';
import { declareCapabilityProvider, provideHostCapability } from '@setsuna-desktop/feature-core/capability';
import { defineFeatureDefinition } from '@setsuna-desktop/feature-core/definition';
import type { FeatureOperationTransport } from '@setsuna-desktop/feature-core/operation';
import {
  composeRendererFeatures,
  mountRendererFeature,
  rendererFeatureEventFeedCapability,
  rendererFeatureOperationTransportCapability,
  rendererToolResultViewRegistryCapability,
  type RendererFeatureEventFeed,
} from '@setsuna-desktop/feature-core/renderer';
import { createFeatureScope } from '@setsuna-desktop/feature-core/scope';
import { collaborationRendererFeature } from '@setsuna-desktop/feature-collaboration/renderer';
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
      legacy: {
        matches: (value) => Boolean(
          value
          && typeof value === 'object'
          && (value as { legacyCount?: unknown }).legacyCount !== undefined,
        ),
        payload: defineRuntimeCodec<{ count: number }>((value) => {
          if (!value || typeof value !== 'object' || (value as { legacyCount?: unknown }).legacyCount !== 2) {
            throw new Error('invalid legacy fixture payload');
          }
          return { count: 2 };
        }),
      },
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
    expect(registry.resolve({ legacyCount: 2 })).toMatchObject({
      featureId: 'result-feature',
      payload: { count: 2 },
    });
    expect(registry.resolve({ legacyCount: 1 })).toBeNull();
    expect(registry.resolve({ unrelated: true })).toBeNull();

    await owner.finishDispose();
    expect(registry.resolve({
      resultKind: 'result-feature.output',
      resultMajor: 2,
      payload: { count: 2 },
    })).toBeNull();
    expect(registry.resolve({ legacyCount: 2 })).toBeNull();
  });

  it('lets the Collaboration Feature recover a persisted flat spawn_agent result', async () => {
    const registry = new RendererToolResultViewRegistry();
    const transport: FeatureOperationTransport = {
      call: vi.fn(async () => {
        throw new Error('State reads are not expected in this registry test.');
      }) as FeatureOperationTransport['call'],
    };
    const feed: RendererFeatureEventFeed = {
      subscribe: () => ({ dispose: () => undefined }),
    };
    const composition = await composeRendererFeatures({
      mounts: [mountRendererFeature(collaborationRendererFeature, { criticality: 'required' })],
      hostCapabilities: [
        provideHostCapability(
          declareCapabilityProvider(rendererFeatureOperationTransportCapability),
          transport,
        ),
        provideHostCapability(
          declareCapabilityProvider(rendererFeatureEventFeedCapability),
          feed,
        ),
        provideHostCapability(
          declareCapabilityProvider(rendererToolResultViewRegistryCapability),
          registry,
        ),
      ],
    });

    expect(registry.resolve({
      tool: 'spawn_agent',
      senderThreadId: 'thread_parent',
      childThreadId: 'thread_child',
      taskId: 'task_1',
      turnId: 'turn_child',
      title: 'Repository scan',
      objective: 'Inspect the repository.',
      identity: { displayName: 'Scout', avatarSeed: 'seed_1' },
      status: 'running',
    })).toMatchObject({
      featureId: 'collaboration',
      contribution: {
        presentation: 'replace',
        workHistoryPresentation: 'persistent',
      },
      payload: {
        parentThreadId: 'thread_parent',
        childThreadId: 'thread_child',
        taskId: 'task_1',
      },
    });

    await composition.dispose();
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
