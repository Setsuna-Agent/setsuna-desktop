// @vitest-environment happy-dom

import { workspaceTargetRootId, type DesktopRuntimeClient, type WorkspaceEntry, type WorkspaceFileRead, type WorkspaceFileSaveInput, type WorkspaceProjectTarget } from '@setsuna-desktop/contracts';
import { ConfirmationProvider } from '@setsuna-desktop/renderer-ui';
import { act, cleanup, fireEvent, renderHook, screen, waitFor } from '@testing-library/react';
import { createElement, useState, type PropsWithChildren } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  visibleWorkspaceFilePreview,
  workspaceFileOpenFailureFeedback,
  useProjectWorkspace,
} from '../../../../../src/features/workspace/hooks/useProjectWorkspace.js';
import { translate, type Translate } from '../../../../../src/shared/i18n/I18nProvider.js';
import { ToastProvider } from '../../../../../src/app/providers/ToastProvider.js';
import { addPanelToSlotState, createFilePanel, deleteFilePanelsInSlot, renameFilePanelsInSlot, type DesktopPanelSlotState } from '../../../../../src/features/workspace/model.js';

afterEach(cleanup);

function WorkspaceProviders({ children }: PropsWithChildren) {
  return createElement(ToastProvider, null, createElement(ConfirmationProvider, null, children));
}

it('keeps same-named drafts separate while switching directories and saves to the original source', async () => {
  const project = { id: 'project', name: 'Workspace', path: '/main', createdAt: '', updatedAt: '',
    roots: [{ id: 'main', path: '/main' }, { id: 'child', path: '/agent' }],
  };
  const file: WorkspaceFileRead = { projectId: project.id, path: 'same.txt', content: 'original',
    size: 8, revision: 'original', preview: { kind: 'text' }, truncated: false };
  const client = {
    readProjectFile: vi.fn(async (target) => ({ ...file, rootId: workspaceTargetRootId(target) })),
    saveProjectFile: vi.fn(async (target, _path, input) => ({ ...file, rootId: workspaceTargetRootId(target), content: input.content, revision: 'saved' })),
  };
  const view = renderHook(() => {
    const [rootId, setRootId] = useState('main');
    return useProjectWorkspace({ project, activeProjectId: project.id, rootId,
      client: client as unknown as DesktopRuntimeClient,
      onOpenFilePanel: (_path, nextRootId) => setRootId(nextRootId!),
    });
  }, { wrapper: WorkspaceProviders });
  await act(async () => { expect(await view.result.current.openProjectFile('/main/same.txt')).toBe(true); });
  act(() => view.result.current.fileDraft.updateContent('main draft'));
  await act(async () => { expect(await view.result.current.openProjectFile('/agent/same.txt')).toBe(true); });
  expect(view.result.current.fileDraft.content).toBe('original');
  act(() => view.result.current.fileDraft.updateContent('child draft'));
  await act(async () => { expect(await view.result.current.openProjectFile('/main/same.txt')).toBe(true); });
  expect(view.result.current.fileDraft.content).toBe('main draft');
  expect(view.result.current.isFileDirty('same.txt', 'child')).toBe(true);
  await act(async () => { expect(await view.result.current.fileDraft.save()).toBe(true); });
  expect(client.saveProjectFile).toHaveBeenCalledExactlyOnceWith({ projectId: 'project', rootId: 'main' }, 'same.txt', {
    content: 'main draft', expectedRevision: 'original',
  });
  await act(async () => { expect(await view.result.current.openProjectFile('/agent/same.txt')).toBe(true); });
  expect(view.result.current.fileDraft.content).toBe('child draft');
});

