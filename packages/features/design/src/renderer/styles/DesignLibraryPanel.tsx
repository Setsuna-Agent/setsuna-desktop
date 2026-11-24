import { ArrowUpRight, Check, Component, GripVertical, LayoutGrid, LibraryBig, Link2, List, Plus, Search, Trash2, Type } from 'lucide-react';
import { useContext, useEffect, useMemo, useRef, useState, type MutableRefObject } from 'react';
import { Button, IconButton, SegmentedControl, TextField, useNativeDragPreview } from '@setsuna-desktop/renderer-ui';
import type { RendererTranslate } from '@setsuna-desktop/feature-core/renderer';
import type { DesignLibraryColorScheme } from '../../contracts/design-library-presets.js';
import { designTypographyOf, type DesignDocument, type DesignDocumentRef, type DesignStyle } from '../../contracts/index.js';
import { designStylesForModes } from '../../contracts/design-styles.js';
import { DesignThumbnail, useDesignThumbnails } from '../canvas/DesignThumbnail.js';
import type { DesignClient } from '../client.js';
import type { ComponentActions } from '../components/DesignComponentActions.js';
import { createDesignComponentThumbnailSelection, type DesignComponentPreviewContext } from '../components/design-component-thumbnails.js';
import { designLibrarySourceLabel, isPresetLibraryPath, linkedDesignPath } from '../components/design-library-resources.js';
import { useDesignViewPreference } from '../context/use-design-view-preference.js';
import type { DesignLibraryPreviewTarget } from '../DesignDocumentSurface.js';
import type { LoadDesignImage, WatchDesignDirectories } from '../design-images.js';
import { designComponentDragType, type DesignComponentDrag } from '../design-layer-drop.js';
import { InspectorField } from '../inspector/DesignInspectorFields.js';
import { DesignTypographyFields } from '../inspector/DesignTextFields.js';
import { designFontStack } from '../text/design-typography.js';
import { DesignLibraryPresets } from './DesignLibraryPresets.js';
import { LibraryScrollArea } from './DesignLibraryCatalog.js';
import { DesignSharedLibraries } from './DesignSharedLibraries.js';
import { DesignStyleContext } from './DesignStyleSelect.js';
import { saveName, unusedName } from './design-style-names.js';
import './design-library-panel.css';

type LibraryProps = Readonly<{
  document: DesignDocument; documentRef: DesignDocumentRef; client: DesignClient; disabled: boolean;
  components: ComponentActions['library'];
  componentPreviews: DesignComponentPreviewContext & Readonly<{ loadImage: LoadDesignImage }>;
  componentDrag: MutableRefObject<DesignComponentDrag | undefined>;
  revision: string;
  colorScheme?: DesignLibraryColorScheme;
  watchDirectories?: WatchDesignDirectories;
  sources: DesignDocument['styles'];
  onSetStyle(id: string, style: DesignStyle | null): Promise<boolean>;
  onPreviewStyle(id: string, style: DesignStyle | undefined): void;
  onLink(documentId: string, path: string): Promise<boolean>;
  onUnlink(path: string): Promise<boolean>;
  onOpenLibrary?(path: string): void;
  onOpenPresetLibrary?(source: DesignLibraryPreviewTarget): void;
  translate: RendererTranslate;
}>;

