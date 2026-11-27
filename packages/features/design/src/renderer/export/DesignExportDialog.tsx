import { useEffect, useMemo, useRef, useState } from 'react';
import type { RendererTranslate } from '@setsuna-desktop/feature-core/renderer';
import { ExportPreviewDialog, ImagePreview, useToast, type ExportPreviewAction } from '@setsuna-desktop/renderer-ui';
import type { DesignExportInput, DesignPreparedExport } from '../../contracts/design-export.js';
import type { DesignPublicationBridge } from '../../contracts/design-publication.js';
import type { DesignAssets } from '../client.js';
import { copyDesignLayerExport } from './design-layer-export-actions.js';
import { designHtmlPreviewDismiss, designHtmlPreviewDocument } from './design-html-viewer.js';
import './design-export-preview.css';

type Prepared = Readonly<{ input: DesignExportInput; file: DesignPreparedExport }>;
type ExportDialogProps = Readonly<{
  requestId: string;
  prepared: Prepared | null;
  bridge: DesignPublicationBridge;
  output: DesignAssets['output'];
  translate: RendererTranslate;
  onSaved(): void;
  onClose(): void;
}>;

export default function DesignExportDialog(props: ExportDialogProps) {
  const { prepared, translate: t, onClose } = props;
  const { busy, copied, fileName, run } = useDesignExportActions(props);
  const kind = prepared?.input.kind;
  const copy = kind === 'png' ? t('feature.design.exportPreview.copyImage')
    : kind === 'svg' ? t('feature.design.exportPreview.copySvg') : kind === 'html' ? t('feature.design.copyHtml') : undefined;
  return <ExportPreviewDialog
    labels={{ title: t('feature.design.exportPreview.title'), exporting: t('feature.design.exportPreview.preparing'),
      expand: t('feature.design.exportPreview.expand'), restore: t('feature.design.exportPreview.restore'),
      saveAs: t('feature.design.exportPreview.saveAs'), copy, copied: t('feature.design.exportPreview.copied'),
      reveal: t('feature.design.exportPreview.reveal'), open: t('feature.design.exportPreview.open') }}
    fileName={fileName} image={kind === 'png' || kind === 'svg'} busy={busy} copied={copied}
    onAction={(action) => { void run(action); }} onClose={onClose}>
    {prepared ? <DesignExportContent prepared={prepared} translate={t} onClose={onClose} /> : null}
  </ExportPreviewDialog>;
}

function useDesignExportActions({ prepared, requestId, bridge, output, translate: t, onSaved }: ExportDialogProps) {
  const toast = useToast();
  const pending = useRef(false);
  const mounted = useRef(false);
  const copiedTimer = useRef<ReturnType<typeof setTimeout>>();
  const [busy, setBusy] = useState<ExportPreviewAction | null>(null);
  const [copied, setCopied] = useState(false);
  const [savedName, setSavedName] = useState<string>();
  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; clearTimeout(copiedTimer.current); };
  }, []);

  async function run(action: ExportPreviewAction) {
    if (!prepared || pending.current) return;
    pending.current = true;
    setBusy(action);
    try {
      if (action === 'copy') {
        if (prepared.input.kind === 'zip' || !await copyDesignLayerExport(output, prepared.input) || !mounted.current) return;
        setCopied(true);
        clearTimeout(copiedTimer.current);
        copiedTimer.current = setTimeout(() => setCopied(false), 1_600);
      } else {
        const name = await bridge.useExportFile(requestId, action);
        if (action !== 'save' || !name || !mounted.current) return;
        setSavedName(name);
        onSaved();
        toast.success(t('feature.design.exportSaved'));
      }
    } catch (error) {
      if (mounted.current) toast.error(t('feature.design.exportFailed', { error: error instanceof Error ? error.message : String(error) }));
    } finally {
      pending.current = false;
      if (mounted.current) setBusy(null);
    }
  }
  return { fileName: savedName ?? prepared?.file.name ?? null, busy, copied, run };
}

function DesignExportContent({ prepared: { input, file }, translate: t, onClose }: Readonly<{
  prepared: Prepared; translate: RendererTranslate; onClose(): void;
}>) {
  switch (input.kind) {
    case 'png': return <ImagePreview src={input.content} alt={file.name} draggable={false} />;
    case 'svg': return <DesignSvgExportPreview svg={input.content} name={file.name} />;
    case 'html': return <DesignHtmlExportPreview html={input.content} name={file.name} onClose={onClose} />;
    case 'zip': return file.archive ? <ul className="sd-export-preview-document design-export-archive" aria-label={file.name}>
      {file.archive.entries.map((entry) => <li key={entry}>{entry}</li>)}
      {file.archive.remaining ? <li>{t('feature.design.exportPreview.remaining', { count: file.archive.remaining })}</li> : null}
    </ul> : null;
  }
}

function DesignHtmlExportPreview({ html, name, onClose }: { html: string; name: string; onClose(): void }) {
  const preview = useMemo(() => designHtmlPreviewDocument(html), [html]);
  const frame = useRef<HTMLIFrameElement>(null);
  useEffect(() => {
    if (!preview.sandbox) return;
    function dismiss(event: MessageEvent) {
      if (event.origin === 'null' && event.source && event.source === frame.current?.contentWindow
        && event.data === designHtmlPreviewDismiss) onClose();
    }
    window.addEventListener('message', dismiss);
    return () => window.removeEventListener('message', dismiss);
  }, [onClose, preview.sandbox]);
  return <iframe {...preview} ref={frame} className="design-export-html" title={name} referrerPolicy="no-referrer" onLoad={(event) => {
    const element = event.currentTarget;
    // Give shortcuts to the canvas when the dialog still has its initial focus.
    if (preview.sandbox && element.closest('[role="dialog"]') === document.activeElement) element.focus({ preventScroll: true });
  }} />;
}

function DesignSvgExportPreview({ svg, name }: { svg: string; name: string }) {
  const [url, setUrl] = useState<string>();
  useEffect(() => {
    const source = URL.createObjectURL(new Blob([svg], { type: 'image/svg+xml' }));
    setUrl(source);
    return () => URL.revokeObjectURL(source);
  }, [svg]);
  return url ? <ImagePreview src={url} alt={name} draggable={false} /> : null;
}
