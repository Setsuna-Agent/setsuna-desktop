import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { ChatThinkingDisclosure } from '../../../../../src/features/chat/conversation/ChatThinkingDisclosure.js';

describe('ChatThinkingDisclosure', () => {
  it('keeps active thinking collapsed by default', () => {
    const html = renderToStaticMarkup(
      <ChatThinkingDisclosure active content="Inspect the runtime chain." scrollStateKey="thinking_1" />,
    );

    expect(html).toContain('正在思考');
    expect(html).not.toContain('Inspect the runtime chain.');
  });

  it('keeps completed thinking collapsed by default', () => {
    const html = renderToStaticMarkup(
      <ChatThinkingDisclosure active={false} content="Inspect the runtime chain." scrollStateKey="thinking_1" />,
    );

    expect(html).toContain('思考过程');
    expect(html).not.toContain('Inspect the runtime chain.');
  });
});
