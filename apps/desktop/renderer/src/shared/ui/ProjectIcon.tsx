import type { WorkspaceProjectIcon } from '@setsuna-desktop/contracts';
import { FolderClosed, FolderOpen } from 'lucide-react';
import { iconColorCssValue } from './icon-colors.js';
import { PROJECT_ICON_COMPONENTS } from './project-icon-presets.js';

export function ProjectIcon({ icon, open = false, size = 14, className }: Readonly<{
  icon?: WorkspaceProjectIcon | null;
  open?: boolean;
  size?: number;
  className?: string;
}>) {
  const Icon = !icon || icon.key === 'folder'
    ? (open ? FolderOpen : FolderClosed)
    : PROJECT_ICON_COMPONENTS[icon.key] ?? FolderClosed;
  return <Icon className={className} size={size}
    style={icon?.color ? { color: iconColorCssValue(icon.color) } : undefined} aria-hidden="true" />;
}
