// @vitest-environment happy-dom
import { workspaceTargetProjectId, workspaceTargetRootId, type DesktopRuntimeClient, type WorkspaceFileRead, type WorkspaceProjectTarget } from '@setsuna-desktop/contracts';
import { act, cleanup, renderHook, waitFor } from '@testing-library/react';
import { useState } from 'react';
import { afterEach, expect, it, vi } from 'vitest';
import { useSidebarSearchFileNavigation } from '../../../../src/app/sidebar/useSidebarSearchFileNavigation.js';
import { useProjectWorkspace } from '../../../../src/features/workspace/hooks/useProjectWorkspace.js';
import { ToastProvider } from '../../../../src/app/providers/ToastProvider.js';

afterEach(cleanup);

it('opens through the selected project after navigation commits and keeps the matched line when switching roots', async () => {
  const readProjectFile = vi.fn(async (target: WorkspaceProjectTarget, path: string): Promise<WorkspaceFileRead> => ({
    projectId: workspaceTargetProjectId(target), rootId: workspaceTargetRootId(target), path, content: 'line\n'.repeat(20),
    size: 100, truncated: false, preview: { kind: 'text' },
  }));
  const view = renderHook(() => {
    const [projectId, setProjectId] = useState('A');
    const [rootId, setRootId] = useState('main');
    const project = { id: projectId, name: projectId, createdAt: '', updatedAt: '', roots: [
      { id: 'main', path: `/${projectId}/main` }, { id: 'other', path: `/${projectId}/other` },
    ] };
    const workspace = useProjectWorkspace({ project, activeProjectId: projectId, rootId, client: { readProjectFile } as unknown as DesktopRuntimeClient,
      onOpenFilePanel: (_path, nextRootId) => setRootId(nextRootId!),
    });
    const open = useSidebarSearchFileNavigation({
      activeProjectId: projectId, activeView: 'chat', workspaceId: projectId, openRootFile: workspace.openRootFile,
      navigation: { changeView: async () => undefined, startProjectThread: async (id) => { setProjectId(id); return true; } },
    });
    return { open, workspace };
  }, { wrapper: ToastProvider });
  const target = { projectId: 'B', rootId: 'other' };
  const flat = 'a\\b.design.json';
  await act(() => view.result.current.open({ ...target, path: flat, line: 12 }));
  await waitFor(() => expect(view.result.current.workspace.filePreview?.projectId).toBe('B'));
  expect(readProjectFile).toHaveBeenCalledExactlyOnceWith(target, flat);
  expect(view.result.current.workspace.fileFocusRequest).toMatchObject({ path: flat, line: 12 });
  await act(() => view.result.current.open({ ...target, path: 'a/b.design.json' }));
  await act(() => view.result.current.open({ ...target, path: flat }));
  expect(readProjectFile.mock.calls.map(([, path]) => path)).toEqual([flat, 'a/b.design.json', flat]);
});

it('does not open a file when leaving the current project is cancelled', async () => {
  const openRootFile = vi.fn(async () => true);
  const navigation = { changeView: vi.fn(async () => undefined), startProjectThread: vi.fn(async () => false) };
  const view = renderHook(() => useSidebarSearchFileNavigation({ activeProjectId: 'A', workspaceId: 'A', activeView: 'chat', navigation, openRootFile }));
  await act(() => view.result.current({ projectId: 'B', rootId: 'primary', path: 'same.ts', line: 12 }));
  expect(openRootFile).not.toHaveBeenCalled();
});
