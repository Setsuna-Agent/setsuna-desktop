// @vitest-environment happy-dom
import type { DesktopRuntimeClient, RuntimeThread, WorkspaceProject } from '@setsuna-desktop/contracts';
import { act, cleanup, renderHook } from '@testing-library/react';
import { useState } from 'react';
import { afterEach, expect, it, vi } from 'vitest';
import { useDesktopNavigation } from '../../../../src/app/controller/useDesktopNavigation.js';
import type { MainView } from '../../../../src/app/types.js';

afterEach(cleanup);

it.each([false, true])('starts a new chat from a restored thread when its project exists: %s', async (projectExists) => {
  const oldThread: RuntimeThread = {
    id: 'thread_old', projectId: 'project_old', title: 'Old conversation',
    createdAt: '2026-07-01T00:00:00.000Z', updatedAt: '2026-07-01T00:00:00.000Z',
    archived: false, messageCount: 0, lastMessagePreview: '', messages: [], lastSeq: 0,
  };
  const project: WorkspaceProject = {
    id: 'project_old', name: 'Project', createdAt: oldThread.createdAt, updatedAt: oldThread.updatedAt,
  };
  const resetPanels = vi.fn();
  const resetProject = vi.fn();
  const { result } = renderHook(() => {
    const [activeProjectId, setActiveProjectId] = useState<string | null>(oldThread.projectId!);
    const [currentThread, setCurrentThread] = useState<RuntimeThread | null>(oldThread);
    const [activeView, setActiveView] = useState<MainView>('settings');
    const [projects, setProjects] = useState(projectExists ? [project] : []);
    const navigation = useDesktopNavigation({
      activeProjectId, setActiveProjectId, currentThread, setCurrentThread, projects, setProjects, setActiveView,
      client: {} as DesktopRuntimeClient,
      confirmDiscardProjectFile: async () => true,
      globalThreads: [], threadsByProjectId: new Map(), reloadThreads: async () => [],
      resetNewThreadWorkspacePanels: resetPanels,
      resetProjectWorkspaceState: resetProject,
      resetThreadWorkspacePanels: vi.fn(),
    });
    return { navigation, activeProjectId, currentThread, activeView };
  });

  await act(() => result.current.navigation.startCurrentThread());

  const newProjectId = projectExists ? project.id : null;
  expect(result.current.activeProjectId).toBe(newProjectId);
  expect(result.current.currentThread).toBeNull();
  expect(result.current.activeView).toBe('chat');
  expect(resetPanels).toHaveBeenCalledWith(newProjectId);
  expect(resetProject).toHaveBeenCalledTimes(projectExists ? 0 : 1);
  expect(oldThread.projectId).toBe('project_old');
});
