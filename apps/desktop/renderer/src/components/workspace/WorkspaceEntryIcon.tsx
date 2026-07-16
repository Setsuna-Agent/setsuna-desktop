import { memo } from 'react';
import { Folder } from 'lucide-react';
import type { WorkspaceEntry } from '@setsuna-desktop/contracts';
import { WorkspaceFileIcon } from './WorkspaceFileIcon.js';

type WorkspaceEntryIconProps = {
  className?: string;
  path: string;
  size?: number;
  type: WorkspaceEntry['type'];
};

export const WorkspaceEntryIcon = memo(function WorkspaceEntryIcon({
  className,
  path,
  size = 15,
  type,
}: WorkspaceEntryIconProps) {
  if (type === 'directory') {
    return <Folder aria-hidden="true" className={className} focusable="false" size={size} />;
  }
  return <WorkspaceFileIcon className={className} path={path} type={type} />;
});
