import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { ConversationDebugLoadingState } from '../../../../src/features/conversation-debug/ConversationDebugLoadingState.js';

describe('ConversationDebugLoadingState', () => {
  it('renders an accessible flow-shaped loading indicator', () => {
    const html = renderToStaticMarkup(
      <ConversationDebugLoadingState label="正在准备流程数据…" />,
    );

    expect(html).toContain('role="status"');
    expect(html).toContain('aria-live="polite"');
    expect(html).toContain('class="conversation-debug-loading" aria-hidden="true"');
    expect(html.match(/conversation-debug-loading__node/g)).toHaveLength(3);
    expect(html).toContain('正在准备流程数据…');
    expect(html).not.toContain('<svg');
  });
});
