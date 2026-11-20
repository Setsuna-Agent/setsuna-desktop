import { ArrowUpRight, Check, Component, File, GripVertical, LayoutGrid, Link2, List, Plus, Search, Trash2, Type, Unlink2 } from 'lucide-react';
import { useContext, useEffect, useMemo, useRef, useState, type MutableRefObject } from 'react';
import { Button, IconButton, SegmentedControl, TextField, useNativeDragPreview, useToast } from '@setsuna-desktop/renderer-ui';
import type { RendererTranslate } from '@setsuna-desktop/feature-core/renderer';
import { designTypographyOf, type DesignDocument, type DesignDocumentRef, type DesignStyle } from '../../contracts/index.js';
import { designStylesForModes } from '../../contracts/design-styles.js';
import { DesignThumbnail, useDesignThumbnails } from '../canvas/DesignThumbnail.js';
import type { DesignClient } from '../client.js';
import type { ComponentActions } from '../components/DesignComponentActions.js';
import { createDesignComponentThumbnailSelection, type DesignComponentPreviewContext } from '../components/design-component-thumbnails.js';
import { linkedDesignPath } from '../components/design-library-resources.js';
import type { LoadDesignImage } from '../design-images.js';
import { designComponentDragType, type DesignComponentDrag } from '../design-layer-drop.js';
import { InspectorField } from '../inspector/DesignInspectorFields.js';
import { DesignTypographyFields } from '../inspector/DesignTextFields.js';
import { designFontStack } from '../text/design-typography.js';
import { DesignStyleContext } from './DesignStyleSelect.js';
import { saveName, unusedName } from './design-style-names.js';
import { useDesignComponentView } from './use-design-component-view.js';
import './design-library-panel.css';

type LibraryProps = Readonly<{
  document: DesignDocument; documentRef: DesignDocumentRef; client: DesignClient; disabled: boolean;
  components: ComponentActions['library'];
  componentPreviews: DesignComponentPreviewContext & Readonly<{ loadImage: LoadDesignImage }>;
  componentDrag: MutableRefObject<DesignComponentDrag | undefined>;
  revision: string;
  sources: DesignDocument['styles'];
  onSetStyle(id: string, style: DesignStyle | null): Promise<boolean>;
  onPreviewStyle(id: string, style: DesignStyle | undefined): void;
  onLink(documentId: string, path: string): Promise<boolean>;
  onUnlink(path: string): Promise<boolean>;
  onOpenLibrary?(path: string): void;
  translate: RendererTranslate;
}>;

export function DesignLibraryPanel({ document, documentRef, client, disabled, components, componentPreviews, componentDrag, revision,
  sources, onSetStyle, onPreviewStyle, onLink, onUnlink, onOpenLibrary, translate: t }: LibraryProps) {
  const [panel, setPanel] = useState<'components' | 'text' | 'linked'>('components');
  return <div className="design-library">
    <SegmentedControl<typeof panel> className="design-library__tabs" label={t('feature.design.library')} value={panel} disabled={disabled}
      onChange={setPanel} options={[
        { value: 'components', label: t('feature.design.components'), icon: <Component size={14} aria-hidden="true" /> },
        { value: 'text', label: t('feature.design.textStyle'), icon: <Type size={14} aria-hidden="true" /> },
        { value: 'linked', label: t('feature.design.sharedLibraries'), icon: <Link2 size={14} aria-hidden="true" /> },
      ]} />
    <div className="design-library__body">
      {panel === 'components' ? <LibraryComponents document={document} components={components} componentPreviews={componentPreviews}
        disabled={disabled} componentDrag={componentDrag} revision={revision} translate={t} /> : null}
      {panel === 'text' ? <NamedTextStyles document={document} disabled={disabled} sources={sources} onSetStyle={onSetStyle}
        onPreviewStyle={onPreviewStyle} onOpenLibrary={onOpenLibrary} translate={t} /> : null}
      {panel === 'linked' ? <LinkedLibraries document={document} client={client} documentRef={documentRef} disabled={disabled}
        onLink={onLink} onUnlink={onUnlink} onOpenLibrary={onOpenLibrary} translate={t} /> : null}
    </div>
  </div>;
}

