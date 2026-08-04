import type { WorkspaceEntrySearchItem } from '@setsuna-desktop/contracts';

export function workspaceFileMentionEntry(filePath: string): WorkspaceEntrySearchItem {
  const normalizedPath = filePath.replace(/\\/gu, '/').replace(/^\.\//u, '').replace(/\/+$/u, '');
  const separatorIndex = normalizedPath.lastIndexOf('/');
  return {
    kind: 'file',
    name: separatorIndex >= 0 ? normalizedPath.slice(separatorIndex + 1) : normalizedPath,
    parent: separatorIndex >= 0 ? normalizedPath.slice(0, separatorIndex) : '',
    path: normalizedPath,
  };
}
