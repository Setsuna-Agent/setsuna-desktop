import type { WorkspaceFileRead } from '@setsuna-desktop/contracts';
import { useState } from 'react';
import type { WorkspaceFileFocusRequest } from '../model.js';

export type WorkspaceFileViewMode = 'source' | 'preview';

export function useWorkspaceFileViewMode(file: WorkspaceFileRead | null, focus: WorkspaceFileFocusRequest | null) {
  const canPreview = Boolean(file && /\.(md|markdown|mdown|mkd|csv)$/i.test(file.path)
    && (!file.preview || file.preview.kind === 'text'));
  // A request to reveal a source line must leave preview, even in the same file.
  const revealLine = Boolean(file && focus?.path === file.path);
  const key = JSON.stringify([file?.projectId, file?.rootId, file?.path, revealLine ? focus?.version : null]);
  const [selection, setSelection] = useState<{ key: string; mode: WorkspaceFileViewMode } | null>(null);
  const mode = !canPreview ? 'source'
    : selection?.key === key ? selection.mode : revealLine ? 'source' : 'preview';
  return { canPreview, mode, setMode: (next: WorkspaceFileViewMode) => setSelection({ key, mode: next }) };
}
