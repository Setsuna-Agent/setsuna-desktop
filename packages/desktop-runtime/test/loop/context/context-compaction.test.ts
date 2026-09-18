import type { RuntimeMessage } from '@setsuna-desktop/contracts';
import { describe, expect, it } from 'vitest';
import {
  createRuntimeContextCompactionCandidate,
  estimateRuntimeMessageTokens,
  materializeRuntimeContextCompaction,
} from '../../../src/loop/context/context-compaction.js';
import { compactionSummaryTokenLimit } from '../../../src/loop/context/context-compaction-summary.js';

describe('runtime context compaction', () => {
  it('includes pinned context when deciding whether the latest input leaves room for a summary', () => {
    const request: RuntimeMessage = {
      id: 'request', turnId: 'active', role: 'user', content: 'task '.repeat(200),
      createdAt: '2026-09-12T00:00:00Z', status: 'complete',
    };
    const policy: RuntimeMessage = { ...request, id: 'policy', role: 'developer', content: 'policy '.repeat(200) };
    const latest: RuntimeMessage = { ...request, id: 'latest', content: 'latest '.repeat(1150) };
    const candidate = createRuntimeContextCompactionCandidate({
      force: true, activeTurnId: 'active', budget: { maxContextTokens: 4_000 },
      messages: [policy, request, { ...request, id: 'history', role: 'assistant', content: 'evidence '.repeat(200) }, latest],
    })!;

    expect(candidate.pinnedMessages.map((message) => message.id)).toEqual(['policy', 'request']);
    expect(candidate.olderMessages).toContainEqual(latest);
    expect(candidate.recentMessages).toEqual([]);
    expect(compactionSummaryTokenLimit(candidate)).toBeGreaterThanOrEqual(850);
    const result = materializeRuntimeContextCompaction({ candidate, id: 'summary', createdAt: latest.createdAt, summary: 'Continue the current task.' });
    expect(result.messages.find((message) => message.id === 'request')).toEqual(request);
    expect(result.messages.find((message) => message.id === 'policy')).toEqual(policy);
  });

  it('retains the active request and corrections across successive compactions without changing transcript order', () => {
    const request: RuntimeMessage = { id: 'request', turnId: 'active', role: 'user', content: 'Evaluate Feature architecture.', createdAt: '2026-09-12T00:00:00Z', status: 'complete' };
    const correction: RuntimeMessage = { ...request, id: 'correction', content: 'Keep the current UI copy.' };
    let messages: RuntimeMessage[] = [request, correction];
    for (let round = 0; round < 2; round += 1) {
      messages.push(...Array.from({ length: 12 }, (_, i): RuntimeMessage => ({ ...request, id: `read_${round}_${i}`, role: 'assistant', content: `Verified evidence ${i}` })));
      const candidate = createRuntimeContextCompactionCandidate({ force: true, activeTurnId: 'active', messages })!;
      const result = materializeRuntimeContextCompaction({ candidate, id: `summary_${round}`, createdAt: '2026-09-12T00:01:00Z', summary: 'Boundary verified; write evaluation.' });
      expect(result.messages.slice(0, 2)).toEqual([request, correction]);
      expect(candidate.olderMessages).not.toContainEqual(request);
      expect(result.messages.filter((message) => message.id === 'request')).toHaveLength(1);
      messages = result.messages;
    }
  });
  it('creates a user-context summary and keeps recent messages when forced', () => {
    const messages = Array.from({ length: 12 }, (_, index): RuntimeMessage => ({
      id: `msg_${index}`,
      role: index % 2 ? 'assistant' : 'user',
      content: `message ${index}`,
      createdAt: `2026-06-25T00:00:${String(index).padStart(2, '0')}.000Z`,
      status: 'complete',
    }));

    const candidate = createRuntimeContextCompactionCandidate({ force: true, messages });
    const result = candidate
      ? materializeRuntimeContextCompaction({
          candidate,
          createdAt: '2026-06-25T00:01:00.000Z',
          id: 'compact_1',
          summary: 'model generated summary',
        })
      : null;

    expect(result?.messages[4]).toMatchObject({
      id: 'compact_1',
      role: 'user',
      contextCompaction: {
        compactedMessageCount: 4,
        maxContextTokens: 256000,
        keptRecentMessageCount: 8,
        maxContextTokensK: 256,
        summaryRole: 'user',
        transcriptAfterMessageId: 'msg_11',
        triggerScopes: ['manual'],
      },
    });
    const notice = result?.notice;
    expect(notice?.historyTokens).toBeGreaterThan(0);
    expect(notice?.summaryTokens).toBeGreaterThan(0);
    expect(notice?.autoCompactTokenLimit).toBe(217600);
    expect(notice?.tokensUntilCompaction).toBe(Math.max(0, (notice?.autoCompactTokenLimit ?? 0) - (notice?.compactedTokens ?? 0)));
    expect(result?.messages.map((message) => message.id)).toEqual([
      ...messages.slice(0, 4).map((message) => message.id),
      'compact_1',
      ...messages.slice(4).map((message) => message.id),
    ]);
    expect(result?.messages.slice(0, 4).every((message) => message.visibility === 'transcript')).toBe(true);
    expect(result?.messages.slice(5).every((message) => message.visibility !== 'transcript')).toBe(true);
    expect(result?.messages[4].content).toContain('model generated summary');
  });

  it('keeps prior transcript-only history visible without re-compacting it', () => {
    const messages: RuntimeMessage[] = [
      {
        id: 'archived_user',
        role: 'user',
        content: 'already archived',
        createdAt: '2026-06-25T00:00:00.000Z',
        status: 'complete',
        visibility: 'transcript',
      },
      ...Array.from({ length: 10 }, (_, index): RuntimeMessage => ({
        id: `msg_${index}`,
        role: index % 2 ? 'assistant' : 'user',
        content: `message ${index}`,
        createdAt: `2026-06-25T00:00:${String(index + 1).padStart(2, '0')}.000Z`,
        status: 'complete',
      })),
    ];

    const candidate = createRuntimeContextCompactionCandidate({ force: true, messages });
    const result = candidate
      ? materializeRuntimeContextCompaction({
          candidate,
          createdAt: '2026-06-25T00:01:00.000Z',
          id: 'compact_1',
          summary: 'model generated summary',
        })
      : null;

    expect(result?.notice.compactedMessageCount).toBe(2);
    expect(result?.messages.map((message) => message.id)).toEqual([
      'archived_user',
      'msg_0',
      'msg_1',
      'compact_1',
      ...messages.slice(3).map((message) => message.id),
    ]);
    expect(result?.messages[0]).toMatchObject({ id: 'archived_user', visibility: 'transcript' });
    expect(result?.messages[1]).toMatchObject({ id: 'msg_0', visibility: 'transcript' });
    expect(result?.messages[2]).toMatchObject({ id: 'msg_1', visibility: 'transcript' });
  });

  it('does not compact small context unless forced', () => {
    const messages: RuntimeMessage[] = [
      {
        id: 'user_1',
        role: 'user',
        content: 'short',
        createdAt: '2026-06-25T00:00:00.000Z',
        status: 'complete',
      },
    ];

    expect(createRuntimeContextCompactionCandidate({ messages })).toBeNull();
  });

  it('pins persisted system and developer messages instead of summarizing or archiving them', () => {
    const messages: RuntimeMessage[] = [
      {
        id: 'injected_policy',
        role: 'developer',
        content: 'Persisted developer policy',
        createdAt: '2026-06-25T00:00:00.000Z',
        status: 'complete',
        visibility: 'model',
      },
      {
        id: 'old_user',
        role: 'user',
        content: 'Old user context',
        createdAt: '2026-06-25T00:00:01.000Z',
        status: 'complete',
      },
      {
        id: 'recent_assistant',
        role: 'assistant',
        content: 'Recent answer',
        createdAt: '2026-06-25T00:00:02.000Z',
        status: 'complete',
      },
    ];

    const candidate = createRuntimeContextCompactionCandidate({ force: true, keepRecentMessages: 1, messages });
    const result = candidate && materializeRuntimeContextCompaction({
      candidate,
      createdAt: '2026-06-25T00:01:00.000Z',
      id: 'compact_1',
      summary: 'Old user context summary',
    });

    expect(candidate?.pinnedMessages.map((message) => message.id)).toEqual(['injected_policy']);
    expect(candidate?.olderMessages.map((message) => message.id)).toEqual(['old_user']);
    expect(result?.messages).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: 'injected_policy', role: 'developer', visibility: 'model' }),
      expect.objectContaining({ id: 'compact_1', role: 'user' }),
    ]));
    expect(result?.messages.find((message) => message.id === 'injected_policy')?.visibility).not.toBe('transcript');
  });

  it('uses the active model budget when deciding automatic compaction', () => {
    const messages: RuntimeMessage[] = [
      {
        id: 'user_1',
        role: 'user',
        content: 'token-ish '.repeat(600),
        createdAt: '2026-06-25T00:00:00.000Z',
        status: 'complete',
      },
      {
        id: 'assistant_1',
        role: 'assistant',
        content: 'recent answer',
        createdAt: '2026-06-25T00:00:01.000Z',
        status: 'complete',
      },
    ];

    expect(createRuntimeContextCompactionCandidate({ messages })).toBeNull();
    const candidate = createRuntimeContextCompactionCandidate({
      budget: { maxContextTokens: 1_000 },
      force: false,
      keepRecentMessages: 1,
      messages,
    });
    const result = candidate
      ? materializeRuntimeContextCompaction({
          candidate,
          createdAt: '2026-06-25T00:01:00.000Z',
          id: 'compact_1',
          summary: 'small-window summary',
        })
      : null;

    expect(candidate?.autoCompactTokenLimit).toBe(850);
    expect(result?.notice.autoCompactTokenLimit).toBe(850);
    expect(result?.notice.tokensUntilCompaction).toBe(Math.max(0, 850 - (result?.notice.compactedTokens ?? 0)));
    expect(result?.notice.maxContextTokens).toBe(1_000);
    expect(result?.notice.maxContextTokensK).toBe(1);
    expect(result?.messages.find((message) => message.id === 'compact_1')?.content).toContain('max_context_tokens_k="1"');
  });

  it('allows an oversized latest tool result to be summarized mid-turn', () => {
    const messages: RuntimeMessage[] = [
      {
        id: 'user_1',
        role: 'user',
        content: 'Inspect the generated report.',
        createdAt: '2026-06-25T00:00:00.000Z',
        status: 'complete',
      },
      {
        id: 'assistant_1',
        role: 'assistant',
        content: '',
        createdAt: '2026-06-25T00:00:01.000Z',
        status: 'complete',
        toolCalls: [{ id: 'call_1', name: 'read_file', arguments: '{"file_path":"report.txt"}' }],
      },
      {
        id: 'tool_1',
        role: 'tool',
        toolCallId: 'call_1',
        toolName: 'read_file',
        content: 'huge tool output '.repeat(90_000),
        createdAt: '2026-06-25T00:00:02.000Z',
        status: 'complete',
      },
    ];

    const candidate = createRuntimeContextCompactionCandidate({ messages });
    expect(candidate?.recentMessages).toHaveLength(0);
    expect(candidate?.olderMessages.map((message) => message.id)).toEqual(['user_1', 'assistant_1', 'tool_1']);
    expect(candidate?.triggerScopes).toEqual(['total', 'latest_tool']);
  });

  it('does not split an assistant tool call from any of its results', () => {
    const messages: RuntimeMessage[] = [
      {
        id: 'old_user',
        role: 'user',
        content: 'Inspect both files.',
        createdAt: '2026-06-25T00:00:00.000Z',
        status: 'complete',
      },
      {
        id: 'assistant_tools',
        role: 'assistant',
        content: '',
        createdAt: '2026-06-25T00:00:01.000Z',
        status: 'complete',
        toolCalls: [
          { id: 'call_1', name: 'read_file', arguments: '{"file_path":"one.txt"}' },
          { id: 'call_2', name: 'read_file', arguments: '{"file_path":"two.txt"}' },
        ],
      },
      {
        id: 'tool_1',
        role: 'tool',
        toolCallId: 'call_1',
        toolName: 'read_file',
        content: 'one',
        createdAt: '2026-06-25T00:00:02.000Z',
        status: 'complete',
      },
      {
        id: 'tool_2',
        role: 'tool',
        toolCallId: 'call_2',
        toolName: 'read_file',
        content: 'two',
        createdAt: '2026-06-25T00:00:03.000Z',
        status: 'complete',
      },
      ...Array.from({ length: 7 }, (_, index): RuntimeMessage => ({
        id: `recent_${index}`,
        role: index % 2 ? 'assistant' : 'user',
        content: `recent ${index}`,
        createdAt: `2026-06-25T00:00:${String(index + 4).padStart(2, '0')}.000Z`,
        status: 'complete',
      })),
    ];

    const candidate = createRuntimeContextCompactionCandidate({ force: true, messages });
    expect(candidate?.olderMessages.map((message) => message.id)).toEqual(['old_user']);
    expect(candidate?.recentMessages.slice(0, 3).map((message) => message.id)).toEqual([
      'assistant_tools',
      'tool_1',
      'tool_2',
    ]);
  });

  it('pairs a reused tool call id with only its nearest open transaction', () => {
    const messages: RuntimeMessage[] = [
      {
        id: 'old_user',
        role: 'user',
        content: 'Inspect both files.',
        createdAt: '2026-06-25T00:00:00.000Z',
        status: 'complete',
      },
      {
        id: 'assistant_first',
        role: 'assistant',
        content: '',
        createdAt: '2026-06-25T00:00:01.000Z',
        status: 'complete',
        toolCalls: [{ id: 'call_0', name: 'read_file', arguments: '{"file_path":"one.txt"}' }],
      },
      {
        id: 'tool_first',
        role: 'tool',
        toolCallId: 'call_0',
        toolName: 'read_file',
        content: 'one',
        createdAt: '2026-06-25T00:00:02.000Z',
        status: 'complete',
      },
      {
        id: 'assistant_second',
        role: 'assistant',
        content: '',
        createdAt: '2026-06-25T00:00:03.000Z',
        status: 'complete',
        toolCalls: [{ id: 'call_0', name: 'read_file', arguments: '{"file_path":"two.txt"}' }],
      },
      {
        id: 'tool_second',
        role: 'tool',
        toolCallId: 'call_0',
        toolName: 'read_file',
        content: 'two',
        createdAt: '2026-06-25T00:00:04.000Z',
        status: 'complete',
      },
      ...Array.from({ length: 7 }, (_, index): RuntimeMessage => ({
        id: `recent_reused_${index}`,
        role: index % 2 ? 'assistant' : 'user',
        content: `recent ${index}`,
        createdAt: `2026-06-25T00:00:${String(index + 5).padStart(2, '0')}.000Z`,
        status: 'complete',
      })),
    ];

    const candidate = createRuntimeContextCompactionCandidate({ force: true, messages });

    expect(candidate?.olderMessages.map((message) => message.id)).toEqual([
      'old_user',
      'assistant_first',
      'tool_first',
    ]);
    expect(candidate?.recentMessages.slice(0, 2).map((message) => message.id)).toEqual([
      'assistant_second',
      'tool_second',
    ]);
  });

  it('counts tool-call arguments as model context', () => {
    const messages: RuntimeMessage[] = [
      {
        id: 'user_1',
        role: 'user',
        content: 'Write the generated file.',
        createdAt: '2026-06-25T00:00:00.000Z',
        status: 'complete',
      },
      {
        id: 'assistant_1',
        role: 'assistant',
        content: '',
        createdAt: '2026-06-25T00:00:01.000Z',
        status: 'complete',
        toolCalls: [{ id: 'call_1', name: 'write_file', arguments: JSON.stringify({ content: 'x'.repeat(4_000) }) }],
      },
      {
        id: 'tool_1',
        role: 'tool',
        toolCallId: 'call_1',
        toolName: 'write_file',
        content: 'Wrote generated.txt.',
        createdAt: '2026-06-25T00:00:02.000Z',
        status: 'complete',
      },
    ];

    expect(estimateRuntimeMessageTokens(messages)).toBeGreaterThan(1_000);
    expect(createRuntimeContextCompactionCandidate({
      budget: { maxContextTokens: 1_000 },
      messages,
    })).not.toBeNull();
  });

  it('counts structured reasoning only when a native provider envelope can replay it', () => {
    const messages: RuntimeMessage[] = [
      {
        id: 'user_1',
        role: 'user',
        content: 'Inspect the implementation.',
        createdAt: '2026-06-25T00:00:00.000Z',
        status: 'complete',
      },
      {
        id: 'assistant_1',
        role: 'assistant',
        content: 'Inspection complete.',
        streamParts: [
          { type: 'reasoning', content: 'x'.repeat(4_000) },
          { type: 'content', content: 'Inspection complete.' },
        ],
        createdAt: '2026-06-25T00:00:01.000Z',
        status: 'complete',
      },
      {
        id: 'user_2',
        role: 'user',
        content: 'Continue.',
        createdAt: '2026-06-25T00:00:02.000Z',
        status: 'complete',
      },
    ];

    expect(estimateRuntimeMessageTokens(messages)).toBeLessThan(1_000);
    expect(createRuntimeContextCompactionCandidate({
      budget: { maxContextTokens: 1_000 },
      messages,
    })).toBeNull();

    const nativeReplayMessages = messages.map((message) => (
      message.id === 'assistant_1'
        ? {
            ...message,
            providerMetadata: {
              anthropic: {
                contentBlocks: [
                  { type: 'thinking' as const, thinking: 'x'.repeat(4_000), signature: 'sig_1' },
                  { type: 'text' as const, text: 'Inspection complete.' },
                ],
              },
            },
          }
        : message
    ));

    expect(estimateRuntimeMessageTokens(nativeReplayMessages)).toBeGreaterThan(1_000);
    expect(createRuntimeContextCompactionCandidate({
      budget: { maxContextTokens: 1_000 },
      messages: nativeReplayMessages,
    })).not.toBeNull();
  });

  it('counts opaque native reasoning state even without a visible reasoning delta', () => {
    const messages: RuntimeMessage[] = [
      {
        id: 'user_1',
        role: 'user',
        content: 'Inspect the implementation.',
        createdAt: '2026-06-25T00:00:00.000Z',
        status: 'complete',
      },
      {
        id: 'assistant_1',
        role: 'assistant',
        content: 'Inspection complete.',
        createdAt: '2026-06-25T00:00:01.000Z',
        status: 'complete',
      },
      {
        id: 'user_2',
        role: 'user',
        content: 'Continue.',
        createdAt: '2026-06-25T00:00:02.000Z',
        status: 'complete',
      },
    ];
    const withAssistantMetadata = (
      providerMetadata: NonNullable<RuntimeMessage['providerMetadata']>,
    ): RuntimeMessage[] => messages.map((message) => (
      message.id === 'assistant_1' ? { ...message, providerMetadata } : message
    ));
    const opaquePayload = 'x'.repeat(4_000);
    const anthropicMessages = withAssistantMetadata({
      anthropic: {
        contentBlocks: [{ type: 'redacted_thinking', data: opaquePayload }],
      },
    });
    const openAiResponsesMessages = withAssistantMetadata({
      schemaVersion: 2,
      source: {
        providerId: 'provider-1',
        providerKind: 'openai-responses',
        model: 'gpt-test',
        endpointFingerprint: 'a'.repeat(64),
      },
      openAiResponses: {
        kind: 'response',
        items: [{ type: 'reasoning', encrypted_content: opaquePayload }],
      },
    });

    for (const nativeMessages of [anthropicMessages, openAiResponsesMessages]) {
      expect(estimateRuntimeMessageTokens(nativeMessages)).toBeGreaterThan(1_000);
      expect(createRuntimeContextCompactionCandidate({
        budget: { maxContextTokens: 1_000 },
        messages: nativeMessages,
      })).not.toBeNull();
    }
  });

  it('counts replayed native compaction envelopes toward context usage', () => {
    const messages: RuntimeMessage[] = [
      {
        id: 'compact_1',
        role: 'user',
        content: 'Portable summary.',
        createdAt: '2026-06-25T00:00:00.000Z',
        status: 'complete',
        contextCompaction: {
          compactedMessageCount: 4,
          compactedTokens: 800,
          keptRecentMessageCount: 2,
          maxContextTokensK: 128,
          originalMessageCount: 5,
          originalTokens: 900,
        },
        providerMetadata: {
          schemaVersion: 2,
          source: {
            providerId: 'provider-1',
            providerKind: 'openai-responses',
            model: 'gpt-test',
            endpointFingerprint: 'a'.repeat(64),
          },
          openAiResponses: {
            kind: 'compaction',
            items: [{ type: 'compaction', id: 'cmp_1', encrypted_content: 'x'.repeat(4_000) }],
          },
        },
      },
      {
        id: 'user_1',
        role: 'user',
        content: 'Continue.',
        createdAt: '2026-06-25T00:00:01.000Z',
        status: 'complete',
      },
    ];

    const withoutEnvelope = messages.map((message) => ({ ...message, providerMetadata: undefined }));
    expect(estimateRuntimeMessageTokens(withoutEnvelope)).toBeLessThan(1_000);
    expect(estimateRuntimeMessageTokens(messages)).toBeGreaterThan(1_000);
    expect(createRuntimeContextCompactionCandidate({
      budget: { maxContextTokens: 1_000 },
      messages,
    })).not.toBeNull();
  });

  it('does not count display-only generated image data as model context', () => {
    const baseMessages: RuntimeMessage[] = [
      {
        id: 'user_1',
        role: 'user',
        content: 'Generate an apple.',
        createdAt: '2026-06-25T00:00:00.000Z',
        status: 'complete',
      },
      {
        id: 'assistant_1',
        role: 'assistant',
        content: '',
        createdAt: '2026-06-25T00:00:01.000Z',
        status: 'complete',
        toolCalls: [{ id: 'call_1', name: 'generate_image', arguments: '{"prompt":"an apple"}' }],
      },
      {
        id: 'tool_1',
        role: 'tool',
        toolCallId: 'call_1',
        toolName: 'generate_image',
        content: 'Generated 1 image.',
        attachments: [{
          id: 'generated_1',
          name: 'generated-image-1.png',
          type: 'image/png',
          size: 300_000,
          url: `data:image/png;base64,${'A'.repeat(400_000)}`,
          modelVisible: false,
        }],
        createdAt: '2026-06-25T00:00:02.000Z',
        status: 'complete',
      },
    ];
    const withoutDisplayAttachment = baseMessages.map((message) => (
      message.id === 'tool_1' ? { ...message, attachments: undefined } : message
    ));

    expect(estimateRuntimeMessageTokens(baseMessages)).toBe(estimateRuntimeMessageTokens(withoutDisplayAttachment));
    expect(createRuntimeContextCompactionCandidate({
      budget: { maxContextTokens: 1_000 },
      messages: baseMessages,
    })).toBeNull();
  });

  it('estimates model-visible images by visual cost instead of Base64 wire size', () => {
    const messages: RuntimeMessage[] = [
      {
        id: 'user_1',
        role: 'user',
        content: 'Inspect the rendered page.',
        createdAt: '2026-07-18T00:00:00.000Z',
        status: 'complete',
      },
      {
        id: 'tool_1',
        role: 'tool',
        toolCallId: 'call_view_image',
        toolName: 'view_image',
        content: 'Loaded page_03.png.',
        attachments: [{
          id: 'page_03',
          name: 'page_03.png',
          type: 'image/png',
          size: 480_000,
          url: `data:image/png;base64,${'A'.repeat(640_000)}`,
        }],
        createdAt: '2026-07-18T00:00:01.000Z',
        status: 'complete',
      },
    ];

    expect(estimateRuntimeMessageTokens(messages)).toBeLessThan(5_000);
    expect(createRuntimeContextCompactionCandidate({
      budget: { maxContextTokens: 100_000 },
      messages,
    })).toBeNull();
  });

  it('allows oversized latest user text to be summarized when it alone exceeds the budget', () => {
    const messages: RuntimeMessage[] = [
      {
        id: 'user_1',
        role: 'user',
        content: 'Start the task.',
        createdAt: '2026-06-25T00:00:00.000Z',
        status: 'complete',
      },
      {
        id: 'assistant_1',
        role: 'assistant',
        content: 'Initial answer.',
        createdAt: '2026-06-25T00:00:01.000Z',
        status: 'complete',
      },
      {
        id: 'steer_1',
        role: 'user',
        content: 'oversized steer detail '.repeat(800),
        createdAt: '2026-06-25T00:00:02.000Z',
        status: 'complete',
      },
    ];

    const candidate = createRuntimeContextCompactionCandidate({
      budget: { maxContextTokens: 1_000 },
      messages,
    });
    const result = candidate
      ? materializeRuntimeContextCompaction({
          candidate,
          createdAt: '2026-06-25T00:01:00.000Z',
          id: 'compact_1',
          summary: 'summarized oversized steer',
          turnId: 'turn_1',
        })
      : null;

    expect(candidate?.recentMessages).toHaveLength(0);
    expect(candidate?.olderMessages.map((message) => message.id)).toEqual(['user_1', 'assistant_1', 'steer_1']);
    expect(candidate?.triggerScopes).toEqual(['total', 'latest_input']);
    expect(result?.messages.slice(0, 3).every((message) => message.visibility === 'transcript')).toBe(true);
    expect(result?.messages[3]).toMatchObject({
      id: 'compact_1',
      role: 'user',
      contextCompaction: {
        triggerScopes: ['total', 'latest_input'],
      },
    });
  });
});

