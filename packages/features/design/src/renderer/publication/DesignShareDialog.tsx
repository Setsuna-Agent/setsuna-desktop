import { Download, Radio, RefreshCw, Share2 } from 'lucide-react';
import { useCallback, useContext, useEffect, useId, useLayoutEffect, useRef, useState, type FormEvent, type KeyboardEvent } from 'react';
import type { RendererTranslate } from '@setsuna-desktop/feature-core/renderer';
import { Button, Dialog, Tabs, TabsList, TabsTrigger, useToast } from '@setsuna-desktop/renderer-ui';
import { isDesignPreviewPassword, type DesignPreviewAccess,
  type DesignPublicationBridge, type DesignPublishedPreview } from '../../contracts/design-publication.js';
import { DesignUiHostContext } from '../context/design-ui-host.js';
import type { DesignExportRequest } from '../export/use-design-exports.js';
import { DesignShareExports } from './DesignShareExports.js';
import { DesignShareAccessForm, DesignShareAccessRow, DesignShareAddresses } from './DesignSharePreview.js';
import '../styles/design-tabbed-dialog.css';
import './design-publication.css';

const sections = [
  { id: 'preview', Icon: Radio, label: 'feature.design.publication.preview' },
  { id: 'export', Icon: Download, label: 'feature.design.layerExport' },
] as const;

