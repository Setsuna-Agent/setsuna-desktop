// @vitest-environment happy-dom

import type { RuntimeMessage, WorkspaceFileChangeAction } from '@setsuna-desktop/contracts';
import { ConfirmationProvider } from '@setsuna-desktop/renderer-ui';
import { act, cleanup, fireEvent, render, waitFor, within } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { MessageItem } from '../../../../../src/features/chat/conversation/ChatMessageItem.js';
import { ChatThreadProvider } from '../../../../../src/features/chat/conversation/ChatThreadProvider.js';
import { ThreadFileChangesProvider } from '../../../../../src/features/chat/hooks/ThreadFileChangesProvider.js';
import { createDesktopRuntimeClient } from '../../../../../src/services/runtime-client/client.js';
import { RendererPluginTestHost } from '../../../support/RendererPluginTestHost.js';
import { fileRun } from '../tool-runs/RuntimeToolRuns.support.js';

afterEach(() => {
  cleanup();
  Reflect.deleteProperty(window, 'setsunaDesktop');
});

it('toggles a merged card between undo and reapply, showing a blocking error dialog without advancing on failure', async () => {
  const request = vi.fn().mockRejectedValueOnce(new Error('File changed after this operation.'))
    .mockResolvedValueOnce({ files: ['README.md'] })
    .mockRejectedValueOnce(new Error('README.md changed after undo. No files were changed.'))
    .mockResolvedValueOnce({ files: ['README.md'] })
    .mockResolvedValueOnce({ files: ['README.md'] });
  const discardUnstaged = vi.fn();
  Object.defineProperty(window, 'setsunaDesktop', { configurable: true, value: {
    runtime: { request }, desktopReview: { discardUnstaged },
  } });
  const client = createDesktopRuntimeClient();
  const view = render(<TestConversation threadId="thread_1" onApplyChanges={async (threadId, toolCallIds, action) => {
    await client.applyThreadFileChanges(threadId, { toolCallIds }, action);
  }} />);
  fireEvent.click(view.getByRole('button', { name: '撤销' }));
  const undoError = await view.findByRole('dialog', { name: '无法撤销' });
  expect(within(undoError).getByText('File changed after this operation.')).toBeTruthy();
  fireEvent.click(within(undoError).getByText('关闭'));
  await waitFor(() => expect((view.getByRole('button', { name: '撤销' }) as HTMLButtonElement).disabled).toBe(false));
  fireEvent.click(view.getByRole('button', { name: '撤销' }));
  await view.findByRole('button', { name: '重新应用' });
  expect(request).toHaveBeenCalledTimes(2);
  fireEvent.click(view.getByRole('button', { name: '重新应用' }));
  const redoError = await view.findByRole('dialog', { name: '无法重新应用' });
  expect(within(redoError).getByText('README.md changed after undo. No files were changed.')).toBeTruthy();
  expect(request).toHaveBeenCalledTimes(3);
  fireEvent.click(within(redoError).getByText('关闭'));
  await waitFor(() => expect((view.getByRole('button', { name: '重新应用' }) as HTMLButtonElement).disabled).toBe(false));
  expect(view.queryByRole('button', { name: '撤销' })).toBeNull();
  fireEvent.click(view.getByRole('button', { name: '重新应用' }));
  await view.findByRole('button', { name: '撤销' });
  fireEvent.click(view.getByRole('button', { name: '撤销' }));
  await view.findByRole('button', { name: '重新应用' });
  expect(request.mock.calls.map(([input]) => input)).toEqual(['undo', 'undo', 'redo', 'redo', 'undo'].map((action) => ({
    path: `/v1/threads/thread_1/file-changes/${action}`, method: 'POST', body: { toolCallIds: ['edit_title', 'edit_body'] },
  })));
  expect(discardUnstaged).not.toHaveBeenCalled();
});

it('restores reapply after a card remount and isolates conversation/batch state even when a request completes offscreen', async () => {
  let finishUndo!: () => void;
  const onApplyChanges = vi.fn().mockReturnValueOnce(new Promise<void>((resolve) => { finishUndo = resolve; }))
    .mockResolvedValue(undefined);
  const view = render(<TestConversation threadId="thread_1" onApplyChanges={onApplyChanges} />);
  fireEvent.click(view.getByRole('button', { name: '撤销' }));
  view.rerender(<TestConversation threadId="thread_2" onApplyChanges={onApplyChanges} />);
  expect((view.getByRole('button', { name: '撤销' }) as HTMLButtonElement).disabled).toBe(false);
  await act(async () => { finishUndo(); });
  expect(view.queryByRole('button', { name: '重新应用' })).toBeNull();

  view.rerender(<TestConversation threadId="thread_1" onApplyChanges={onApplyChanges} />);
  expect(view.getByRole('button', { name: '重新应用' })).toBeTruthy();
  view.rerender(<TestConversation threadId="thread_1" toolCallIds={['later_edit']} onApplyChanges={onApplyChanges} />);
  expect(view.getByRole('button', { name: '撤销' })).toBeTruthy();
  view.rerender(<TestConversation threadId="thread_1" onApplyChanges={onApplyChanges} />);
  fireEvent.click(view.getByRole('button', { name: '重新应用' }));
  await view.findByRole('button', { name: '撤销' });
  view.rerender(<TestConversation threadId="thread_2" onApplyChanges={onApplyChanges} />);
  view.rerender(<TestConversation threadId="thread_1" onApplyChanges={onApplyChanges} />);
  expect(view.getByRole('button', { name: '撤销' })).toBeTruthy();
  expect(onApplyChanges.mock.calls).toEqual([
    ['thread_1', ['edit_title', 'edit_body'], 'undo'],
    ['thread_1', ['edit_title', 'edit_body'], 'redo'],
  ]);
});

function TestConversation({ threadId, toolCallIds = ['edit_title', 'edit_body'], onApplyChanges }: {
  threadId: string;
  toolCallIds?: string[];
  onApplyChanges: (threadId: string, toolCallIds: string[], action: WorkspaceFileChangeAction) => Promise<void>;
}) {
  const message: RuntimeMessage = {
    id: 'assistant_1', turnId: 'turn_1', role: 'assistant', status: 'complete', phase: 'final_answer',
    createdAt: '2026-09-12T00:00:00Z', content: 'Edited README.md.', toolRuns: [
      ...toolCallIds.map((id) => fileRun(id, 'edit', 'README.md', 'Edited')),
      { id: 'read', name: 'read_file', status: 'success' },
    ],
  };
  return <RendererPluginTestHost><ConfirmationProvider><ThreadFileChangesProvider>
    <ChatThreadProvider key={threadId} threadId={threadId}>
      <MessageItem
        activeAssistantItemId={null} activeTurnId={null} assistantItemIdByTurnId={new Map()}
        deleteMode={false} editingDraft="" editingMessageId={null} editingSubmitting={false}
        expandedWorkHistoryItemIds={new Set()} selectedForDelete={false} pluginUses={[]}
        item={{ type: 'assistant', id: message.id, turnId: message.turnId, segments: [message],
          messageIds: [message.id], steerMessages: [], handledSteerMessageIds: [] }}
        onAnswerApproval={async () => undefined} onCancelEdit={() => undefined}
        onEditDraftChange={() => undefined} onWorkHistoryExpandedChange={() => undefined}
        onFileChangesAction={(ids, action) => onApplyChanges(threadId, ids, action)}
      />
    </ChatThreadProvider>
  </ThreadFileChangesProvider></ConfirmationProvider></RendererPluginTestHost>;
}
