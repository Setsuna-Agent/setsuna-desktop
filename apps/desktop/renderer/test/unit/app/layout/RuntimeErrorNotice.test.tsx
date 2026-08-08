import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { RuntimeErrorNotice, runtimeErrorNoticeMessage } from '../../../../src/app/layout/RuntimeErrorNotice.js';

describe('RuntimeErrorNotice', () => {
  it('renders runtime details in a dismissible alert', () => {
    const html = renderToStaticMarkup(
      <RuntimeErrorNotice message="provider returned 403" onDismiss={() => undefined} />,
    );

    expect(html).toContain('role="alert"');
    expect(html).toContain('provider returned 403');
    expect(html).toContain('aria-label="关闭运行时错误提示"');
  });

  it('suppresses an error already visible in the transcript', () => {
    const error = '模型服务返回了空响应';
    const thread = {
      messages: [{
        id: 'message_error',
        role: 'assistant' as const,
        content: '',
        createdAt: '2026-07-21T00:00:00.000Z',
        status: 'error' as const,
        error,
      }],
    };

    expect(runtimeErrorNoticeMessage(error, thread)).toBeNull();
    expect(runtimeErrorNoticeMessage('另一个错误', thread)).toBe('另一个错误');
    expect(runtimeErrorNoticeMessage('   ', thread)).toBeNull();
  });
});
