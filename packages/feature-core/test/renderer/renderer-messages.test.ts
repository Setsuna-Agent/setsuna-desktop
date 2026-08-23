import { describe, expect, it } from 'vitest';
import { defineFeatureDefinition } from '../../src/definition.js';
import {
  composeRendererFeatures,
  composeRendererMessages,
  defineRendererDependencies,
  defineRendererFeature,
  defineRendererMessageBundle,
  mountRendererFeature,
  resolveRendererMessage,
} from '../../src/renderer/index.js';

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
    const mounts = [mountRendererFeature(module, { criticality: 'optional' })];
    const messages = composeRendererMessages({
      'zh-CN': { 'host.title': '宿主' },
      'en-US': { 'host.title': 'Host' },
    }, mounts);

    const composition = await composeRendererFeatures({ mounts });

    expect(composition.statuses()[0]?.status).toBe('failed');
    expect(resolveRendererMessage(messages, 'en-US', 'zh-CN', 'feature.messageOwner.title')).toBe('修复设置');
    expect(resolveRendererMessage(messages, 'en-US', 'zh-CN', 'host.title')).toBe('Host');
    expect(resolveRendererMessage(messages, 'en-US', 'zh-CN', 'feature.messageOwner.missing')).toBeUndefined();
    await composition.dispose();
  });

  it('rejects duplicate namespaces deterministically before either module setup runs', () => {
    let setupCount = 0;
    const messages = defineRendererMessageBundle({
      namespace: 'feature.sharedCopy',
      fallbackLocale: 'en-US',
      messages: { 'en-US': { 'feature.sharedCopy.title': 'Shared' } },
    });
    const mounts = ['first-owner', 'second-owner'].map((id) => mountRendererFeature(
      defineRendererFeature({
        definition: feature(id),
        dependencies: defineRendererDependencies({}),
        messages: [messages],
        setup() {
          setupCount += 1;
        },
      }),
      { criticality: 'optional' },
    ));

    expect(() => composeRendererMessages({ 'en-US': {} }, mounts)).toThrow(
      'Renderer message namespace "feature.sharedCopy" is owned by both "first-owner" and "second-owner".',
    );
    expect(setupCount).toBe(0);
  });
});

function feature(id: string) {
  return defineFeatureDefinition({ id, version: '1.0.0' });
}
