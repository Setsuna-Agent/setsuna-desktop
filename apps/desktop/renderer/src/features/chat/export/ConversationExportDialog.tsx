import { Button, Dialog, DocumentMarkdown, FileIcon, IconButton, IconSwap, ImagePreview } from '@setsuna-desktop/renderer-ui';
import { Check, Copy, Download, ExternalLink, FolderOpen, Maximize2, Minimize2 } from 'lucide-react';
import { useState } from 'react';
import { useI18n } from '../../../shared/i18n/I18nProvider.js';
import { ActionTooltip } from '../../../shared/ui/primitives.js';
import type { ConversationExportPreview } from './exportConversation.js';
import { useConversationExportActions } from './useConversationExportActions.js';
import './conversationExportPreview.css';

export default function ConversationExportDialog({ preview, onClose }: {
  preview: ConversationExportPreview | null;
  onClose: () => void;
}) {
  const { t } = useI18n();
  const [expanded, setExpanded] = useState(false);
  const { busy, copied, run, file } = useConversationExportActions(preview);
  const copyLabel = t(copied ? 'chat.message.copied' : preview?.file.format === 'png' ? 'chat.image.copy' : 'chat.export.copy');
  return <Dialog
    title={t('chat.export.preview')}
    className={`conversation-export-dialog${expanded ? ' conversation-export-dialog--expanded' : ''}`}
    width={expanded ? 1080 : 720}
    onClose={onClose}
    headerActions={<ActionTooltip title={t(expanded ? 'chat.export.restore' : 'chat.export.expand')}>
      <IconButton label={t(expanded ? 'chat.export.restore' : 'chat.export.expand')} onClick={() => setExpanded(!expanded)}>
        {expanded ? <Minimize2 size={16} /> : <Maximize2 size={16} />}
      </IconButton>
    </ActionTooltip>}
    footer={preview ? <>
      <Button icon={<Download size={16} />} disabled={Boolean(busy)} loading={busy === 'save'} onClick={() => void run('save')}>
        {t('chat.export.saveAs')}
      </Button>
      <Button variant="primary" disabled={Boolean(busy)} loading={busy === 'copy'} onClick={() => void run('copy')}>
        <IconSwap swapKey={copied ? 'copied' : 'copy'}>{copied ? <Check size={16} /> : <Copy size={16} />}</IconSwap>{copyLabel}
      </Button>
    </> : undefined}
  >
    <div className={`conversation-export-preview${preview?.file.format === 'png' ? ' conversation-export-preview--image' : ''}`}>
      {!preview ? <span className="sd-spinner" role="status" aria-label={t('chat.export.exporting')} />
        : preview.file.imageDataUrl ? <ImagePreview src={preview.file.imageDataUrl} alt={preview.file.name} draggable={false} />
          : preview.file.format === 'html' ? <iframe title={preview.file.name} srcDoc={preview.input.content} sandbox="" referrerPolicy="no-referrer" />
            : <DocumentMarkdown content={preview.markdown} className="conversation-export-preview__markdown" />}
    </div>
    {file ? <div className="conversation-export-file">
      <FileIcon path={file.name} className="conversation-export-file__icon" />
      <button className="conversation-export-file__name" title={file.name} disabled={Boolean(busy)} onClick={() => void run('open')}>
        {file.name}
      </button>
      <ActionTooltip title={t('chat.export.reveal')}>
        <IconButton label={t('chat.export.reveal')} disabled={Boolean(busy)} onClick={() => void run('reveal')}><FolderOpen size={17} /></IconButton>
      </ActionTooltip>
      <ActionTooltip title={t('chat.export.open')}>
        <IconButton label={t('chat.export.open')} disabled={Boolean(busy)} onClick={() => void run('open')}><ExternalLink size={17} /></IconButton>
      </ActionTooltip>
    </div> : null}
  </Dialog>;
}
