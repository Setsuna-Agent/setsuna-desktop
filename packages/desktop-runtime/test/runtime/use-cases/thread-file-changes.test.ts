import type { PendingStoredThreadEvent, RuntimeThread, RuntimeToolRun, WorkspaceFileChange, WorkspaceFileChangeAction } from '@setsuna-desktop/contracts';
import { describe, expect, it, vi } from 'vitest';
import { applyThreadFileChanges } from '../../../src/runtime/use-cases/thread-file-changes.js';
import { createFileChangePatch } from '../../../src/utils/file-change-patch.js';

describe('applyThreadFileChanges', () => {
  it.each(['undo', 'redo'] as const)('resolves %s operations from stored results in completion order, ignoring clipped previews', async (action) => {
    const later = run('later', 'first', 'second', '2026-09-12T01:00:02Z');
    const earlier = run('earlier', 'original', 'first', '2026-09-12T01:00:01Z');
    const runtime = fixture([later, earlier, run('unrelated', 'x', 'y')]);
    await expect(applyThreadFileChanges(runtime, 'thread_1', { toolCallIds: ['later', 'earlier', 'earlier'] }, action))
      .resolves.toEqual({ files: ['README.md'], state: { action, seq: 10 } });
    expect(runtime.workspaceProjects.applyFileChanges).toHaveBeenCalledWith('project_1', [
      { path: 'README.md', patch: createFileChangePatch('original', 'first') },
      { path: 'README.md', patch: createFileChangePatch('first', 'second') },
    ], action, expect.any(Function));
    expect(runtime.threadStore.getThread).toHaveBeenCalledWith('thread_1');
    expect(runtime.threadStore.appendEvent).toHaveBeenCalledWith('thread_1', expect.objectContaining({
      type: 'thread.file_changes_applied', payload: { toolCallIds: ['later', 'earlier'], action },
    }));
    expect(runtime.eventBus.publish).toHaveBeenCalledWith(expect.objectContaining({ type: 'thread.file_changes_applied', seq: 10 }));
  });

  it('refuses old or missing records and active operations without falling back to Git discard', async () => {
    for (const runs of [[], [{ ...run('edit', 'before', 'after'), data: { ok: true, diff: { path: 'README.md', action: 'Edited', lines: [] } } }],
      [{ ...run('edit', 'before', 'after'), status: 'error' as const }]]) {
      const runtime = fixture(runs);
      await expect(applyThreadFileChanges(runtime, 'thread_1', { toolCallIds: ['edit'] }, 'undo')).rejects.toThrow();
      expect(runtime.workspaceProjects.applyFileChanges).not.toHaveBeenCalled();
    }
    const runtime = fixture([run('edit', 'before', 'after')]);
    runtime.agentLoop.activeTurnId.mockReturnValue('turn_running');
    await expect(applyThreadFileChanges(runtime, 'thread_1', { toolCallIds: ['edit'] }, 'redo')).rejects.toMatchObject({ code: 'conflict' });
    expect(runtime.workspaceProjects.applyFileChanges).not.toHaveBeenCalled();
  });
});

function run(id: string, before: string, after: string, completedAt = ''): RuntimeToolRun {
  return { id, name: 'edit', status: 'success', completedAt, resultPreview: '...truncated preview...',
    data: { ok: true, diff: { path: 'README.md', undo: createFileChangePatch(before, after) } } };
}

function fixture(runs: RuntimeToolRun[]) {
  const thread = { id: 'thread_1', projectId: 'project_1', messages: [{ toolRuns: runs }] } as RuntimeThread;
  return {
    threadStore: { getThread: vi.fn(async () => thread),
      appendEvent: vi.fn(async (_id: string, event: PendingStoredThreadEvent) => ({ ...event, seq: 10 })),
    },
    eventBus: { publish: vi.fn() },
    agentLoop: {
      activeTurnId: vi.fn<() => string | null>(() => null),
      withThreadMutation: async <T>(_id: string, operation: () => Promise<T>) => operation(),
    },
    workspaceProjects: {
      applyFileChanges: vi.fn(async (_id: string, _changes: WorkspaceFileChange[], _action: WorkspaceFileChangeAction, persist?: () => Promise<void>) => { await persist?.(); }),
      ensureTemporaryWorkspace: vi.fn(),
    },
  };
}
