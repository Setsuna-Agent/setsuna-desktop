import { describe, expect, it } from 'vitest';
import {
  hasOpenThinkingSegments,
  hasRenderableThinkingContent,
  hasThinkingSegments,
  splitThinkingContent,
  visibleMarkdownContent,
} from '../../../../../src/features/chat/conversation/chatThinkingContent.js';

describe('chatThinkingContent', () => {
  it('splits closed thinking from visible markdown', () => {
    expect(splitThinkingContent('<think>plan</think>answer')).toEqual([
      { type: 'think', content: 'plan', closed: true },
      { type: 'markdown', content: 'answer', closed: true },
    ]);
    expect(visibleMarkdownContent('<think>plan</think>answer')).toBe('answer');
  });

  it('supports escaped think tags from streamed markdown text', () => {
    expect(visibleMarkdownContent('&lt;think&gt;plan&lt;/think&gt;\n\nanswer')).toBe('\n\nanswer');
  });

  it('renders only unclosed streaming thinking segments', () => {
    expect(hasRenderableThinkingContent('<think>plan</think>', false)).toBe(false);
    expect(hasRenderableThinkingContent('<think>plan', false)).toBe(false);
    expect(hasRenderableThinkingContent('<think>plan', true)).toBe(true);
  });

  it('keeps thinking evidence available for the work panel', () => {
    expect(hasThinkingSegments('<think>plan</think>answer')).toBe(true);
    expect(hasThinkingSegments('answer')).toBe(false);
  });

  it('distinguishes open streaming thinking from completed hidden thinking', () => {
    expect(hasOpenThinkingSegments('<think>plan', true)).toBe(true);
    expect(hasOpenThinkingSegments('<think>plan</think>answer', true)).toBe(false);
    expect(hasOpenThinkingSegments('<think>plan', false)).toBe(false);
  });
});
