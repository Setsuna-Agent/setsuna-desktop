import type { DocumentPreviewProps } from '@setsuna-desktop/renderer-contracts/workspace';
import { useI18n } from '../../../shared/i18n/I18nProvider.js';
import { useDocumentPreview } from './useDocumentPreview.js';
import './document-preview.css';

export default function DocumentPreviewSurface(props: DocumentPreviewProps) {
  const { t } = useI18n();
  const { containerRef, loading, error } = useDocumentPreview(props);
  return <section className="desktop-document-preview" aria-label={props.label ?? props.filePath}>
    <div className="desktop-document-preview__host" ref={containerRef} />
    {loading || error ? <div className="desktop-document-preview__status" role={error ? 'alert' : 'status'}>
      {error ? t('workspace.files.documentPreviewFailed', { error }) : t('workspace.files.loadingPreview')}
    </div> : null}
  </section>;
}
