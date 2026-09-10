// @vitest-environment happy-dom
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { DesktopRuntimeClient, RuntimeEventBatch, RuntimeThread } from '@setsuna-desktop/contracts';
import { composeRendererMessages } from '@setsuna-desktop/feature-core/renderer';
import type { ComponentProps } from 'react';
import { afterEach, expect, it, vi } from 'vitest';
import { reviewRendererFeature } from '../../../../../../packages/features/review/src/renderer/feature.js';
import { ReviewConflictTaskProgress } from '../../../src/composition/ReviewConflictTaskProgress.js';
import { ChatTranscript } from '../../../src/features/chat/conversation/ChatTranscript.js';
import { createDesktopRuntimeClient } from '../../../src/services/runtime-client/client.js';
import { I18nProvider } from '../../../src/shared/i18n/I18nProvider.js';
import { hostMessages } from '../../../src/shared/i18n/messages.js';

vi.mock('../../../src/services/runtime-client/client.js', () => ({ createDesktopRuntimeClient: vi.fn() }));
vi.mock('../../../src/features/chat/conversation/ChatTranscript.js', () => ({
  ChatTranscript: vi.fn(({ messages, onAnswerApproval }: ComponentProps<typeof ChatTranscript>) => <div>
    {messages.map((message) => <p key={message.id}>{message.content}</p>)}
    <button onClick={() => void onAnswerApproval('repair-approval', { decision: 'approve' })}>Approve repair</button>
  </div>),
}));
afterEach(() => { cleanup(); vi.clearAllMocks(); });

it('streams the repair transcript, routes approvals and stopping to the task, and refreshes Git on terminal events', async () => {
  const thread: RuntimeThread = {
    id: 'repair-thread', kind: 'side', title: 'Git conflict task', activeTurnId: 'repair-turn',
    createdAt: '', updatedAt: '', archived: false, messageCount: 1, lastMessagePreview: '', lastSeq: 1,
    turns: [{ id: 'repair-turn', status: 'in_progress', items: [] }],
    messages: [{ id: 'answer', role: 'assistant', content: '检查冲突', status: 'streaming', createdAt: '' }],
  };
  let receive!: (batch: RuntimeEventBatch) => void;
  const unsubscribe = vi.fn();
  const client = {
    getThread: vi.fn(async () => thread),
    answerApproval: vi.fn(async () => undefined),
    cancelTurn: vi.fn(async () => ({ cancelled: true })),
    subscribeEvents: vi.fn((_id, _seq, callback) => { receive = callback; return unsubscribe; }),
  } as unknown as DesktopRuntimeClient;
  vi.mocked(createDesktopRuntimeClient).mockReturnValue(client);
  const onFinished = vi.fn();
  const onBack = vi.fn();
  const view = render(<I18nProvider initialLocale="zh-CN" messageCatalog={composeRendererMessages(hostMessages, [{ module: reviewRendererFeature }])}>
    <ReviewConflictTaskProgress threadId="repair-thread" turnId="repair-turn" workspaceRoot="/repo" onBack={onBack} onFinished={onFinished} onOpenWorkspaceFile={vi.fn()} />
  </I18nProvider>);
  expect(await screen.findByText('检查冲突')).toBeTruthy();
  expect(client.subscribeEvents).toHaveBeenCalledWith('repair-thread', expect.any(Number), expect.any(Function));
  expect(onFinished).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button', { name: 'Approve repair' }));
  await waitFor(() => expect(client.answerApproval).toHaveBeenCalledWith('repair-approval', { decision: 'approve' }));
  await act(async () => { receive({ events: [{ id: 'delta', threadId: thread.id, turnId: 'repair-turn', seq: 2, createdAt: '', type: 'message.delta', payload: { messageId: 'answer', text: '，保留双方更改' } }] }); });
  expect(screen.getByText('检查冲突，保留双方更改')).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: '停止处理' }));
  await waitFor(() => expect(client.cancelTurn).toHaveBeenCalledExactlyOnceWith('repair-thread', 'repair-turn'));
  await act(async () => { receive({ events: [{ id: 'end', threadId: thread.id, turnId: 'repair-turn', seq: 3, createdAt: '', type: 'turn.cancelled', payload: {} }] }); });
  expect(screen.getByRole('status').textContent).toBe('已停止');
  expect(screen.queryByRole('button', { name: '停止处理' })).toBeNull();
  expect(onFinished).toHaveBeenCalledOnce();
  fireEvent.click(screen.getByRole('button', { name: '返回变更' }));
  expect(onBack).toHaveBeenCalledOnce();
  view.unmount();
  expect(unsubscribe).toHaveBeenCalled();
  expect(client.cancelTurn).toHaveBeenCalledTimes(1);
});
