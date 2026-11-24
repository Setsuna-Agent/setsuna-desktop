import { ArrowLeft, Globe } from 'lucide-react';
import { useMemo } from 'react';
import { IconButton } from '@setsuna-desktop/renderer-ui';
import type { DesignLibraryColorScheme } from '../../contracts/design-library-presets.js';
import { DesignDocumentSurface, type DesignDocumentSurfaceProps, type DesignLibraryPreviewTarget } from '../DesignDocumentSurface.js';

export function DesignPresetLibraryPreview({ source, colorScheme, documentRef, client, visible, watchDirectories, onClose, translate: t }: Readonly<{
  source: DesignLibraryPreviewTarget;
  colorScheme: DesignLibraryColorScheme;
  onClose(): void;
}> & Pick<DesignDocumentSurfaceProps, 'documentRef' | 'client' | 'visible' | 'watchDirectories' | 'translate'>) {
  const libraryRef = useMemo(() => ({ ...documentRef, path: source.path }), [documentRef, source.path]);
  const websiteLabel = t('feature.design.openLibraryWebsite', { name: source.name });
  return <div className="design-workspace__editing">
    <nav className="design-workspace__library-header" aria-label={source.name}>
      <div className="design-workspace__bar">
        <IconButton autoFocus size="small" label={t('feature.design.backToDraft')} onClick={onClose}><ArrowLeft size={17} /></IconButton>
        <span className="design-workspace__library-name">{source.name}</span>
      </div>
      <a className="sd-button sd-button--secondary sd-button--small sd-icon-button design-workspace__library-website" href={source.homepage}
        target="_blank" rel="noopener noreferrer" aria-label={websiteLabel} title={websiteLabel}>
        <Globe size={15} aria-hidden="true" />
      </a>
    </nav>
    <div className="design-workspace__editor">
      <DesignDocumentSurface libraryPreview={colorScheme} documentRef={libraryRef} expectedDocumentId={source.documentId}
        client={client} visible={visible} watchDirectories={watchDirectories} onDocumentMissing={onClose} translate={t} />
    </div>
  </div>;
}
