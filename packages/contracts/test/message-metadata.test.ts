import { describe, expect, it } from 'vitest';
import {
  normalizeRuntimeMessageProviderMetadata,
  RUNTIME_PROVIDER_METADATA_MAX_BYTES,
  runtimeJsonByteLength,
  sanitizeRuntimeJsonValue,
} from '../src/message-metadata.js';
import { applyRuntimeEventToThread } from '../src/thread-events.js';
import type { RuntimeEvent } from '../src/events.js';
import type { RuntimeThread } from '../src/threads.js';

const source = {
  providerId: 'provider-1',
  providerKind: 'openai-responses' as const,
  model: 'gpt-test',
  endpointFingerprint: 'a'.repeat(64),
};

describe('runtime provider metadata', () => {
  it('keeps legacy Anthropic blocks without inventing a source', () => {
    expect(normalizeRuntimeMessageProviderMetadata({
      anthropic: {
        contentBlocks: [
          { type: 'thinking', thinking: 'reason', signature: 'signed' },
          { type: 'tool_use', id: 'call_1', name: 'read_file', input: { path: 'README.md' } },
        ],
      },
    })).toEqual({
      anthropic: {
        contentBlocks: [
          { type: 'thinking', thinking: 'reason', signature: 'signed' },
          { type: 'tool_use', id: 'call_1', name: 'read_file', input: { path: 'README.md' } },
        ],
      },
    });
  });

  it('degrades partial or malformed V2 envelopes instead of treating them as legacy', () => {
    expect(normalizeRuntimeMessageProviderMetadata({
      schemaVersion: 2,
      anthropic: {
        contentBlocks: [{ type: 'thinking', thinking: 'reason', signature: 'signed' }],
      },
    })).toBeUndefined();
    expect(normalizeRuntimeMessageProviderMetadata({
      source,
      anthropic: {
        contentBlocks: [{ type: 'thinking', thinking: 'reason', signature: 'signed' }],
      },
    })).toBeUndefined();
  });

  it('deep-clones known envelopes while retaining JSON-safe additive fields', () => {
    const input = {
      schemaVersion: 2,
      source,
      openAiResponses: {
        kind: 'response',
        responseId: 'resp_1',
        items: [{
          type: 'message',
          id: 'msg_1',
          role: 'assistant',
          phase: 'commentary',
          content: [{ type: 'output_text', text: 'Hello' }],
        }],
      },
      future: { nested: ['kept'] },
    };

    const normalized = normalizeRuntimeMessageProviderMetadata(input);
    input.openAiResponses.items[0]!.content[0]!.text = 'mutated';
    input.future.nested[0] = 'mutated';

    expect(normalized).toMatchObject({
      openAiResponses: {
        responseId: 'resp_1',
        items: [{ phase: 'commentary', content: [{ text: 'Hello' }] }],
      },
      future: { nested: ['kept'] },
    });
  });

  it('keeps only a valid semantic fingerprint on V2 metadata', () => {
    const metadata = {
      schemaVersion: 2,
      source,
      openAiResponses: {
        kind: 'response',
        responseId: 'resp_1',
        items: [],
      },
    };

    expect(normalizeRuntimeMessageProviderMetadata({
      ...metadata,
      semanticFingerprint: `sha256:${'b'.repeat(64)}`,
    })?.semanticFingerprint).toBe(`sha256:${'b'.repeat(64)}`);
    expect(normalizeRuntimeMessageProviderMetadata({
      ...metadata,
      semanticFingerprint: 'not-a-fingerprint',
    })?.semanticFingerprint).toBeUndefined();
  });

  it('omits a known native envelope above the per-message size limit', () => {
    expect(normalizeRuntimeMessageProviderMetadata({
      schemaVersion: 2,
      source,
      openAiResponses: {
        kind: 'response',
        items: [{
          type: 'reasoning',
          id: 'reasoning_1',
          encrypted_content: 'x'.repeat(RUNTIME_PROVIDER_METADATA_MAX_BYTES),
        }],
      },
    })).toBeUndefined();
  });

  it('omits oversized unknown additive metadata after final normalization', () => {
    const metadata = {
      schemaVersion: 3,
      futurePayload: 'x'.repeat(RUNTIME_PROVIDER_METADATA_MAX_BYTES),
    };

    expect(runtimeJsonByteLength(metadata)).toBeGreaterThan(RUNTIME_PROVIDER_METADATA_MAX_BYTES);
    expect(normalizeRuntimeMessageProviderMetadata(metadata)).toBeUndefined();
  });

  it('retains bounded additive fields after omitting an oversized known envelope', () => {
    expect(normalizeRuntimeMessageProviderMetadata({
      schemaVersion: 2,
      source,
      openAiResponses: {
        kind: 'response',
        items: [{
          type: 'reasoning',
          id: 'reasoning_1',
          encrypted_content: 'x'.repeat(RUNTIME_PROVIDER_METADATA_MAX_BYTES),
        }],
      },
      futurePayload: { nested: ['kept'] },
    })).toEqual({
      schemaVersion: 2,
      source,
      futurePayload: { nested: ['kept'] },
    });
  });

  it('drops unsupported and cyclic JSON values', () => {
    const cyclic: Record<string, unknown> = { kept: true, unsupported: 1n };
    cyclic.self = cyclic;

    expect(sanitizeRuntimeJsonValue(cyclic)).toEqual({ kept: true });
  });

  it('normalizes and detaches metadata during event replay', () => {
    const providerMetadata = {
      schemaVersion: 2 as const,
      source,
      openAiResponses: {
        kind: 'response' as const,
        responseId: 'resp_1',
        items: [{ type: 'message', id: 'msg_1', content: [{ type: 'output_text', text: 'Hello' }] }],
      },
    };
    const projected = applyRuntimeEventToThread(baseThread(), {
      id: 'event_1',
      seq: 1,
      threadId: 'thread_1',
      turnId: 'turn_1',
      type: 'message.completed',
      createdAt: '2026-07-23T00:00:01.000Z',
      payload: { messageId: 'assistant_1', providerMetadata },
    } satisfies RuntimeEvent);

    providerMetadata.openAiResponses.items[0]!.content[0]!.text = 'mutated';
    expect(projected.messages[0]?.providerMetadata?.openAiResponses?.items).toEqual([
      { type: 'message', id: 'msg_1', content: [{ type: 'output_text', text: 'Hello' }] },
    ]);
  });

  it('drops oversized unknown metadata during event replay without dropping semantic history', () => {
    const projected = applyRuntimeEventToThread(baseThread(), {
      id: 'event_oversized_metadata',
      seq: 1,
      threadId: 'thread_1',
      turnId: 'turn_1',
      type: 'message.completed',
      createdAt: '2026-07-23T00:00:01.000Z',
      payload: {
        messageId: 'assistant_1',
        providerMetadata: {
          schemaVersion: 3,
          futurePayload: 'x'.repeat(RUNTIME_PROVIDER_METADATA_MAX_BYTES),
        } as never,
      },
    } satisfies RuntimeEvent);

    expect(projected.messages[0]).toMatchObject({
      id: 'assistant_1',
      content: 'Hello',
    });
    expect(projected.messages[0]?.providerMetadata).toBeUndefined();
  });

  it('removes provider envelopes together with semantic history on context clear', () => {
    const thread = baseThread();
    thread.messages[0]!.providerMetadata = {
      schemaVersion: 2,
      source,
      openAiResponses: {
        kind: 'response',
        responseId: 'resp_before_clear',
        items: [{ type: 'message', id: 'msg_1', content: [] }],
      },
    };

    const cleared = applyRuntimeEventToThread(thread, {
      id: 'event_clear',
      seq: 1,
      threadId: 'thread_1',
      type: 'thread.context_cleared',
      createdAt: '2026-07-23T00:00:01.000Z',
      payload: { clearedMessageCount: 1 },
    } satisfies RuntimeEvent);

    expect(cleared.messages).toEqual([]);
    expect(JSON.stringify(cleared)).not.toContain('resp_before_clear');
  });
});

function baseThread(): RuntimeThread {
  return {
    id: 'thread_1',
    title: 'Thread',
    createdAt: '2026-07-23T00:00:00.000Z',
    updatedAt: '2026-07-23T00:00:00.000Z',
    archived: false,
    messageCount: 1,
    lastMessagePreview: '',
    lastSeq: 0,
    messages: [{
      id: 'assistant_1',
      turnId: 'turn_1',
      role: 'assistant',
      content: 'Hello',
      createdAt: '2026-07-23T00:00:00.000Z',
      status: 'streaming',
    }],
  };
}
