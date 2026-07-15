import { memo } from 'react';
import type { WorkspaceEntry } from '@setsuna-desktop/contracts';
import { getIcon } from 'seti-file-icons';

type WorkspaceFileIconProps = {
  className?: string;
  path: string;
  type: WorkspaceEntry['type'];
};

export const WorkspaceFileIcon = memo(function WorkspaceFileIcon({
  className = 'desktop-file-row__icon',
  path,
  type,
}: WorkspaceFileIconProps) {
  if (type === 'directory') return null;

  const icon = getIcon(fileName(path));
  const svgMarkup = { __html: icon.svg };

  return (
    <span
      className={className}
      data-file-icon-theme="seti"
      data-file-icon-color={icon.color}
      aria-hidden="true"
      // The filename only selects a bundled Seti asset; user-controlled text is never inserted into the SVG.
      dangerouslySetInnerHTML={svgMarkup}
    />
  );
});

function fileName(path: string): string {
  return path.split(/[\\/]/u).filter(Boolean).at(-1) ?? path;
}
