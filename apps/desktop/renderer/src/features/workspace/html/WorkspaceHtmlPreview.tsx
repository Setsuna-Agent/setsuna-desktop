import type { WorkspaceFileRead } from '@setsuna-desktop/contracts';
import { HtmlFilePreview } from '@setsuna-desktop/renderer-ui';
import { useCallback } from 'react';

export function WorkspaceHtmlPreview({ file, workspaceRoot, content }: {
  file: WorkspaceFileRead;
  workspaceRoot?: string;
  content?: string;
}) {
  const { path: filePath, revision, modifiedAt, size } = file;
  const loadPreview = useCallback(async () => {
    const desktop = window.setsunaDesktop?.desktop;
    if (!desktop || !workspaceRoot) throw new Error('Workspace is unavailable.');
    const result = await desktop.createWorkspaceFilePreview(workspaceRoot, filePath,
      { htmlContent: content, sandbox: true });
    if (!result.ok) throw new Error(result.error);
    return { url: result.url, dispose: () => { void desktop.releaseWorkspaceFilePreview(result.previewId).catch(() => undefined); } };
  }, [content, filePath, workspaceRoot]);
  return <HtmlFilePreview key={revision ?? modifiedAt ?? size} title={filePath} loadPreview={loadPreview} />;
}
