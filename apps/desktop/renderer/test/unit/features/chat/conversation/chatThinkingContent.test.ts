import { describe, expect, it } from 'vitest';
import {
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

  it('keeps nested tag examples inside the outer thinking segment', () => {
    const content = '<think>inspect "before<think>private</think>after" and keep reasoning';

    expect(splitThinkingContent(content, true)).toEqual([{
      type: 'think',
      content: 'inspect "before<think>private</think>after" and keep reasoning',
      closed: false,
    }]);
  });

  it('keeps streaming final text visible when it mentions the old protocol as inline code', () => {
    const content = '审查范围主要是将 `<think>` 标签迁移为结构化通道。';

    expect(splitThinkingContent(content, true)).toEqual([{
      type: 'markdown',
      content,
      closed: true,
    }]);
  });

  it('does not expose a legacy streaming tail after an ambiguous closing-tag example', () => {
    const content = '<think>private reasoning mentions </think> but is still running';

    expect(splitThinkingContent(content, true)).toEqual([{
      type: 'think',
      content: 'private reasoning mentions </think> but is still running',
      closed: false,
    }]);
  });
});
