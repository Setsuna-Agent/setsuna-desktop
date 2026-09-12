import { FileIcon } from '@setsuna-desktop/renderer-ui';

export function ArtifactFileIcon({ path }: Readonly<{ path: string }>) {
  return <FileIcon className="artifact-card__file-icon" path={path} />;
}
