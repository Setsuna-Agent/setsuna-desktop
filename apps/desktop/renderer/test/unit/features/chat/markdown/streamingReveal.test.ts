import { describe, expect, it } from 'vitest';
import {
  initialStreamingRevealState,
  initialStreamingRevealTimeline,
  maximumStreamingRevealRanges,
  reconcileStreamingRevealState,
  resolveStreamingRevealAnimation,
  resolveStreamingRevealTimelineAnimation,
  splitStreamingRevealUnits,
  streamingRevealDurationMs,
  streamingRevealUnitStaggerMs,
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
    expect(resolveStreamingRevealAnimation(startedAtByKey, '7', 1_500)).toEqual({
      active: false,
      delayMs: -streamingRevealDurationMs,
    });
  });

  it('stagger-schedules visual words across transport chunks on one timeline', () => {
    const timeline = initialStreamingRevealTimeline();

    expect(resolveStreamingRevealTimelineAnimation(timeline, '0:0', 1_000)).toEqual({
      active: true,
      delayMs: 0,
    });
    expect(resolveStreamingRevealTimelineAnimation(timeline, '0:6', 1_000)).toEqual({
      active: true,
      delayMs: streamingRevealUnitStaggerMs,
    });
    expect(resolveStreamingRevealTimelineAnimation(timeline, '1:12', 1_000)).toEqual({
      active: true,
      delayMs: streamingRevealUnitStaggerMs * 2,
    });
    expect(resolveStreamingRevealTimelineAnimation(timeline, '0:6', 1_100)).toEqual({
      active: true,
      delayMs: -(100 - streamingRevealUnitStaggerMs),
    });
  });

  it('splits prose into flowing words instead of one transport-sized unit', () => {
    expect(splitStreamingRevealUnits('Hello, world!')).toEqual([
      { start: 0, text: 'Hello, ' },
      { start: 7, text: 'world!' },
    ]);
  });

  it('bounds animated ranges during long streams', () => {
    let state = initialStreamingRevealState('');
    for (let index = 0; index < maximumStreamingRevealRanges + 8; index += 1) {
      state = reconcileStreamingRevealState(state, `${state.content}x`, true);
    }

    expect(state.ranges).toHaveLength(maximumStreamingRevealRanges);
    expect(state.ranges[0]?.key).toBe(8);
  });
});