async function openInactiveDrafts() {
  const project = { id: 'project', name: 'Workspace', path: '/main', createdAt: '', updatedAt: '',
    roots: [{ id: 'main', path: '/main' }, { id: 'child', path: '/agent' }],
  };
  const file = (target: WorkspaceProjectTarget, filePath: string): WorkspaceFileRead => ({
    projectId: project.id, rootId: workspaceTargetRootId(target), path: filePath,
    content: 'original', size: 8, revision: 'original', preview: { kind: 'text' }, truncated: false,
  });
  const client = {
    readProjectFile: vi.fn(async (target: WorkspaceProjectTarget, filePath: string) => file(target, filePath)),
    saveProjectFile: vi.fn(async (target: WorkspaceProjectTarget, filePath: string, input: WorkspaceFileSaveInput): Promise<WorkspaceFileRead> => ({
      ...file(target, filePath), content: input.content, revision: 'saved',
    })),
    renameProjectEntry: vi.fn().mockResolvedValue({ path: 'lib', name: 'lib', type: 'directory' }),
    moveProjectEntry: vi.fn().mockResolvedValue({ path: 'archive/lib', name: 'lib', type: 'directory' }),
    deleteProjectEntry: vi.fn().mockResolvedValue(undefined),
  };
  const view = renderHook(() => {
    const [rootId, setRootId] = useState('main');
    return useProjectWorkspace({ project, activeProjectId: project.id, rootId,
      client: client as unknown as DesktopRuntimeClient,
      onOpenFilePanel: (_path, nextRootId) => setRootId(nextRootId!),
    });
  }, { wrapper: WorkspaceProviders });
  for (const [filePath, content] of [
    ['/agent/src/one.ts', 'first child draft'],
    ['/main/src/one.ts', 'primary draft'],
    ['/agent/src/two.ts', 'second child draft'],
  ]) {
    await act(async () => { expect(await view.result.current.openProjectFile(filePath)).toBe(true); });
    act(() => view.result.current.fileDraft.updateContent(content));
  }
  await act(async () => { await view.result.current.openProjectFile('/main/keep.ts'); });
  await act(async () => { await view.result.current.openProjectFile('/agent/keep.ts'); });
  return { view, client };
}

it('finishes a pending rename in its original directory after switching to another directory', async () => {
  const { view, client } = await openInactiveDrafts();
  await act(async () => { await view.result.current.openProjectFile('/agent/src/one.ts'); });
  let finishRename!: (entry: WorkspaceEntry) => void;
  client.renameProjectEntry.mockImplementationOnce(() => new Promise((resolve) => { finishRename = resolve; }));
  let renaming!: Promise<WorkspaceEntry | null>;
  act(() => { renaming = view.result.current.renameEntry('src', 'lib'); });
  await act(async () => { expect(await view.result.current.openProjectFile('/main/keep.ts')).toBe(true); });
  expect(view.result.current.entryOperationPending).toBe(true);
  await act(async () => {
    finishRename({ path: 'lib', name: 'lib', type: 'directory' });
    expect(await renaming).toMatchObject({ path: 'lib' });
  });
  expect(view.result.current.entryOperationPending).toBe(false);
  expect(view.result.current.filePreview).toMatchObject({ rootId: 'main', path: 'keep.ts' });
  expect(view.result.current.isFileDirty('src/one.ts', 'main')).toBe(true);
  expect(view.result.current.isFileDirty('src/one.ts', 'child')).toBe(false);
  expect(view.result.current.isFileDirty('lib/one.ts', 'child')).toBe(true);
  await act(async () => { await view.result.current.openProjectFile('/agent/lib/one.ts'); });
  expect(view.result.current.fileDraft.content).toBe('first child draft');
  await act(async () => { expect(await view.result.current.fileDraft.save()).toBe(true); });
  expect(client.saveProjectFile).toHaveBeenLastCalledWith({ projectId: 'project', rootId: 'child' }, 'lib/one.ts', {
    content: 'first child draft', expectedRevision: 'original',
  });
});

