// @vitest-environment happy-dom

import { projectMessagePageFileChanges, threadFileChangeKey, type RuntimeMessage, type RuntimeThread, type ThreadFileChangesResult, type WorkspaceFileChangeAction } from '@setsuna-desktop/contracts';
import { ConfirmationProvider } from '@setsuna-desktop/renderer-ui';
import { act, cleanup, fireEvent, render, waitFor, within } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { MessageItem } from '../../../../../src/features/chat/conversation/ChatMessageItem.js';
import { createChatRenderWindow, type ChatDisplayItem } from '../../../../../src/features/chat/conversation/chatMessageDisplay.js';
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

it('restores the action after an app remount and ignores older persisted state until a newer event arrives', async () => {
  const key = threadFileChangeKey(['edit_title', 'edit_body']);
  const onApplyChanges = vi.fn().mockResolvedValueOnce({ files: ['README.md'], state: { action: 'undo', seq: 20 } })
    .mockResolvedValueOnce({ files: ['README.md'], state: { action: 'redo', seq: 21 } });
  const first = render(<TestConversation threadId="thread_1" onApplyChanges={onApplyChanges} />);
  fireEvent.click(first.getByRole('button', { name: '撤销' }));
  await first.findByRole('button', { name: '重新应用' });
  first.unmount();

  const saved: RuntimeThread['fileChangeStates'] = JSON.parse(JSON.stringify({ [key]: { action: 'undo', seq: 20 } }));
  const restarted = render(<TestConversation threadId="thread_1" fileChangeStates={saved} onApplyChanges={onApplyChanges} />);
  expect(restarted.getByRole('button', { name: '重新应用' })).toBeTruthy();
  expect(onApplyChanges).toHaveBeenCalledTimes(1);
  fireEvent.click(restarted.getByRole('button', { name: '重新应用' }));
  await restarted.findByRole('button', { name: '撤销' });
  restarted.rerender(<TestConversation threadId="thread_1" fileChangeStates={saved} onApplyChanges={onApplyChanges} />);
  expect(restarted.getByRole('button', { name: '撤销' })).toBeTruthy();
  restarted.rerender(<TestConversation threadId="thread_1" fileChangeStates={{ [key]: { action: 'undo', seq: 22 } }} onApplyChanges={onApplyChanges} />);
  expect(restarted.getByRole('button', { name: '重新应用' })).toBeTruthy();
  expect(onApplyChanges.mock.calls.map((call) => call[2])).toEqual(['undo', 'redo']);
});

it.each(['late.ts', 'early.ts', null])('keeps every file operation when a long turn is folded (late target: %s)', async (latePath) => {
  const segments: RuntimeMessage[] = Array.from({ length: 161 }, (_, index) => ({
    id: `assistant_${index}`, turnId: 'turn_1', role: 'assistant', status: 'complete',
    phase: index === 160 ? 'final_answer' : 'commentary', createdAt: '2026-09-12T00:00:00Z', content: `Progress ${index}`,
    toolRuns: index === 0 ? [fileRun('early_edit', 'edit', 'early.ts', 'Edited')]
      : index === 160 && latePath ? [fileRun('late_edit', 'edit', latePath, 'Edited')] : [],
  }));
  const onApplyChanges = vi.fn().mockResolvedValue(undefined);
  const expectedIds = latePath ? ['early_edit', 'late_edit'] : ['early_edit'];
  const props = { threadId: 'thread_1', segments, onApplyChanges };
  const view = render(<TestConversation {...props} windowed />);
  fireEvent.click(view.getByRole('button', { name: '撤销' }));
  await view.findByRole('button', { name: '重新应用' });
  expect(onApplyChanges).toHaveBeenCalledWith('thread_1', expectedIds, 'undo');
  // Expanding history must retain the same operation batch and its persisted action state.
  view.rerender(<TestConversation {...props} windowed={false} />);
  fireEvent.click(view.getByRole('button', { name: '重新应用' }));
  await view.findByRole('button', { name: '撤销' });
  view.rerender(<TestConversation {...props} windowed />);
  fireEvent.click(view.getByRole('button', { name: '撤销' }));
  await view.findByRole('button', { name: '重新应用' });
  expect(onApplyChanges.mock.calls).toEqual(['undo', 'redo', 'undo'].map((action) => ['thread_1', expectedIds, action]));
});

