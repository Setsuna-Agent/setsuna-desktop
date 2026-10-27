// @vitest-environment happy-dom
import type { DesktopRuntimeClient, RuntimeThread } from '@setsuna-desktop/contracts';
import { act, cleanup, renderHook } from '@testing-library/react';
import { useState } from 'react';
import { afterEach, expect, it, vi } from 'vitest';
import { useDesktopNavigation } from '../../../../src/app/controller/useDesktopNavigation.js';
import { RuntimeClientError } from '../../../../src/services/runtime-client/runtimeClientErrors.js';

afterEach(cleanup);

const source: RuntimeThread = {
  id: 'source', projectId: 'project', title: 'Source', archived: false,
  createdAt: '', updatedAt: '', messageCount: 0, lastMessagePreview: '', messages: [], lastSeq: 0,
};
const fallback: RuntimeThread = { ...source, id: 'fallback' };
const project = { id: 'project', name: 'Project', createdAt: '', updatedAt: '' };
const other: RuntimeThread = { ...source, id: 'other', projectId: 'another-project' };

function setup(remaining: RuntimeThread[] = [other, fallback]) {
  const onError = vi.fn();
  const removeProject = vi.fn(async (): Promise<void> => undefined);
  const archiveProject = vi.fn(async (): Promise<void> => undefined);
  const listProjects = vi.fn(async () => ({ projects: [] }));
  const deleteThread = vi.fn(async (_id: string): Promise<void> => undefined);
  const updateThread = vi.fn(async () => ({ ...source, archived: true }));
  const getThread = vi.fn(async (id: string) => [source, fallback, other].find((thread) => thread.id === id)!);
  const confirmDiscardProjectFile = vi.fn(async () => true);
  const reloadThreads = vi.fn(async () => remaining);
  const resetThreadWorkspacePanels = vi.fn();
  const resetProjectWorkspaceState = vi.fn();
  const hook = renderHook(() => {
    const [currentThread, setCurrentThread] = useState<RuntimeThread | null>(source);
    const [activeProjectId, setActiveProjectId] = useState<string | null>(source.projectId!);
    const navigation = useDesktopNavigation({
      activeProjectId, setActiveProjectId, currentThread, setCurrentThread,
      projects: [project], setProjects: vi.fn(), activeView: 'chat', setActiveView: vi.fn(),
      client: { deleteThread, updateThread, getThread, removeProject, archiveProject, listProjects } as unknown as DesktopRuntimeClient,
      confirmDiscardProjectFile, onError, threadsByProjectId: new Map(), reloadThreads,
      resetProjectWorkspaceState, resetNewThreadWorkspacePanels: vi.fn(), resetThreadWorkspacePanels,
    });
    return { navigation, currentThread, activeProjectId };
  });
  return { ...hook, onError, removeProject, archiveProject, listProjects, deleteThread, updateThread, getThread, confirmDiscardProjectFile, reloadThreads,
    resetThreadWorkspacePanels, resetProjectWorkspaceState };
}

it.each(['archiveThread', 'deleteThread'] as const)('switches to another conversation in the same project after %s', async (action) => {
  const harness = setup();
  await act(() => harness.result.current.navigation[action](source));
  if (action === 'deleteThread') {
    expect(harness.deleteThread).toHaveBeenCalledExactlyOnceWith(source.id);
    expect(harness.updateThread).not.toHaveBeenCalled();
  } else {
    expect(harness.updateThread).toHaveBeenCalledExactlyOnceWith(source.id, { archived: true });
    expect(harness.deleteThread).not.toHaveBeenCalled();
  }
  expect(harness.resetThreadWorkspacePanels).toHaveBeenCalledExactlyOnceWith(source.id);
  expect(harness.result.current.currentThread?.id).toBe(fallback.id);
  expect(harness.result.current.activeProjectId).toBe(source.projectId);
});

it('deletes an unselected conversation without navigating away from the current one', async () => {
  const harness = setup([source, fallback]);
  await act(() => harness.result.current.navigation.deleteThread(other));
  expect(harness.deleteThread).toHaveBeenCalledExactlyOnceWith(other.id);
  expect(harness.confirmDiscardProjectFile).not.toHaveBeenCalled();
  expect(harness.getThread).not.toHaveBeenCalled();
  expect(harness.result.current.currentThread?.id).toBe(source.id);
});

