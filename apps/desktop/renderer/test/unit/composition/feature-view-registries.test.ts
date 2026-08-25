import { defineRuntimeCodec } from '@setsuna-desktop/feature-core/codec';
import { provideHostCapability } from '@setsuna-desktop/feature-core/capability';
import { defineFeature } from '@setsuna-desktop/feature-core/definition';
import type { FeatureOperationTransport } from '@setsuna-desktop/feature-core/operation';
import {
  defineRendererFeatureHost,
  rendererFeatureEventFeedCapability,
  rendererFeatureOperationTransportCapability,
  type RendererFeatureActivation,
  type RendererFeatureContributionInput,
  type RendererFeatureContributions,
  type RendererFeatureEventFeed,
} from '@setsuna-desktop/feature-core/renderer';
import { FeatureCompositionValidationError } from '@setsuna-desktop/feature-core/status';
import { collaborationRendererFeature } from '@setsuna-desktop/feature-collaboration/renderer';
import { memoryRendererFeature } from '@setsuna-desktop/feature-memory/renderer';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  createRendererFeatureViews,
  RendererSettingsViewCatalog,
  RendererToolResultViewCatalog,
} from '../../../src/composition/feature-view-registries.js';

describe('Renderer Feature view catalogs', () => {
  afterEach(() => vi.restoreAllMocks());

  it('orders settings contributions and rejects conflicts while composing the static catalog', () => {
    const catalog = new RendererSettingsViewCatalog([
      activation('first-feature', {
        settingsViews: [{
          sectionId: 'later',
          location: 'capabilities',
          order: 20,
          titleKey: 'feature.first.title',
          render: () => null,
        }],
      }),
      activation('second-feature', {
        settingsViews: [{
          sectionId: 'earlier',
          location: 'capabilities',
          order: 10,
          titleKey: 'feature.second.title',
          render: () => null,
        }],
      }),
    ]);

    expect(catalog.list('capabilities').map(({ sectionId }) => sectionId)).toEqual(['earlier', 'later']);
    const error = captureError(() => new RendererSettingsViewCatalog([
      activation('first-feature', {
        settingsViews: [{
          sectionId: 'duplicate',
          location: 'settings',
          order: 10,
          titleKey: 'feature.first.title',
          render: () => null,
        }],
      }),
      activation('second-feature', {
        settingsViews: [{
          sectionId: 'duplicate',
          location: 'settings',
          order: 20,
          titleKey: 'feature.second.title',
          render: () => null,
        }],
      }),
    ]));
    expect(error).toBeInstanceOf(FeatureCompositionValidationError);
    expect((error as FeatureCompositionValidationError).issues).toMatchObject([{
      code: 'DUPLICATE_RENDERER_CONTRIBUTION',
      featureIds: ['first-feature', 'second-feature'],
    }]);
  });

  it('orders host-section extensions and validates nested subpages once', () => {
    const catalog = new RendererSettingsViewCatalog([
      activation('first-feature', {
        settingsSectionExtensions: [{
          id: 'later-preferences',
          targetSectionId: 'personalization',
          order: 20,
          render: () => null,
          subpages: [{ id: 'details', render: () => null }],
        }],
      }),
      activation('second-feature', {
        settingsSectionExtensions: [{
          id: 'earlier-preferences',
          targetSectionId: 'personalization',
          order: 10,
          render: () => null,
        }, {
          id: 'task-models',
          targetSectionId: 'taskModels',
          order: 10,
          render: () => null,
        }],
      }),
    ]);

    expect(catalog.listSectionExtensions('personalization').map(({ id }) => id)).toEqual([
      'earlier-preferences',
      'later-preferences',
    ]);
    expect(catalog.listSectionExtensions('taskModels').map(({ id }) => id)).toEqual(['task-models']);
    expect(catalog.listSectionExtensions('personalization')[1]?.subpages?.map(({ id }) => id)).toEqual([
      'details',
    ]);

    const error = captureError(() => new RendererSettingsViewCatalog([
      activation('invalid-feature', {
        settingsSectionExtensions: [{
          id: 'preferences',
          targetSectionId: 'personalization',
          order: 10,
          render: () => null,
          subpages: [{ id: 'duplicate', render: () => null }, { id: 'duplicate', render: () => null }],
        }],
      }),
    ]));
    expect(error).toBeInstanceOf(FeatureCompositionValidationError);
    expect((error as FeatureCompositionValidationError).issues).toMatchObject([{
      code: 'INVALID_RENDERER_CONTRIBUTION',
      featureIds: ['invalid-feature'],
    }]);
  });

  it('collects Memory settings metadata from a successful Feature activation', async () => {
    const transport: FeatureOperationTransport = {
      call: vi.fn(async () => {
        throw new Error('State reads are not expected while composing the Feature.');
      }) as FeatureOperationTransport['call'],
    };
    const { composition } = await defineRendererFeatureHost({
      required: [memoryRendererFeature],
      optional: [],
    }).activate({
      hostMessages: { 'en-US': {} },
      hostCapabilities: [
        provideHostCapability(
          rendererFeatureOperationTransportCapability,
          transport,
        ),
      ],
    });
    const views = createRendererFeatureViews(composition.activations());

    expect(views.settings.list('settings')).toEqual([]);
    expect(views.settings.listSectionExtensions('personalization')).toMatchObject([{
      featureId: 'memory',
      id: 'memory-preferences',
      subpages: [{ id: 'preview' }],
    }]);
    expect(views.settings.listSectionExtensions('taskModels')).toMatchObject([{
      featureId: 'memory',
      id: 'memory-task-models',
    }]);

    await composition.dispose();
  });

  it('uses exact result kind and major and fails closed on bad payloads', () => {
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const catalog = new RendererToolResultViewCatalog([
      activation('result-feature', {
        toolResultViews: [{
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
        }],
      }),
    ]);

    expect(catalog.resolve({
      resultKind: 'result-feature.output',
      resultMajor: 2,
      payload: { count: 2 },
    })).toMatchObject({ featureId: 'result-feature', payload: { count: 2 } });
    expect(catalog.resolve({
      resultKind: 'result-feature.output',
      resultMajor: 1,
      payload: { count: 2 },
    })).toBeNull();
    expect(catalog.resolve({
      resultKind: 'result-feature.output',
      resultMajor: 2,
      payload: { count: 1 },
    })).toBeNull();
    expect(catalog.resolve({ legacyCount: 2 })).toMatchObject({
      featureId: 'result-feature',
      payload: { count: 2 },
    });
    expect(catalog.resolve({ legacyCount: 1 })).toBeNull();
    expect(catalog.resolve({ unrelated: true })).toBeNull();
  });

  it('recovers Collaboration legacy tool results from its static activation metadata', async () => {
    const transport: FeatureOperationTransport = {
      call: vi.fn(async () => {
        throw new Error('State reads are not expected in this catalog test.');
      }) as FeatureOperationTransport['call'],
    };
    const feed: RendererFeatureEventFeed = {
      subscribe: () => ({ dispose: () => undefined }),
    };
    const { composition } = await defineRendererFeatureHost({
      required: [collaborationRendererFeature],
      optional: [],
    }).activate({
      hostMessages: { 'en-US': {} },
      hostCapabilities: [
        provideHostCapability(
          rendererFeatureOperationTransportCapability,
          transport,
        ),
        provideHostCapability(
          rendererFeatureEventFeedCapability,
          feed,
        ),
      ],
    });
    const views = createRendererFeatureViews(composition.activations());

    const spawnResultView = views.toolResults.resolve({
      tool: 'spawn_agent',
      senderThreadId: 'thread_parent',
      childThreadId: 'thread_child',
      taskId: 'task_1',
      turnId: 'turn_child',
      title: 'Repository scan',
      objective: 'Inspect the repository.',
      identity: { displayName: 'Scout', avatarSeed: 'seed_1' },
      status: 'running',
    });
    expect(spawnResultView).toMatchObject({
      featureId: 'collaboration',
      contribution: {
        presentation: 'replace',
      },
      payload: {
        parentThreadId: 'thread_parent',
        childThreadId: 'thread_child',
        taskId: 'task_1',
      },
    });
    expect(spawnResultView?.contribution.workHistoryPresentation).toBeUndefined();

    await composition.dispose();
  });
});

function activation(
  featureId: string,
  contributions: RendererFeatureContributionInput,
): RendererFeatureActivation {
  const definition = defineFeature(featureId);
  const value: RendererFeatureContributions = Object.freeze({
    composerStatusViews: Object.freeze([...(contributions.composerStatusViews ?? [])]),
    settingsViews: Object.freeze([...(contributions.settingsViews ?? [])]),
    settingsSectionExtensions: Object.freeze([...(contributions.settingsSectionExtensions ?? [])]),
    toolResultViews: Object.freeze([...(contributions.toolResultViews ?? [])]),
  });
  return Object.freeze({ featureId: definition.id, value });
}

function captureError(run: () => unknown): unknown {
  try {
    run();
    throw new Error('Expected fixture to fail.');
  } catch (error) {
    return error;
  }
}
