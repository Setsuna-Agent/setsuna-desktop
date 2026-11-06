// @vitest-environment happy-dom

import type { RuntimeMessage, RuntimeToolRun } from '@setsuna-desktop/contracts';
import { cleanup, fireEvent, render, waitFor } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { MessageItem } from '../../../../../src/features/chat/conversation/ChatMessageItem.js';
import { createChatDisplayItems } from '../../../../../src/features/chat/conversation/chatMessageDisplay.js';
import { RendererPluginTestHost } from '../../../support/RendererPluginTestHost.js';

afterEach(cleanup);

it('preserves and submits an answer while work history is collapsed and other tools update', async () => {
  const onAnswerApproval = vi.fn().mockResolvedValue(undefined);
  const question: RuntimeToolRun = {
    id: 'question', name: 'request_user_input', status: 'pending_approval',
    approvalId: 'approval_question', approvalStatus: 'pending',
    userInput: {
      title: '日报设置', message: '选择日报主题。',
      requestedSchema: {
        type: 'object',
        properties: { topic: { type: 'string', title: '日报主题', default: 'AI 资讯' } },
        required: ['topic'],
      },
    },
  };
  const panel = (run: RuntimeToolRun, inspecting: boolean) => {
    const messages: RuntimeMessage[] = [{
      id: 'inspection', turnId: 'turn_input', role: 'assistant', phase: 'commentary',
      content: '正在检查任务配置。', createdAt: '2026-11-06T00:00:00.000Z', status: 'complete',
      toolRuns: [{ id: 'inspect', name: 'manage_automation', status: inspecting ? 'running' : 'success' }],
    }, {
      id: 'question_message', turnId: 'turn_input', role: 'assistant', phase: 'commentary',
      content: '', createdAt: '2026-11-06T00:00:01.000Z', status: 'complete', toolRuns: [run],
    }];
    const item = createChatDisplayItems(messages)[0]!;
    return <MessageItem item={item} activeTurnId="turn_input" activeAssistantItemId={item.id}
      deleteMode={false} selectedForDelete={false} pluginUses={[]}
      onAnswerApproval={onAnswerApproval} onWorkHistoryExpandedChange={() => undefined} />;
  };
  const view = render(panel(question, true), { wrapper: RendererPluginTestHost });
  fireEvent.change(view.getByRole('textbox', { name: /日报主题/ }), { target: { value: '开发工具与开源项目' } });
  fireEvent.click(view.getByRole('button', { name: /^工作中/ }));
  await waitFor(() => expect(view.queryByText('正在检查任务配置。')).toBeNull());

  view.rerender(panel({ ...question }, false));
  fireEvent.click(view.getByRole('button', { name: '提交' }));
  await waitFor(() => expect(onAnswerApproval).toHaveBeenCalledExactlyOnceWith('approval_question', {
    decision: 'approve',
    userInputResponse: { action: 'submit', values: { topic: '开发工具与开源项目' } },
  }));

  // The approval can resolve before the waiting tool receives its terminal event.
  view.rerender(panel({ ...question, approvalStatus: 'approved' }, false));
  expect(view.queryByRole('textbox', { name: /日报主题/ })).toBeNull();
});
