import {
  WORKSPACE_TEXT_FILE_EDIT_MAX_BYTES,
  type WorkspaceFileRead,
} from '@setsuna-desktop/contracts';
import { describe, expect, it } from 'vitest';
import { canEditWorkspaceFile } from '../../../../../src/features/workspace/hooks/useWorkspaceFileDraft.js';

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