it('relocates all inactive descendant drafts and preserves same-named drafts in other roots', async () => {
  const { view, client } = await openInactiveDrafts();
  await act(async () => { await view.result.current.renameEntry('src', 'lib'); });
  let moving!: Promise<WorkspaceEntry | null>;
  act(() => { moving = view.result.current.moveEntry('lib', 'archive'); });
  fireEvent.click(screen.getByRole('button', { name: '移动' }));
  await act(async () => { await moving; });
  expect(view.result.current.filePreview?.path).toBe('keep.ts');
  expect(view.result.current.isFileDirty('src/one.ts', 'child')).toBe(false);
  expect(view.result.current.isFileDirty('lib/one.ts', 'child')).toBe(false);
  expect(view.result.current.isFileDirty('archive/lib/one.ts', 'child')).toBe(true);
  expect(view.result.current.isFileDirty('src/one.ts', 'main')).toBe(true);

  for (const [filePath, content] of [
    ['archive/lib/one.ts', 'first child draft'], ['archive/lib/two.ts', 'second child draft'],
  ]) {
    await act(async () => { await view.result.current.openProjectFile(filePath); });
    expect(view.result.current.fileDraft).toMatchObject({ content, dirty: true });
    await act(async () => { expect(await view.result.current.fileDraft.save()).toBe(true); });
    expect(client.saveProjectFile).toHaveBeenLastCalledWith({ projectId: 'project', rootId: 'child' }, filePath, {
      content, expectedRevision: 'original',
    });
  }
  await act(async () => { await view.result.current.openProjectFile('/main/src/one.ts'); });
  expect(view.result.current.fileDraft.content).toBe('primary draft');
  await act(async () => { await view.result.current.fileDraft.save(); });
  expect(view.result.current.fileDraft.hasUnsavedChanges).toBe(false);
});

it('warns for inactive drafts and discards only deleted descendants after successful deletion', async () => {
  const { view, client } = await openInactiveDrafts();
  let deleting!: Promise<boolean>;
  act(() => { deleting = view.result.current.deleteEntry('src'); });
  expect(await screen.findByText(/其中有未保存的修改/)).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: '取消' }));
  await act(async () => { expect(await deleting).toBe(false); });
  expect(client.deleteProjectEntry).not.toHaveBeenCalled();
  expect(view.result.current.isFileDirty('src/one.ts', 'child')).toBe(true);
  expect(view.result.current.isFileDirty('src/two.ts', 'child')).toBe(true);

  client.deleteProjectEntry.mockRejectedValueOnce(new Error('permission denied'));
  act(() => { deleting = view.result.current.deleteEntry('src'); });
  fireEvent.click(screen.getByRole('button', { name: '删除' }));
  await act(async () => { expect(await deleting).toBe(false); });
  expect(view.result.current.isFileDirty('src/one.ts', 'child')).toBe(true);
  expect(view.result.current.isFileDirty('src/two.ts', 'child')).toBe(true);

  act(() => { deleting = view.result.current.deleteEntry('src'); });
  fireEvent.click(screen.getByRole('button', { name: '删除' }));
  await act(async () => { expect(await deleting).toBe(true); });
  expect(view.result.current.filePreview?.path).toBe('keep.ts');
  expect(view.result.current.isFileDirty('src/one.ts', 'child')).toBe(false);
  expect(view.result.current.isFileDirty('src/two.ts', 'child')).toBe(false);
  expect(view.result.current.isFileDirty('src/one.ts', 'main')).toBe(true);
  await act(async () => { await view.result.current.openProjectFile('/main/src/one.ts'); });
  expect(view.result.current.fileDraft.content).toBe('primary draft');
  await act(async () => { await view.result.current.fileDraft.save(); });
  expect(view.result.current.fileDraft.hasUnsavedChanges).toBe(false);
});

it('blocks moving or deleting a file that is still saving in an inactive tab', async () => {
  const { view, client } = await openInactiveDrafts();
  await act(async () => { await view.result.current.openProjectFile('src/one.ts'); });
  let finishSave!: (file: WorkspaceFileRead) => void;
  client.saveProjectFile.mockImplementationOnce(() => new Promise((resolve) => { finishSave = resolve; }));
  let saving!: Promise<boolean>;
  act(() => { saving = view.result.current.fileDraft.save(); });
  await act(async () => { await view.result.current.openProjectFile('/main/keep.ts'); });
  await act(async () => { await view.result.current.openProjectFile('/agent/keep.ts'); });
  await act(async () => {
    await expect(view.result.current.moveEntry('src', 'archive')).rejects.toThrow();
    expect(await view.result.current.deleteEntry('src')).toBe(false);
  });
  expect(client.moveProjectEntry).not.toHaveBeenCalled();
  expect(client.deleteProjectEntry).not.toHaveBeenCalled();
  await act(async () => {
    finishSave({ projectId: 'project', rootId: 'child', path: 'src/one.ts', content: 'first child draft',
      size: 17, revision: 'saved', preview: { kind: 'text' }, truncated: false });
    expect(await saving).toBe(true);
  });
  await act(async () => { await view.result.current.openProjectFile('src/one.ts'); });
  expect(view.result.current.fileDraft.dirty).toBe(false);
});

