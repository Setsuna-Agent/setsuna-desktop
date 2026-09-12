import { Vue } from '@react-symbols/icons/files';
import { FileIcon as SymbolsFileIcon } from '@react-symbols/icons/utils';

// Symbols includes the Vue glyph but omits it from its default extension map.
const fileIconExtensions = { vue: Vue };

/** Shared file-type icons for workspace entries, artifacts, and plugin cards. */
export function FileIcon({ path, className }: { path: string; className?: string }) {
  // Renderer paths may come from any desktop OS; only the basename selects an icon.
  const fileName = path.split(/[\\/]/u).filter(Boolean).at(-1) ?? path;
  // Upstream uses plain-object maps; colliding names/extensions need the default file icon.
  const extension = fileName.slice(fileName.lastIndexOf('.') + 1).toLowerCase();
  const iconFileName = Object.hasOwn(Object.prototype, extension) ? '' : fileName;

  return (
    <span className={className} data-file-icon-theme="symbols" aria-hidden="true">
      <SymbolsFileIcon
        fileName={iconFileName}
        editFileExtensionData={fileIconExtensions}
        autoAssign
        width="100%"
        height="100%"
        focusable="false"
      />
    </span>
  );
}
