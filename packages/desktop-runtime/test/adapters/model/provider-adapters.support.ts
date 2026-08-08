import { type ModelRequest, type RuntimeJsonObject, type RuntimeMessageProviderMetadata } from '@setsuna-desktop/contracts';
import { expect } from 'vitest';
import { providerEndpointFingerprint } from '../../../src/adapters/model/provider-replay-context.js';
import type { FetchImpl } from '../../../src/adapters/model/provider-http.js';
import type { RuntimeProviderConfig } from '../../../src/ports/config-store.js';
import type { ModelClient } from '../../../src/ports/model-client.js';

export const model = {
  id: 'model-1',
  name: 'Model 1',
  code: 'model-code',
  enabled: true,
  maxOutputTokens: 1234,
  thinkingEnabled: false,
  thinkingEfforts: [],
};

export const request = {
  model: 'fallback-model',
  messages: [
    { id: 'sys', role: 'system' as const, content: 'System prompt', createdAt: '2026-06-25T00:00:00.000Z' },
    { id: 'user', role: 'user' as const, content: 'Hello', createdAt: '2026-06-25T00:00:01.000Z' },
  ],
};

export type CapturedRequest = {
  url?: string;
  headers?: Record<string, string>;
  body?: Record<string, unknown>;
};

export function expectHeaders(captured: CapturedRequest): Record<string, string> {
  expect(captured.headers).toBeDefined();
  return captured.headers ?? {};
}

export function expectBody(captured: CapturedRequest): Record<string, unknown> {
  expect(captured.body).toBeDefined();
  return captured.body ?? {};
}

export function provider(kind: RuntimeProviderConfig['provider'], baseUrl: string, activeModel: RuntimeProviderConfig['activeModel'] = model): RuntimeProviderConfig {
  return {
    id: 'provider-1',
    name: 'Provider 1',
    provider: kind,
    baseUrl,
    enabled: true,
    apiKey: 'secret',
    models: activeModel ? [activeModel] : [],
    activeModel,
  };
}

export function responsesMetadata(items: RuntimeJsonObject[]): RuntimeMessageProviderMetadata {
  return {
    schemaVersion: 2,
    source: {
      providerId: 'provider-1',
      providerKind: 'openai-responses',
      model: 'model-code',
      endpointFingerprint: providerEndpointFingerprint('https://api.openai.test/v1'),
    },
    openAiResponses: {
      kind: 'response',
      items,
    },
  };
}

export function modelStepSnapshot(
  featureKeys: string[],
): NonNullable<ModelRequest['stepSnapshot']> {
  return {
    threadId: 'thread_1',
    turnId: 'turn_1',
    threadLastSeq: 12,
    conversationMessageIds: ['assistant_1'],
    messageIds: ['assistant_1'],
    toolNames: [],
    selectedSkills: [],
    mcpServerKeys: [],
    mcpServerCount: 0,
    permissionProfile: 'workspace-write',
    featureKeys,
    worldState: {
      threadMessageCount: 1,
      threadUpdatedAt: '2026-07-23T00:00:00.000Z',
    },
  };
}

export function fakeFetch(body: string, captured: CapturedRequest): FetchImpl {
  return async (input, init) => {
    captured.url = String(input);
    captured.headers = init?.headers as Record<string, string>;
    captured.body = JSON.parse(String(init?.body ?? '{}')) as Record<string, unknown>;
    const responseBody = body.endsWith('\n\n') ? body : `${body}\n\n`;
    return new Response(responseBody, {
      status: 200,
      headers: {
        'Content-Type': 'text/event-stream',
      },
    });
  };
}

export function stagedSseFetch(initialBody: string, remainingBody: string): {
  fetch: FetchImpl;
  release: () => void;
} {
  const encoder = new TextEncoder();
  let controller: ReadableStreamDefaultController<Uint8Array> | undefined;
  return {
    fetch: async () => new Response(
      new ReadableStream<Uint8Array>({
        start(nextController) {
          controller = nextController;
          nextController.enqueue(encoder.encode(completeSseBlock(initialBody)));
        },
      }),
      {
        status: 200,
        headers: { 'Content-Type': 'text/event-stream' },
      },
    ),
    release: () => {
      if (!controller) throw new Error('Staged SSE response has not started.');
      controller.enqueue(encoder.encode(completeSseBlock(remainingBody)));
      controller.close();
    },
  };
}

export function completeSseBlock(value: string): string {
  if (value.endsWith('\n\n')) return value;
  return value.endsWith('\n') ? `${value}\n` : `${value}\n\n`;
}

export async function collect(client: ModelClient, override: Partial<ModelRequest> = {}) {
  const events = [];
  for await (const event of client.stream({ ...request, ...override })) events.push(event);
  return events;
}
