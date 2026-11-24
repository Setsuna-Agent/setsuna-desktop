import { ArrowRight, ArrowUpRight, ChevronDown, Copy, Droplet, Ellipsis, Hash, Pencil, Plus, RotateCcw, SquareCheck, Trash2, Type } from 'lucide-react';
import { useContext, useMemo, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import { Button, Checkbox, Dropdown, IconButton, type MenuItem } from '@setsuna-desktop/renderer-ui';
import type { RendererTranslate } from '@setsuna-desktop/feature-core/renderer';
import type { DesignDocument, DesignEdit, DesignStyle } from '../../contracts/index.js';
import { designColorWithAlpha, designDefaultColor, splitDesignColor } from '../../contracts/design-color.js';
import { designResourceParts } from '../../contracts/design-resource-id.js';
import { createDesignVariableResolver } from '../../contracts/design-variable-aliases.js';
import { defaultVariableCollectionId, designVariableCollectionKey, planDesignVariableMove,
  type DesignVariableCollection } from '../../contracts/design-variable-collections.js';
import {
  designVariableAliasId, designVariableKinds, designVariableValue, withDesignVariableValue,
  type DesignVariable, type DesignVariableKind, type DesignVariableValue,
} from '../../contracts/design-variables.js';
import {
  designLibrarySourceLabel, designLibraryVariableCollections, designVariableCollectionLabel, isPresetLibraryPath, type DesignLibraryResources,
} from '../components/design-library-resources.js';
import { DesignUiHostContext } from '../context/design-ui-host.js';
import { InspectorField, InspectorTextArea, NumberField } from '../inspector/DesignInspectorFields.js';
import { ColorField } from '../inspector/DesignPaintField.js';
import { designColorStyle, DesignStyleContext } from './DesignStyleSelect.js';
import { DesignVariableAliasPicker } from './DesignVariableAliasPicker.js';
import { saveName, unusedName } from './design-style-names.js';
import './design-variable-table.css';

const icons = { color: Droplet, number: Hash, string: Type, boolean: SquareCheck };
const initial = {
  color: { kind: 'color', color: designDefaultColor }, number: { kind: 'number', value: 0 },
  string: { kind: 'string', value: '' }, boolean: { kind: 'boolean', value: false },
} as const;

type TableProps = Readonly<{
  document: DesignDocument;
  resources: DesignLibraryResources;
  previewStyles?: DesignDocument['styles'];
  disabled: boolean;
  selectedCollection: string;
  onSelectCollection(key: string): void;
  onCommit(edits: readonly DesignEdit[]): Promise<boolean>;
  onPreviewStyle(id: string, style: DesignVariable | undefined): void;
  onOpenLibrary?(path: string): void;
  translate: RendererTranslate;
}>;

export function DesignVariableTable({ document, resources, previewStyles, disabled, selectedCollection, onSelectCollection,
  onCommit, onPreviewStyle, onOpenLibrary, translate: t }: TableProps) {
  const { styles } = useContext(DesignStyleContext);
  const ScrollOverlay = useContext(DesignUiHostContext)?.ScrollOverlay;
  const scrollRef = useRef<HTMLDivElement>(null);
  const sources = useMemo(() => Object.keys(resources.styles).length ? { ...styles, ...resources.styles } : styles, [resources.styles, styles]);
  const [renaming, setRenaming] = useState<string>();
  const [renamingMode, setRenamingMode] = useState<{ collectionKey: string; id?: string }>();
  const [focusId, setFocusId] = useState<string>();
  const collections = designLibraryVariableCollections(document, resources);
  const active = collections.find(({ key }) => key === selectedCollection) ?? collections[0];
  const destinations = collections.filter(({ key, path }) => key !== active.key && !path);
  const { collection, id: collectionId, path } = active;
  const readOnly = disabled || Boolean(path);
  const defaultName = t('feature.design.defaultVariableCollection');
  const modes: { id?: string; name: string }[] = [
    { name: collection.defaultModeName ?? t('feature.design.defaultVariableMode') },
    ...Object.entries(collection.modes ?? {}).map(([id, name]) => ({ id, name })),
  ];
  const columns = modes.map((mode) => {
    const selectedMode = mode.id ? { [active.key]: mode.id } : undefined;
    return {
      ...mode,
      resolveValue: createDesignVariableResolver(sources, document.documentId, selectedMode),
      resolvePreviewValue: previewStyles && createDesignVariableResolver(previewStyles, document.documentId, selectedMode),
    };
  });
  const rows = Object.entries(styles ?? {}).flatMap(([id, catalogStyle]) => {
    const style = document.styles?.[id] ?? catalogStyle;
    if (style.kind === 'text') return [];
    const owner = designResourceParts(id)?.documentId ?? document.documentId;
    return designVariableCollectionKey(owner, style.collectionId) === active.key ? [{ id, style }] : [];
  });
  const collectionName = designVariableCollectionLabel(active, defaultName);
  const saveCollection = (next: DesignVariableCollection | null, id = collectionId) => onCommit([{ kind: 'setVariableCollection', collectionId: id, collection: next }]);
  const saveStyle = (styleId: string, style: DesignStyle | null) => onCommit([{ kind: 'setStyle', styleId, style }]);
  const nameLabel = t('feature.design.name');
  const modeNameLabel = t('feature.design.variableModeName');
  const opacityLabel = t('feature.design.opacity');
  const addVariableLabel = t('feature.design.addVariable');

  function addCollection() {
    const id = crypto.randomUUID();
    const key = designVariableCollectionKey(document.documentId, id);
    const name = unusedName(t('feature.design.newVariableCollection'), collections.map((entry) => designVariableCollectionLabel(entry, defaultName)));
    void saveCollection({ name }, id).then((saved) => {
      if (!saved) return;
      onSelectCollection(key);
      setRenaming(key);
    });
  }

  function addMode() {
    const id = crypto.randomUUID();
    const name = unusedName(t('feature.design.newVariableMode'), modes.map((mode) => mode.name));
    setRenamingMode({ collectionKey: active.key, id });
    void saveCollection({ ...collection, modes: { ...collection.modes, [id]: name } });
  }

  function deleteMode(id: string) {
    const nextModes = { ...collection.modes };
    delete nextModes[id];
    void saveCollection({ ...collection, modes: nextModes });
  }

  function modeHeading(id: string | undefined, name: string) {
    if (path) return <span title={name}>{name}</span>;
    if (renamingMode?.collectionKey === active.key && renamingMode.id === id) {
      return <div onBlur={() => setRenamingMode(undefined)}>
        <InspectorField label={`${modeNameLabel} · ${name}`} value={name} maxLength={128} autoFocus readOnly={readOnly}
          onFocus={(event) => event.currentTarget.select()} onSave={(input) => saveName(input, (nextName) => saveCollection(id
            ? { ...collection, modes: { ...collection.modes, [id]: nextName } }
            : { ...collection, defaultModeName: nextName }))} />
      </div>;
    }
    return <Dropdown modal disabled={disabled} menu={{ items: [
      { key: 'rename', label: t('feature.design.renameVariableMode'), icon: <Pencil size={14} />,
        onClick: () => setRenamingMode({ collectionKey: active.key, id }) },
      id ? { key: 'delete', label: t('feature.design.deleteVariableMode'), icon: <Trash2 size={14} />, danger: true,
        onClick: () => deleteMode(id) } : null,
    ] }}>
      <Button size="small" variant="ghost" title={name}>
        <span>{name}</span><ChevronDown size={12} aria-hidden="true" />
      </Button>
    </Dropdown>;
  }

  function createVariable(style: DesignVariable) {
    const id = crypto.randomUUID();
    const name = unusedName(style.name, rows.map(({ style }) => style.name));
    setFocusId(id);
    void saveStyle(id, { ...style, name });
  }

  return <div className="design-variable-panel">
    <header className="design-variable-panel__toolbar">
      <div className="design-variable-panel__collection-controls">
        <div className="design-variable-panel__collections" role="group" aria-label={t('feature.design.variableCollections')}>
          {collections.map((entry) => {
            const { key } = entry;
            const name = designVariableCollectionLabel(entry, defaultName);
            const selected = key === active.key;
            if (selected && key === renaming) {
              return <div className="design-variable-panel__rename" key={key} onBlur={() => setRenaming(undefined)}>
                <InspectorField label={t('feature.design.renameVariableCollection')} value={name} maxLength={128} autoFocus
                  onFocus={(event) => event.currentTarget.select()} readOnly={readOnly}
                  onSave={(input) => saveName(input, (name) => saveCollection({ ...collection, name }))} />
              </div>;
            }
            const hasActions = selected && !entry.path;
            const source = designLibrarySourceLabel(entry.path);
            const button = <button type="button" className="design-variable-panel__collection" key={key}
              title={source ? `${name} · ${source}` : name} aria-pressed={selected}
              onClick={hasActions ? undefined : () => {
                onSelectCollection(key);
                setRenaming(undefined);
                setRenamingMode(undefined);
              }}>
              <span>{name}</span>
              {hasActions ? <ChevronDown size={12} aria-hidden="true" /> : null}
            </button>;
            return hasActions ? <Dropdown key={key} modal disabled={disabled} menu={{ items: [
              { key: 'rename', label: t('feature.design.renameVariableCollection'), icon: <Pencil size={14} />, onClick: () => setRenaming(key) },
              { key: 'delete', label: t('feature.design.deleteVariableCollection'), danger: true, icon: <Trash2 size={14} />,
                disabled: collectionId === defaultVariableCollectionId || rows.length > 0, onClick: () => { void saveCollection(null); } },
            ] }}>{button}</Dropdown> : button;
          })}
        </div>
        <IconButton size="small" label={t('feature.design.addVariableCollection')} disabled={disabled} onClick={addCollection}><Plus size={15} /></IconButton>
      </div>
      {path && onOpenLibrary && !isPresetLibraryPath(document, path) ? <IconButton size="small" label={t('feature.design.openLibrarySource')} disabled={disabled}
        onClick={() => onOpenLibrary(path)}><ArrowUpRight size={15} /></IconButton> : null}
      {!path ? <Dropdown modal disabled={disabled} placement="bottomRight" menu={{ items: designVariableKinds.map((kind) => {
        const Icon = icons[kind];
        const name = t(`feature.design.variableType.${kind}`);
        return { key: kind, label: name, icon: <Icon size={14} />, onClick: () => createVariable({ ...initial[kind], name,
          collectionId: collectionId === defaultVariableCollectionId ? undefined : collectionId }) };
      }) }}>
        <Button className="design-variable-panel__add" size="small" variant="ghost" disabled={disabled}>
          {addVariableLabel}<ChevronDown size={12} aria-hidden="true" />
        </Button>
      </Dropdown> : null}
    </header>
    <div className="design-variable-panel__body" key={active.key}>
      <div className="design-variable-panel__scroll" ref={scrollRef} data-overlay-scroll={ScrollOverlay ? '' : undefined}>
        <table className="design-variable-panel__table" aria-label={collectionName} data-read-only={Boolean(path) || undefined}
          style={{ '--design-variable-columns': modes.length } as CSSProperties}>
          <colgroup><col className="design-variable-panel__name-col" />
            {modes.map(({ id }) => <col key={id ?? ''} />)}
            {!path ? <col className="design-variable-panel__actions-col" /> : null}</colgroup>
          <thead><tr>
            <th scope="col" className="design-variable-panel__name">{nameLabel}</th>
            {modes.map(({ id, name }) => <th scope="col" className="design-variable-panel__column-title" key={id ?? ''}>
              {modeHeading(id, name)}
            </th>)}
            {!path ? <th scope="col" className="design-variable-panel__actions"><IconButton size="small"
              label={t('feature.design.addVariableMode')} disabled={readOnly} onClick={addMode}><Plus size={15} /></IconButton></th> : null}
          </tr></thead>
          <tbody>{rows.map(({ id, style }) => {
            const Icon = icons[style.kind];
            const icon = <Icon size={13} aria-hidden="true" />;
            return <tr key={id}>
              <td className="design-variable-panel__name">{path ? <span className="design-variable-panel__readonly-name" title={style.name}>{icon}<span>{style.name}</span></span>
                : <InspectorField label={`${nameLabel} · ${style.name}`} prefix={icon} value={style.name} maxLength={128} readOnly={readOnly}
                  data-variable-name="" autoFocus={focusId === id} onFocus={(event) => event.currentTarget.select()}
                  onSave={(input) => saveName(input, (name) => saveStyle(id, { ...style, name }))} />}</td>
              {columns.map(({ id: modeId, name, resolveValue, resolvePreviewValue }) => {
                const override = modeId !== undefined && Object.hasOwn(style.modeValues ?? {}, modeId);
                const saveValue = (value: DesignVariableValue | undefined) => saveStyle(id, withDesignVariableValue(style, modeId, value));
                const label = `${style.name} · ${name}`;
                const aliasId = designVariableAliasId(style, modeId);
                const value = resolveValue(id) ?? designVariableValue(style, modeId);
                // Keep the edited cell's baseline while its aliases follow the preview.
                const displayedValue = aliasId ? resolvePreviewValue?.(id) ?? value : value;
                const sourceName = style.kind === 'color' && aliasId
                  ? designColorStyle(sources, aliasId)?.name ?? t('feature.design.unavailableStyle') : undefined;
                const withAlias = (source: string | undefined) => {
                  if (source === aliasId) return;
                  const fallback = source ? resolveValue(source) : value;
                  if (fallback !== undefined) return withDesignVariableValue(style, modeId, fallback, source);
                };
                const aliasPicker = path ? null : <DesignVariableAliasPicker variableId={id} kind={style.kind} value={aliasId}
                  label={t('feature.design.bindVariable', { field: label })} sources={sources} resolveValue={resolveValue} disabled={disabled}
                  onPreview={(source) => onPreviewStyle(id, source === undefined ? undefined : withAlias(source || undefined))}
                  onChange={(source) => {
                    const next = withAlias(source);
                    if (next) void saveStyle(id, next);
                  }} translate={t} />;
                return <td key={modeId ?? ''}>
                  <div className="design-variable-panel__cell" data-inherited={modeId !== undefined && !override || undefined}>
                    <VariableValueField label={label} opacityLabel={`${opacityLabel} · ${label}`} kind={style.kind}
                      value={displayedValue} sourceName={sourceName} disabled={readOnly || Boolean(aliasId)} onSave={saveValue}
                      aliasPicker={style.kind === 'color' ? aliasPicker : null}
                      onPreview={(value) => onPreviewStyle(id, value === undefined ? undefined : withDesignVariableValue(style, modeId, value))} />
                    {style.kind !== 'color' ? aliasPicker : null}
                    {override && !path ? <IconButton size="small" className="design-variable-panel__context-action"
                      label={`${t('feature.design.resetVariableValue')} · ${label}`} disabled={readOnly}
                      onClick={() => { void saveValue(undefined); }}><RotateCcw size={12} /></IconButton> : null}
                  </div>
                </td>;
              })}
              {!path ? <td className="design-variable-panel__actions"><VariableRowActions name={style.name} disabled={readOnly} translate={t}
                onDuplicate={() => createVariable(style)} onDelete={() => { void saveStyle(id, null); }}
                moveItems={destinations.map((destination) => ({ key: destination.key, label: designVariableCollectionLabel(destination, defaultName),
                  onClick: () => { void onCommit(planDesignVariableMove(id, style, collection, destination)); } }))} /></td> : null}
            </tr>;
          })}</tbody>
        </table>
      </div>
      {ScrollOverlay ? <ScrollOverlay scrollRef={scrollRef} /> : null}
    </div>
  </div>;
}

function VariableRowActions({ name, disabled, moveItems, onDuplicate, onDelete, translate: t }: Readonly<{
  name: string;
  disabled: boolean;
  moveItems: MenuItem[];
  onDuplicate(): void;
  onDelete(): void;
  translate: RendererTranslate;
}>) {
  const trigger = useRef<HTMLElement>(null);
  const renameRequested = useRef(false);
  return <Dropdown ref={trigger} modal disabled={disabled} placement="bottomRight" className="design-variable-row-menu"
    onCloseAutoFocus={(event) => {
      if (!renameRequested.current) return;
      renameRequested.current = false;
      const input = trigger.current?.closest('tr')?.querySelector<HTMLInputElement>('input[data-variable-name]');
      if (!input) return;
      event.preventDefault();
      input.focus({ preventScroll: true });
    }} menu={{ items: [
      { key: 'rename', label: t('feature.design.renameVariable'), icon: <Pencil size={14} />,
        onClick: () => { renameRequested.current = true; } },
      { key: 'duplicate', label: t('feature.design.duplicateVariable'), icon: <Copy size={14} />, onClick: onDuplicate },
      { key: 'move', label: t('feature.design.moveVariableTo'), icon: <ArrowRight size={14} />,
        disabled: !moveItems.length, children: moveItems.length ? moveItems : undefined, submenuClassName: 'design-variable-row-menu' },
      { key: 'separator', type: 'divider' },
      { key: 'delete', label: t('feature.design.removeVariable'), icon: <Trash2 size={14} />, danger: true, onClick: onDelete },
    ] }}>
    <IconButton size="small" disabled={disabled}
      label={t('feature.design.variableActions', { name })}><Ellipsis size={15} /></IconButton>
  </Dropdown>;
}

function VariableValueField({ kind, label, opacityLabel, value, sourceName, disabled, aliasPicker, onSave, onPreview }: Readonly<{
  kind: DesignVariableKind; label: string; opacityLabel: string; value: DesignVariableValue; disabled: boolean;
  sourceName?: string;
  aliasPicker: ReactNode;
  onSave(value: DesignVariableValue): Promise<boolean>; onPreview(value: DesignVariableValue | undefined): void;
}>) {
  if (kind === 'color' && typeof value === 'string') {
    const setOpacity = (percentage: number) => designColorWithAlpha(value, percentage / 100);
    return <ColorField label={label} value={value} displayName={sourceName} disabled={disabled} onSave={onSave} onPreview={onPreview} editOpacity
      link={aliasPicker} opacityField={<NumberField label={opacityLabel} value={Math.round(splitDesignColor(value).opacity * 100)} suffix="%"
        min={0} max={100} readOnly={disabled} onSave={(percentage) => onSave(setOpacity(percentage))}
        onPreview={(percentage) => onPreview(percentage === undefined ? undefined : setOpacity(percentage))} />} />;
  }
  if (typeof value === 'boolean') return <Checkbox aria-label={label} checked={value} disabled={disabled}
    onChange={(next) => { void onSave(next); }} />;
  if (typeof value === 'string') return <InspectorTextArea aria-label={label} rows={1} readOnly={disabled} value={value}
    onSave={onSave} onDraft={onPreview} />;
  function parse(input: string) {
    const number = Number(input);
    return input.trim() && Number.isFinite(number) ? number : undefined;
  }
  return <InspectorField label={label} value={String(value)} readOnly={disabled} type="number" step="any"
    onDraft={(input) => onPreview(input === undefined ? undefined : parse(input))} onSave={(input) => {
      const number = parse(input);
      return number === undefined ? Promise.resolve(false) : onSave(number);
    }} />;
}