it('renames and moves open descendants, preserving the active draft for saving at its new path', async () => {
  const file: WorkspaceFileRead = {
    projectId: 'project', path: 'src/main.ts', content: 'original', size: 8,
    revision: 'revision-1', preview: { kind: 'text' }, truncated: false,
  };
  const client = {
    readProjectFile: vi.fn().mockResolvedValue(file),
    renameProjectEntry: vi.fn().mockResolvedValue({ path: 'lib', name: 'lib', type: 'directory' }),
    moveProjectEntry: vi.fn().mockResolvedValue({ path: 'archive/lib', name: 'lib', type: 'directory' }),
    saveProjectFile: vi.fn().mockResolvedValue({ ...file, path: 'archive/lib/main.ts', content: 'unsaved', revision: 'revision-2' }),
  };
  const view = renderHook(() => {
    const [slot, setSlot] = useState<DesktopPanelSlotState>({
      active: 'file:src/main.ts',
      panels: [createFilePanel('src/main.ts'), createFilePanel('src/other.ts'), createFilePanel('src-extra/keep.ts')],
    });
    const workspace = useProjectWorkspace({
      activeProjectId: 'project', client: client as unknown as DesktopRuntimeClient,
      onOpenFilePanel: (path) => setSlot((current) => addPanelToSlotState(current, createFilePanel(path))),
      onEntryRenamed: (previous, next) => setSlot((current) => renameFilePanelsInSlot(current, previous, next)),
    });
    return { workspace, slot };
  }, { wrapper: WorkspaceProviders });
  await act(async () => { await view.result.current.workspace.openProjectFile(file.path); });
  act(() => view.result.current.workspace.fileDraft.updateContent('unsaved'));
  await act(async () => { await view.result.current.workspace.renameEntry('src', 'lib'); });
  expect(view.result.current.workspace.filePreview?.path).toBe('lib/main.ts');
  expect(view.result.current.workspace.fileDraft).toMatchObject({ editing: true, dirty: true, content: 'unsaved' });
  expect(view.result.current.slot.active).toBe('file:lib/main.ts');
  expect(view.result.current.slot.panels.map((panel) => panel.filePath)).toEqual(['lib/main.ts', 'lib/other.ts', 'src-extra/keep.ts']);
  let moving!: Promise<WorkspaceEntry | null>;
  act(() => { moving = view.result.current.workspace.moveEntry('lib', 'archive'); });
  expect(screen.getByText('将“lib”移动到“archive”？')).toBeTruthy();
  expect(client.moveProjectEntry).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button', { name: '移动' }));
  await act(async () => { await moving; });
  expect(client.moveProjectEntry).toHaveBeenCalledWith('project', 'lib', { parentPath: 'archive' });
  expect(view.result.current.workspace.fileDraft).toMatchObject({ content: 'unsaved', dirty: true });
  expect(view.result.current.slot.panels.map((panel) => panel.filePath)).toEqual(['archive/lib/main.ts', 'archive/lib/other.ts', 'src-extra/keep.ts']);
  await act(async () => { await view.result.current.workspace.fileDraft.save(); });
  expect(client.saveProjectFile).toHaveBeenCalledWith('project', 'archive/lib/main.ts', {
    content: 'unsaved', expectedRevision: 'revision-1',
  });
  expect(view.result.current.workspace.fileDraft.dirty).toBe(false);

  client.renameProjectEntry.mockRejectedValueOnce(new Error('already exists'));
  await act(async () => {
    await expect(view.result.current.workspace.renameEntry('archive/lib/main.ts', 'taken.ts')).rejects.toThrow('already exists');
  });
  expect(view.result.current.workspace.filePreview?.path).toBe('archive/lib/main.ts');
  expect(view.result.current.slot.active).toBe('file:archive/lib/main.ts');
});

