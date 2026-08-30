import { describe, expect, it } from 'vitest';
import { defineFeature } from '../../src/definition.js';
import {
  defineRendererDependencies,
  defineRendererFeature,
  defineRendererFeatureHost,
  defineRendererMessageBundle,
  resolveRendererMessage,
  type RendererUiRegistrarFactory,
} from '../../src/renderer/index.js';
import { FeatureCompositionValidationError } from '../../src/status.js';

describe('Renderer Feature messages', () => {
  it('keeps static copy available when setup fails and uses the Feature fallback locale', async () => {
    const module = defineRendererFeature({
      definition: feature('message-owner'),
      dependencies: defineRendererDependencies({}),
      messages: [defineRendererMessageBundle({
        namespace: 'feature.messageOwner',
        fallbackLocale: 'zh-CN',
        messages: {
          'zh-CN': {
            'feature.messageOwner.title': '修复设置',
          },
          'en-US': {},
        },
      })],
      setup() {
        throw new Error('fixture setup failed');
      },
    });
    const { composition, messages } = await defineRendererFeatureHost({
      required: [],
      optional: [module],
    }).activate({
      createUiRegistrar: testUiRegistrarFactory,
      hostMessages: {
        'zh-CN': { 'host.title': '宿主' },
        'en-US': { 'host.title': 'Host' },
      },
    });

    expect(composition.statuses()[0]?.status).toBe('failed');
    expect(resolveRendererMessage(messages, 'en-US', 'zh-CN', 'feature.messageOwner.title')).toBe('修复设置');
    expect(resolveRendererMessage(messages, 'en-US', 'zh-CN', 'host.title')).toBe('Host');
    expect(resolveRendererMessage(messages, 'en-US', 'zh-CN', 'feature.messageOwner.missing')).toBeUndefined();
    await composition.dispose();
  });

  it('rejects duplicate namespaces deterministically before either module setup runs', async () => {
    let setupCount = 0;
    const messages = defineRendererMessageBundle({
      namespace: 'feature.sharedCopy',
      fallbackLocale: 'en-US',
      messages: { 'en-US': { 'feature.sharedCopy.title': 'Shared' } },
    });
    const modules = ['first-owner', 'second-owner'].map((id) => (
      defineRendererFeature({
        definition: feature(id),
        dependencies: defineRendererDependencies({}),
        messages: [messages],
        setup() {
          setupCount += 1;
        },
      })
    ));

    const error = await captureError(() => defineRendererFeatureHost({
      required: [],
      optional: modules,
    }).activate({
      createUiRegistrar: testUiRegistrarFactory,
      hostMessages: { 'en-US': {} },
    }));

    expect(error).toBeInstanceOf(FeatureCompositionValidationError);
    expect((error as FeatureCompositionValidationError).issues).toEqual([
      expect.objectContaining({
        code: 'DUPLICATE_RENDERER_MESSAGE_NAMESPACE',
        featureIds: ['first-owner', 'second-owner'],
      }),
      expect.objectContaining({
        code: 'DUPLICATE_RENDERER_MESSAGE_KEY',
        featureIds: ['first-owner', 'second-owner'],
      }),
    ]);
    expect(setupCount).toBe(0);
  });
});

function feature(id: string) {
  return defineFeature(id);
}

async function captureError(run: () => Promise<unknown>): Promise<unknown> {
  try {
    await run();
    throw new Error('Expected fixture to fail.');
  } catch (error) {
    return error;
  }
}

const testUiRegistrarFactory: RendererUiRegistrarFactory = (owner) => ({
  owner,
  single: () => () => undefined,
  list: () => () => undefined,
  keyed: () => () => undefined,
  chain: () => () => undefined,
});
