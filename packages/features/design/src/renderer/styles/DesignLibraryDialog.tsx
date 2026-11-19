import { ArrowUpRight, Check, File, LibraryBig, Link2, Palette, Plus, Search, Trash2, Type } from 'lucide-react';
import { useContext, useEffect, useState } from 'react';
import { Button, Dialog, IconButton, TextField, useToast } from '@setsuna-desktop/renderer-ui';
import type { RendererTranslate } from '@setsuna-desktop/feature-core/renderer';
import { designTypographyOf, type DesignDocument, type DesignDocumentRef, type DesignStyle } from '../../contracts/index.js';
import type { DesignClient } from '../client.js';
import { linkedDesignPath } from '../components/design-library-resources.js';
import { InspectorField, PaintField } from '../inspector/DesignInspectorFields.js';
import { DesignTypographyFields } from '../inspector/DesignTextFields.js';
import { designFontStack } from '../text/design-typography.js';
import { DesignStyleContext } from './DesignStyleSelect.js';
import './design-library-dialog.css';

type LibraryProps = Readonly<{
  document: DesignDocument; documentRef: DesignDocumentRef; client: DesignClient; disabled: boolean;
  onSetStyle(id: string, style: DesignStyle | null): Promise<boolean>;
  onPreviewColor(id: string, color: string | undefined): void;
  onLink(documentId: string, path: string): Promise<boolean>;
  onOpenLibrary?(path: string): void;
  onClose(): void; translate: RendererTranslate;
}>;

export function DesignLibraryDialog({ document, documentRef, client, disabled, onSetStyle, onPreviewColor, onLink, onOpenLibrary, onClose, translate: t }: LibraryProps) {
  const [panel, setPanel] = useState<'color' | 'text' | 'linked'>('color');
  const title = t('feature.design.library');
  return <Dialog className="design-library" title={<span className="design-library__title"><LibraryBig size={17} />{title}</span>}
    width={550} onClose={onClose} dismissible={!disabled}>
    <div className="design-library__nav">
      <div className="design-library__tabs" role="group" aria-label={title}>
        <Button size="small" variant="ghost" icon={<Palette size={15} />} aria-pressed={panel === 'color'} disabled={disabled}
          onClick={() => setPanel('color')}>{t('feature.design.colorStyle')}</Button>
        <Button size="small" variant="ghost" icon={<Type size={15} />} aria-pressed={panel === 'text'} disabled={disabled}
          onClick={() => setPanel('text')}>{t('feature.design.textStyle')}</Button>
      </div>
      <Button className="design-library__link-tab" size="small" variant="ghost" icon={<Link2 size={15} />}
        aria-pressed={panel === 'linked'} disabled={disabled}
        onClick={() => setPanel('linked')}>{t('feature.design.sharedLibraries')}</Button>
    </div>
    {panel === 'linked' ? <LinkedLibraries document={document} client={client} documentRef={documentRef} disabled={disabled}
      onLink={onLink} onOpenLibrary={onOpenLibrary} onClose={onClose} translate={t} />
      : <NamedStyles key={panel} kind={panel} document={document} disabled={disabled}
        onSetStyle={onSetStyle} onPreviewColor={onPreviewColor} onOpenLibrary={onOpenLibrary} translate={t} />}
  </Dialog>;
}

