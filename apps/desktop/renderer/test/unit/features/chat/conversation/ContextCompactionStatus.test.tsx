import type { RuntimeMessage } from '@setsuna-desktop/contracts';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { ContextCompactionStatus } from '../../../../../src/features/chat/conversation/ContextCompactionStatus.js';

describe('ContextCompactionStatus', () => {
  it('renders an indeterminate loading state without a fake percentage', () => {
    const html = renderToStaticMarkup(<ContextCompactionStatus active />);

    expect(html).toContain('正在压缩上下文');
    expect(html).toContain('chat-timeline-divider is-loading');
    expect(html).toContain('chat-loading-text chat-timeline-divider__label');
    expect(html).not.toContain('%');
  });

  it('renders the completed compacted message count', () => {
    const message: RuntimeMessage = {
      id: 'message_compaction',
      role: 'system',
      content: 'summary',
      createdAt: '2026-07-11T00:00:00.000Z',
      status: 'complete',
      contextCompaction: {
        compactedMessageCount: 12,
        compactedTokens: 128,
        keptRecentMessageCount: 2,
        maxContextTokensK: 256,
        originalMessageCount: 14,
        originalTokens: 512,
      },
    };

    expect(renderToStaticMarkup(<ContextCompactionStatus message={message} />)).toContain('已压缩 12 条上下文');
  });
});
