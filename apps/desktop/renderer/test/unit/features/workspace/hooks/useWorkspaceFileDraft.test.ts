// @vitest-environment happy-dom

import {
  WORKSPACE_TEXT_FILE_EDIT_MAX_BYTES,
  type WorkspaceFileRead,
} from '@setsuna-desktop/contracts';
import { ConfirmationProvider } from '@setsuna-desktop/renderer-ui';
import { act, cleanup, fireEvent, renderHook, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  canEditWorkspaceFile,
  reconcileWorkspaceFileDraftAfterSave,
  useWorkspaceFileDraft,
} from '../../../../../src/features/workspace/hooks/useWorkspaceFileDraft.js';

afterEach(cleanup);

it('retains an unsaved draft until confirmation and rejects a decision for a file that has changed', async () => {
  const file: WorkspaceFileRead = {
    projectId: 'project-1', path: 'notes.txt', content: 'original', size: 8,
    revision: 'revision-1', preview: { kind: 'text' }, truncated: false,
  };
  const client = { readProjectFileForEdit: vi.fn(), saveProjectFile: vi.fn() };
  const view = renderHook(({ currentFile }) => useWorkspaceFileDraft({
    client, file: currentFile, onFilePrepared: vi.fn(), onFileSaved: vi.fn(),
  }), { initialProps: { currentFile: file }, wrapper: ConfirmationProvider });
  await act(async () => { await view.result.current.startEditing(); });
  act(() => view.result.current.updateContent('unsaved edit'));
  let decision!: Promise<boolean>;
  act(() => { decision = view.result.current.confirmDiscardChanges(); });
  expect(view.result.current.dirty).toBe(true);
  fireEvent.click(await screen.findByRole('button', { name: '取消' }));
  await act(async () => { expect(await decision).toBe(false); });
  expect(view.result.current.content).toBe('unsaved edit');
  expect(view.result.current.dirty).toBe(true);

  act(() => { decision = view.result.current.confirmDiscardChanges(); });
  view.rerender({ currentFile: { ...file, path: 'another.txt' } });
  fireEvent.click(await screen.findByRole('button', { name: '确认' }));
  await act(async () => { expect(await decision).toBe(false); });
  expect(view.result.current.content).toBe('original');
  expect(client.saveProjectFile).not.toHaveBeenCalled();
});

describe('canEditWorkspaceFile', () => {
  const textFile: WorkspaceFileRead = {
    projectId: 'project-1',
    path: 'src/example.ts',
    content: 'export {};\n',
    size: 11,
    preview: { kind: 'text' },
    revision: 'revision-1',
    truncated: false,
  };

  it('enables revisioned text files that can be fully loaded into the editor', () => {
    expect(canEditWorkspaceFile(textFile)).toBe(true);
    expect(canEditWorkspaceFile({ ...textFile, truncated: true })).toBe(true);
    expect(canEditWorkspaceFile({ ...textFile, revision: undefined })).toBe(false);
    expect(canEditWorkspaceFile({ ...textFile, size: WORKSPACE_TEXT_FILE_EDIT_MAX_BYTES + 1 })).toBe(false);
    expect(canEditWorkspaceFile({ ...textFile, preview: { kind: 'unsupported', reason: 'binary' } })).toBe(false);
  });
});

describe('reconcileWorkspaceFileDraftAfterSave', () => {
  const savedFile: WorkspaceFileRead = {
    projectId: 'project-1',
    path: 'src/example.ts',
    content: 'saved content',
    size: 13,
    preview: { kind: 'text' },
    revision: 'revision-2',
    truncated: false,
  };
  const savingSession = {
    content: 'saved content',
    error: null,
    expectedRevision: 'revision-1',
    fileKey: 'project-1:src/example.ts',
    originalContent: 'original content',
    saving: true,
  };

  it('closes the editor when its content still matches the saved snapshot', () => {
    expect(reconcileWorkspaceFileDraftAfterSave(savingSession, {
      saved: savedFile,
      savingContent: 'saved content',
      savingFileKey: savingSession.fileKey,
    })).toBeNull();
  });

  it('preserves edits made while the save was pending and advances their base revision', () => {
    expect(reconcileWorkspaceFileDraftAfterSave({
      ...savingSession,
      content: 'newer editor content',
    }, {
      saved: savedFile,
      savingContent: 'saved content',
      savingFileKey: savingSession.fileKey,
    })).toEqual({
      ...savingSession,
      content: 'newer editor content',
      expectedRevision: 'revision-2',
      originalContent: 'saved content',
      saving: false,
    });
  });
});
