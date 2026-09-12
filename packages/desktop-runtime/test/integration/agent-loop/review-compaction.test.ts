import type { ModelRequest, ModelStreamEvent } from '@setsuna-desktop/contracts';
import { describe, expect, it } from 'vitest';
import { InMemoryEventBus } from '../../../src/adapters/event/in-memory-event-bus.js';
import { RandomIdGenerator } from '../../../src/adapters/id/random-id-generator.js';
import { estimateRuntimeMessageTokens, estimateRuntimeToolDefinitionTokens } from '../../../src/loop/context/context-compaction.js';
import { AgentLoop } from '../../../src/loop/core/agent-loop.js';
import { systemClock } from '../../../src/ports/clock.js';
import { createTestThreadStore } from '../../support/thread-store.js';
import { ContextWindowConfigStore, mkDataDir, waitForTurnCompleted, WORKSPACE_READ_FILE_TOOL } from '../../support/agent-loop/shared.js';

describe('review context compaction', () => {
  it('hands off review evidence and the original request when provider usage triggers repeated compaction', async () => {
    const ids = new RandomIdGenerator();
    const threadStore = createTestThreadStore(await mkDataDir(), systemClock, ids);
    const thread = await threadStore.createThread({ title: 'Review with calibrated context' });
    const prompt = 'Review the cancellation flow; report verified findings without changing files.';
    const evidence = 'Cancellation releases the pending tool before completing the turn.';
    const requests: ModelRequest[] = [];
    const summaries: ModelRequest[] = [];
    const loop = new AgentLoop({
      threadStore, ids, clock: systemClock, eventBus: new InMemoryEventBus(),
      configStore: new ContextWindowConfigStore(32_000),
      toolHost: {
        listTools: async () => [WORKSPACE_READ_FILE_TOOL],
        runTool: async () => ({ content: `${evidence}\n${'source evidence '.repeat(800)}` }),
      },
      modelClient: { stream: async function* (request): AsyncGenerator<ModelStreamEvent> {
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
    const started = await loop.startReviewTurn(thread.id, {
      developerInstructions: 'Review mode: inspect only; do not modify files.',
      displayText: 'Review current changes', language: 'en-US', prompt,
    });
    await waitForTurnCompleted(threadStore, thread.id, started.turnId);

    expect(requests).toHaveLength(13);
    expect(summaries.length).toBeGreaterThanOrEqual(2);
    for (const request of requests) {
      expect(request.messages).toContainEqual(expect.objectContaining({ role: 'user', content: prompt }));
      expect(request.stepSnapshot?.inputMessageIds).toContain(started.turnId);
    }
    const events = await threadStore.listEvents(thread.id);
    const compactedEvents = events.filter((event) => event.type === 'thread.context_compacted');
    expect(compactedEvents).toHaveLength(summaries.length);
    for (const event of compactedEvents) {
      const nextRequest = requests.find((request) => request.stepSnapshot!.threadLastSeq >= event.seq);
      expect(nextRequest?.messages.some((message) => message.contextCompaction && message.content.includes(evidence))).toBe(true);
    }
    const saved = await threadStore.getThread(thread.id);
    expect(saved?.messages.some((message) => message.visibility === 'transcript' && message.content.includes(evidence))).toBe(true);
    expect(saved?.messages.filter((message) => message.role === 'assistant').at(-1)?.content).toContain('Review complete');
  });
});
