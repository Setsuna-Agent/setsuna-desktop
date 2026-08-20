import type {
  ProviderConfigState,
  RuntimeConfigState,
  RuntimeMessage,
  RuntimeThread,
} from '@setsuna-desktop/contracts';
import { describe, expect, it } from 'vitest';
import { runtimeThreadResponse } from '../../src/server/runtime-thread-response.js';
import type { RuntimeFactory } from '../../src/server/types.js';

describe('runtime thread response model binding', () => {
  it('projects a legacy binding from the complete history rather than the paginated message tail', async () => {
    const firstMessage = assistantMessage('first', 'provider-a', 'anthropic', 'model-a-code');
    const laterMessages = Array.from({ length: 160 }, (_, index) => (
      assistantMessage(`later-${index}`, 'provider-b', 'openai-responses', 'model-b-code')
    ));
    const completeThread = runtimeThread([firstMessage, ...laterMessages]);
    const paginatedThread = {
      ...completeThread,
      messages: completeThread.messages.slice(-160),
    };
    const runtime = {
      configStore: { getConfig: async () => runtimeConfig() },
    } as unknown as RuntimeFactory;

    const responseThread = await runtimeThreadResponse(runtime, paginatedThread, completeThread);

    expect(responseThread.messages).toHaveLength(160);
    expect(responseThread.modelBinding).toEqual({
      providerId: 'provider-a',
      modelId: 'model-a',
      modelCode: 'model-a-code',
    });
  });
});

function assistantMessage(
  id: string,
  providerId: string,
  providerKind: ProviderConfigState['provider'],
  model: string,
): RuntimeMessage {
  return {
    id,
    role: 'assistant',
    content: id,
    createdAt: '2026-08-20T00:00:00.000Z',
    status: 'complete',
    providerMetadata: {
      schemaVersion: 2,
      source: {
        providerId,
        providerKind,
        model,
        endpointFingerprint: 'a'.repeat(64),
      },
    },
  };
}

function runtimeThread(messages: RuntimeMessage[]): RuntimeThread {
  return {
    id: 'legacy-thread',
    title: 'Legacy thread',
    createdAt: '2026-08-20T00:00:00.000Z',
    updatedAt: '2026-08-20T00:00:00.000Z',
    archived: false,
    messageCount: messages.length,
    lastMessagePreview: '',
    lastSeq: 0,
    messages,
  };
}

function runtimeConfig(): RuntimeConfigState {
  return {
    configPath: '/tmp/config.json',
    dataPath: '/tmp/data',
    storagePath: '/tmp/storage',
    activeProviderId: 'provider-b',
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
  modelCode: string,
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
      code: modelCode,
      enabled: true,
      maxOutputTokens: 4_096,
      thinkingEnabled: false,
      thinkingEfforts: [],
    }],
  };
}
