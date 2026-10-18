import type {
  ProviderConfigState,
  RuntimeConfigState,
  RuntimeMessage,
  RuntimeThread,
} from '@setsuna-desktop/contracts';
import { describe, expect, it, vi } from 'vitest';
import { runtimeThreadResponse } from '../../src/server/runtime-thread-response.js';
import type { RuntimeFactory } from '../../src/server/types.js';

describe('runtime thread response model binding', () => {
  it.each(['supplied', 'sampling'] as const)('projects a legacy binding from %s history without inferring from only the page', async (source) => {
    const firstMessage = assistantMessage('first', 'provider-a', 'anthropic', 'model-a-code');
    const laterMessages = Array.from({ length: 160 }, (_, index) => (
      assistantMessage(`later-${index}`, 'provider-b', 'openai-responses', 'model-b-code')
    ));
    const completeThread = runtimeThread([firstMessage, ...laterMessages]);
    const paginatedThread = {
      ...completeThread,
      messages: completeThread.messages.slice(-160),
      messagePage: { total: completeThread.messages.length, nextBefore: 1 },
    };
    const getThread = vi.fn(async () => { throw new Error('Full history is too large'); });
    const runtime = {
      configStore: { getConfig: async () => runtimeConfig() },
      threadStore: { getSamplingState: async () => completeThread, getThread },
    } as unknown as RuntimeFactory;

    const responseThread = await runtimeThreadResponse(runtime, paginatedThread, source === 'supplied' ? completeThread : undefined);

    expect(responseThread.messages).toHaveLength(160);
    expect(responseThread.modelBinding).toEqual({
      providerId: 'provider-a',
      modelId: 'model-a',
      modelCode: 'model-a-code',
    });
    expect(getThread).not.toHaveBeenCalled();
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
