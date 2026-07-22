import type { WorkspaceFileRead } from '@setsuna-desktop/contracts';
import { describe, expect, it } from 'vitest';
import { visibleWorkspaceFilePreview } from '../../../../../src/features/workspace/hooks/useProjectWorkspace.js';

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
