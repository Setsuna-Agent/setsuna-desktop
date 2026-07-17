import { describe, expect, it } from 'vitest';
import type { WorkspaceProject } from '@setsuna-desktop/contracts';
import { readyThreadWorkspacePath, resolveThreadWorkspaceState } from './useThreadWorkspace.js';

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
      temporaryWorkspace: { status: 'ready', threadId: 'thread_a', workspace: workspaceA },
      thread: { id: 'thread_b' },
    })).toEqual({ status: 'loading' });
  });

  it('preserves an explicit resolution failure for the current thread', () => {
    expect(resolveThreadWorkspaceState({
      projectWorkspace: undefined,
      temporaryWorkspace: { status: 'error', threadId: 'thread_b', workspace: null },
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
