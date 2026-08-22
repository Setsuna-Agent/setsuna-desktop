// @vitest-environment happy-dom

import { cleanup, fireEvent, render } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { WorkHistoryPanel } from '../../../../../src/features/chat/conversation/ChatWorkHistory.js';

afterEach(cleanup);

describe('WorkHistoryPanel', () => {
  it('expands once when live details first arrive without overriding a later manual collapse', () => {
    const panel = ({ hasDetails, detail = '读取文件' }: { detail?: string; hasDetails: boolean }) => (
      <WorkHistoryPanel
        active
        defaultExpanded
        hasDetails={hasDetails}
        persistentChildren={<span>子代理任务</span>}
      >
        <span>子代理任务</span>
        <span>{detail}</span>
      </WorkHistoryPanel>
    );
    const view = render(panel({ hasDetails: false }));

    expect(view.container.querySelector('.chat-work-history__summary')?.getAttribute('aria-expanded')).toBeNull();
    expect(view.queryByText('读取文件')).toBeNull();

    view.rerender(panel({ hasDetails: true }));
    const summary = view.container.querySelector<HTMLButtonElement>('.chat-work-history__summary');
    expect(summary?.getAttribute('aria-expanded')).toBe('true');
    expect(view.getByText('读取文件')).toBeTruthy();

    fireEvent.click(summary!);
    expect(summary?.getAttribute('aria-expanded')).toBe('false');
    expect(view.queryByText('读取文件')).toBeNull();
    expect(view.getByText('子代理任务')).toBeTruthy();

    view.rerender(panel({ hasDetails: false }));
    view.rerender(panel({ detail: '继续读取', hasDetails: true }));
    expect(view.container.querySelector('.chat-work-history__summary')?.getAttribute('aria-expanded')).toBe('false');
    expect(view.queryByText('继续读取')).toBeNull();
  });
});