export function DesignShareDialog({ bridge, designKey, documentId, disabled, publishing, packaging, publish, copy,
  exportPackage, exportDocument, onClose, translate: t }: Readonly<{
  bridge: Pick<DesignPublicationBridge, 'previewStatus' | 'stopPreview'>;
  designKey: string;
  documentId: string;
  disabled: boolean;
  publishing: boolean;
  packaging: boolean;
  publish(access: DesignPreviewAccess): Promise<DesignPublishedPreview | undefined>;
  copy(text: string): Promise<void>;
  exportPackage(): void;
  exportDocument?(request: DesignExportRequest): void;
  onClose(): void;
  translate: RendererTranslate;
}>) {
  const toast = useToast();
  const openExternal = useContext(DesignUiHostContext)?.openExternal;
  const [section, setSection] = useState<(typeof sections)[number]['id']>('preview');
  const [status, setStatus] = useState<DesignPublishedPreview | null>();
  const [editingAccess, setEditingAccess] = useState(false);
  const [selectedAccess, setSelectedAccess] = useState<DesignPreviewAccess['kind']>();
  const [password, setPassword] = useState('');
  const [stopping, setStopping] = useState(false);
  const statusRequest = useRef(0);
  const focusTarget = useRef<string>();
  const id = useId();
  const accessForm = `${id}-access-form`;
  const accessRow = `${id}-access-row`;
  const primaryCopy = `${id}-copy`;
  const preview = section === 'preview';
  const active = status?.designKey === designKey && status.documentId === documentId ? status : undefined;
  const published = editingAccess ? undefined : active;
  const access = selectedAccess ?? active?.access ?? 'link';
  const busy = publishing || packaging || stopping;
  const canPublish = !disabled && !busy && status !== undefined && (access === 'link' || isDesignPreviewPassword(password));

  const report = useCallback((error: unknown) => toast.error(t('feature.design.publication.accessFailed',
    { error: error instanceof Error ? error.message : String(error) })), [t, toast]);
  useEffect(() => {
    if (!preview) return;
    let alive = true;
    const readStatus = async (reportFailure = false) => {
      const version = ++statusRequest.current;
      try {
        const current = await bridge.previewStatus();
        if (alive && version === statusRequest.current) setStatus(current);
      } catch (error) {
        if (alive && reportFailure) report(error);
      }
    };
    const focus = () => { void readStatus(); };
    void readStatus(true);
    const poll = window.setInterval(() => { void readStatus(); }, 2_000);
    window.addEventListener('focus', focus);
    return () => {
      alive = false;
      window.clearInterval(poll);
      window.removeEventListener('focus', focus);
    };
  }, [bridge, preview, report]);

  useLayoutEffect(() => {
    // Publishing and access edits replace the focused controls in place.
    if (!focusTarget.current) return;
    document.getElementById(focusTarget.current)?.focus({ preventScroll: true });
    focusTarget.current = undefined;
  });

  function navigateTabs(event: KeyboardEvent<HTMLDivElement>) {
    if (busy) return;
    const { key } = event;
    if (key !== 'ArrowLeft' && key !== 'ArrowRight' && key !== 'Home' && key !== 'End') return;
    event.preventDefault();
    const next = key === 'Home' ? 'preview' : key === 'End' ? 'export' : preview ? 'export' : 'preview';
    if (next === section) return;
    focusTarget.current = `${id}-${next}-tab`;
    setSection(next);
  }

  function resetAccess() {
    setEditingAccess(false);
    setSelectedAccess(undefined);
    setPassword('');
  }

  function editAccess(focusPassword = false) {
    focusTarget.current = focusPassword ? `${accessForm}-password-field` : `${accessForm}-${access}`;
    setEditingAccess(true);
  }

  function cancelAccess() {
    focusTarget.current = accessRow;
    resetAccess();
  }

  async function publishAccess(nextAccess: DesignPreviewAccess) {
    const next = await publish(nextAccess);
    if (!next) return;
    statusRequest.current += 1;
    focusTarget.current = primaryCopy;
    setStatus(next);
    resetAccess();
  }

  function submitAccess(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!canPublish) return;
    void publishAccess(access === 'password' ? { kind: 'password', password } : { kind: 'link' });
  }

  async function stop() {
    if (!status) return;
    const { id: stoppedId } = status;
    setStopping(true);
    try {
      await bridge.stopPreview(stoppedId);
      statusRequest.current += 1;
      if (active) resetAccess();
      focusTarget.current = `${accessForm}-${active ? 'link' : access}`;
      setStatus((current) => current?.id === stoppedId ? null : current);
    } catch (error) {
      report(error);
    } finally {
      setStopping(false);
    }
  }

  async function copyLink(url: string) {
    try {
      await copy(url);
      toast.success(t('feature.design.copied'));
    } catch (error) {
      report(error);
    }
  }

  async function openLink(url: string) {
    const opened = await openExternal?.(url).catch(() => false);
    if (!opened) toast.error(t('feature.design.publication.openLinkFailed'));
  }

  const shareLabel = t('feature.design.publication.share');
  const updateLabel = t('feature.design.publication.update');
  const footer = !preview ? undefined : <>
    {status ? <Button variant="danger" className="design-share-stop" disabled={busy} loading={stopping} onClick={() => { void stop(); }}>
      {t('feature.design.publication.stop')}
    </Button> : null}
    {published ? <Button variant="secondary" icon={<RefreshCw size={14} aria-hidden="true" />} disabled={disabled || busy} loading={publishing} onClick={() => {
      if (published.access === 'password') editAccess(true);
      else void publishAccess({ kind: 'link' });
    }}>{updateLabel}</Button> : <>
      {active && editingAccess ? <Button variant="secondary" disabled={busy} onClick={cancelAccess}>{t('feature.design.cancel')}</Button> : null}
      <Button variant="primary" type="submit" form={accessForm} disabled={!canPublish} loading={publishing}>
        {active ? updateLabel : t('feature.design.publication.publish')}
      </Button>
    </>}
  </>;

  const tabs = <Tabs className="design-tabbed-dialog__nav" value={section} variant="segment"
    onValueChange={(next) => setSection(next === 'export' ? 'export' : 'preview')}>
    <TabsList aria-label={shareLabel} onKeyDown={navigateTabs}>
      {sections.map(({ id: tab, Icon, label }) => <TabsTrigger key={tab} value={tab} id={`${id}-${tab}-tab`}
        aria-controls={`${id}-${tab}-panel`} tabIndex={section === tab ? 0 : -1} disabled={busy}>
        <Icon size={14} aria-hidden="true" />{t(label)}
      </TabsTrigger>)}
    </TabsList>
  </Tabs>;

  return <Dialog className="design-tabbed-dialog design-share-dialog" width={500} title={<span className="design-tabbed-dialog__title">
    <Share2 size={15} aria-hidden="true" />
    <span className="design-tabbed-dialog__title-text">{shareLabel}</span>
  </span>} headerActions={tabs} onClose={onClose} onEscapeKeyDown={(event) => {
    if (!preview || !active || !editingAccess || busy) return;
    event.preventDefault();
    cancelAccess();
  }} footer={footer}>
    <section className="design-share-panel" id={`${id}-preview-panel`} role="tabpanel" aria-labelledby={`${id}-preview-tab`} hidden={!preview}>
      {status === undefined ? <div className="design-share-loading" aria-busy="true" aria-label={t('feature.design.publication.preview')}>
        <span className="sd-spinner" aria-hidden="true" />
      </div> : published ? <div className="design-share-published">
        <DesignShareAddresses urls={published.urls} copyId={primaryCopy} disabled={busy} onCopy={(url) => { void copyLink(url); }}
          onOpen={openExternal ? (url) => { void openLink(url); } : undefined} translate={t} />
        <DesignShareAccessRow id={accessRow} access={published.access} disabled={busy} onEdit={() => editAccess()} translate={t} />
      </div> : <DesignShareAccessForm id={accessForm} access={access} password={password} disabled={busy}
        onAccess={(next) => { setSelectedAccess(next); if (next === 'link') setPassword(''); }}
        onPassword={setPassword} onSubmit={submitAccess} translate={t} />}
    </section>
    <section className="design-share-panel" id={`${id}-export-panel`} role="tabpanel" aria-labelledby={`${id}-export-tab`} hidden={preview}>
      <DesignShareExports disabled={disabled || busy} packaging={packaging} exportPackage={exportPackage} exportDocument={exportDocument} translate={t} />
    </section>
  </Dialog>;
}
