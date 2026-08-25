// @vitest-environment happy-dom

import { act, cleanup, renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  nextStreamingChunkLength,
  useSmoothedStreamingContent,
} from '../../../../../src/features/chat/markdown/useSmoothedStreamingContent.js';

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe('useSmoothedStreamingContent', () => {
  it('briefly holds isolated characters instead of revealing each transport delta', () => {
    vi.useFakeTimers();
    const view = renderHook(
      ({ content }) => useSmoothedStreamingContent(content, true),
      { initialProps: { content: '这' } },
    );

    view.rerender({ content: '这是' });
    act(() => vi.advanceTimersByTime(40));
    expect(view.result.current).toBe('这');

    view.rerender({ content: '这是一段' });
    act(() => vi.advanceTimersByTime(56));
    expect(view.result.current).toBe('这是一段');
  });

  it('coalesces high-frequency character deltas into readable chunks', () => {
    vi.useFakeTimers();
    const view = renderHook(
      ({ content }) => useSmoothedStreamingContent(content, true),
      { initialProps: { content: '这' } },
    );
    const completeContent = '这是一段会被平滑分批显示的中文回复，而不是逐字跳出来。';

    for (let index = 2; index <= completeContent.length; index += 1) {
      view.rerender({ content: completeContent.slice(0, index) });
    }

    expect(view.result.current).toBe('这');
    act(() => vi.advanceTimersByTime(28));
    expect(view.result.current.length).toBeGreaterThan(2);
    expect(view.result.current.length).toBeLessThan(completeContent.length);

    act(() => vi.advanceTimersByTime(500));
    expect(view.result.current).toBe(completeContent);
  });

  it('flushes the exact content immediately when streaming completes', () => {
    vi.useFakeTimers();
    const view = renderHook(
      ({ content, streaming }) => useSmoothedStreamingContent(content, streaming),
      { initialProps: { content: '开', streaming: true } },
    );

    view.rerender({ content: '开始输出一段还未显示完成的内容', streaming: true });
    expect(view.result.current).toBe('开');

    view.rerender({ content: '开始输出一段还未显示完成的内容', streaming: false });
    expect(view.result.current).toBe('开始输出一段还未显示完成的内容');
  });

  it('shows non-append rewrites without waiting for a timer', () => {
    vi.useFakeTimers();
    const view = renderHook(
      ({ content }) => useSmoothedStreamingContent(content, true),
      { initialProps: { content: 'old content' } },
    );

    view.rerender({ content: 'rewritten content' });

    expect(view.result.current).toBe('rewritten content');
  });
});

describe('nextStreamingChunkLength', () => {
  it('prefers nearby phrase boundaries and never splits surrogate pairs', () => {
    expect(nextStreamingChunkLength('abcdefghij klmnopqrstuvwxyz')).toBe(11);

    const emojiContent = '😀'.repeat(20);
    const chunkLength = nextStreamingChunkLength(emojiContent);
    expect(emojiContent.slice(0, chunkLength)).toBe('😀'.repeat(10));
  });
});
