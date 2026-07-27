import {
  applyRuntimeEventToThread,
  RUNTIME_PROVIDER_METADATA_MAX_BYTES,
  type RuntimeEvent,
  type RuntimeThread,
} from '@setsuna-desktop/contracts';
import { describe, expect, it } from 'vitest';
import {
  normalizeThreadSnapshot,
  toSummary,
} from '../../../src/adapters/store/thread-store-state.js';

describe('thread snapshot provider metadata compatibility', () => {
  it('keeps legacy Anthropic metadata readable without adding V2 source fields', () => {
    const snapshot = threadWithMetadata({
      anthropic: {
        contentBlocks: [
          { type: 'thinking', thinking: 'legacy', signature: 'signed' },
          { type: 'tool_use', id: 'call_1', name: 'read_file', input: { path: 'README.md' } },
        ],
      },
    });

    const normalized = normalizeThreadSnapshot(snapshot);

    expect(normalized.changed).toBe(false);
    expect(normalized.thread.messages[0]?.providerMetadata).toEqual(snapshot.messages[0]?.providerMetadata);
  });

  it('silently degrades an invalid V2 envelope while keeping the semantic message', () => {
    const snapshot = threadWithMetadata({
      schemaVersion: 2,
      openAiResponses: {
        kind: 'response',
        items: [{ type: 'message', id: 'msg_1', content: [] }],
      },
    } as never);

    const normalized = normalizeThreadSnapshot(snapshot);

    expect(normalized.changed).toBe(true);
    expect(normalized.thread.messages[0]).toMatchObject({
      id: 'assistant_1',
      role: 'assistant',
      content: 'Portable answer',
    });
    expect(normalized.thread.messages[0]?.providerMetadata).toBeUndefined();
  });

  it('preserves valid unknown additive metadata fields', () => {
    const snapshot = threadWithMetadata({
      schemaVersion: 3,
      futureProvider: { nested: ['kept'] },
    } as never);

    const normalized = normalizeThreadSnapshot(snapshot);
    const metadata = normalized.thread.messages[0]?.providerMetadata as unknown as {
      futureProvider: { nested: string[] };
    };

    expect(metadata.futureProvider.nested).toEqual(['kept']);
  });

  it('drops oversized unknown metadata while preserving the semantic snapshot message', () => {
    const snapshot = threadWithMetadata({
      schemaVersion: 3,
      futurePayload: 'x'.repeat(RUNTIME_PROVIDER_METADATA_MAX_BYTES),
    } as never);

    const normalized = normalizeThreadSnapshot(snapshot);

    expect(normalized.changed).toBe(true);
    expect(normalized.thread.messages[0]).toMatchObject({
      id: 'assistant_1',
      role: 'assistant',
      content: 'Portable answer',
    });
    expect(normalized.thread.messages[0]?.providerMetadata).toBeUndefined();
  });

  it('produces the same provider metadata from event replay and direct snapshot normalization', () => {
    const providerMetadata = {
      schemaVersion: 2 as const,
      source: {
        providerId: 'provider-1',
        providerKind: 'openai-responses' as const,
        model: 'gpt-test',
        endpointFingerprint: 'a'.repeat(64),
      },
      openAiResponses: {
        kind: 'response' as const,
        responseId: 'resp_1',
        items: [{
          type: 'message',
          id: 'message_1',
          role: 'assistant',
          content: [{ type: 'output_text', text: 'Portable answer' }],
        }],
      },
      future: { nested: ['kept'] },
    };
    const direct = normalizeThreadSnapshot(threadWithMetadata(providerMetadata)).thread;
    const eventBase = threadWithMetadata(providerMetadata);
    delete eventBase.messages[0]!.providerMetadata;
    const replayed = applyRuntimeEventToThread(eventBase, {
      id: 'event_metadata',
      seq: 2,
      threadId: eventBase.id,
      type: 'message.completed',
      createdAt: '2026-07-23T00:00:01.000Z',
      payload: {
        messageId: 'assistant_1',
        providerMetadata,
      },
    } satisfies RuntimeEvent);

    expect(replayed.messages[0]?.providerMetadata).toEqual(direct.messages[0]?.providerMetadata);
  });
});

describe('thread summary Goal projection', () => {
  it('omits Goal execution attachments from list summaries', () => {
    const thread = threadWithMetadata({});
    thread.goal = {
      threadId: thread.id,
      objective: 'Inspect the attached design.',
      status: 'active',
      tokenBudget: null,
      tokensUsed: 0,
      timeUsedSeconds: 0,
      createdAt: 1,
      updatedAt: 1,
      execution: {
        attachments: [{
          id: 'goal_image',
          name: 'design.png',
          type: 'image/png',
          size: 1,
          url: 'data:image/png;base64,AA==',
        }],
        skillIds: ['skill_design'],
        thinking: true,
      },
    };

    expect(toSummary(thread).goal).toMatchObject({
      objective: 'Inspect the attached design.',
      status: 'active',
    });
    expect(toSummary(thread).goal?.execution).toBeUndefined();
    expect(thread.goal.execution?.attachments).toHaveLength(1);
  });
});

function threadWithMetadata(providerMetadata: NonNullable<RuntimeThread['messages'][number]['providerMetadata']>): RuntimeThread {
  return {
    id: 'thread_1',
    title: 'Thread',
    createdAt: '2026-07-23T00:00:00.000Z',
    updatedAt: '2026-07-23T00:00:00.000Z',
    archived: false,
    memoryMode: 'enabled',
    messageCount: 1,
    lastMessagePreview: 'Portable answer',
    lastSeq: 1,
    messages: [{
      id: 'assistant_1',
      role: 'assistant',
      content: 'Portable answer',
      createdAt: '2026-07-23T00:00:00.000Z',
      status: 'complete',
      providerMetadata,
    }],
  };
}
