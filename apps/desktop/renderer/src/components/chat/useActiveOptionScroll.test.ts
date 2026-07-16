import { describe, expect, it } from 'vitest';
import { nextActiveOptionScrollTop } from './useActiveOptionScroll.js';

const baseMetrics = {
  clientHeight: 100,
  clientTop: 1,
  optionBottom: 80,
  optionTop: 52,
  scrollHeight: 300,
  scrollTop: 40,
  viewportTop: 10,
};

describe('active option scrolling', () => {
  it('keeps the current scroll position when the active option is visible', () => {
    expect(nextActiveOptionScrollTop(baseMetrics)).toBe(40);
  });

  it('scrolls down just enough to reveal an option below the viewport', () => {
    expect(nextActiveOptionScrollTop({
      ...baseMetrics,
      optionBottom: 139,
      optionTop: 111,
    })).toBe(68);
  });

  it('scrolls up just enough to reveal an option above the viewport', () => {
    expect(nextActiveOptionScrollTop({
      ...baseMetrics,
      optionBottom: 29,
      optionTop: 1,
    })).toBe(30);
  });

  it('clamps scrolling to the container boundaries', () => {
    expect(nextActiveOptionScrollTop({
      ...baseMetrics,
      optionBottom: 340,
      optionTop: 312,
      scrollTop: 190,
    })).toBe(200);
    expect(nextActiveOptionScrollTop({
      ...baseMetrics,
      optionBottom: -2,
      optionTop: -30,
      scrollTop: 5,
    })).toBe(0);
  });
});
