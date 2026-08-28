import { getIcon } from 'seti-file-icons';

export function ArtifactFileIcon({ path }: Readonly<{ path: string }>) {
  const icon = getIcon(fileName(path));
  return (
    <span
      aria-hidden="true"
      className="artifact-card__file-icon"
      data-file-icon-color={icon.color}
      data-file-icon-theme="seti"
      // The filename only selects a bundled Seti asset; user text is never inserted into the SVG.
      dangerouslySetInnerHTML={{ __html: icon.svg }}
    />
  );
}

function fileName(path: string): string {
  return path.split(/[\\/]/u).filter(Boolean).at(-1) ?? path;
}
