import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createRuntimeServerTestHarness, type RuntimeServerTestHarness } from '../../support/runtime-server/harness.js';
import {
  createOpenAiCaptureServer,
  withTimeout
} from '../../support/runtime-server/shared.js';

describe('runtime server reviews and message mutations', () => {
  let harness: RuntimeServerTestHarness;

  beforeEach(async () => {
    harness = await createRuntimeServerTestHarness();
  });

  afterEach(async () => {
    await harness.close();
  });

  it('starts inline AppServer reviews with visible review mode markers', async () => {
      const capture = await createOpenAiCaptureServer();
      try {
        await harness.runtimeFetch('/v1/config', {
          method: 'PUT',
          body: JSON.stringify({
            activeProviderId: 'review-provider',
            providers: [
              {
                id: 'review-provider',
                name: 'Review provider',
                provider: 'openai-compatible',
                baseUrl: capture.baseUrl,
                apiKey: 'sk-review',
                enabled: true,
                models: [
                  {
                    id: 'review-model',
                    name: 'Review model',
                    code: 'review-model',
                    enabled: true,
                    maxOutputTokens: 1000,
                    thinkingEnabled: false,
                    thinkingEfforts: [],
                  },
                ],
              },
            ],
          }),
        });
        const startedThread = await harness.appServerRpc('thread/start', { name: 'Inline review', cwd: process.cwd() });
        const review = await harness.appServerRpc('review/start', {
          threadId: startedThread.thread.id,
          delivery: 'inline',
          target: { type: 'commit', sha: '1234567890abcdef', title: 'Tidy UI colors' },
        });
        const body = await withTimeout(capture.nextBody, harness.providerCaptureTimeoutMs, 'Timed out waiting for review provider request');
  
        expect(JSON.stringify(body)).toContain('Review commit 1234567890abcdef: Tidy UI colors.');
        expect(review).toMatchObject({
          reviewThreadId: startedThread.thread.id,
          turn: {
            status: 'inProgress',
            itemsView: 'notLoaded',
            items: [
              {
                type: 'userMessage',
                clientId: null,
                content: [{ type: 'text', text: 'commit 1234567: Tidy UI colors' }],
              },
            ],
          },
        });
  
        const turnId = review.turn.id as string;
        const updated = await harness.waitForThread(
          startedThread.thread.id,
          (item) =>
            item.messages.some((message) => message.turnId === turnId && message.reviewMode?.kind === 'entered')
            && item.messages.some((message) => message.turnId === turnId && message.role === 'assistant' && message.content === 'Captured.')
            && item.messages.some((message) => message.turnId === turnId && message.reviewMode?.kind === 'exited' && message.reviewMode.review === 'Captured.'),
        );
        const reviewMessages = updated.messages.filter((message) => message.turnId === turnId && message.reviewMode);
        const hasEnteredReviewItem = await harness.readEventStreamContains(
          startedThread.thread.id,
          0,
          '"type":"enteredReviewMode"',
          { format: 'swe' },
        );
        const hasExitedReviewItem = await harness.readEventStreamContains(
          startedThread.thread.id,
          0,
          '"type":"exitedReviewMode"',
          { format: 'swe' },
        );
        const read = await harness.appServerRpc('thread/read', { threadId: startedThread.thread.id, includeTurns: true });
        const activeTurn = read.thread.turns.find((turn: { id: string }) => turn.id === turnId);
  
        expect(review.turn.items[0].id).toBe(turnId);
        expect(reviewMessages.map((message) => message.reviewMode?.kind)).toEqual(['entered', 'exited']);
        expect(hasEnteredReviewItem).toBe(true);
        expect(hasExitedReviewItem).toBe(true);
        expect(activeTurn?.items).toEqual(expect.arrayContaining([
          expect.objectContaining({ type: 'enteredReviewMode', id: turnId, review: 'commit 1234567: Tidy UI colors' }),
          expect.objectContaining({ type: 'agentMessage', text: 'Captured.' }),
          expect.objectContaining({ type: 'exitedReviewMode', id: turnId, review: 'Captured.' }),
        ]));
      } finally {
        await capture.close();
      }
    });
  
  it('rejects detached AppServer reviews until a visible thread route exists', async () => {
      const startedThread = await harness.appServerRpc('thread/start', { name: 'Detached review', cwd: process.cwd() });
  
      await expect(harness.appServerRpcEnvelope({
        id: 'detached_review',
        method: 'review/start',
        params: {
          threadId: startedThread.thread.id,
          delivery: 'detached',
          target: { type: 'custom', instructions: 'Review elsewhere.' },
        },
      })).resolves.toMatchObject({
        id: 'detached_review',
        error: { code: -32600, message: 'review/start detached delivery is not supported yet' },
      });
    });
  
  it('updates, deletes, and regenerates thread messages through the runtime API', async () => {
      const thread = await harness.runtimeFetch('/v1/threads', {
        method: 'POST',
        body: JSON.stringify({ title: 'Message actions' }),
      });
      await harness.runtimeFetch(`/v1/threads/${encodeURIComponent(thread.id)}/turns`, {
        method: 'POST',
        body: JSON.stringify({ input: 'Original prompt.' }),
      });
      const populated = await harness.waitForThread(thread.id, (item) => item.messages.some((message) => message.role === 'assistant' && message.status === 'complete'));
      const userMessage = populated.messages.find((message) => message.role === 'user');
      const assistantMessage = populated.messages.find((message) => message.role === 'assistant');
  
      if (!userMessage || !assistantMessage) throw new Error('Expected a completed user/assistant exchange.');
  
      const edited = await harness.runtimeFetch(`/v1/threads/${encodeURIComponent(thread.id)}/messages/${encodeURIComponent(userMessage.id)}`, {
        method: 'PATCH',
        body: JSON.stringify({ content: 'Edited prompt.' }),
      });
      expect(edited.messages.find((message: { id: string }) => message.id === userMessage.id)).toMatchObject({ content: 'Edited prompt.' });
  
      const deleted = await harness.runtimeFetch(`/v1/threads/${encodeURIComponent(thread.id)}/messages`, {
        method: 'DELETE',
        body: JSON.stringify({ messageIds: [assistantMessage.id] }),
      });
      expect(deleted.messages.some((message: { id: string }) => message.id === assistantMessage.id)).toBe(false);
  
      const regenerated = await harness.runtimeFetch(`/v1/threads/${encodeURIComponent(thread.id)}/messages/${encodeURIComponent(userMessage.id)}/regenerate`, {
        method: 'POST',
        body: JSON.stringify({ content: 'Regenerated prompt.' }),
      });
      const rerun = await harness.waitForThread(
        thread.id,
        (item) => item.messages.some((message) => message.turnId === regenerated.turnId && message.role === 'assistant' && message.status === 'complete'),
      );
  
      expect(rerun.messages.filter((message) => message.role === 'user').map((message) => message.content)).toEqual(['Regenerated prompt.']);
      expect(rerun.messages.some((message) => message.id === assistantMessage.id)).toBe(false);
    });
});
