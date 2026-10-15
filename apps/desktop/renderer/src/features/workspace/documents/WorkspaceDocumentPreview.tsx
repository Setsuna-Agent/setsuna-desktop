import type { WorkspaceFileRead } from '@setsuna-desktop/contracts';
import { useCallback } from 'react';
import { DocumentPreview } from './DocumentPreview.js';

export function WorkspaceDocumentPreview({ file, workspaceRoot, content }: {
  file: WorkspaceFileRead;
  workspaceRoot?: string;
  content?: string;
}) {
  const { path: filePath, revision } = file;
  const load = useCallback(async () => {
    if (content !== undefined) return new TextEncoder().encode(content);
    const desktop = window.setsunaDesktop?.desktop;
    if (!desktop || !workspaceRoot) throw new Error('Workspace is unavailable.');
    const result = await desktop.readWorkspaceDocument(workspaceRoot, filePath);
    if (!result.ok) throw new Error(result.error);
    return result.data;
    // A disk revision change reloads the same path without retaining its old parser instance.
  }, [content, filePath, workspaceRoot, revision]);
  return <DocumentPreview filePath={filePath} load={load} />;
}
