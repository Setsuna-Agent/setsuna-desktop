import type { RuntimeMessage } from '@setsuna-desktop/contracts';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { ContextCompactionStatus } from '../../../../../src/features/chat/conversation/ContextCompactionStatus.js';

describe('ContextCompactionStatus', () => {
  it('renders active and completed compaction inline with icons for every caller', () => {
    const activeHtml = renderToStaticMarkup(<ContextCompactionStatus active />);
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
    const completedHtml = renderToStaticMarkup(<ContextCompactionStatus message={message} />);

    expect(activeHtml).toContain('chat-tool-run--running');
    expect(activeHtml).toContain('lucide-grip');
    expect(activeHtml).toContain('正在压缩上下文');
    expect(activeHtml).toContain('role="status"');
    expect(activeHtml).not.toContain('chat-timeline-divider');
    expect(completedHtml).toContain('chat-tool-run--success');
    expect(completedHtml).toContain('lucide-circle-check');
    expect(completedHtml).toContain('已压缩 12 条上下文');
    expect(completedHtml).not.toContain('chat-timeline-divider');
  });
});