it('does not apply a pending rename to the next workspace', async () => {
  let finishRename!: (entry: WorkspaceEntry) => void;
  const client = { renameProjectEntry: vi.fn().mockReturnValue(new Promise<WorkspaceEntry>((resolve) => { finishRename = resolve; })) };
  const onEntryRenamed = vi.fn();
  const view = renderHook(({ projectId }) => useProjectWorkspace({
    activeProjectId: projectId, client: client as unknown as DesktopRuntimeClient,
    onOpenFilePanel: vi.fn(), onEntryRenamed,
  }), { initialProps: { projectId: 'first' }, wrapper: WorkspaceProviders });
  let rename!: Promise<WorkspaceEntry | null>;
  act(() => { rename = view.result.current.renameEntry('old', 'new'); });
  view.rerender({ projectId: 'second' });
  await act(async () => {
    finishRename({ path: 'new', name: 'new', type: 'directory' });
    expect(await rename).toBeNull();
  });
  expect(onEntryRenamed).not.toHaveBeenCalled();
  expect(view.result.current.filePreview).toBeNull();
  expect(view.result.current.entryOperationPending).toBe(false);
});

it('moves a file only after confirmation and ignores cancellation, duplicate requests and stale decisions', async () => {
  const entry: WorkspaceEntry = { path: 'archive/main.ts', name: 'main.ts', type: 'file' };
  const client = { moveProjectEntry: vi.fn().mockResolvedValue(entry) };
  const onEntryRenamed = vi.fn();
  const view = renderHook(({ projectId }) => useProjectWorkspace({
    activeProjectId: projectId, client: client as unknown as DesktopRuntimeClient,
    onOpenFilePanel: vi.fn(), onEntryRenamed,
  }), { initialProps: { projectId: 'first' }, wrapper: WorkspaceProviders });
  let moving!: Promise<WorkspaceEntry | null>;
  act(() => { moving = view.result.current.moveEntry('src/main.ts', 'archive'); });
  expect(screen.getByText('将“src/main.ts”移动到“archive”？')).toBeTruthy();
  expect(view.result.current.entryOperationPending).toBe(true);
  await act(async () => { expect(await view.result.current.moveEntry('other.ts', 'archive')).toBeNull(); });
  expect(client.moveProjectEntry).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button', { name: '取消' }));
  await act(async () => { expect(await moving).toBeNull(); });
  expect(view.result.current.entryOperationPending).toBe(false);
  expect(onEntryRenamed).not.toHaveBeenCalled();

  act(() => { moving = view.result.current.moveEntry('src/main.ts', 'archive'); });
  fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Escape' });
  await act(async () => { expect(await moving).toBeNull(); });
  expect(client.moveProjectEntry).not.toHaveBeenCalled();

  act(() => { moving = view.result.current.moveEntry('src/main.ts', 'archive'); });
  view.rerender({ projectId: 'second' });
  fireEvent.click(screen.getByRole('button', { name: '移动' }));
  await act(async () => { expect(await moving).toBeNull(); });
  expect(client.moveProjectEntry).not.toHaveBeenCalled();
  expect(onEntryRenamed).not.toHaveBeenCalled();

  act(() => { moving = view.result.current.moveEntry('src/main.ts', 'archive'); });
  fireEvent.click(screen.getByRole('button', { name: '移动' }));
  await act(async () => { expect(await moving).toEqual(entry); });
  expect(client.moveProjectEntry).toHaveBeenCalledExactlyOnceWith('second', 'src/main.ts', { parentPath: 'archive' });
  expect(onEntryRenamed).toHaveBeenCalledExactlyOnceWith('src/main.ts', 'archive/main.ts', undefined);
  expect(view.result.current.entryOperationPending).toBe(false);
});