function NamedStyles({ document, kind, disabled, onSetStyle, onPreviewColor, onOpenLibrary, translate: t }:
  Pick<LibraryProps, 'document' | 'disabled' | 'onSetStyle' | 'onPreviewColor' | 'onOpenLibrary' | 'translate'> &
  Readonly<{ kind: DesignStyle['kind'] }>) {
  const [selected, setSelected] = useState<string>();
  const { styles: previewStyles } = useContext(DesignStyleContext);
  const choices = Object.entries({ ...previewStyles, ...document.styles }).filter(([, style]) => style.kind === kind).reverse();
  const entry = choices.find(([id]) => id === selected) ?? choices[0];
  const [id, style] = entry ?? [];
  const path = id && linkedDesignPath(document, id);
  function add() {
    const base = t(kind === 'color' ? 'feature.design.newColorStyle' : 'feature.design.newTextStyle');
    let name = base;
    let suffix = 2;
    while (choices.some(([, item]) => item.name === name)) name = `${base} ${suffix++}`;
    const styleId = crypto.randomUUID();
    const next: DesignStyle = kind === 'color' ? { kind, color: '#6865ed', name } : { kind, name, typography: designTypographyOf({ fontSize: 16 }) };
    void onSetStyle(styleId, next).then((saved) => { if (saved) setSelected(styleId); });
  }
  const label = t(kind === 'color' ? 'feature.design.colorStyle' : 'feature.design.textStyle');
  const addLabel = t('feature.design.addStyle');
  if (!style || !id) return <button type="button" className="design-library__empty" disabled={disabled} onClick={add}>
    <span className="design-library__sample-stack" aria-hidden="true">
      <span className="design-library__sample">
        {kind === 'color' ? <><i /><i /><i /></> : 'Aa'}
      </span>
      <span className="design-library__sample-add"><Plus size={15} /></span>
    </span>
    <span>{addLabel}</span>
  </button>;

  return <div className="design-library__styles">
    <div className="design-library__cards" role="group" aria-label={label}>
      <button type="button" className="design-library__card design-library__card--add" disabled={disabled} onClick={add}>
        <span className="design-library__card-preview" aria-hidden="true"><Plus size={23} strokeWidth={1.6} /></span>
        <span className="design-library__card-name">{addLabel}</span>
      </button>
      {choices.map(([key, item]) => <StyleCard key={key} style={previewStyles?.[key] ?? item} source={linkedDesignPath(document, key)}
        selected={key === id} disabled={disabled} onSelect={() => setSelected(key)} />)}
    </div>
    {path ? onOpenLibrary ? <Button className="design-library__link-action" size="small" variant="secondary"
      icon={<ArrowUpRight size={15} />} title={path} disabled={disabled} onClick={() => onOpenLibrary(path)}>
      {t('feature.design.openLibrarySource')}
    </Button> : null : <div className="design-library__edit" key={id}>
      <div className="design-library__edit-row" data-kind={style.kind}>
        <InspectorField label={t('feature.design.name')} value={style.name} readOnly={disabled} maxLength={128}
          onSave={(name) => {
            const trimmed = name.trim();
            return trimmed && !/[\p{C}]/u.test(trimmed) ? onSetStyle(id, { ...style, name: trimmed }) : Promise.resolve(false);
          }} />
        {style.kind === 'color' ? <div className="design-library__color">
          <PaintField label={t('feature.design.fill')} value={style.color} disabled={disabled} onPreview={(color) => onPreviewColor(id, color)}
            onSave={(color) => onSetStyle(id, { ...style, color })} />
        </div> : null}
        <IconButton size="small" label={t('feature.design.removeStyle')} disabled={disabled}
          onClick={() => { void onSetStyle(id, null); }}><Trash2 size={15} /></IconButton>
      </div>
      {style.kind === 'text' ? <DesignTypographyFields typography={style.typography} disabled={disabled} translate={t}
        onSave={(patch) => onSetStyle(id, { ...style, typography: { ...style.typography, ...patch } })} /> : null}
    </div>}
  </div>;
}

function StyleCard({ style, source, selected, disabled, onSelect }: Readonly<{
  style: DesignStyle; source?: string; selected: boolean; disabled: boolean; onSelect(): void;
}>) {
  return <button type="button" className="design-library__card" aria-pressed={selected} disabled={disabled} onClick={onSelect}
    title={source ? `${style.name} · ${source}` : style.name}>
    {style.kind === 'color' ? <span className="design-library__card-preview" style={{ backgroundColor: style.color }} aria-hidden="true" />
      : <span className="design-library__card-preview" aria-hidden="true" style={{ fontFamily: designFontStack(style.typography.fontFamily),
        fontWeight: style.typography.fontWeight, fontSize: Math.max(18, Math.min(38, style.typography.fontSize + 8)),
        letterSpacing: style.typography.letterSpacing }}>Aa</span>}
    <span className="design-library__card-label">
      <span className="design-library__card-name">{style.name}</span>
      {selected ? <Check size={14} aria-hidden="true" /> : source ? <Link2 size={14} aria-hidden="true" /> : null}
    </span>
  </button>;
}

