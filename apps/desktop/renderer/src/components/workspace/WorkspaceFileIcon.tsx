import { addCollection, Icon } from '@iconify/react';
import { icons as vscodeIcons } from '@iconify-json/vscode-icons';
import { getIconForFile, getIconForFolder, getIconForOpenFolder } from 'vscode-icons-js';
import type { WorkspaceEntry } from '@setsuna-desktop/contracts';

addCollection(vscodeIcons);

export function WorkspaceFileIcon({
  className = 'desktop-file-row__icon',
  expanded = false,
  path,
  type,
}: {
  className?: string;
  expanded?: boolean;
  path: string;
  type: WorkspaceEntry['type'];
}) {
  const name = fileName(path);
  const icon = type === 'directory' ? (expanded ? getIconForOpenFolder(name) : getIconForFolder(name)) : getIconForFile(name);
  return (
    <span className={className} aria-hidden="true">
      <Icon icon={iconifyNameFromVscodeIcon(icon)} />
    </span>
  );
}

function iconifyNameFromVscodeIcon(iconFile?: string): string {
  const iconName = String(iconFile || '').replace(/\.svg$/i, '').replace(/_/g, '-');
  return `vscode-icons:${iconName || 'default-file'}`;
}

function fileName(path: string): string {
  return path.split('/').filter(Boolean).at(-1) ?? path;
}
