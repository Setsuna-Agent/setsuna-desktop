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

/** 从路径开头压缩目录，并尽量完整保留末尾文件名。 */
export function WorkspaceFilePath({ className, path }: { className?: string; path: string }) {
  const { directory, filename } = workspaceFilePathParts(path);
  // 目录使用 RTL 从左侧省略；分隔符独立渲染，避免双向文本把末尾斜杠移到最前面。
  const directoryLabel = directory.slice(0, -1);
  return (
    <span
      className={['desktop-workspace-file-path', className].filter(Boolean).join(' ')}
      title={path}
    >
      {directoryLabel ? (
        <span className="desktop-workspace-file-path__directory">
          {directoryLabel}
        </span>
      ) : null}
      {directory
        ? <span className="desktop-workspace-file-path__separator">/</span>
        : null}
      <span className="desktop-workspace-file-path__filename">
        {filename}
      </span>
    </span>
  );
}

function workspaceFilePathParts(path: string): { directory: string; filename: string } {
  const normalized = path.replace(/\\/gu, '/');
  const separatorIndex = normalized.lastIndexOf('/');
  return separatorIndex < 0
    ? { directory: '', filename: normalized }
    : {
        directory: normalized.slice(0, separatorIndex + 1),
        filename: normalized.slice(separatorIndex + 1),
      };
}

function fileName(path: string): string {
  return path.split(/[\\/]/u).filter(Boolean).at(-1) ?? path;
}
