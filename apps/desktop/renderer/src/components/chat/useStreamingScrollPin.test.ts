import { describe, expect, it } from 'vitest';
import { nextStreamingScrollPinned, scrollDistanceToBottom } from './useStreamingScrollPin.js';

describe('streaming overflow scroll pin', () => {
  it('releases immediately when the user scrolls upward and stays released away from the bottom', () => {
    let pinned = nextStreamingScrollPinned(true, { type: 'user-scroll-up' });
    expect(pinned).toBe(false);

    pinned = nextStreamingScrollPinned(pinned, { type: 'scroll-position', distanceToBottom: 2 });
    expect(pinned).toBe(false);
  });

  it('resumes automatic following only after the user returns to the bottom', () => {
    expect(nextStreamingScrollPinned(false, { type: 'scroll-position', distanceToBottom: 0 })).toBe(true);
    expect(nextStreamingScrollPinned(false, { type: 'scroll-position', distanceToBottom: 1 })).toBe(false);
  });

  it('calculates the remaining scroll distance without returning negative values', () => {
    expect(scrollDistanceToBottom({ clientHeight: 100, scrollHeight: 500, scrollTop: 275 })).toBe(125);
    expect(scrollDistanceToBottom({ clientHeight: 100, scrollHeight: 100, scrollTop: 5 })).toBe(0);
  });
});
