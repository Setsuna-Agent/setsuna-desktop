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
const other: RuntimeThread = { ...source, id: 'other', projectId: 'another-project' };

function setup(remaining: RuntimeThread[] = [other, fallback]) {
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
      projects: [], setProjects: vi.fn(), activeView: 'chat', setActiveView: vi.fn(),
      client: { deleteThread, updateThread, getThread } as unknown as DesktopRuntimeClient,
      confirmDiscardProjectFile, globalThreads: [], threadsByProjectId: new Map(), reloadThreads,
      resetProjectWorkspaceState, resetNewThreadWorkspacePanels: vi.fn(), resetThreadWorkspacePanels,
    });
    return { navigation, currentThread, activeProjectId };
  });
  return { ...hook, deleteThread, updateThread, getThread, confirmDiscardProjectFile, reloadThreads,
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
  harness.deleteThread.mockRejectedValueOnce(new Error('Delete failed'));
  await act(async () => {
    await expect(harness.result.current.navigation.deleteThread(source)).rejects.toThrow('Delete failed');
  });
  expect(harness.reloadThreads).not.toHaveBeenCalled();
  expect(harness.resetThreadWorkspacePanels).not.toHaveBeenCalled();
  expect(harness.result.current.currentThread?.id).toBe(source.id);
});
