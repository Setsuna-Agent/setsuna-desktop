// @vitest-environment happy-dom
import { cleanup, render } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { RuntimeErrorNotice, runtimeErrorNoticeMessage } from '../../../../src/app/layout/RuntimeErrorNotice.js';

const toast = vi.hoisted(() => ({ error: vi.fn(), dismiss: vi.fn() }));
vi.mock('../../../../src/app/providers/ToastProvider.js', () => ({ useToast: () => toast }));
afterEach(() => { cleanup(); vi.clearAllMocks(); });

describe('RuntimeErrorNotice', () => {
  it('owns one shared toast and dismisses it when the error changes or its conversation leaves', () => {
    toast.error.mockReturnValueOnce(1).mockReturnValueOnce(2);
    const view = render(<RuntimeErrorNotice message="first error" />);
    view.rerender(<RuntimeErrorNotice message="first error" />);
    expect(toast.error).toHaveBeenCalledTimes(1);
    expect(toast.error).toHaveBeenLastCalledWith('first error');
    view.rerender(<RuntimeErrorNotice message="second error" />);
    expect(toast.dismiss).toHaveBeenCalledWith(1);
    expect(toast.error).toHaveBeenLastCalledWith('second error');
    view.unmount();
    expect(toast.dismiss).toHaveBeenLastCalledWith(2);
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
    expect(runtimeErrorNoticeMessage(
      `Error invoking remote method 'runtime:request': Error: ${error} (POST /v1/threads/thread_old/turns)`, thread,
    )).toBeNull();
    expect(runtimeErrorNoticeMessage('另一个错误', thread)).toBe('另一个错误');
    expect(runtimeErrorNoticeMessage('   ', thread)).toBeNull();
  });
});