function LibraryComponents({ document, components, componentPreviews, componentDrag, revision, disabled, translate: t }:
  Pick<LibraryProps, 'document' | 'components' | 'componentPreviews' | 'componentDrag' | 'revision' | 'disabled' | 'translate'>) {
  const results = useRef<HTMLDivElement>(null);
  const { projected, resources, layoutEngine, loadImage } = componentPreviews;
  const selectThumbnail = useMemo(() => createDesignComponentThumbnailSelection(document, { projected, resources, layoutEngine }),
    [document, projected, resources, layoutEngine]);
  const observeThumbnail = useDesignThumbnails(results, selectThumbnail, loadImage, { pixels: 512 });
  const dragPreview = useNativeDragPreview();
  useEffect(() => {
    const source = dragPreview.dragging ? componentDrag.current : undefined;
    if (!source) return;
    return () => { if (componentDrag.current === source) componentDrag.current = undefined; };
  }, [componentDrag, dragPreview.dragging]);
  const [query, setQuery] = useState('');
  const { componentView, setComponentView } = useDesignComponentView();
  const search = query.trim().toLowerCase();
  const searchLabel = t('feature.design.componentSearch');
  const nextView = componentView === 'grid' ? 'list' : 'grid';
  const ViewIcon = nextView === 'list' ? List : LayoutGrid;
  return <div className="design-library__catalog">
    <div className="design-library__search-row">
      <TextField aria-label={searchLabel} placeholder={searchLabel} value={query} disabled={disabled}
        appearance="search" leadingIcon={<Search size={15} />} onChange={(event) => setQuery(event.currentTarget.value)} />
      <IconButton size="small" label={t(nextView === 'list' ? 'feature.design.showComponentList' : 'feature.design.showComponentGrid')}
        disabled={disabled} onClick={() => setComponentView(nextView)}>
        <ViewIcon size={16} aria-hidden="true" />
      </IconButton>
    </div>
    <div ref={results} className="design-library__results design-library__results--components" data-view={componentView}
      role="list" aria-label={t('feature.design.components')}>
      {components.filter(({ name }) => name.toLowerCase().includes(search)).map(({ id, name }) =>
        <div role="listitem" key={id} className="design-library__card design-library__card--component" data-view={componentView} title={name}
          draggable={!disabled} aria-disabled={disabled || undefined} onDragStart={(event) => {
            if (disabled) { event.preventDefault(); return; }
            event.dataTransfer.effectAllowed = 'copy';
            event.dataTransfer.setData(designComponentDragType, id);
            componentDrag.current = { id, revision };
            dragPreview.start(event);
          }} onDragEnd={() => {
            componentDrag.current = undefined;
            dragPreview.end();
          }}>
          <DesignThumbnail id={id} observe={observeThumbnail} fallback={<Component size={15} />} />
          <span className="design-library__card-label">
            <span className="design-library__card-name">{name}</span>
            <GripVertical size={14} aria-hidden="true" />
          </span>
        </div>)}
    </div>
  </div>;
}

function NamedTextStyles({ document, disabled, sources, onSetStyle, onPreviewStyle, onOpenLibrary, translate: t }:
  Pick<LibraryProps, 'document' | 'disabled' | 'sources' | 'onSetStyle' | 'onPreviewStyle' | 'onOpenLibrary' | 'translate'>) {
  const [selected, setSelected] = useState<string>();
  const catalog = useContext(DesignStyleContext);
  const { styles } = catalog;
  const resolvedCatalog = useMemo(() => {
    const resolved = designStylesForModes(sources, document.documentId);
    return { ...catalog, styles: styles && Object.fromEntries(Object.entries(styles).map(([id, style]) => [id, resolved?.[id] ?? style])) };
  }, [catalog, document.documentId, sources, styles]);
  const choices = Object.entries(styles ?? {}).flatMap(([id, style]) => style.kind === 'text' ? [{ id, style }] : []).reverse();
  const { id, style } = choices.find(({ id }) => id === selected) ?? choices[0] ?? {};
  const path = id && linkedDesignPath(document, id);
  function add() {
    const name = unusedName(t('feature.design.newTextStyle'), choices.map(({ style }) => style.name));
    const styleId = crypto.randomUUID();
    const next: DesignStyle = { kind: 'text', name, typography: designTypographyOf({ fontSize: 16 }) };
    void onSetStyle(styleId, next).then((saved) => { if (saved) setSelected(styleId); });
  }
  const label = t('feature.design.textStyle');
  const addLabel = t('feature.design.addStyle');
  if (!style || !id) return <button type="button" className="design-library__empty" disabled={disabled} onClick={add}>
    <span className="design-library__sample-stack" aria-hidden="true">
      <span className="design-library__sample">Aa</span>
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
      {choices.map(({ id: key, style: item }) => {
        const resolved = resolvedCatalog.styles?.[key];
        return <StyleCard key={key} style={resolved?.kind === 'text' ? resolved : item} source={linkedDesignPath(document, key)}
          selected={key === id} disabled={disabled} onSelect={() => setSelected(key)} />;
      })}
    </div>
    {path ? onOpenLibrary ? <Button className="design-library__link-action" size="small" variant="secondary"
      icon={<ArrowUpRight size={15} />} title={path} disabled={disabled} onClick={() => onOpenLibrary(path)}>
      {t('feature.design.openLibrarySource')}
    </Button> : null : <div className="design-library__edit" key={id}>
      <div className="design-library__edit-row">
        <InspectorField label={t('feature.design.name')} value={style.name} readOnly={disabled} maxLength={128}
          onSave={(value) => saveName(value, (name) => onSetStyle(id, { ...style, name }))} />
        <IconButton size="small" label={t('feature.design.removeStyle')} disabled={disabled}
          onClick={() => { void onSetStyle(id, null); }}><Trash2 size={15} /></IconButton>
      </div>
      <DesignStyleContext.Provider value={resolvedCatalog}>
        <DesignTypographyFields typography={style.typography} disabled={disabled} translate={t}
          onBind={(typography) => onSetStyle(id, { ...style, typography })}
          onBindPreview={(typography) => onPreviewStyle(id, typography && { ...style, typography })}
          onPreview={(patch) => onPreviewStyle(id, patch && { ...style, typography: { ...style.typography, ...patch } })}
          onSave={(patch) => onSetStyle(id, { ...style, typography: { ...style.typography, ...patch } })} />
      </DesignStyleContext.Provider>
    </div>}
  </div>;
}

