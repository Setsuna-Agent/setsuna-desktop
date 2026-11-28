import { DocumentMarkdown, ExportPreviewDialog, ImagePreview } from '@setsuna-desktop/renderer-ui';
import { useI18n } from '../../../shared/i18n/I18nProvider.js';
import type { ConversationExportPreview } from './exportConversation.js';
import { useConversationExportActions } from './useConversationExportActions.js';

export default function ConversationExportDialog({ preview, onClose }: {
  preview: ConversationExportPreview | null;
  onClose: () => void;
}) {
  const { t } = useI18n();
  const { busy, copied, run, file } = useConversationExportActions(preview);
  const image = preview?.file.format === 'png';
  return <ExportPreviewDialog
    labels={{ title: t('chat.export.preview'), exporting: t('chat.export.exporting'), expand: t('chat.export.expand'),
      restore: t('chat.export.restore'), saveAs: t('chat.export.saveAs'), copied: t('chat.message.copied'),
      copy: t(image ? 'chat.image.copy' : 'chat.export.copy'), reveal: t('chat.export.reveal'), open: t('chat.export.open') }}
    fileName={file?.name ?? null} image={image} busy={busy} copied={copied} onAction={(action) => { void run(action); }} onClose={onClose}>
    {preview?.file.imageDataUrl ? <ImagePreview src={preview.file.imageDataUrl} alt={preview.file.name} draggable={false} />
      : preview?.file.format === 'html' ? <iframe title={preview.file.name} srcDoc={preview.input.content} sandbox="" referrerPolicy="no-referrer" />
        : preview ? <DocumentMarkdown content={preview.markdown} className="sd-export-preview-document" /> : null}
  </ExportPreviewDialog>;
}
