import type {
  ProviderConfigState,
  RuntimeConfigState,
  RuntimeThread,
} from '@setsuna-desktop/contracts';
import { describe, expect, it } from 'vitest';
import { chatThreadModelSelection } from '../../../../src/features/chat/chatModelSelection.js';

describe('chat thread model selection', () => {
  it('uses the latest global choice only for a new conversation', () => {
    const config = runtimeConfig('provider-b');

    expect(chatThreadModelSelection(config, null)).toMatchObject({
      reference: { providerId: 'provider-b', modelId: 'model-b' },
    });
  });

  it('keeps a historical conversation on its persisted model after the global choice changes', () => {
    const config = runtimeConfig('provider-b');
    const thread = runtimeThread({
      providerId: 'provider-a',
      modelId: 'model-a',
      modelCode: 'model-a-code',
    });

    expect(chatThreadModelSelection(config, thread)).toMatchObject({
      model: { id: 'model-a', code: 'model-a-code' },
      provider: { id: 'provider-a' },
      reference: { providerId: 'provider-a', modelId: 'model-a' },
    });
  });

  it('does not infer a legacy binding from the renderer message page', () => {
    const thread = runtimeThread();
    thread.messageCount = 1;
    thread.messages = [{
      id: 'legacy-assistant',
      role: 'assistant',
      content: 'legacy answer',
      createdAt: thread.createdAt,
      status: 'complete',
      providerMetadata: {
        schemaVersion: 2,
        source: {
          providerId: 'provider-a',
          providerKind: 'anthropic',
          model: 'model-a-code',
          endpointFingerprint: 'a'.repeat(64),
        },
      },
    }];

    expect(chatThreadModelSelection(runtimeConfig('provider-b'), thread)).toMatchObject({
      reference: { providerId: 'provider-b', modelId: 'model-b' },
    });
  });

  it('keeps a bound model unavailable when its configured code has changed', () => {
    const thread = runtimeThread({
      providerId: 'provider-a',
      modelId: 'model-a',
      modelCode: 'historical-model-a-code',
    });

    expect(chatThreadModelSelection(runtimeConfig('provider-b'), thread)).toMatchObject({
      fallbackModelCode: 'historical-model-a-code',
      model: null,
      provider: { id: 'provider-a' },
      reference: { providerId: 'provider-a', modelId: 'model-a' },
    });
  });

  it('leaves unrecoverable legacy history selectable until its next turn persists a binding', () => {
    const thread = runtimeThread();
    thread.messageCount = 1;
    thread.messages = [{
      id: 'legacy-user',
      role: 'user',
      content: 'legacy input',
      createdAt: thread.createdAt,
      status: 'complete',
    }];

    expect(chatThreadModelSelection(runtimeConfig('provider-b'), thread)).toMatchObject({
      reference: { providerId: 'provider-b', modelId: 'model-b' },
    });
  });

  it('shows an optimistic thread selection before its persisted binding arrives', () => {
    const thread = runtimeThread({
      providerId: 'provider-a',
      modelId: 'model-a',
      modelCode: 'model-a-code',
    });

    expect(chatThreadModelSelection(runtimeConfig('provider-a'), thread, {
      providerId: 'provider-b',
      modelId: 'model-b',
    })).toMatchObject({
      model: { id: 'model-b', code: 'model-b-code' },
      provider: { id: 'provider-b' },
      reference: { providerId: 'provider-b', modelId: 'model-b' },
    });
  });
});

function runtimeConfig(activeProviderId: string): RuntimeConfigState {
  return {
    configPath: '/tmp/config.json',
    dataPath: '/tmp/data',
    storagePath: '/tmp/storage',
    activeProviderId,
    providers: [
      provider('provider-a', 'model-a', 'model-a-code', 'anthropic'),
      provider('provider-b', 'model-b', 'model-b-code', 'openai-responses'),
    ],
    globalPrompt: '',
    memory: { useMemories: false, generateMemories: false, disableOnExternalContext: true },
    memoryEnabled: false,
    setsunaStyle: 'developer',
    approvalPolicy: 'on-request',
    permissionProfile: 'workspace-write',
  };
}

function provider(
  id: string,
  modelId: string,
  code: string,
  kind: ProviderConfigState['provider'],
): ProviderConfigState {
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
      code,
      enabled: true,
      maxOutputTokens: 4096,
      thinkingEnabled: false,
      thinkingEfforts: [],
    }],
  };
}

function runtimeThread(modelBinding?: RuntimeThread['modelBinding']): RuntimeThread {
  const now = '2026-08-20T00:00:00.000Z';
  return {
    id: 'thread-a',
    title: 'Thread A',
    createdAt: now,
    updatedAt: now,
    archived: false,
    messageCount: 0,
    lastMessagePreview: '',
    messages: [],
    lastSeq: 0,
    modelBinding,
  };
}
