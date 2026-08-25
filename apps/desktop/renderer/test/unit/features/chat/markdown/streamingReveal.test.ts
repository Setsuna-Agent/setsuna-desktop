import { describe, expect, it } from 'vitest';
import {
  initialStreamingRevealState,
  reconcileStreamingRevealState,
  resolveStreamingRevealAnimation,
} from '../../../../../src/features/chat/markdown/streamingReveal.js';

describe('reconcileStreamingRevealState', () => {
  it('keeps earlier streamed chunks mounted while appending the next chunk', () => {
    const initial = initialStreamingRevealState('开');
    const firstChunk = reconcileStreamingRevealState(initial, '开始输出', true);
    const secondChunk = reconcileStreamingRevealState(firstChunk, '开始输出一段内容', true);

    expect(firstChunk.ranges).toEqual([{ start: 1, end: 4, key: 0 }]);
    expect(secondChunk.ranges).toEqual([
      { start: 1, end: 4, key: 0 },
      { start: 4, end: 8, key: 1 },
    ]);
  });

  it('clips repaired Markdown suffixes without replaying the stable chunk', () => {
    const initial = initialStreamingRevealState('**The**');
    const firstChunk = reconcileStreamingRevealState(initial, '**The use**', true);
    const secondChunk = reconcileStreamingRevealState(firstChunk, '**The useState**', true);

    expect(secondChunk.ranges).toEqual([
      { start: 5, end: 9, key: 0 },
      { start: 9, end: 16, key: 1 },
    ]);
    expect(reconcileStreamingRevealState(secondChunk, '**The useState**', false).ranges).toEqual([]);
  });

  it('resumes a reveal timeline after a Markdown reparse instead of replaying it', () => {
    const startedAtByKey = new Map<string, number>();

    expect(resolveStreamingRevealAnimation(startedAtByKey, '7', 1_000)).toEqual({
      active: true,
      delayMs: 0,
    });
    expect(resolveStreamingRevealAnimation(startedAtByKey, '7', 1_120)).toEqual({
      active: true,
      delayMs: -120,
    });
    expect(resolveStreamingRevealAnimation(startedAtByKey, '7', 1_300)).toEqual({
      active: false,
      delayMs: -280,
    });
  });
});
