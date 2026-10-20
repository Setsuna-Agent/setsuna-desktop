import type { ModelRequest, ModelStreamEvent } from '@setsuna-desktop/contracts';
import { createReviewTurnRequest } from '@setsuna-desktop/feature-review/runtime';
import { describe, expect, it } from 'vitest';
import { InMemoryEventBus } from '../../../src/adapters/event/in-memory-event-bus.js';
import { RandomIdGenerator } from '../../../src/adapters/id/random-id-generator.js';
import { estimateRuntimeMessageTokens, estimateRuntimeToolDefinitionTokens } from '../../../src/loop/context/context-compaction.js';
import { AgentLoop } from '../../../src/loop/core/agent-loop.js';
import { systemClock } from '../../../src/ports/clock.js';
import { createTestThreadStore } from '../../support/thread-store.js';
import { ContextWindowConfigStore, mkDataDir, waitForTurnCompleted, WORKSPACE_READ_FILE_TOOL } from '../../support/agent-loop/shared.js';

describe('review context compaction', () => {
  it.each([false, true])('preserves the full review request through repeated compaction (regenerated: %s)', async (regenerate) => {
    const ids = new RandomIdGenerator();
    const threadStore = createTestThreadStore(await mkDataDir(), systemClock, ids);
    const thread = await threadStore.createThread({ title: 'Review with calibrated context' });
    const instructions = 'Review only the cancellation flow; report verified findings without changing files.';
    const review = createReviewTurnRequest({ type: 'custom', instructions }, 'en-US');
    const evidence = 'Cancellation releases the pending tool before completing the turn.';
    const requests: ModelRequest[] = [];
    const summaries: ModelRequest[] = [];
    let initialReviewPending = regenerate;
    const loop = new AgentLoop({
      threadStore, ids, clock: systemClock, eventBus: new InMemoryEventBus(),
      configStore: new ContextWindowConfigStore(32_000),
      reviewControl: { prepare: async ({ target, language }) => createReviewTurnRequest(target, language ?? 'en-US') },
      toolHost: {
        listTools: async () => [WORKSPACE_READ_FILE_TOOL],
        runTool: async () => ({ content: `${evidence}\n${'source evidence '.repeat(800)}` }),
      },
      modelClient: { stream: async function* (request): AsyncGenerator<ModelStreamEvent> {
        if (initialReviewPending) {
          initialReviewPending = false;
          yield { type: 'text_delta', text: 'Original review completed.' };
          yield { type: 'done', finishReason: 'stop' };
          return;
        }
        if (request.messages.some((message) => message.id === 'context_compaction_system')) {
          summaries.push(request);
          expect(request.messages.map((message) => message.content).join('\n')).toContain(evidence);
          yield { type: 'text_delta', text: JSON.stringify({ summary: evidence, open_items: ['Finish the remaining cancellation checks.'] }) };
          yield { type: 'done', finishReason: 'stop' };
          return;
        }
        requests.push(request);
        // Reproduce a provider reporting more input than the local character estimate.
        const inputTokens = estimateRuntimeMessageTokens(request.messages)
          + estimateRuntimeToolDefinitionTokens(request.tools) + 12_000;
        yield { type: 'usage', usage: { inputTokens, outputTokens: 10, totalTokens: inputTokens + 10 } };
        if (requests.length <= 12) {
          yield { type: 'tool_calls', toolCalls: [{ id: `read_${requests.length}`, name: 'workspace_read_file', arguments: '{"path":"cancellation.ts"}' }] };
          yield { type: 'done', finishReason: 'tool_calls' };
        } else {
          yield { type: 'text_delta', text: 'Review complete using the collected cancellation evidence.' };
          yield { type: 'done', finishReason: 'stop' };
        }
      } },
    });
    let started = await loop.startReviewTurn(thread.id, regenerate
      ? createReviewTurnRequest({ type: 'uncommittedChanges' }, 'en-US')
      : review);
    const originalTurnId = started.turnId;
    const userMessageId = originalTurnId;
    if (regenerate) {
      await waitForTurnCompleted(threadStore, thread.id, originalTurnId);
      started = await loop.regenerateFromMessage(thread.id, userMessageId, { content: instructions });
    }
    await waitForTurnCompleted(threadStore, thread.id, started.turnId);

    expect(requests).toHaveLength(13);
    expect(summaries.length).toBeGreaterThanOrEqual(2);
    for (const [index, request] of requests.entries()) {
      expect(request.messages.filter((message) => message.id === userMessageId), `Sampling step ${index + 1}`).toEqual([
        expect.objectContaining({ role: 'user', content: review.prompt }),
      ]);
    }
    expect(requests.every((request) => request.stepSnapshot?.inputMessageIds?.includes(userMessageId))).toBe(true);
    expect(requests.every((request) => request.messages.find((message) => message.id === userMessageId)?.turnId === started.turnId)).toBe(true);
    const events = await threadStore.listEvents(thread.id);
    const compactedEvents = events.filter((event) => event.type === 'thread.context_compacted');
    expect(compactedEvents).toHaveLength(summaries.length);
    for (const event of compactedEvents) {
      const nextRequest = requests.find((request) => request.stepSnapshot!.threadLastSeq >= event.seq);
      expect(nextRequest?.messages.some((message) => message.contextCompaction && message.content.includes(evidence))).toBe(true);
    }
    const saved = await threadStore.getThread(thread.id);
    expect(saved?.messages.filter((message) => message.inputKind === 'review')).toEqual([
      expect.objectContaining({ id: userMessageId, role: 'user', content: review.prompt }),
    ]);
    expect(saved?.messages.some((message) => message.visibility === 'transcript' && message.content.includes(evidence))).toBe(true);
    expect(saved?.messages.filter((message) => message.role === 'assistant').at(-1)?.content).toContain('Review complete');
  });
});