it('clears the current conversation and workspace panels after deleting the final conversation', async () => {
  const harness = setup([]);
  await act(() => harness.result.current.navigation.deleteThread(source));
  expect(harness.result.current.currentThread).toBeNull();
  expect(harness.resetThreadWorkspacePanels).toHaveBeenCalledExactlyOnceWith(source.id);
  expect(harness.resetProjectWorkspaceState).toHaveBeenCalledOnce();
});

it('does not switch back when deletion finishes after the user opens another conversation', async () => {
  const harness = setup();
  let finish!: () => void;
  harness.deleteThread.mockImplementationOnce(() => new Promise<void>((resolve) => { finish = resolve; }));
  let deletion!: Promise<void>;
  await act(async () => { deletion = harness.result.current.navigation.deleteThread(source); });
  await act(() => harness.result.current.navigation.selectThread(other.id));
  await act(async () => { finish(); await deletion; });
  expect(harness.result.current.currentThread?.id).toBe(other.id);
  expect(harness.result.current.activeProjectId).toBe(other.projectId);
});

it('keeps the thread when discarding a pending file edit is declined or deletion fails', async () => {
  const harness = setup();
  harness.deleteThread.mockRejectedValueOnce(new RuntimeClientError('thread_deletion_cancelled', 'Cancelled'));
  await act(() => harness.result.current.navigation.deleteThread(source));
  expect(harness.confirmDiscardProjectFile).not.toHaveBeenCalled();
  expect(harness.onError).not.toHaveBeenCalled();
  harness.deleteThread.mockRejectedValueOnce(new Error('Delete failed'));
  await act(() => harness.result.current.navigation.deleteThread(source));
  expect(harness.onError).toHaveBeenCalledExactlyOnceWith('Delete failed');
  expect(harness.reloadThreads).not.toHaveBeenCalled();
  expect(harness.resetThreadWorkspacePanels).not.toHaveBeenCalled();
  expect(harness.result.current.currentThread?.id).toBe(source.id);
});

it.each(['archiveProject', 'removeProject'] as const)('reports a failed %s once and preserves the current view for retry', async (action) => {
  const harness = setup();
  harness[action].mockRejectedValueOnce(new Error('Project operation failed'));
  await act(async () => { expect(await harness.result.current.navigation[action](project)).toBe(false); });
  expect(harness.onError).toHaveBeenCalledExactlyOnceWith('Project operation failed');
  expect(harness.result.current.currentThread?.id).toBe(source.id);
  expect(harness.result.current.activeProjectId).toBe(project.id);
  expect(harness.reloadThreads).not.toHaveBeenCalled();
  await act(async () => { expect(await harness.result.current.navigation[action](project)).toBe(true); });
  expect(harness[action]).toHaveBeenCalledTimes(2);
});

it('does not navigate back when project removal completes after opening another conversation', async () => {
  const harness = setup();
  let finish!: () => void;
  harness.removeProject.mockImplementationOnce(() => new Promise<void>((resolve) => { finish = resolve; }));
  let pending!: Promise<boolean>;
  await act(async () => { pending = harness.result.current.navigation.removeProject(project); });
  await act(() => harness.result.current.navigation.selectThread(other.id));
  harness.resetProjectWorkspaceState.mockClear();
  await act(async () => { finish(); await pending; });
  expect(harness.result.current.currentThread?.id).toBe(other.id);
  expect(harness.result.current.activeProjectId).toBe(other.projectId);
  expect(harness.resetProjectWorkspaceState).not.toHaveBeenCalled();
});

it('keeps a failed rename editable and closes the editor after retry', async () => {
  const harness = setup();
  act(() => harness.result.current.navigation.openRenameThread(source));
  act(() => harness.result.current.navigation.setRenameThreadTitle('New title'));
  harness.updateThread.mockRejectedValueOnce(new Error('Rename failed'));
  await act(() => harness.result.current.navigation.saveRenameThread());
  expect(harness.onError).toHaveBeenCalledExactlyOnceWith('Rename failed');
  expect(harness.result.current.navigation.renamingThread?.id).toBe(source.id);
  expect(harness.result.current.navigation.renameThreadTitle).toBe('New title');
  await act(() => harness.result.current.navigation.saveRenameThread());
  expect(harness.updateThread).toHaveBeenLastCalledWith(source.id, { title: 'New title' });
  expect(harness.result.current.navigation.renamingThread).toBeNull();
});
