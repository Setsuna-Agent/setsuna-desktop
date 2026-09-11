// @vitest-environment happy-dom

import { act, cleanup, renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { useSmoothedStreamingContent } from '../../../../../src/features/chat/markdown/useSmoothedStreamingContent.js';

function mockFrames() {
  let now = 0;
  let nextId = 0;
  let reducedMotion = false;
  const callbacks = new Map<number, FrameRequestCallback>();
  vi.spyOn(performance, 'now').mockImplementation(() => now);
  vi.spyOn(window, 'requestAnimationFrame').mockImplementation((callback) => {
    const id = ++nextId;
    callbacks.set(id, callback);
    return id;
  });
  vi.spyOn(window, 'cancelAnimationFrame').mockImplementation((id) => { callbacks.delete(id); });
  vi.spyOn(window, 'matchMedia').mockReturnValue({
    get matches() { return reducedMotion; },
  } as MediaQueryList);
  return {
    callbacks,
    elapse(ms: number) { now += ms; },
    reduce() { reducedMotion = true; },
    frame(ms = 16) {
      now += ms;
      const pending = [...callbacks.values()];
      callbacks.clear();
      act(() => { pending.forEach((callback) => callback(now)); });
    },
  };
}

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe('useSmoothedStreamingContent', () => {
  it('keeps progressing on frames even when new deltas arrive more frequently', () => {
    const frames = mockFrames();
    const view = renderHook(
      ({ content }) => useSmoothedStreamingContent(content, true),
      { initialProps: { content: '' } },
    );
    const content = '连续输出的文字不会因为网络不断追加而重置等待时间';
    for (let length = 1; length <= 4; length += 1) {
      view.rerender({ content: content.slice(0, length) });
      frames.elapse(4);
    }
    expect(view.result.current).toBe('');
    expect(frames.callbacks.size).toBe(1);
    frames.frame(0);
    expect(view.result.current).toBe('连');
    frames.frame();
    expect(view.result.current).toBe('连续输');
    frames.frame();
    expect(view.result.current).toBe('连续输出');
    expect(frames.callbacks.size).toBe(0);
  });

  it('spreads a large burst across frames and catches up without a long replay', () => {
    const frames = mockFrames();
    const view = renderHook(
      ({ content }) => useSmoothedStreamingContent(content, true),
      { initialProps: { content: 'Intro. ' } },
    );
    const content = `Intro. ${'流式正文'.repeat(250)}`;
    view.rerender({ content });
    frames.frame();
    expect(view.result.current.length).toBeGreaterThan('Intro. '.length);
    expect(view.result.current.length).toBeLessThan(content.length / 10);
    let previous = view.result.current;
    for (let index = 0; index < 125; index += 1) {
      frames.frame();
      expect(view.result.current.startsWith(previous)).toBe(true);
      previous = view.result.current;
    }
    expect(view.result.current).toBe(content);
    expect(frames.callbacks.size).toBe(0);
  });

  it('preserves grapheme boundaries while revealing mixed Chinese and emoji text', () => {
    const frames = mockFrames();
    const view = renderHook(
      ({ content }) => useSmoothedStreamingContent(content, true),
      { initialProps: { content: '' } },
    );
    const graphemes = ['中', '文', '👩🏽‍💻', 'e\u0301', '🇨🇳', '结', '束'];
    const content = graphemes.join('');
    const prefixes = new Set(graphemes.map((_, index) => graphemes.slice(0, index + 1).join('')));
    view.rerender({ content });
    for (let index = 0; index < 8; index += 1) {
      frames.frame();
      expect(prefixes.has(view.result.current)).toBe(true);
    }
    expect(view.result.current).toBe(content);
  });

  it('shows history and completion immediately and cancels pending frames', () => {
    const frames = mockFrames();
    const view = renderHook(
      ({ content, streaming }) => useSmoothedStreamingContent(content, streaming),
      { initialProps: { content: '已有内容', streaming: true } },
    );
    expect(view.result.current).toBe('已有内容');
    expect(frames.callbacks.size).toBe(0);
    view.rerender({ content: '已有内容以及尚未显示的追加正文', streaming: true });
    expect(frames.callbacks.size).toBe(1);
    view.rerender({ content: '已有内容以及尚未显示的追加正文', streaming: false });
    expect(view.result.current).toBe('已有内容以及尚未显示的追加正文');
    expect(frames.callbacks.size).toBe(0);
  });

  it('drops old queued text on correction and cancels work on unmount', () => {
    const frames = mockFrames();
    const view = renderHook(
      ({ content }) => useSmoothedStreamingContent(content, true),
      { initialProps: { content: 'old' } },
    );
    view.rerender({ content: 'old queued response' });
    view.rerender({ content: 'corrected response' });
    frames.frame();
    expect(view.result.current).toBe('corrected response');
    expect(frames.callbacks.size).toBe(0);
    view.rerender({ content: 'corrected response with new text' });
    expect(frames.callbacks.size).toBe(1);
    view.unmount();
    expect(frames.callbacks.size).toBe(0);
  });

  it('honors reduced motion during a stream and on subsequent updates', () => {
    const frames = mockFrames();
    const view = renderHook(
      ({ content }) => useSmoothedStreamingContent(content, true),
      { initialProps: { content: '' } },
    );
    view.rerender({ content: '正在输出一段文字' });
    frames.reduce();
    frames.frame();
    expect(view.result.current).toBe('正在输出一段文字');
    expect(frames.callbacks.size).toBe(0);
    view.rerender({ content: '正在输出一段文字，直接显示后续内容' });
    expect(view.result.current).toBe('正在输出一段文字，直接显示后续内容');
    expect(frames.callbacks.size).toBe(0);
  });
});
