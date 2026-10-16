// @vitest-environment happy-dom

import { workspaceTargetRootId, type DesktopRuntimeClient, type WorkspaceFileRead, type WorkspaceProjectTarget } from '@setsuna-desktop/contracts';
import { ConfirmationProvider } from '@setsuna-desktop/renderer-ui';
import { act, cleanup, renderHook, waitFor } from '@testing-library/react';
import type { PropsWithChildren } from 'react';
import { afterEach, expect, it, vi } from 'vitest';
import { ToastProvider } from '../../../../../src/app/providers/ToastProvider.js';
import { ReviewFeatureHostBoundary } from '../../../../../src/composition/review-feature-adapter.js';
import { useDesktopWorkspacePanels } from '../../../../../src/features/workspace/hooks/useDesktopWorkspacePanels.js';
import { useProjectWorkspace } from '../../../../../src/features/workspace/hooks/useProjectWorkspace.js';
import { useWorkspaceFilePanelLifecycle } from '../../../../../src/features/workspace/hooks/useWorkspaceFilePanelLifecycle.js';
import { createFilePanel } from '../../../../../src/features/workspace/model.js';
import { I18nProvider } from '../../../../../src/shared/i18n/I18nProvider.js';
import { writeSessionRecord } from '../../../../../src/shared/preferences/sessionStorage.js';

afterEach(() => { cleanup(); localStorage.clear(); });

const project = { id: 'project', name: 'Project', path: '/repo', createdAt: '', updatedAt: '',
  roots: [{ id: 'primary', path: '/repo' }],
};
const identity = 'thread:A';
const windowKey = 'primary:0';

function file(path: string): WorkspaceFileRead {
  return { projectId: project.id, rootId: 'primary', path, content: `contents of ${path}`, size: 20,
    revision: path, preview: { kind: 'text' }, truncated: false };
}

function Providers({ children }: PropsWithChildren) {
  return <I18nProvider initialLocale="zh-CN"><ToastProvider><ConfirmationProvider>
    <ReviewFeatureHostBoundary>{children}</ReviewFeatureHostBoundary>
  </ConfirmationProvider></ToastProvider></I18nProvider>;
}

function setup() {
  const readProjectFile = vi.fn(async (target: WorkspaceProjectTarget, path: string): Promise<WorkspaceFileRead> => ({
    ...file(path), rootId: workspaceTargetRootId(target),
  }));
  const client = { readProjectFile } as unknown as DesktopRuntimeClient;
  const view = renderHook(({ windowSessionKey }) => {
    const panels = useDesktopWorkspacePanels({ activeProject: project, activeView: 'chat', conversationDebugEnabled: false,
      targetIdentity: identity, workspaceStatus: 'ready', setError: vi.fn(), windowSessionKey });
    const selectedFile = [panels.sideActivePanel, panels.bottomActivePanel].find((panel) => panel?.type === 'file' || panel?.type === 'files');
    const rootId = selectedFile?.rootId ?? 'primary';
    const workspace = useProjectWorkspace({ project, rootId, activeProjectId: project.id, client, onOpenFilePanel: panels.openFilePanel });
    useWorkspaceFilePanelLifecycle({ panels, workspace, projectId: project.id, rootId, targetIdentity: identity });
    return { panels, workspace };
  }, { initialProps: { windowSessionKey: null as string | null }, wrapper: Providers });
  return { ...view, readProjectFile };
}

it.each(['side', 'bottom'] as const)('validates restored %s directory bindings before reading a preview after delayed recovery', async (slot) => {
  const valid = createFilePanel('keep.ts', 'primary');
  const removed = createFilePanel('removed.ts', 'removed-root');
  const slotKey = slot === 'side' ? 'sidePanelSlot' : 'bottomPanelSlot';
  writeSessionRecord(windowKey, 'panels', identity, {
    [slotKey]: { active: removed.id, panels: [valid, removed] },
  });
  const view = setup();
  expect(view.readProjectFile).not.toHaveBeenCalled();
  view.rerender({ windowSessionKey: windowKey });
  await waitFor(() => expect(view.result.current.workspace.filePreview?.path).toBe(valid.filePath));
  expect(view.result.current.panels[slotKey]).toEqual({ active: valid.id, panels: [valid] });
  expect(view.readProjectFile).toHaveBeenCalledExactlyOnceWith({ projectId: project.id, rootId: 'primary' }, valid.filePath);
});

it.each(['side', 'bottom'] as const)('keeps the recovered %s file panel collapsed until explicitly opened', async (slot) => {
  const saved = createFilePanel('saved.ts', 'primary');
  const slotKey = slot === 'side' ? 'sidePanelSlot' : 'bottomPanelSlot';
  const expandedKey = slot === 'side' ? 'sidePanelExpanded' : 'bottomPanelExpanded';
  const visibleKey = slot === 'side' ? 'sidePanelVisible' : 'bottomPanelVisible';
  writeSessionRecord(windowKey, 'panels', identity, {
    [slotKey]: { active: saved.id, panels: [saved] }, [expandedKey]: false,
  });
  const view = setup();
  let finishRead!: (value: WorkspaceFileRead) => void;
  view.readProjectFile.mockImplementationOnce(() => new Promise((resolve) => { finishRead = resolve; }));
  view.rerender({ windowSessionKey: windowKey });
  await waitFor(() => expect(view.readProjectFile).toHaveBeenCalledOnce());
  expect(view.result.current.panels[visibleKey]).toBe(false);
  await act(async () => { finishRead(file(saved.filePath!)); });
  expect(view.result.current.workspace.filePreview?.path).toBe(saved.filePath);
  expect(view.result.current.panels[slotKey].active).toBe(saved.id);
  expect(view.result.current.panels[visibleKey]).toBe(false);
  // Explicit user navigation must still reveal even an already loaded preview.
  await act(async () => { await view.result.current.workspace.openProjectFile(saved.filePath!); });
  expect(view.result.current.panels[visibleKey]).toBe(true);
  expect(view.readProjectFile).toHaveBeenCalledOnce();
});