function StyleCard({ style, source, selected, disabled, onSelect }: Readonly<{
  style: Extract<DesignStyle, { kind: 'text' }>; source?: string; selected: boolean; disabled: boolean; onSelect(): void;
}>) {
  return <button type="button" className="design-library__card" aria-pressed={selected} disabled={disabled} onClick={onSelect}
    title={source ? `${style.name} · ${source}` : style.name}>
    <span className="design-library__card-preview" aria-hidden="true" style={{ fontFamily: designFontStack(style.typography.fontFamily),
        fontWeight: style.typography.fontWeight, fontStyle: style.typography.fontStyle, fontSize: Math.max(18, Math.min(38, style.typography.fontSize + 8)),
        letterSpacing: style.typography.letterSpacing }}>Aa</span>
    <span className="design-library__card-label">
      <span className="design-library__card-name">{style.name}</span>
      {selected ? <Check size={14} aria-hidden="true" /> : source ? <Link2 size={14} aria-hidden="true" /> : null}
    </span>
  </button>;
}

function LinkedLibraries({ client, document, documentRef, disabled, onLink, onUnlink, onOpenLibrary, translate: t }:
  Pick<LibraryProps, 'client' | 'document' | 'documentRef' | 'disabled' | 'onLink' | 'onUnlink' | 'onOpenLibrary' | 'translate'>) {
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
    if (!path || linked || !paths.includes(path)) return;
    const controller = new AbortController();
    void client.read({ ...documentRef, path }, controller.signal).then(({ document }) => {
      if (!controller.signal.aborted) setLoaded({ path, documentId: document.documentId });
    }).catch((error: unknown) => {
      if (!controller.signal.aborted) toast.error(t('feature.design.loadFailed', { error: String(error) }));
    });
    return () => controller.abort();
  }, [client, documentRef, linked, path, paths, t, toast]);

  const sourceLabel = t('feature.design.librarySource');
  const searchLabel = t('feature.design.librarySearch');
  const search = query.trim().toLowerCase();
  const results = [...new Set([...linkedPaths, ...paths])].filter((path) => path.toLowerCase().includes(search));
  return <div className="design-library__catalog">
    <TextField aria-label={searchLabel} placeholder={searchLabel} value={query} disabled={disabled}
      appearance="search" leadingIcon={<Search size={15} />} onChange={(event) => { setQuery(event.target.value); setPath(''); setLoaded(undefined); }} />
    <div className="design-library__results" role="group" aria-label={sourceLabel}>
      {results.map((candidate) => <button type="button" key={candidate} className="design-library__result"
        disabled={disabled} aria-pressed={candidate === path} title={candidate} onClick={() => {
          if (candidate === path) return;
          setPath(candidate);
          setLoaded(undefined);
        }}>
        <span className="design-library__result-icon" aria-hidden="true">{linkedPaths.has(candidate) ? <Link2 size={15} /> : <File size={15} />}</span>
        <span className="design-library__card-name">{candidate}</span>
        {candidate === path ? <Check size={15} aria-hidden="true" /> : null}
      </button>)}
    </div>
    {linked ? <div className="design-library__link-actions">
      <Button className="design-library__link-action" size="small" variant="secondary" icon={<Unlink2 size={15} />} disabled={disabled}
        onClick={() => { void onUnlink(path).then((saved) => { if (saved) setPath((current) => current === path ? '' : current); }); }}>
        {t('feature.design.unlinkLibrary')}
      </Button>
      {onOpenLibrary ? <Button className="design-library__link-action" size="small" variant="secondary"
        icon={<ArrowUpRight size={15} />} disabled={disabled} onClick={() => onOpenLibrary(path)}>{t('feature.design.openLibrarySource')}</Button> : null}
    </div> : <Button className="design-library__link-action" variant="primary" size="small" icon={<Link2 size={15} />}
        disabled={disabled || !sourceId || sourceId === document.documentId}
        onClick={() => { if (sourceId) void onLink(sourceId, path); }}>
        {t('feature.design.linkLibrary')}
      </Button>}
  </div>;
}
