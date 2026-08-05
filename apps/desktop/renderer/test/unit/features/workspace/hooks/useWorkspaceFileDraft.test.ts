import {
  WORKSPACE_TEXT_FILE_EDIT_MAX_BYTES,
  type WorkspaceFileRead,
} from '@setsuna-desktop/contracts';
import { describe, expect, it } from 'vitest';
import {
  canEditWorkspaceFile,
  reconcileWorkspaceFileDraftAfterSave,
} from '../../../../../src/features/workspace/hooks/useWorkspaceFileDraft.js';

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