function LinkedLibraries({ client, document, documentRef, disabled, onLink, onOpenLibrary, onClose, translate: t }:
  Pick<LibraryProps, 'client' | 'document' | 'documentRef' | 'disabled' | 'onLink' | 'onOpenLibrary' | 'onClose' | 'translate'>) {
  const toast = useToast();
  const [paths, setPaths] = useState<readonly string[]>([]);
  const [query, setQuery] = useState('');
  const [path, setPath] = useState('');
  const [loaded, setLoaded] = useState<Readonly<{ path: string; documentId: string }>>();
  const linkedPaths = new Set(Object.values(document.libraries ?? {}));
  const linked = linkedPaths.has(path);
  const sourceId = loaded?.path === path ? loaded.documentId : undefined;

  useEffect(() => {
    const controller = new AbortController();
    void client.list({ projectId: documentRef.projectId, rootId: documentRef.rootId }, controller.signal).then((paths) => {
      if (!controller.signal.aborted) setPaths(paths.filter((path) => path !== documentRef.path));
    }).catch((error: unknown) => {
      if (!controller.signal.aborted) toast.error(t('feature.design.loadDocumentsFailed', { error: String(error) }));
    });
    return () => controller.abort();
  }, [client, documentRef, t, toast]);

  useEffect(() => {
    if (!path || linked) return;
    const controller = new AbortController();
    void client.read({ ...documentRef, path }, controller.signal).then(({ document }) => {
      if (!controller.signal.aborted) setLoaded({ path, documentId: document.documentId });
    }).catch((error: unknown) => {
      if (!controller.signal.aborted) toast.error(t('feature.design.loadFailed', { error: String(error) }));
    });
    return () => controller.abort();
  }, [client, documentRef, linked, path, t, toast]);

  const sourceLabel = t('feature.design.librarySource');
  const searchLabel = t('feature.design.librarySearch');
  const search = query.trim().toLowerCase();
  const results = [...new Set([...linkedPaths, ...paths])].filter((path) => path.toLowerCase().includes(search));
  return <div className="design-library__links">
    <TextField aria-label={searchLabel} placeholder={searchLabel} value={query} disabled={disabled}
      appearance="search" leadingIcon={<Search size={15} />} onChange={(event) => { setQuery(event.target.value); setPath(''); setLoaded(undefined); }} />
    <div className="design-library__sources" role="group" aria-label={sourceLabel}>
      {results.map((candidate) => <button type="button" key={candidate} className="design-library__source"
        disabled={disabled} aria-pressed={candidate === path} title={candidate} onClick={() => {
          if (candidate === path) return;
          setPath(candidate);
          setLoaded(undefined);
        }}>
        <span className="design-library__source-icon" aria-hidden="true">{linkedPaths.has(candidate) ? <Link2 size={15} /> : <File size={15} />}</span>
        <span className="design-library__card-name">{candidate}</span>
        {candidate === path ? <Check size={15} aria-hidden="true" /> : null}
      </button>)}
    </div>
    {linked && onOpenLibrary ? <Button className="design-library__link-action" size="small" variant="secondary"
      icon={<ArrowUpRight size={15} />} disabled={disabled} onClick={() => onOpenLibrary(path)}>{t('feature.design.openLibrarySource')}</Button>
      : <Button className="design-library__link-action" variant="primary" size="small" icon={<Link2 size={15} />}
        disabled={disabled || linked || !sourceId || sourceId === document.documentId}
        onClick={() => { if (sourceId) void onLink(sourceId, path).then((ok) => { if (ok) onClose(); }); }}>
        {t('feature.design.linkLibrary')}
      </Button>}
  </div>;
}
