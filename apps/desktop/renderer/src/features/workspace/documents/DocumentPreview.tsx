import type { DocumentPreviewProps } from '@setsuna-desktop/renderer-contracts/workspace';
import { lazy, Suspense } from 'react';
import { useI18n } from '../../../shared/i18n/I18nProvider.js';

// Neither the viewer nor its WASM/worker assets enter the initial renderer import graph.
const DocumentPreviewSurface = lazy(() => import('./DocumentPreviewSurface.js'));

export function DocumentPreview(props: DocumentPreviewProps) {
  const { t } = useI18n();
  return <Suspense fallback={<div role="status">{t('workspace.files.loadingPreview')}</div>}>
    <DocumentPreviewSurface {...props} />
  </Suspense>;
}
