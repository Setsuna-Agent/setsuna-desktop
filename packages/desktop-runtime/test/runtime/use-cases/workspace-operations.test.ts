import {
  WORKSPACE_TEXT_FILE_EDIT_MAX_BYTES,
  WORKSPACE_TEXT_FILE_MAX_BYTES,
  type WorkspaceFileRead,
} from '@setsuna-desktop/contracts';
import { describe, expect, it, vi } from 'vitest';
import type { RuntimeContainer } from '../../../src/runtime/runtime-factory.js';
import {
  archiveRuntimeWorkspaceProject,
  saveRuntimeWorkspaceFile,
} from '../../../src/runtime/use-cases/workspace-operations.js';

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

describe('saveRuntimeWorkspaceFile', () => {
  const currentFile: WorkspaceFileRead = {
    projectId: 'project_1',
    path: 'src/example.ts',
    content: 'export const value = 1;\n',
    size: 24,
    modifiedAt: '2026-08-05T00:00:00.000Z',
    preview: { kind: 'text' },
    revision: 'revision_1',
    truncated: false,
  };

  it('writes and returns the refreshed file when its revision still matches', async () => {
    const refreshed = { ...currentFile, content: 'export const value = 2;\n', revision: 'revision_2' };
    const workspaceProjects = {
      readFile: vi.fn()
        .mockResolvedValueOnce(currentFile)
        .mockResolvedValueOnce(refreshed),
      writeFile: vi.fn(async () => ({
        projectId: currentFile.projectId,
        path: currentFile.path,
        size: refreshed.content.length,
        revision: refreshed.revision,
        created: false,
      })),
    };

    await expect(saveRuntimeWorkspaceFile(
      workspaceProjects,
      currentFile.projectId,
      currentFile.path,
      { content: refreshed.content, expectedRevision: currentFile.revision! },
    )).resolves.toBe(refreshed);
    expect(workspaceProjects.writeFile).toHaveBeenCalledWith(
      currentFile.projectId,
      currentFile.path,
      refreshed.content,
    );
    expect(workspaceProjects.readFile).toHaveBeenLastCalledWith(
      currentFile.projectId,
      currentFile.path,
      { maxTextBytes: WORKSPACE_TEXT_FILE_EDIT_MAX_BYTES },
    );
  });

  it('rejects a stale revision without writing', async () => {
    const workspaceProjects = {
      readFile: vi.fn(async () => ({ ...currentFile, revision: 'external_revision' })),
      writeFile: vi.fn(),
    };

    await expect(saveRuntimeWorkspaceFile(
      workspaceProjects,
      currentFile.projectId,
      currentFile.path,
      { content: 'local edit\n', expectedRevision: currentFile.revision! },
    )).rejects.toMatchObject({ code: 'conflict' });
    expect(workspaceProjects.writeFile).not.toHaveBeenCalled();
  });

  it('allows a complete editor buffer to replace a truncated preview', async () => {
    const largePreview = {
      ...currentFile,
      size: WORKSPACE_TEXT_FILE_MAX_BYTES + 1,
      truncated: true,
    };
    const refreshed = { ...largePreview, content: 'complete edited file\n', truncated: false };
    const workspaceProjects = {
      readFile: vi.fn()
        .mockResolvedValueOnce(largePreview)
        .mockResolvedValueOnce(refreshed),
      writeFile: vi.fn(async () => ({
        projectId: currentFile.projectId,
        path: currentFile.path,
        size: refreshed.content.length,
        created: false,
      })),
    };

    await expect(saveRuntimeWorkspaceFile(
      workspaceProjects,
      currentFile.projectId,
      currentFile.path,
      { content: refreshed.content, expectedRevision: currentFile.revision! },
    )).resolves.toBe(refreshed);
    expect(workspaceProjects.writeFile).toHaveBeenCalledWith(
      currentFile.projectId,
      currentFile.path,
      refreshed.content,
    );
  });

  it('rejects binary files and oversized editor buffers', async () => {
    const workspaceProjects = {
      readFile: vi.fn(async () => ({
        ...currentFile,
        preview: { kind: 'unsupported' as const, reason: 'binary' as const },
      })),
      writeFile: vi.fn(),
    };

    await expect(saveRuntimeWorkspaceFile(
      workspaceProjects,
      currentFile.projectId,
      currentFile.path,
      { content: 'local edit\n', expectedRevision: currentFile.revision! },
    )).rejects.toMatchObject({ code: 'invalid_request' });
    await expect(saveRuntimeWorkspaceFile(
      workspaceProjects,
      currentFile.projectId,
      currentFile.path,
      { content: 'x'.repeat(WORKSPACE_TEXT_FILE_EDIT_MAX_BYTES + 1), expectedRevision: currentFile.revision! },
    )).rejects.toMatchObject({ code: 'invalid_input' });
    expect(workspaceProjects.writeFile).not.toHaveBeenCalled();
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