it('blocks saves throughout a delayed move and releases the guard after either success or failure', async () => {
  const file: WorkspaceFileRead = {
    projectId: 'project', path: 'src/main.ts', content: 'original', size: 8,
    revision: 'revision-1', preview: { kind: 'text' }, truncated: false,
  };
  let finishMove!: (entry: WorkspaceEntry) => void;
  const movedFile = { ...file, path: 'archive/src/main.ts', content: 'unsaved', revision: 'revision-2' };
  const client = {
    readProjectFile: vi.fn().mockResolvedValue(file),
    moveProjectEntry: vi.fn().mockReturnValueOnce(new Promise<WorkspaceEntry>((resolve) => { finishMove = resolve; })),
    saveProjectFile: vi.fn().mockResolvedValueOnce(movedFile),
  };
  const view = renderHook(() => useProjectWorkspace({
    activeProjectId: 'project', client: client as unknown as DesktopRuntimeClient, onOpenFilePanel: vi.fn(),
  }), { wrapper: WorkspaceProviders });
  await act(async () => { await view.result.current.openProjectFile(file.path); });
  act(() => view.result.current.fileDraft.updateContent('unsaved'));
  let moving!: Promise<WorkspaceEntry | null>;
  await act(async () => {
    moving = view.result.current.moveEntry('src', 'archive');
    expect(await view.result.current.fileDraft.save()).toBe(false);
  });
  expect(client.saveProjectFile).not.toHaveBeenCalled();
  expect(view.result.current.entryOperationPending).toBe(true);
  expect(view.result.current.fileDraft).toMatchObject({ content: 'unsaved', dirty: true, saving: false });
  expect(client.moveProjectEntry).not.toHaveBeenCalled();
  await act(async () => {
    fireEvent.click(screen.getByRole('button', { name: '移动' }));
    expect(await view.result.current.fileDraft.save()).toBe(false);
  });
  await act(async () => {
    finishMove({ path: 'archive/src', name: 'src', type: 'directory' });
    await moving;
  });
  await act(async () => { expect(await view.result.current.fileDraft.save()).toBe(true); });
  expect(client.saveProjectFile).toHaveBeenLastCalledWith('project', movedFile.path, {
    content: 'unsaved', expectedRevision: 'revision-1',
  });
  expect(view.result.current.fileDraft).toMatchObject({ dirty: false, saving: false });

  act(() => view.result.current.fileDraft.updateContent('next edit'));
  client.moveProjectEntry.mockRejectedValueOnce(new Error('move failed'));
  act(() => { moving = view.result.current.moveEntry('archive/src', ''); });
  expect(screen.getByText('将“archive/src”移动到“工作区根目录”？')).toBeTruthy();
  const failedMove = expect(moving).rejects.toThrow('move failed');
  fireEvent.click(screen.getByRole('button', { name: '移动' }));
  await act(async () => { await failedMove; });
  expect(view.result.current.entryOperationPending).toBe(false);
  client.saveProjectFile.mockResolvedValueOnce({ ...movedFile, content: 'next edit', revision: 'revision-3' });
  await act(async () => { expect(await view.result.current.fileDraft.save()).toBe(true); });
  expect(client.saveProjectFile).toHaveBeenLastCalledWith('project', movedFile.path, {
    content: 'next edit', expectedRevision: 'revision-2',
  });
  expect(view.result.current.fileDraft).toMatchObject({ dirty: false, saving: false });
});