it.each([
  { turnId: 'turn_1', lateEdit: true }, { turnId: 'turn_1', lateEdit: false },
  { turnId: undefined, lateEdit: true }, { turnId: undefined, lateEdit: false },
])('restores a full-turn reapply batch from a 430-message tail page (turn: $turnId, late edit: $lateEdit)', async ({ turnId, lateEdit }) => {
  const messages: RuntimeMessage[] = Array.from({ length: 430 }, (_, index) => ({
    id: `message_${index}`, turnId, role: 'assistant', status: 'complete',
    phase: index === 429 ? 'final_answer' : 'commentary', createdAt: '2026-09-12T00:00:00Z', content: `Progress ${index}`,
    toolRuns: index === 0 ? [fileRun('early_edit', 'edit', 'early.ts', 'Edited')]
      : index === 429 && lateEdit ? [fileRun('late_edit', 'edit', 'late.ts', 'Edited')] : [],
  }));
  const page = projectMessagePageFileChanges(messages, { messages: messages.slice(-160), nextBefore: 270, total: 430 });
  const ids = lateEdit ? ['early_edit', 'late_edit'] : ['early_edit'];
  const restored = JSON.parse(JSON.stringify({
    messages: page.messages, fileChangeGroups: page.fileChangeGroups,
    fileChangeStates: { [threadFileChangeKey(ids)]: { action: 'undo', seq: 500 } },
  })) as Pick<RuntimeThread, 'messages' | 'fileChangeGroups' | 'fileChangeStates'>;
  const onApplyChanges = vi.fn().mockResolvedValue({ files: ['early.ts'], state: { action: 'redo', seq: 501 } });
  const props = { threadId: 'thread_1', segments: restored.messages, onApplyChanges, ...restored };
  const view = render(<TestConversation {...props} windowed />);
  fireEvent.click(view.getByRole('button', { name: '重新应用' }));
  await view.findByRole('button', { name: '撤销' });
  view.rerender(<TestConversation {...props} segments={messages} windowed={false} />);
  fireEvent.click(view.getByRole('button', { name: '撤销' }));
  await waitFor(() => expect(onApplyChanges).toHaveBeenCalledTimes(2));
  expect(onApplyChanges.mock.calls).toEqual(['redo', 'undo'].map((action) => ['thread_1', ids, action]));
});

function TestConversation({ threadId, toolCallIds = ['edit_title', 'edit_body'], fileChangeStates, fileChangeGroups, onApplyChanges, segments, windowed = false }: {
  threadId: string;
  toolCallIds?: string[];
  fileChangeStates?: RuntimeThread['fileChangeStates'];
  fileChangeGroups?: RuntimeThread['fileChangeGroups'];
  onApplyChanges: (threadId: string, toolCallIds: string[], action: WorkspaceFileChangeAction) => Promise<void | ThreadFileChangesResult>;
  segments?: RuntimeMessage[];
  windowed?: boolean;
}) {
  const message: RuntimeMessage = {
    id: 'assistant_1', turnId: 'turn_1', role: 'assistant', status: 'complete', phase: 'final_answer',
    createdAt: '2026-09-12T00:00:00Z', content: 'Edited README.md.', toolRuns: [
      ...toolCallIds.map((id) => fileRun(id, 'edit', 'README.md', 'Edited')),
      { id: 'read', name: 'read_file', status: 'success' },
    ],
  };
  const messages = segments ?? [message];
  const item: ChatDisplayItem = {
    type: 'assistant', id: message.id, turnId: message.turnId, segments: messages,
    messageIds: messages.map((segment) => segment.id), steerMessages: [], handledSteerMessageIds: [],
  };
  return <RendererPluginTestHost><ConfirmationProvider><ThreadFileChangesProvider>
    <ChatThreadProvider key={threadId} threadId={threadId} fileChangeStates={fileChangeStates} fileChangeGroups={fileChangeGroups}>
      <MessageItem
        activeAssistantItemId={null} activeTurnId={null} assistantItemIdByTurnId={new Map()}
        deleteMode={false}
        expandedWorkHistoryItemIds={new Set()} selectedForDelete={false} pluginUses={[]}
        item={createChatRenderWindow([item], { enabled: windowed }).items[0]}
        onAnswerApproval={async () => undefined} onWorkHistoryExpandedChange={() => undefined}
        onFileChangesAction={(ids, action) => onApplyChanges(threadId, ids, action)}
      />
    </ChatThreadProvider>
  </ThreadFileChangesProvider></ConfirmationProvider></RendererPluginTestHost>;
}
