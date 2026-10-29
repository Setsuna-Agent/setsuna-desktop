// @vitest-environment happy-dom
import type { DesktopRuntimeClient, RuntimeThread } from '@setsuna-desktop/contracts';
import { createNoopCollaborationRendererStateService, type CollaborationTask } from '@setsuna-desktop/feature-collaboration/contracts';
import { CollaborationRendererProvider, CollaborationTaskNavigationProvider } from '@setsuna-desktop/feature-collaboration/renderer';
import { cleanup, fireEvent, render, waitFor, within } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { CollaborationApprovals } from '../../../../src/features/chat/CollaborationApprovals.js';
import { withRendererPluginTestHost } from '../../support/RendererPluginTestHost.js';

afterEach(cleanup);

it('answers an identified child approval from the parent without opening the child and keeps other child requests pending', async () => {
  const tasks: CollaborationTask[] = ['a', 'b'].map((id) => ({ id, childThreadId: id, activeTurnId: `turn_${id}`, title: id, objective: '',
    identity: { displayName: `Agent ${id}`, avatarSeed: id }, status: 'waiting_approval', createdAt: '', updatedAt: '' }));
  const snapshots = new Map(tasks.map((task) => [task.id, child(task.id)]));
  const unsubscribe = vi.fn();
  const answerApproval = vi.fn(async (id: string) => {
    const snapshot = snapshots.get(id)!;
    snapshots.set(id, { ...snapshot, lastSeq: 2, messages: [{ ...snapshot.messages[0]!, toolRuns: [] }] });
  });
  const client = { getThread: vi.fn(async (id: string) => snapshots.get(id)), subscribeEvents: vi.fn(() => unsubscribe), answerApproval } as unknown as DesktopRuntimeClient;
  const snapshot = { state: { tasks, executions: [] }, throughSeq: 3, loading: false, stale: false, error: null };
  const service = { ...createNoopCollaborationRendererStateService(), available: true,
    controller: () => ({ snapshot: () => snapshot, start: vi.fn(), retry: vi.fn(), subscribe: () => () => undefined }),
  };
  const openTask = vi.fn();
  const view = render(withRendererPluginTestHost(<CollaborationRendererProvider service={service}>
    <CollaborationTaskNavigationProvider onOpenTask={openTask} onOpenList={vi.fn()}>
      <CollaborationApprovals parentThreadId="parent" client={client} />
    </CollaborationTaskNavigationProvider>
  </CollaborationRendererProvider>));
  await waitFor(() => expect(view.getAllByRole('button', { name: '允许' })).toHaveLength(2));
  const second = view.getByRole('button', { name: 'Agent b' }).closest('section')!;
  fireEvent.click(within(second).getByRole('button', { name: '允许' }));
  await waitFor(() => expect(answerApproval).toHaveBeenCalledWith('b', expect.objectContaining({ decision: 'approve' })));
  expect(openTask).not.toHaveBeenCalled();
  await waitFor(() => expect(view.getAllByRole('button', { name: '允许' })).toHaveLength(1));
  fireEvent.click(view.getByRole('button', { name: 'Agent a' }));
  expect(openTask).toHaveBeenCalledWith('parent', tasks[0]);
  view.unmount();
  expect(unsubscribe).toHaveBeenCalledTimes(2);
});

function child(id: string): RuntimeThread {
  return { id, title: id, parentThreadId: 'parent', createdAt: '', updatedAt: '', archived: false, lastSeq: 1,
    activeTurnId: `turn_${id}`, messageCount: 1, lastMessagePreview: '', messages: [{ id: `assistant_${id}`, role: 'assistant',
      turnId: `turn_${id}`, content: '', status: 'complete', createdAt: '', toolRuns: [{
        id: `call_${id}`, name: 'exec_command', status: 'pending_approval', approvalId: id, approvalStatus: 'pending', approvalReviewer: 'user',
        approvalReason: 'Run the requested check.', argumentsPreview: '{"cmd":"pnpm test"}', availableApprovalDecisions: [{ type: 'approve' }, { type: 'reject' }],
      }],
    }] };
}
