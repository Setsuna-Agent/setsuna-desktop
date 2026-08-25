import { reviewFilePathParts } from './review-paths.js';
import { useReviewRendererHost } from './host.js';

export function ReviewFileIcon({ className, path }: Readonly<{
  className?: string;
  path: string;
}>) {
  const FileIcon = useReviewRendererHost().ui.FileIcon;
  return <FileIcon className={className} path={path} />;
}

/** Compress directories from the leading edge while keeping the filename visible. */
export function ReviewFilePath({ className, path }: Readonly<{
  className?: string;
  path: string;
}>) {
  const { directory, filename } = reviewFilePathParts(path);
  const directoryLabel = directory.slice(0, -1);
  return (
    <span
      className={['desktop-workspace-file-path', className].filter(Boolean).join(' ')}
      title={path}
    >
      {directoryLabel ? (
        <span className="desktop-workspace-file-path__directory">{directoryLabel}</span>
      ) : null}
      {directory ? <span className="desktop-workspace-file-path__separator">/</span> : null}
      <span className="desktop-workspace-file-path__filename">{filename}</span>
    </span>
  );
}