it('rejects moving a saving file before React renders and lets the save complete before relocating', async () => {
  const file: WorkspaceFileRead = {
    projectId: 'project', path: 'src/main.ts', content: 'original', size: 8,
    revision: 'revision-1', preview: { kind: 'text' }, truncated: false,
  };
  let finishSave!: (file: WorkspaceFileRead) => void;
  const client = {
    readProjectFile: vi.fn().mockResolvedValue(file),
    moveProjectEntry: vi.fn().mockResolvedValue({ path: 'archive/src', name: 'src', type: 'directory' }),
    saveProjectFile: vi.fn().mockReturnValueOnce(new Promise<WorkspaceFileRead>((resolve) => { finishSave = resolve; })),
  };
  const view = renderHook(() => useProjectWorkspace({
    activeProjectId: 'project', client: client as unknown as DesktopRuntimeClient, onOpenFilePanel: vi.fn(),
  }), { wrapper: WorkspaceProviders });
  await act(async () => { await view.result.current.openProjectFile(file.path); });
  act(() => view.result.current.fileDraft.updateContent('first edit'));
  let saving!: Promise<boolean>;
  await act(async () => {
    saving = view.result.current.fileDraft.save();
    await expect(view.result.current.moveEntry('src', 'archive')).rejects.toThrow();
  });
  expect(client.moveProjectEntry).not.toHaveBeenCalled();
  expect(view.result.current.fileDraft.saving).toBe(true);
  act(() => view.result.current.fileDraft.updateContent('second edit'));
  await act(async () => {
    finishSave({ ...file, content: 'first edit', revision: 'revision-2' });
    expect(await saving).toBe(true);
  });
  expect(view.result.current.fileDraft).toMatchObject({ content: 'second edit', dirty: true, saving: false });
  let moving!: Promise<WorkspaceEntry | null>;
  act(() => { moving = view.result.current.moveEntry('src', 'archive'); });
  fireEvent.click(screen.getByRole('button', { name: '移动' }));
  await act(async () => { await moving; });
  client.saveProjectFile.mockResolvedValueOnce({ ...file, path: 'archive/src/main.ts', content: 'second edit', revision: 'revision-3' });
  await act(async () => { expect(await view.result.current.fileDraft.save()).toBe(true); });
  expect(client.saveProjectFile).toHaveBeenLastCalledWith('project', 'archive/src/main.ts', {
    content: 'second edit', expectedRevision: 'revision-2',
  });
  expect(view.result.current.fileDraft).toMatchObject({ dirty: false, saving: false });
});

it('ignores background reads superseded by local editing or a different file', async () => {
  const file: WorkspaceFileRead = {
    projectId: 'project', path: 'a.ts', content: 'original', size: 8,
    revision: 'revision-1', preview: { kind: 'text' }, truncated: false,
  };
  let finishRead!: (file: WorkspaceFileRead) => void;
  const readProjectFile = vi.fn().mockResolvedValue(file);
  const view = renderHook(() => useProjectWorkspace({ activeProjectId: file.projectId,
    client: { readProjectFile } as unknown as DesktopRuntimeClient, onOpenFilePanel: vi.fn(),
  }), { wrapper: WorkspaceProviders });
  await act(async () => { await view.result.current.openProjectFile(file.path); });
  readProjectFile.mockImplementationOnce(() => new Promise((resolve) => { finishRead = resolve; }));
  let refreshing!: Promise<void>;
  act(() => { refreshing = view.result.current.refreshFilePreview(() => true); });
  act(() => view.result.current.fileDraft.updateContent('local edit'));
  await act(async () => {
    finishRead({ ...file, content: 'external edit', revision: 'revision-2' });
    await refreshing;
  });
  expect(view.result.current.filePreview?.content).toBe('original');
  expect(view.result.current.fileDraft).toMatchObject({ content: 'local edit', dirty: true });

  act(() => view.result.current.fileDraft.updateContent('original'));
  readProjectFile.mockImplementationOnce(() => new Promise((resolve) => { finishRead = resolve; }));
  act(() => { refreshing = view.result.current.refreshFilePreview(() => true); });
  readProjectFile.mockResolvedValueOnce({ ...file, path: 'b.ts', content: 'another file' });
  await act(async () => { await view.result.current.openProjectFile('b.ts'); });
  await act(async () => {
    finishRead({ ...file, content: 'external edit', revision: 'revision-2' });
    await refreshing;
  });
  expect(view.result.current.filePreview?.path).toBe('b.ts');
  expect(view.result.current.fileDraft.content).toBe('another file');
});

