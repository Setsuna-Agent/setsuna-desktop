import { provideHostCapability } from '@setsuna-desktop/feature-core/capability';
import { defineRuntimeCodec } from '@setsuna-desktop/feature-core/codec';
import type { FeatureOperationTransport } from '@setsuna-desktop/feature-core/operation';
import {
  defineRendererFeatureHost,
  rendererFeatureEventFeedCapability,
  rendererFeatureOperationTransportCapability,
  type RendererFeatureEventFeed,
} from '@setsuna-desktop/feature-core/renderer';
import { collaborationRendererFeature } from '@setsuna-desktop/feature-collaboration/renderer';
import {
  chatToolResultResolverSlot,
  registerChatToolResult,
} from '@setsuna-desktop/renderer-contracts/chat';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  createRendererPluginRuntime,
  type RendererPluginSnapshot,
} from '../../../../src/kernel/renderer-plugins/runtime.js';

describe('Chat tool-result resolver Slot', () => {
  afterEach(() => vi.restoreAllMocks());

  it('uses exact result kind and major and fails closed on bad payloads', () => {
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const runtime = createToolResultRuntime();
    registerChatToolResult(runtime.createRegistrar({
      featureId: 'result-feature',
      pluginId: 'feature.result-feature',
      scopeId: 'fixture:result-feature',
    }), {
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
    const snapshot = runtime.commitInitial();

    expect(resolve(snapshot, {
      resultKind: 'result-feature.output',
      resultMajor: 2,
      payload: { count: 2 },
    })).toMatchObject({ featureId: 'result-feature', payload: { count: 2 } });
    expect(resolve(snapshot, {
      resultKind: 'result-feature.output',
      resultMajor: 1,
      payload: { count: 2 },
    })).toBeNull();
    expect(resolve(snapshot, {
      resultKind: 'result-feature.output',
      resultMajor: 2,
      payload: { count: 1 },
    })).toBeNull();
    expect(resolve(snapshot, { legacyCount: 2 })).toMatchObject({
      featureId: 'result-feature',
      payload: { count: 2 },
    });
    expect(resolve(snapshot, { legacyCount: 1 })).toBeNull();
    expect(resolve(snapshot, { unrelated: true })).toBeNull();
  });

  it('recovers Collaboration legacy results registered during Feature activation', async () => {
    const runtime = createToolResultRuntime();
    const transport: FeatureOperationTransport = {
      call: vi.fn(async () => {
        throw new Error('State reads are not expected in this resolver test.');
      }) as FeatureOperationTransport['call'],
    };
    const feed: RendererFeatureEventFeed = {
      subscribe: () => ({ dispose: () => undefined }),
    };
    const { composition } = await defineRendererFeatureHost({
      required: [collaborationRendererFeature],
      optional: [],
    }).activate({
      createUiRegistrar: (owner, track) => runtime.createRegistrar(owner, track),
      hostMessages: { 'en-US': {} },
      hostCapabilities: [
        provideHostCapability(rendererFeatureOperationTransportCapability, transport),
        provideHostCapability(rendererFeatureEventFeedCapability, feed),
      ],
    });
    const snapshot = runtime.commitInitial();
    const spawnResultView = resolve(snapshot, {
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
      contribution: { presentation: 'replace' },
      payload: {
        parentThreadId: 'thread_parent',
        childThreadId: 'thread_child',
        taskId: 'task_1',
      },
    });
    expect(spawnResultView?.contribution.workHistoryPresentation).toBeUndefined();
    await composition.dispose();
    await runtime.dispose();
  });
});

function createToolResultRuntime() {
  const runtime = createRendererPluginRuntime();
  runtime.declareRoot(
    { pluginId: 'core.chat-host', scopeId: 'fixture:chat' },
    {
      slot: chatToolResultResolverSlot,
      fallback: { resolve: () => null },
    },
  );
  return runtime;
}

function resolve(
  snapshot: RendererPluginSnapshot,
  value: unknown,
) {
  return snapshot.resolveChain(chatToolResultResolverSlot, { value });
}
