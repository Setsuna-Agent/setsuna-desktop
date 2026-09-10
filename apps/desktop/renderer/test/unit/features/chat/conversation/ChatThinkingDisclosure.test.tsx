import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { ChatThinkingDisclosure } from '../../../../../src/features/chat/conversation/ChatThinkingDisclosure.js';

describe('ChatThinkingDisclosure', () => {
  it('starts as the compact disclosure with a thinking indicator', () => {
    const html = renderToStaticMarkup(
      <ChatThinkingDisclosure active content="Inspect the runtime chain." scrollStateKey="thinking_1" />,
    );

    expect(html).toContain('<details class="chat-thinking-disclosure is-active">');
    expect(html).toContain('正在思考');
    expect(html).toContain('lucide-brain');
    expect(html).toContain('chat-loading-text');
    expect(html).toContain('chat-thinking-disclosure__chevron');
    expect(html).not.toContain('Inspect the runtime chain.');
  });

  it('keeps completed thinking as a static expandable disclosure', () => {
    const html = renderToStaticMarkup(
      <ChatThinkingDisclosure active={false} content="Inspect the runtime chain." scrollStateKey="thinking_1" />,
    );

    expect(html).toContain('思考过程');
    expect(html).not.toContain('Inspect the runtime chain.');
    expect(html).not.toContain('chat-loading-text');
  });
});
