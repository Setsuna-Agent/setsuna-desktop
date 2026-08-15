import { describe, expect, it } from 'vitest';
import { assistantRunCopyText } from '../../../../../src/features/chat/conversation/chatMessageDisplay.js';

describe('assistantRunCopyText', () => {
  it('copies a completed review once without hidden thinking content', () => {
    expect(assistantRunCopyText({
      type: 'assistant',
      id: 'assistant_1',
      handledSteerMessageIds: [],
      messageIds: ['assistant_1'],
      reviewExit: {
        kind: 'exited',
        review: '<think>internal plan</think>visible answer',
      },
      steerMessages: [],
      segments: [{
        id: 'assistant_1',
        role: 'assistant',
        content: '<think>internal plan</think>visible answer',
        phase: 'final_answer',
        createdAt: '2026-06-26T00:00:02.000Z',
        status: 'complete',
      }],
    })).toBe('visible answer');
  });

  it('copies literal think tags from a review with an authoritative reasoning boundary', () => {
    const review = '<think>literal example</think> is visible review text.';

    expect(assistantRunCopyText({
      type: 'assistant',
      id: 'assistant_review_structured',
      handledSteerMessageIds: [],
      messageIds: ['assistant_review_structured'],
      reviewExit: { kind: 'exited', reasoningSeparated: true, review },
      steerMessages: [],
      segments: [],
    })).toBe(review);
  });

  it('preserves literal think tags when copying authoritative structured content', () => {
    const content = '<think>literal example</think> is visible answer text.';

    expect(assistantRunCopyText({
      type: 'assistant',
      id: 'assistant_structured',
      handledSteerMessageIds: [],
      messageIds: ['assistant_structured'],
      steerMessages: [],
      segments: [{
        id: 'assistant_structured',
        role: 'assistant',
        content,
        streamParts: [{ type: 'content', content }],
        phase: 'final_answer',
        createdAt: '2026-06-26T00:00:02.000Z',
        status: 'complete',
      }],
    })).toBe(content);
  });
});
