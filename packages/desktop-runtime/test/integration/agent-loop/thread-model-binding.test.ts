import type { RuntimeConfigState } from '@setsuna-desktop/contracts';
import { describe, expect, it } from 'vitest';
import { InMemoryEventBus } from '../../../src/adapters/event/in-memory-event-bus.js';
import { RandomIdGenerator } from '../../../src/adapters/id/random-id-generator.js';
import { AgentLoop } from '../../../src/loop/core/agent-loop.js';
import { effectiveRuntimeThreadModelBinding } from '../../../src/loop/core/runtime-thread-model.js';
import { systemClock } from '../../../src/ports/clock.js';
import { createTestThreadStore } from '../../support/thread-store.js';
import {
  MemoryCapturingModelClient,
  mkDataDir,
  TestConfigStore,
} from '../../support/agent-loop/shared.js';

describe('agent loop thread model binding', () => {
  it('persists a legacy inferred binding before clearing its provider evidence', async () => {
    const ids = new RandomIdGenerator();
    const threadStore = createTestThreadStore(await mkDataDir(), systemClock, ids);
    const thread = await threadStore.createThread({ title: 'Legacy model binding' });
    await threadStore.appendEvent(thread.id, {
      id: ids.id('event'),
      threadId: thread.id,
      turnId: 'legacy_turn',
      type: 'message.created',
      createdAt: systemClock.now().toISOString(),
      payload: {
        message: {
          id: 'legacy_assistant',
          turnId: 'legacy_turn',
          role: 'assistant',
          content: 'Legacy response.',
          createdAt: systemClock.now().toISOString(),
          status: 'streaming',
        },
      },
    });
    await threadStore.appendEvent(thread.id, {
      id: ids.id('event'),
      threadId: thread.id,
      turnId: 'legacy_turn',
      type: 'message.completed',
      createdAt: systemClock.now().toISOString(),
      payload: {
        messageId: 'legacy_assistant',
        providerMetadata: {
          schemaVersion: 2,
          source: {
            providerId: 'provider-a',
            providerKind: 'anthropic',
            model: 'model-a-code',
            endpointFingerprint: 'a'.repeat(64),
          },
          anthropic: {
            contentBlocks: [{ type: 'text', text: 'Legacy response.' }],
          },
        },
      },
    });
    const config = modelConfig();
    const legacyThread = await threadStore.getThread(thread.id);
    expect(legacyThread?.messages.find((message) => message.id === 'legacy_assistant')?.providerMetadata?.source).toEqual({
      providerId: 'provider-a',
      providerKind: 'anthropic',
      model: 'model-a-code',
      endpointFingerprint: 'a'.repeat(64),
    });
    expect(legacyThread && effectiveRuntimeThreadModelBinding(config, legacyThread)).toEqual({
      providerId: 'provider-a',
      modelId: 'model-a',
      modelCode: 'model-a-code',
    });
    const modelClient = new MemoryCapturingModelClient();
    const loop = new AgentLoop({
      threadStore,
      modelClient,
      eventBus: new InMemoryEventBus(),
      clock: systemClock,
      ids,
      configStore: new TestConfigStore(config),
    });

    const cleared = await loop.clearThreadContext(thread.id);
    const bindingEvent = (await threadStore.listEvents(thread.id, 0)).find((event) => (
      event.type === 'thread.updated' && event.payload.modelBinding
    ));

    expect(cleared.messages).toEqual([]);
    expect(cleared.modelBinding).toEqual({
      providerId: 'provider-a',
      modelId: 'model-a',
      modelCode: 'model-a-code',
    });
    expect(bindingEvent).toMatchObject({
      type: 'thread.updated',
      payload: { modelBinding: cleared.modelBinding },
    });
    const switched = await threadStore.updateThread(thread.id, {
      modelBinding: {
        providerId: 'provider-b',
        modelId: 'model-b',
        modelCode: 'model-b-code',
      },
    });
    expect(switched.modelBinding).toEqual({
      providerId: 'provider-b',
      modelId: 'model-b',
      modelCode: 'model-b-code',
    });

    await loop.sendTurn(thread.id, {
      input: 'Use the thread model selected after clearing context.',
    });
    expect(modelClient.requests[0]).toMatchObject({
      model: 'model-b-code',
      providerId: 'provider-b',
    });
  });
});

function modelConfig(): RuntimeConfigState {
  return {
    configPath: '/tmp/config.json',
    dataPath: '/tmp',
    storagePath: '/tmp/memories',
    activeProviderId: 'provider-b',
    providers: [
      provider('provider-a', 'model-a', 'model-a-code', 'anthropic'),
      provider('provider-b', 'model-b', 'model-b-code', 'openai-responses'),
    ],
    globalPrompt: '',
    setsunaStyle: 'developer',
    approvalPolicy: 'on-request',
    permissionProfile: 'workspace-write',
  };
}

function provider(
  id: string,
  modelId: string,
  modelCode: string,
  kind: RuntimeConfigState['providers'][number]['provider'],
): RuntimeConfigState['providers'][number] {
  return {
    id,
    name: id,
    provider: kind,
    baseUrl: `https://${id}.example.test`,
    enabled: true,
    apiKeySet: true,
    apiKeyPreview: '***',
    models: [{
      id: modelId,
      name: modelId,
      code: modelCode,
      enabled: true,
      maxOutputTokens: 4_096,
      thinkingEnabled: false,
      thinkingEfforts: [],
    }],
  };
}
