import { lazy, Suspense } from 'react';
import type { ReviewFileDocumentProps } from '@setsuna-desktop/feature-review/renderer/host';
import { useI18n } from '../../shared/i18n/I18nProvider.js';

const MarkdownPreview = lazy(async () => {
  const module = await import('../../features/workspace/markdown/WorkspaceMarkdownPreview.js');
  return { default: module.WorkspaceMarkdownPreview };
});

export function ReviewFileDocument({ content, filePath, onOpenFile, loadImage }: ReviewFileDocumentProps) {
  const { t } = useI18n();
  return <Suspense fallback={<div className="desktop-review-document-status" role="status">{t('workspace.files.loadingPreview')}</div>}>
    <MarkdownPreview content={content} file={{ path: filePath }} onOpenFile={onOpenFile} loadImage={loadImage} />
  </Suspense>;
}
