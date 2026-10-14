import type { WorkspaceFileRead } from '@setsuna-desktop/contracts';
import { useI18n } from '../../../shared/i18n/I18nProvider.js';
import { useWorkspaceVideoPreview } from './useWorkspaceVideoPreview.js';
import './video-preview.css';

export default function WorkspaceVideoPreview({ file, workspaceRoot }: {
  file: WorkspaceFileRead;
  workspaceRoot?: string;
}) {
  const { t } = useI18n();
  const { videoRef, error } = useWorkspaceVideoPreview(file, workspaceRoot);
  return <section className="desktop-video-preview" aria-label={file.path}>
    <video ref={videoRef} controls playsInline preload="metadata" hidden={Boolean(error)} aria-label={file.path} />
    {error ? <div role="alert">{t('workspace.files.documentPreviewFailed', { error })}</div> : null}
  </section>;
}
