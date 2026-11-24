import { Search, type LucideIcon } from 'lucide-react';
import { useContext, useEffect, useLayoutEffect, useMemo, useRef, useState, type ComponentProps, type CSSProperties, type ReactNode } from 'react';
import type { RendererTranslate } from '@setsuna-desktop/feature-core/renderer';
import { IconButton, TextField, useHoverPreview, useToast } from '@setsuna-desktop/renderer-ui';
import { designDefaultColor } from '../../contracts/design-color.js';
import { designIconNames, type DesignVector } from '../../contracts/index.js';
import { DesignUiHostContext } from '../context/design-ui-host.js';
import { defaultDesignStroke } from '../design-paint.js';
import type { DesignLucideSource } from './design-svg-source.js';
import './design-icon-picker.css';

type IconLoader = () => Promise<{ default: LucideIcon }>;
type LucideCatalog = Readonly<Record<string, IconLoader>>;
type Entry = Readonly<{ name: string; label: string; search: string; load: IconLoader }>;
type IconActions = Readonly<{
  onPick(source: DesignLucideSource): void;
  preview?: Readonly<{
    prepare(source: DesignLucideSource): Promise<DesignVector>;
    show(node: DesignVector | undefined, owner: string): void;
  }>;
}>;
const commonNames = new Set<string>(designIconNames);
const tile = 36;
const gap = 4;
const rowStep = tile + gap;
const initialViewport = { width: 300, height: 5 * rowStep - gap };
const overscan = 2;

export function designLucideLabel(name: string, translate: RendererTranslate) {
  return commonNames.has(name) ? translate(`feature.design.icon.${name}`) : name.replaceAll('-', ' ');
}

export function DesignLucidePicker({ selected, disabled, searchAction, onPick, preview, translate: t }: IconActions & Readonly<{
  selected?: string;
  disabled: boolean;
  searchAction?: ReactNode;
  translate: RendererTranslate;
}>) {
  const toast = useToast();
  const [catalog, setCatalog] = useState<LucideCatalog>();
  const [query, setQuery] = useState('');
  const entries = useMemo(() => {
    if (!catalog) return [];
    const names = [...designIconNames.filter((name) => Object.hasOwn(catalog, name)), ...Object.keys(catalog).filter((name) => !commonNames.has(name))];
    return names.map((name): Entry => {
      const label = designLucideLabel(name, t);
      return { name, label, search: name.replaceAll('-', ' ') + ' ' + label.toLowerCase(), load: catalog[name] };
    });
  }, [catalog, t]);
  const search = query.toLowerCase().replace(/[-\s]+/gu, ' ').trim();
  const matches = useMemo(() => search ? entries.filter((entry) => entry.search.includes(search)) : entries, [entries, search]);

  useEffect(() => {
    let active = true;
    void import('lucide-react/dynamicIconImports.js').then(({ default: icons }) => {
      // The installed version's declarations also admit a CommonJS default wrapper.
      if (active) setCatalog((icons.default ?? icons) as LucideCatalog);
    }).catch(() => { if (active) toast.error(t('feature.design.loadIconsFailed')); });
    return () => { active = false; };
  }, [t, toast]);

  return <>
    <div className="design-icon-picker__search">
      <TextField autoFocus appearance="search" aria-label={t('feature.design.searchIcons')} placeholder={t('feature.design.searchIcons')}
        leadingIcon={<Search size={14} />} value={query} readOnly={disabled} onChange={(event) => setQuery(event.target.value)} />
      {searchAction}
    </div>
    <DesignIconGrid key={search} entries={matches} selected={selected} disabled={disabled} onPick={onPick} preview={preview} label={t('feature.design.icon')} />
  </>;
}

function DesignIconGrid({ entries, label, selected, disabled, onPick, preview }: IconActions & Readonly<{
  entries: readonly Entry[];
  label: string;
  selected?: string;
  disabled: boolean;
}>) {
  const ScrollOverlay = useContext(DesignUiHostContext)?.ScrollOverlay;
  const scroll = useRef<HTMLDivElement>(null);
  const content = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState(initialViewport);
  const [scrollTop, setScrollTop] = useState(0);
  const hover = useHoverPreview(disabled ? undefined : preview?.show);

  useLayoutEffect(() => {
    const element = scroll.current;
    if (!element) return;
    function measure() {
      const width = content.current?.clientWidth || initialViewport.width;
      const height = element?.clientHeight || initialViewport.height;
      setSize((previous) => previous.width === width && previous.height === height ? previous : { width, height });
    }
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  const columns = Math.max(1, Math.floor((size.width + gap) / rowStep));
  const rows = Math.ceil(entries.length / columns);
  const height = Math.max(0, rows * rowStep - gap);
  const top = Math.max(0, Math.min(scrollTop, height - size.height));
  const firstRow = Math.max(0, Math.floor(top / rowStep) - overscan);
  const pastRow = Math.min(rows, Math.ceil((top + size.height) / rowStep) + overscan);

  return <div className="design-icon-picker__viewport" style={{ '--design-icon-picker-grid-height': `${initialViewport.height}px` } as CSSProperties}>
    <div ref={scroll} className="design-icon-picker__scroll" role="group" aria-label={label} tabIndex={0}
      onScroll={(event) => setScrollTop(event.currentTarget.scrollTop)}>
      <div ref={content} className="design-icon-picker__spacer" style={{ height }}>
        <div className="design-icon-picker__grid" style={{
          top: firstRow * rowStep, gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))`, gridAutoRows: tile, gap,
        }}>
          {entries.slice(firstRow * columns, pastRow * columns).map((entry) => <CatalogIcon key={entry.name} entry={entry}
            {...(preview && entry.name !== selected ? hover.option(async (tile) => {
              const source = iconSource(tile, entry);
              if (source) return preview.prepare(source);
            }) : undefined)}
            selected={entry.name === selected} disabled={disabled} onPick={(source) => { hover.clear(); onPick(source); }} />)}
        </div>
      </div>
    </div>
    {ScrollOverlay ? <ScrollOverlay scrollRef={scroll} /> : null}
  </div>;
}

type IconHoverEvents = Pick<ComponentProps<typeof IconButton>, 'onPointerEnter' | 'onPointerLeave'>;

function CatalogIcon({ entry, selected, disabled, onPick, ...hoverEvents }: IconHoverEvents & Readonly<{
  entry: Entry;
  selected: boolean;
  disabled: boolean;
  onPick(source: DesignLucideSource): void;
}>) {
  const { name, label, load } = entry;
  const [Icon, setIcon] = useState<LucideIcon>();
  useEffect(() => {
    let active = true;
    void load().then(({ default: glyph }) => { if (active) setIcon(() => glyph); }).catch(() => undefined);
    return () => { active = false; };
  }, [load]);
  return <IconButton {...hoverEvents} label={label} title={label === name ? label : label + ' · ' + name} aria-pressed={selected || undefined}
    disabled={disabled || !Icon} onClick={(event) => {
      const source = iconSource(event.currentTarget, entry);
      if (source) onPick(source);
    }}>
    {Icon ? <Icon size={24} strokeWidth={defaultDesignStroke.width} aria-hidden="true" /> : null}
  </IconButton>;
}

function iconSource(tile: HTMLElement, { name, label }: Entry): DesignLucideSource | undefined {
  const svg = tile.querySelector('svg');
  if (svg) return { markup: svg.outerHTML, name: label, icon: name, color: designDefaultColor };
}
