import { Link2, Search } from 'lucide-react';
import { useContext, useMemo, useRef, useState, type KeyboardEvent } from 'react';
import type { RendererTranslate } from '@setsuna-desktop/feature-core/renderer';
import { Dropdown, IconButton, TextField, useHoverPreview, type MenuItem } from '@setsuna-desktop/renderer-ui';
import type { DesignDocument } from '../../contracts/index.js';
import { designVariableAliasDependents } from '../../contracts/design-variable-aliases.js';
import type { DesignVariableKind, DesignVariableValue } from '../../contracts/design-variables.js';
import { DesignStyleContext } from './DesignStyleSelect.js';
import './design-variable-link.css';

export function DesignVariableAliasPicker({ variableId, kind, value, label, sources, resolveValue, disabled, onChange, onPreview, translate: t }: Readonly<{
  variableId: string;
  kind: DesignVariableKind;
  value?: string;
  label: string;
  sources: DesignDocument['styles'];
  resolveValue(id: string): DesignVariableValue | undefined;
  disabled: boolean;
  onChange(id: string | undefined): void;
  onPreview(id: string | undefined): void;
  translate: RendererTranslate;
}>) {
  const { styles } = useContext(DesignStyleContext);
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const preview = useHoverPreview(open && !disabled ? onPreview : undefined);
  const searchRef = useRef<HTMLInputElement>(null);
  const blocked = useMemo(() => open ? designVariableAliasDependents(sources, variableId) : undefined, [open, sources, variableId]);
  const search = query.trim().toLowerCase();
  const searchLabel = t('feature.design.searchVariables');
  const source = value && Object.hasOwn(sources ?? {}, value) ? sources?.[value] : undefined;
  const title = value ? `${label} · ${source?.name ?? t('feature.design.unavailableStyle')}` : label;

  function changeOpen(next: boolean) {
    setOpen(next);
    if (!next) { preview.clear(); setQuery(''); }
  }

  function select(id: string | undefined) {
    // Close before a save disables the trigger and changes the controlled menu state.
    changeOpen(false);
    onChange(id);
  }

  const items: MenuItem[] = [];
  if (blocked) {
    if (!search) items.push({ key: '', label: t('feature.design.noVariableReference'),
      hover: value ? preview.option(() => '') : undefined, onClick: () => select(undefined) });
    for (const [id, style] of Object.entries(styles ?? {})) {
      if (style.kind !== kind || blocked.has(id) || !style.name.toLowerCase().includes(search)) continue;
      const color = kind === 'color' ? resolveValue(id) : undefined;
      items.push({ key: id, label: <span className="design-variable-alias-menu__choice" title={style.name}>
        <span>{style.name}</span>
        {typeof color === 'string' ? <span className="design-variable-alias-menu__swatch" aria-hidden="true" style={{ backgroundColor: color }} /> : null}
      </span>, hover: id === value ? undefined : preview.option(() => id), onClick: () => select(id) });
    }
  }
  return <Dropdown modal open={open && !disabled} disabled={disabled} onOpenChange={changeOpen}
    initialFocusRef={searchRef} rootClassName="design-variable-alias-menu sd-menu-surface--neutral" menu={{ items, selectedKeys: [value ?? ''] }}
    popupRender={(rows) => <>
      <TextField ref={searchRef} appearance="search" leadingIcon={<Search size={14} />} aria-label={searchLabel} placeholder={searchLabel}
        value={query} onChange={(event) => { preview.clear(); setQuery(event.currentTarget.value); }} onKeyDown={navigateSearch} />
      <div className="design-variable-alias-menu__options">{rows}</div>
    </>}>
    <IconButton label={label} title={title} size="small" className={`design-variable-link${value ? ' is-linked' : ''}`} disabled={disabled}>
      <Link2 aria-hidden="true" />
    </IconButton>
  </Dropdown>;
}

function navigateSearch(event: KeyboardEvent<HTMLInputElement>) {
  // The search input owns text and IME events. Radix owns Escape and navigation between results.
  if (event.key === 'Escape' && !event.nativeEvent.isComposing) return;
  event.stopPropagation();
  if (event.nativeEvent.isComposing || !['ArrowDown', 'ArrowUp', 'Tab'].includes(event.key)) return;
  event.preventDefault();
  const rows = event.currentTarget.closest('[role="menu"]')?.querySelectorAll<HTMLElement>('[role="menuitem"]');
  const fromEnd = event.key === 'ArrowUp' || (event.key === 'Tab' && event.shiftKey);
  const row = fromEnd ? rows?.[rows.length - 1] : rows?.[0];
  row?.focus();
}
