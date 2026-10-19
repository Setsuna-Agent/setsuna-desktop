// @vitest-environment happy-dom

import { cleanup, fireEvent, render, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { WorkHistoryDetails, WorkHistoryPanel } from '../../../../../src/features/chat/conversation/ChatWorkHistory.js';
import { ChatWorkHistoryTimeline } from '../../../../../src/features/chat/conversation/ChatWorkHistoryTimeline.js';

afterEach(cleanup);

describe('WorkHistoryPanel', () => {
  it('expands once when live details first arrive without overriding a later manual collapse', async () => {
    const panel = ({ hasDetails, detail = '读取文件' }: { detail?: string; hasDetails: boolean }) => (
      <WorkHistoryPanel active defaultExpanded hasDetails={hasDetails}>
        <WorkHistoryDetails persistentChildren={<span>子代理任务</span>}>
          <span>子代理任务</span>
          <span>{detail}</span>
        </WorkHistoryDetails>
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
    // 收起动画结束后才卸载明细，并只保留一份常驻节点。
    await waitFor(() => expect(view.queryByText('读取文件')).toBeNull());
    expect(view.getAllByText('子代理任务')).toHaveLength(1);

    view.rerender(panel({ hasDetails: false }));
    view.rerender(panel({ detail: '继续读取', hasDetails: true }));
    expect(view.container.querySelector('.chat-work-history__summary')?.getAttribute('aria-expanded')).toBe('false');
    expect(view.queryByText('继续读取')).toBeNull();
  });

  it('keeps following answer content mounted while work details collapse', async () => {
    const view = render(
      <ChatWorkHistoryTimeline
        active={false}
        defaultExpanded
        itemId="assistant_1"
        onExpandedChange={vi.fn()}
        sections={[
          { type: 'work', id: 'work_1', hasDetails: true, hasFollowingContent: false, segments: [], children: <span>读取文件</span> },
          { type: 'content', id: 'answer_1', children: <p>最终回答</p> },
        ]}
      />,
    );
    const answer = view.getByText('最终回答');

    fireEvent.click(view.container.querySelector<HTMLButtonElement>('.chat-work-history__summary')!);
    await waitFor(() => expect(view.queryByText('读取文件')).toBeNull());

    // 正文不随折叠重新挂载，否则收起结束时会重新渲染整段 Markdown。
    expect(view.getByText('最终回答')).toBe(answer);
  });
});
