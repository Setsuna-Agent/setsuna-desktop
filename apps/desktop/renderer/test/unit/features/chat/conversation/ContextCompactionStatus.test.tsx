import type { RuntimeMessage } from '@setsuna-desktop/contracts';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { ContextCompactionStatus } from '../../../../../src/features/chat/conversation/ContextCompactionStatus.js';

describe('ContextCompactionStatus', () => {
  it('renders divider progress and the completed compacted-message count', () => {
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

    expect(activeHtml).toContain('chat-timeline-divider is-loading');
    expect(activeHtml).toContain('正在压缩上下文');
    expect(activeHtml).not.toContain('%');
    expect(renderToStaticMarkup(<ContextCompactionStatus message={message} />)).toContain('已压缩 12 条上下文');
  });

  it('renders turn compaction as a compact tool row without divider lines', () => {
    const activeHtml = renderToStaticMarkup(<ContextCompactionStatus active presentation="tool" />);
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
    const completedHtml = renderToStaticMarkup(<ContextCompactionStatus message={message} presentation="tool" />);

    expect(activeHtml).toContain('chat-tool-run--running');
    expect(activeHtml).toContain('lucide-grip');
    expect(activeHtml).toContain('正在压缩上下文');
    expect(completedHtml).toContain('chat-tool-run--success');
    expect(completedHtml).toContain('已压缩 12 条上下文');
    expect(completedHtml).not.toContain('chat-timeline-divider');
  });
});