describe('protocol-aware context compaction', () => {
  it('does not split a tool transaction when a persisted steer sits before its results', () => {
    const messages: RuntimeMessage[] = [
      {
        id: 'old_user',
        role: 'user',
        content: 'Inspect both files.',
        createdAt: '2026-07-23T00:00:00.000Z',
        status: 'complete',
      },
      {
        id: 'assistant_tools',
        role: 'assistant',
        content: '',
        createdAt: '2026-07-23T00:00:01.000Z',
        status: 'complete',
        toolCalls: [
          { id: 'call_1', name: 'read_file', arguments: '{"path":"one"}' },
          { id: 'call_2', name: 'read_file', arguments: '{"path":"two"}' },
        ],
      },
      {
        id: 'persisted_steer',
        role: 'user',
        content: 'Use the results in order.',
        createdAt: '2026-07-23T00:00:02.000Z',
        status: 'complete',
      },
      {
        id: 'tool_1',
        role: 'tool',
        content: 'one',
        toolCallId: 'call_1',
        createdAt: '2026-07-23T00:00:03.000Z',
        status: 'complete',
      },
      {
        id: 'tool_2',
        role: 'tool',
        content: 'two',
        toolCallId: 'call_2',
        createdAt: '2026-07-23T00:00:04.000Z',
        status: 'complete',
      },
      ...Array.from({ length: 5 }, (_, index): RuntimeMessage => ({
        id: `recent_${index}`,
        role: index % 2 ? 'assistant' : 'user',
        content: `recent ${index}`,
        createdAt: `2026-07-23T00:00:${String(index + 5).padStart(2, '0')}.000Z`,
        status: 'complete',
      })),
    ];

    const candidate = createRuntimeContextCompactionCandidate({ force: true, messages });

    expect(candidate?.olderMessages.map((message) => message.id)).toEqual(['old_user']);
    expect(candidate?.recentMessages.slice(0, 4).map((message) => message.id)).toEqual([
      'assistant_tools',
      'persisted_steer',
      'tool_1',
      'tool_2',
    ]);
  });

  it('attaches a detached native envelope to the portable summary message', () => {
    const messages = Array.from({ length: 10 }, (_, index): RuntimeMessage => ({
      id: `msg_${index}`,
      role: index % 2 ? 'assistant' : 'user',
      content: `message ${index}`,
      createdAt: `2026-07-23T00:00:${String(index).padStart(2, '0')}.000Z`,
      status: 'complete',
    }));
    const candidate = createRuntimeContextCompactionCandidate({ force: true, messages });
    const providerMetadata = {
      schemaVersion: 2 as const,
      source: {
        providerId: 'provider-1',
        providerKind: 'openai-responses' as const,
        model: 'gpt-test',
        endpointFingerprint: 'a'.repeat(64),
      },
      openAiResponses: {
        kind: 'compaction' as const,
        responseId: 'resp_compact_1',
        items: [{
          type: 'compaction',
          id: 'cmp_1',
          encrypted_content: 'encrypted-compaction',
          created_by: 'model',
        }],
      },
    };
    const result = candidate
      ? materializeRuntimeContextCompaction({
          candidate,
          createdAt: '2026-07-23T00:01:00.000Z',
          id: 'compact_1',
          providerMetadata,
          summary: 'Portable summary.',
        })
      : null;

    providerMetadata.openAiResponses.items[0]!.encrypted_content = 'mutated';
    const summaryMessage = result?.messages.find((message) => message.id === 'compact_1');
    expect(summaryMessage).toMatchObject({
      role: 'user',
      content: expect.stringContaining('Portable summary.'),
      providerMetadata: {
        openAiResponses: {
          kind: 'compaction',
          items: [{ encrypted_content: 'encrypted-compaction' }],
        },
      },
    });
  });
});
