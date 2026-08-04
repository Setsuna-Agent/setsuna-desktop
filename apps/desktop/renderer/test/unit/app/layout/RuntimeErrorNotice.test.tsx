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

  it('surfaces an event error immediately and ignores empty messages', () => {
    expect(runtimeErrorNoticeMessage('  模型服务返回了空响应  ')).toBe('模型服务返回了空响应');
    expect(runtimeErrorNoticeMessage('   ')).toBeNull();
    expect(runtimeErrorNoticeMessage(null)).toBeNull();
  });
});
