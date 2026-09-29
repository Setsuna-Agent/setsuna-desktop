import type { WorkspaceProject } from '@setsuna-desktop/contracts';
import { describe, expect, it } from 'vitest';
import {
  readyThreadWorkspacePath,
  resolveThreadWorkspaceState,
  resolvedWorkspaceStatus,
} from '../../../../../src/features/workspace/hooks/useThreadWorkspace.js';

const workspaceA: WorkspaceProject = {
  id: 'temporary_workspace.2026-07-18.thread_a',
  name: 'Thread A',
  path: 'D:\\temp\\2026-07-18\\thread_a',
  createdAt: '2026-07-18T00:00:00.000Z',
  updatedAt: '2026-07-18T00:00:00.000Z',
};

describe('resolveThreadWorkspaceState', () => {
  it('does not expose the previous thread workspace during a switch', () => {
    expect(resolveThreadWorkspaceState({
      projectWorkspace: undefined,
      resolvedWorkspace: { status: 'ready', threadId: 'thread_a', workspace: workspaceA },
      thread: { id: 'thread_b' },
    })).toEqual({ status: 'loading' });
  });

  it('uses the conversation worktree while retaining the owning project', () => {
    const project = { ...workspaceA, id: 'project', path: '/original' };
    const thread = { id: 'fork', projectId: project.id, workspaceId: workspaceA.id };
    expect(resolveThreadWorkspaceState({ projectWorkspace: project, resolvedWorkspace: null, thread }))
      .toEqual({ status: 'loading' });
    expect(resolveThreadWorkspaceState({ projectWorkspace: project, thread,
      resolvedWorkspace: { status: 'ready', threadId: thread.id, workspaceId: workspaceA.id, workspace: workspaceA },
    })).toEqual({ status: 'ready', workspace: workspaceA });
  });

  it('withholds a missing worktree even when its saved directory metadata is still present', () => {
    const resolved = resolvedWorkspaceStatus({ project: workspaceA, exists: false, readable: false }, true);
    expect(resolved).toEqual({ status: 'missing', workspace: null });
    expect(resolveThreadWorkspaceState({
      thread: { id: 'fork', projectId: 'project', workspaceId: workspaceA.id },
      projectWorkspace: { ...workspaceA, id: 'project' },
      resolvedWorkspace: { ...resolved, threadId: 'fork', workspaceId: workspaceA.id },
    })).toEqual({ status: 'missing' });
    expect(readyThreadWorkspacePath(workspaceA, 'missing')).toBeNull();
  });

  it('does not reuse a resolved directory after the same conversation changes its binding', () => {
    expect(resolveThreadWorkspaceState({
      thread: { id: 'fork', workspaceId: 'different-worktree' },
      resolvedWorkspace: { status: 'ready', threadId: 'fork', workspaceId: workspaceA.id, workspace: workspaceA },
    })).toEqual({ status: 'loading' });
  });

  it('preserves an explicit resolution failure for the current thread', () => {
    expect(resolveThreadWorkspaceState({
      projectWorkspace: undefined,
      resolvedWorkspace: { status: 'error', threadId: 'thread_b', workspace: null },
      thread: { id: 'thread_b' },
    })).toEqual({ status: 'error' });
  });
});

describe('readyThreadWorkspacePath', () => {
  it('returns a cwd only after workspace resolution succeeds', () => {
    expect(readyThreadWorkspacePath(workspaceA, 'loading')).toBeNull();
    expect(readyThreadWorkspacePath(workspaceA, 'error')).toBeNull();
    expect(readyThreadWorkspacePath(undefined, 'ready')).toBeNull();
    expect(readyThreadWorkspacePath(workspaceA, 'ready')).toBe(workspaceA.path);
  });
});
