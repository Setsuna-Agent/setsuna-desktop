import { describe, expect, it, vi } from 'vitest';
import type { RuntimeContainer } from '../../../src/runtime/runtime-factory.js';
import { archiveRuntimeWorkspaceProject } from '../../../src/runtime/use-cases/workspace-operations.js';

describe('archiveRuntimeWorkspaceProject', () => {
  it('archives active threads through their mutation owner before hiding the project', async () => {
    const order: string[] = [];
    const runtime = workspaceRuntime({
      threads: [
        { archived: false, id: 'thread_a' },
        { archived: true, id: 'thread_archived' },
        { archived: false, id: 'thread_b' },
      ],
      onArchiveProject: (projectId) => order.push(`project:${projectId}`),
      onThreadMutation: (threadId) => order.push(`mutation:${threadId}`),
      onUpdateThread: (threadId) => order.push(`thread:${threadId}`),
    });

    await archiveRuntimeWorkspaceProject(runtime, 'project_1');

    expect(runtime.threadStore.listThreads).toHaveBeenCalledWith({
      includeArchived: true,
      projectId: 'project_1',
    });
    expect(runtime.threadStore.updateThread).toHaveBeenCalledTimes(2);
    expect(runtime.workspaceProjects.archiveProject).toHaveBeenCalledWith('project_1');
    expect(order).toEqual([
      'mutation:thread_a',
      'thread:thread_a',
      'mutation:thread_b',
      'thread:thread_b',
      'project:project_1',
    ]);
  });

  it('keeps the project visible when a thread archive fails', async () => {
    const runtime = workspaceRuntime({
      threads: [{ archived: false, id: 'thread_a' }],
      onUpdateThread: () => {
        throw new Error('thread archive failed');
      },
    });

    await expect(archiveRuntimeWorkspaceProject(runtime, 'project_1'))
      .rejects.toThrow('thread archive failed');
    expect(runtime.workspaceProjects.archiveProject).not.toHaveBeenCalled();
  });
});

function workspaceRuntime({
  threads,
  onArchiveProject = () => undefined,
  onThreadMutation = () => undefined,
  onUpdateThread = () => undefined,
}: {
  threads: Array<{ archived: boolean; id: string }>;
  onArchiveProject?: (projectId: string) => void;
  onThreadMutation?: (threadId: string) => void;
  onUpdateThread?: (threadId: string) => void;
}) {
  return {
    agentLoop: {
      withThreadMutation: vi.fn(async (
        threadId: string,
        mutation: () => Promise<unknown>,
      ) => {
        onThreadMutation(threadId);
        return mutation();
      }),
    },
    threadStore: {
      listThreads: vi.fn(async () => threads),
      updateThread: vi.fn(async (threadId: string) => {
        onUpdateThread(threadId);
        return {};
      }),
    },
    workspaceProjects: {
      archiveProject: vi.fn(async (projectId: string) => {
        onArchiveProject(projectId);
      }),
    },
  } as unknown as Pick<
    RuntimeContainer,
    'agentLoop' | 'threadStore' | 'workspaceProjects'
  >;
}
