import { Check, Copy, Download, ExternalLink, FolderOpen, Maximize2, Minimize2 } from 'lucide-react';
import { useState, type ReactNode } from 'react';
import { Button, IconButton } from '../button.js';
import { Dialog } from '../dialog.js';
import { FileIcon } from '../file-icon.js';
import { IconSwap } from '../icons/icon-swap.js';
import { Tooltip } from '../popover.js';

export type ExportPreviewAction = 'save' | 'copy' | 'open' | 'reveal';

type ExportPreviewLabels = Readonly<{
  title: string; exporting: string; expand: string; restore: string; saveAs: string;
  copy?: string; copied: string; reveal: string; open: string;
}>;

export function ExportPreviewDialog({ labels, fileName, image, busy, copied, onAction, onClose, children }: Readonly<{
  labels: ExportPreviewLabels;
  fileName: string | null;
  image?: boolean;
  busy: ExportPreviewAction | null;
  copied: boolean;
  onAction(action: ExportPreviewAction): void;
  onClose(): void;
  children?: ReactNode;
}>) {
  const [expanded, setExpanded] = useState(false);
  const expandLabel = expanded ? labels.restore : labels.expand;
  return <Dialog title={labels.title}
    className={`sd-export-preview-dialog${expanded ? ' sd-export-preview-dialog--expanded' : ''}`}
    width={expanded ? 1080 : 720} onClose={onClose}
    headerActions={<Tooltip placement="bottomRight" title={expandLabel}>
      <IconButton label={expandLabel} onClick={() => setExpanded((previous) => !previous)}>
        {expanded ? <Minimize2 size={16} /> : <Maximize2 size={16} />}
      </IconButton>
    </Tooltip>}
    footer={fileName ? <>
      <Button icon={<Download size={16} />} variant={labels.copy ? 'secondary' : 'primary'}
        disabled={Boolean(busy)} loading={busy === 'save'} onClick={() => onAction('save')}>
        {labels.saveAs}
      </Button>
      {labels.copy ? <Button variant="primary" disabled={Boolean(busy)} loading={busy === 'copy'} onClick={() => onAction('copy')}>
        <IconSwap swapKey={copied ? 'copied' : 'copy'}>{copied ? <Check size={16} /> : <Copy size={16} />}</IconSwap>
        {copied ? labels.copied : labels.copy}
      </Button> : null}
    </> : undefined}>
    <div className={`sd-export-preview-surface${image ? ' sd-export-preview-surface--image' : ''}`}>
      {fileName ? children : <span className="sd-spinner" role="status" aria-label={labels.exporting} />}
    </div>
    {fileName ? <div className="sd-export-preview-file">
      <FileIcon path={fileName} className="sd-export-preview-file__icon" />
      <button type="button" className="sd-export-preview-file__name" title={fileName}
        disabled={Boolean(busy)} onClick={() => onAction('open')}>{fileName}</button>
      <Tooltip placement="bottomRight" title={labels.reveal}>
        <IconButton label={labels.reveal} disabled={Boolean(busy)} onClick={() => onAction('reveal')}><FolderOpen size={17} /></IconButton>
      </Tooltip>
      <Tooltip placement="bottomRight" title={labels.open}>
        <IconButton label={labels.open} disabled={Boolean(busy)} onClick={() => onAction('open')}><ExternalLink size={17} /></IconButton>
      </Tooltip>
    </div> : null}
  </Dialog>;
}
