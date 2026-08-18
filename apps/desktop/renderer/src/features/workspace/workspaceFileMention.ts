import type { WorkspaceEntrySearchItem } from '@setsuna-desktop/contracts';

export function workspaceFileMentionEntry(filePath: string): WorkspaceEntrySearchItem {
  return workspaceMentionEntry(filePath, 'file');
}

export function workspaceDirectoryMentionEntry(directoryPath: string): WorkspaceEntrySearchItem {
  return workspaceMentionEntry(directoryPath, 'directory');
}

function workspaceMentionEntry(
  entryPath: string,
  kind: WorkspaceEntrySearchItem['kind'],
): WorkspaceEntrySearchItem {
  const normalizedPath = entryPath.replace(/\\/gu, '/').replace(/^\.\//u, '').replace(/\/+$/u, '');
  const separatorIndex = normalizedPath.lastIndexOf('/');
  return {
    kind,
    name: separatorIndex >= 0 ? normalizedPath.slice(separatorIndex + 1) : normalizedPath,
    parent: separatorIndex >= 0 ? normalizedPath.slice(0, separatorIndex) : '',
    path: normalizedPath,
  };
}
