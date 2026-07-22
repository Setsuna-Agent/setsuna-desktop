import type { WorkspaceEntry } from '@setsuna-desktop/contracts';
import { memo } from 'react';
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
      // 文件名只用于选择内置 Seti 资源，用户可控文本绝不会插入 SVG。
      dangerouslySetInnerHTML={svgMarkup}
    />
  );
});

function fileName(path: string): string {
  return path.split(/[\\/]/u).filter(Boolean).at(-1) ?? path;
}