it('retains the draft on cancelled or failed deletion and closes affected tabs only after success', async () => {
  const file: WorkspaceFileRead = {
    projectId: 'project', path: 'src/main.ts', content: 'original', size: 8,
    revision: 'revision-1', preview: { kind: 'text' }, truncated: false,
  };
  let finishDeletion!: () => void;
  const pendingDeletion = new Promise<void>((resolve) => { finishDeletion = resolve; });
  const client = {
    readProjectFile: vi.fn().mockResolvedValue(file),
    deleteProjectEntry: vi.fn().mockRejectedValueOnce(new Error('permission denied')).mockReturnValueOnce(pendingDeletion),
  };
  const view = renderHook(() => {
    const [slot, setSlot] = useState<DesktopPanelSlotState>({
      active: 'file:src/main.ts', panels: [createFilePanel('src/main.ts'), createFilePanel('src/other.ts'), createFilePanel('keep.ts')],
    });
    const workspace = useProjectWorkspace({
      activeProjectId: 'project', client: client as unknown as DesktopRuntimeClient,
      onOpenFilePanel: vi.fn(),
      onEntryDeleted: (path) => setSlot((current) => deleteFilePanelsInSlot(current, path)),
    });
    return { slot, workspace };
  }, { wrapper: WorkspaceProviders });
  await act(async () => { await view.result.current.workspace.openProjectFile(file.path); });
  act(() => view.result.current.workspace.fileDraft.updateContent('unsaved'));
  let deleting!: Promise<boolean>;
  act(() => { deleting = view.result.current.workspace.deleteEntry('src'); });
  expect(await screen.findByText(/其中有未保存的修改/)).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: '取消' }));
  await act(async () => { expect(await deleting).toBe(false); });
  expect(client.deleteProjectEntry).not.toHaveBeenCalled();
  act(() => { deleting = view.result.current.workspace.deleteEntry('src'); });
  fireEvent.click(await screen.findByRole('button', { name: '删除' }));
  await act(async () => { expect(await deleting).toBe(false); });
  expect(view.result.current.workspace.fileDraft).toMatchObject({ content: 'unsaved', dirty: true });
  expect(view.result.current.slot.panels).toHaveLength(3);
  act(() => { deleting = view.result.current.workspace.deleteEntry('src'); });
  fireEvent.click(await screen.findByRole('button', { name: '删除' }));
  await waitFor(() => expect(client.deleteProjectEntry).toHaveBeenCalledTimes(2));
  expect(view.result.current.workspace.entryOperationPending).toBe(true);
  await act(async () => { expect(await view.result.current.workspace.deleteEntry('src')).toBe(false); });
  expect(client.deleteProjectEntry).toHaveBeenCalledTimes(2);
  await act(async () => {
    finishDeletion();
    expect(await deleting).toBe(true);
  });
  expect(client.deleteProjectEntry).toHaveBeenLastCalledWith('project', 'src');
  expect(view.result.current.workspace.filePreview).toBeNull();
  expect(view.result.current.workspace.fileDraft.dirty).toBe(false);
  expect(view.result.current.workspace.entryOperationPending).toBe(false);
  expect(view.result.current.workspace.fileDraft.hasUnsavedChanges).toBe(false);
  expect(view.result.current.slot.panels.map((panel) => panel.id)).toEqual(['file:keep.ts', 'files']);
  expect(view.result.current.slot.active).toBe('files');
});

describe('visibleWorkspaceFilePreview', () => {
  const preview: WorkspaceFileRead = {
    projectId: 'temporary_workspace.2026-07-18.thread_a',
    path: 'notes.txt',
    content: 'thread A',
    size: 8,
    truncated: false,
  };

  it('keeps a preview that belongs to the active workspace', () => {
    expect(visibleWorkspaceFilePreview(preview, preview.projectId)).toBe(preview);
  });

  it('synchronously hides a preview from the previous workspace', () => {
    expect(visibleWorkspaceFilePreview(preview, 'temporary_workspace.2026-07-18.thread_b')).toBeNull();
    expect(visibleWorkspaceFilePreview(preview, null)).toBeNull();
  });
});

describe('workspace file open failure feedback', () => {
  const t: Translate = (key, params) => translate('zh-CN', key, params);

  it('warns when a referenced file no longer exists', () => {
    expect(workspaceFileOpenFailureFeedback(
      'src/deleted.ts',
      new Error("ENOENT: no such file or directory, stat '/workspace/src/deleted.ts'"),
      t,
    )).toEqual({
      message: '无法打开 src/deleted.ts：文件已删除或不存在。',
      tone: 'warning',
    });
  });

  it('keeps unrelated read failures as errors', () => {
    expect(workspaceFileOpenFailureFeedback(
      'src/private.ts',
      new Error('Permission denied'),
      t,
    )).toEqual({
      message: '无法打开 src/private.ts：Permission denied',
      tone: 'error',
    });
  });
});
