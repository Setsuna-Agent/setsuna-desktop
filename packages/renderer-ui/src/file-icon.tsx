import { Vue } from '@react-symbols/icons/files';
import { FileIcon as SymbolsFileIcon } from '@react-symbols/icons/utils';
import type { ComponentProps } from 'react';

// Symbols omits Vue's extension mapping and has no Word document glyph.
const fileIconExtensions = {
  vue: Vue,
  doc: WordDocumentIcon,
  docx: WordDocumentIcon,
  docm: WordDocumentIcon,
  dot: WordDocumentIcon,
  dotx: WordDocumentIcon,
  dotm: WordDocumentIcon,
};

function WordDocumentIcon(props: ComponentProps<'svg'>) {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" {...props}>
      <rect x="7" y="2" width="14" height="20" rx="1.5" fill="#2B7CD3" />
      <path d="M14 7h5M14 11h5M14 15h5" stroke="#FFFFFF" strokeWidth="1.5" />
      <rect x="1" y="6" width="13" height="13" rx="1.5" fill="#185ABD" />
      <path d="m3.5 9 1.6 7 2.4-5 2.4 5 1.6-7" stroke="#FFFFFF" strokeWidth="1.4" strokeLinejoin="round" />
    </svg>
  );
}

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
