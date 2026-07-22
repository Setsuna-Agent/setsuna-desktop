import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { RuntimeErrorNotice, runtimeErrorNoticeMessage } from '../../../../src/app/layout/RuntimeErrorNotice.js';

describe('RuntimeErrorNotice', () => {
  it('renders a dismissible alert with the runtime error details', () => {
    const html = renderToStaticMarkup(
      <RuntimeErrorNotice message="模型服务返回异常状态：403" onDismiss={vi.fn()} />,
    );

    expect(html).toContain('role="alert"');
    expect(html).toContain('运行时错误');
    expect(html).toContain('模型服务返回异常状态：403');
    expect(html).toContain('aria-label="关闭运行时错误提示"');
  });

  it('suppresses a duplicate error already projected into the transcript', () => {
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
  });
});