export function DesignLibraryPanel({ document, documentRef, client, disabled, components, componentPreviews, componentDrag, revision, colorScheme, watchDirectories,
  sources, onSetStyle, onPreviewStyle, onLink, onUnlink, onOpenLibrary, onOpenPresetLibrary, translate: t }: LibraryProps) {
  const [panel, setPanel] = useState<'components' | 'text' | 'linked' | 'presets'>('components');
  return <div className="design-library">
    <SegmentedControl<typeof panel> className="design-library__tabs" label={t('feature.design.library')} value={panel} disabled={disabled}
      onChange={setPanel} options={[
        { value: 'components', label: t('feature.design.components'), icon: <Component size={13} aria-hidden="true" /> },
        { value: 'text', label: t('feature.design.textStyle'), icon: <Type size={13} aria-hidden="true" /> },
        { value: 'linked', label: t('feature.design.sharedLibraries'), icon: <Link2 size={13} aria-hidden="true" /> },
        { value: 'presets', label: t('feature.design.library'), icon: <LibraryBig size={13} aria-hidden="true" /> },
      ]} />
    {panel === 'components' ? <LibraryComponents document={document} components={components} componentPreviews={componentPreviews}
      disabled={disabled} componentDrag={componentDrag} revision={revision} translate={t} /> : null}
    {panel === 'text' ? <NamedTextStyles document={document} disabled={disabled} sources={sources} onSetStyle={onSetStyle}
      onPreviewStyle={onPreviewStyle} onOpenLibrary={onOpenLibrary} translate={t} /> : null}
    {panel === 'linked' ? <DesignSharedLibraries key={document.documentId} document={document} client={client} documentRef={documentRef}
      disabled={disabled} watchDirectories={watchDirectories} onLink={onLink} onUnlink={onUnlink} onOpen={onOpenLibrary} translate={t} /> : null}
    {panel === 'presets' ? <DesignLibraryPresets key={document.documentId} document={document} documentRef={documentRef} client={client}
      disabled={disabled} colorScheme={colorScheme} onLink={onLink} onUnlink={onUnlink} onOpen={onOpenPresetLibrary} translate={t} /> : null}
  </div>;
}

function LibraryComponents({ document, components, componentPreviews, componentDrag, revision, disabled, translate: t }:
  Pick<LibraryProps, 'document' | 'components' | 'componentPreviews' | 'componentDrag' | 'revision' | 'disabled' | 'translate'>) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const { projected, resources, layoutEngine, loadImage } = componentPreviews;
  const selectThumbnail = useMemo(() => createDesignComponentThumbnailSelection(document, { projected, resources, layoutEngine }),
    [document, projected, resources, layoutEngine]);
  const observeThumbnail = useDesignThumbnails(scrollRef, selectThumbnail, loadImage, { pixels: 512 });
  const dragPreview = useNativeDragPreview();
  useEffect(() => {
    const source = dragPreview.dragging ? componentDrag.current : undefined;
    if (!source) return;
    return () => { if (componentDrag.current === source) componentDrag.current = undefined; };
  }, [componentDrag, dragPreview.dragging]);
  const [query, setQuery] = useState('');
  const [componentView, setComponentView] = useDesignViewPreference('component');
  const search = query.trim().toLowerCase();
  const searchLabel = t('feature.design.componentSearch');
  const nextView = componentView === 'grid' ? 'list' : 'grid';
  const ViewIcon = nextView === 'list' ? List : LayoutGrid;
  return <div className="design-library__catalog">
    <div className="design-library__search-row">
      <TextField aria-label={searchLabel} placeholder={searchLabel} value={query} disabled={disabled}
        appearance="search" leadingIcon={<Search size={14} />} onChange={(event) => setQuery(event.currentTarget.value)} />
      <IconButton size="small" label={t(nextView === 'list' ? 'feature.design.showComponentList' : 'feature.design.showComponentGrid')}
        disabled={disabled} onClick={() => setComponentView(nextView)}>
        <ViewIcon size={15} aria-hidden="true" />
      </IconButton>
    </div>
    <LibraryScrollArea kind="components" scrollRef={scrollRef}>
      <div className="design-library__results design-library__results--components" data-view={componentView}
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
              <GripVertical size={12} aria-hidden="true" />
            </span>
          </div>)}
      </div>
    </LibraryScrollArea>
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
    <LibraryScrollArea kind="styles">
      <div className="design-library__cards" role="group" aria-label={label}>
        <button type="button" className="design-library__card design-library__card--add" disabled={disabled} onClick={add}>
          <span className="design-library__card-preview" aria-hidden="true"><Plus size={19} strokeWidth={1.6} /></span>
          <span className="design-library__card-name">{addLabel}</span>
        </button>
        {choices.map(({ id: key, style: item }) => {
          const resolved = resolvedCatalog.styles?.[key];
          return <StyleCard key={key} style={resolved?.kind === 'text' ? resolved : item} source={designLibrarySourceLabel(linkedDesignPath(document, key))}
            selected={key === id} disabled={disabled} onSelect={() => setSelected(key)} />;
        })}
      </div>
    </LibraryScrollArea>
    {path ? onOpenLibrary && !isPresetLibraryPath(document, path) ? <Button className="design-library__link-action" size="small" variant="secondary"
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
