import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { ActiveThinkingDisclosure } from '../../../../../src/features/chat/conversation/ActiveThinkingDisclosure.js';

describe('ActiveThinkingDisclosure', () => {
  it('starts as a compact disclosure without rendering hidden thinking content', () => {
    const html = renderToStaticMarkup(
      <ActiveThinkingDisclosure content="Inspect the runtime chain." scrollStateKey="thinking_1" />,
    );

    expect(html).toContain('<details class="chat-thinking-disclosure">');
    expect(html).toContain('正在思考');
    expect(html).toContain('chat-thinking-disclosure__chevron');
    expect(html).not.toMatch(/<details[^>]*\bopen(?:=|\s|>)/u);
    expect(html).not.toContain('Inspect the runtime chain.');
  });
});
