import {
  ArrowDownToLine, ArrowLeftRight, ArrowRightToLine, ArrowUpDown, Link2,
  PanelBottom, PanelLeft, PanelRight, PanelTop, SquareDashed, SquareDashedMousePointer, Unlink2,
} from 'lucide-react';
import { useId, type ReactNode } from 'react';
import type { RendererTranslate } from '@setsuna-desktop/feature-core/renderer';
import { Checkbox, IconButton } from '@setsuna-desktop/renderer-ui';
import type { DesignFrame, DesignLayout, DesignNode, DesignSizeMode } from '../../contracts/index.js';
import { InspectorField, InspectorSection, NumberField } from './DesignInspectorFields.js';
import { bindDesignNumber, type InspectorNumberEdits } from './design-inspector-edit.js';
import { hasEditableLayout } from '../design-layout-adjustment.js';
import { designPadding, designSizeMode, designSizeModes, type DesignAxis, type DesignLayerBox } from '../design-layout.js';

const directions = [
  { id: 'free', icon: SquareDashed }, { id: 'vertical', icon: ArrowDownToLine }, { id: 'horizontal', icon: ArrowRightToLine },
] as const;
const anchors = [
  { id: 'start', vertical: 'top', horizontal: 'left' },
  { id: 'center', vertical: 'centerY', horizontal: 'centerX' },
  { id: 'end', vertical: 'bottom', horizontal: 'right' },
] as const;
const distributions = ['space-between', 'space-around'] as const;
const sizeAxes = ['width', 'height'] as const;
const adaptiveSizes = ['fill', 'hug'] as const;
const paddingFields = [
  { side: 'left', index: 3, icon: PanelLeft }, { side: 'right', index: 1, icon: PanelRight },
  { side: 'top', index: 0, icon: PanelTop }, { side: 'bottom', index: 2, icon: PanelBottom },
] as const;

type SaveNode = (node: DesignNode) => Promise<boolean>;
type SaveLayout = (layout: DesignLayout) => Promise<boolean>;
type SpacingMode = 'fixed' | (typeof distributions)[number];

export function DesignSizeFields({ node, projectedNode, box, preview, parent, disabled, onSave, numberEdits, translate: t }: Readonly<{
  node: DesignNode;
  projectedNode: DesignNode;
  box: DesignLayerBox;
  preview?: Readonly<{ width: number; height: number }>;
  parent?: DesignFrame;
  disabled: boolean;
  onSave: SaveNode;
  numberEdits: InspectorNumberEdits;
  translate: RendererTranslate;
}>) {
  const axes = sizeAxes.map((axis) => ({
    axis, mode: designSizeMode(projectedNode, parent, axis), modes: designSizeModes(projectedNode, parent, axis),
  }));
  const sizes = adaptiveSizes.filter((mode) => axes.some(({ modes }) => modes.includes(mode)));

  function saveSize(axis: DesignAxis, size: number, mode: DesignSizeMode) {
    if (axis === 'width') return onSave({ ...node, width: size, widthMode: mode });
    if (node.kind === 'text') return Promise.resolve(false);
    return onSave({ ...node, height: size, heightMode: mode });
  }

  return <div className="design-inspector__size-fields" role="group" aria-label={t('feature.design.size')}>
    {axes.map(({ axis, mode }) => <NumberField key={axis} label={t(`feature.design.${axis}`)}
      prefix={axis === 'width' ? 'W' : 'H'} value={box[axis]} min={0.01}
      previewValue={preview?.[axis]} readOnly={mode !== 'fixed' || (axis === 'height' && node.kind === 'text')}
      {...bindDesignNumber(numberEdits, (current, size) => axis === 'width' ? { ...current, width: size, widthMode: 'fixed' }
        : current.kind === 'text' ? current : { ...current, height: size, heightMode: 'fixed' })} />)}
    {sizes.flatMap((size) => axes.map(({ axis, mode, modes }) => {
      const key = `${axis}:${size}`;
      if (!modes.includes(size)) return <span key={key} aria-hidden="true" />;
      const label = t(`feature.design.size.${size}.${axis}`);
      return <Checkbox className="design-inspector__size-option" key={key} title={label} checked={mode === size} disabled={disabled}
        onChange={(checked) => { void saveSize(axis, Math.max(0.01, box[axis]), checked ? size : 'fixed'); }}>
        <span>{label}</span>
      </Checkbox>;
    }))}
    {(['minWidth', 'maxWidth'] as const).map((limit) => {
      const label = t(`feature.design.${limit}`);
      return <InspectorField key={limit} label={label} prefix={label}
        value={node[limit] === undefined ? '' : String(node[limit])} placeholder="—" type="number" step="any" min={0} readOnly={disabled}
        onSave={(text) => {
          const size = text.trim() ? Number(text) : undefined;
          if (size !== undefined && (!Number.isFinite(size) || size < 0 || (limit === 'maxWidth' && size === 0))) return Promise.resolve(false);
          return numberEdits.onNumberSave((current) => {
            const next = { ...current, [limit]: size };
            return next.minWidth !== undefined && next.maxWidth !== undefined && next.minWidth > next.maxWidth ? current : next;
          });
        }} />;
    })}
  </div>;
}

export function DesignLayoutFields({ frame, preview, sizeControls, disabled, adjustment, onLayoutChange, numberEdits, translate: t }: Readonly<{
  frame: DesignFrame;
  preview?: DesignLayout;
  sizeControls: ReactNode;
  disabled: boolean;
  adjustment?: Readonly<{ active: boolean; toggle(): void }>;
  onLayoutChange(layout: DesignLayout | undefined): Promise<boolean>;
  numberEdits: InspectorNumberEdits;
  translate: RendererTranslate;
}>) {
  const { layout } = frame;
  const direction = layout?.direction ?? 'free';
  const shown = preview ?? layout;
  const spacing = distributions.find((mode) => mode === shown?.justify) ?? 'fixed';
  return <InspectorSection title={t('feature.design.layout')} action={adjustment ? <IconButton
    className="design-inspector__layout-adjust" size="small" label={t('feature.design.adjustLayoutOnCanvas')}
    aria-pressed={adjustment.active} disabled={disabled || Boolean(preview)} onClick={adjustment.toggle}>
    <SquareDashedMousePointer size={15} />
  </IconButton> : null}>
    <LayoutGroup title={t('feature.design.size')}>{sizeControls}</LayoutGroup>
    <div className="design-inspector__segments" role="group" aria-label={t('feature.design.layout')}>
      {directions.map(({ id, icon: Icon }) => <IconButton key={id} size="small"
        label={t(`feature.design.layout.${id}`)} aria-pressed={direction === id} disabled={disabled || Boolean(preview)}
        onClick={() => {
          if (id === direction) return;
          const next: DesignLayout | undefined = id === 'free' ? undefined : { gap: 12, padding: 16, align: 'start', ...layout, direction: id };
          void onLayoutChange(next);
        }}>
        <Icon size={16} />
      </IconButton>)}
    </div>
    {layout ? <>
      <Checkbox checked={Boolean(layout.wrap)} disabled={disabled} onChange={(wrap) => { void onLayoutChange({ ...layout, wrap }); }}>
        {t('feature.design.layout.wrap')}
      </Checkbox>
      <div className="design-inspector__layout-controls">
        <LayoutGroup title={t('feature.design.align')}>
          <LayoutAlignment layout={shown ?? layout} spacing={spacing} disabled={disabled || Boolean(preview)} onSave={onLayoutChange} translate={t} />
        </LayoutGroup>
        <LayoutGroup title={t('feature.design.gap')}>
          <LayoutSpacing layout={layout} preview={preview} spacing={spacing} disabled={disabled || Boolean(preview)}
            onSave={onLayoutChange} numberEdits={numberEdits} translate={t} />
        </LayoutGroup>
      </div>
      <LayoutGroup title={t('feature.design.padding')}>
        <LayoutPaddingFields layout={layout} preview={preview} disabled={disabled || Boolean(preview)}
          onSave={onLayoutChange} numberEdits={numberEdits} translate={t} />
      </LayoutGroup>
    </> : null}
  </InspectorSection>;
}

function LayoutGroup({ title, children }: Readonly<{ title: string; children: ReactNode }>) {
  return <div className="design-inspector__layout-group"><h4>{title}</h4>{children}</div>;
}

type LayoutControls = Readonly<{
  layout: DesignLayout;
  disabled: boolean;
  onSave: SaveLayout;
  translate: RendererTranslate;
}>;

function LayoutAlignment({ layout, spacing, disabled, onSave, translate: t }: LayoutControls & { spacing: SpacingMode }) {
  const horizontal = layout.direction === 'horizontal';
  const packed = spacing === 'fixed';
  const mainAlignment = packed ? layout.justify ?? 'start' : 'center';
  return <div className="design-inspector__matrix" role="group" aria-label={t('feature.design.align')}>
    {anchors.flatMap((row) => anchors.map((column) => {
      const key = `${row.id}:${column.id}`;
      const main = horizontal ? column.id : row.id;
      const cross = horizontal ? row.id : column.id;
      // Distributed items already use the main axis. The center row or column controls only cross-axis alignment.
      if (!packed && main !== 'center') return <span key={key} aria-hidden="true" />;
      const label = packed ? t('feature.design.layoutCell', {
        vertical: t(`feature.design.align.${row.vertical}`), horizontal: t(`feature.design.align.${column.horizontal}`),
      }) : t(`feature.design.align.${horizontal ? row.vertical : column.horizontal}`);
      const selected = layout.align === cross && mainAlignment === main;
      return <button key={key} type="button" title={label} aria-label={label} aria-pressed={selected} disabled={disabled}
        onClick={() => {
          if (!selected) void onSave({ ...layout, align: cross, justify: packed ? main : layout.justify });
        }}><span /></button>;
    }))}
  </div>;
}

type LayoutNumbers = LayoutControls & Readonly<{ preview?: DesignLayout; numberEdits: InspectorNumberEdits }>;

function bindLayoutNumber(edits: InspectorNumberEdits, apply: (layout: DesignLayout, value: number) => DesignLayout) {
  return bindDesignNumber(edits, (node, value) => hasEditableLayout(node) ? { ...node, layout: apply(node.layout, value) } : node);
}

function LayoutSpacing({ layout, preview, spacing, disabled, onSave, numberEdits, translate: t }: LayoutNumbers & { spacing: SpacingMode }) {
  const group = useId();
  const fixed = spacing === 'fixed';
  const fixedLabel = t('feature.design.gap.fixed');
  const GapIcon = layout.direction === 'horizontal' ? ArrowLeftRight : ArrowUpDown;
  return <div className="design-inspector__spacing" role="radiogroup" aria-label={t('feature.design.distribution')}>
    <div className="design-inspector__spacing-choice">
      <input type="radio" name={group} value="fixed" checked={fixed} disabled={disabled} aria-label={fixedLabel} title={fixedLabel}
        onChange={() => { void onSave({ ...layout, justify: 'start' }); }} />
      <NumberField label={t(fixed ? 'feature.design.gap' : 'feature.design.gap.minimum')} prefix={<GapIcon size={12} />}
        value={layout.gap} previewValue={preview?.gap} min={0}
        {...bindLayoutNumber(numberEdits, (current, gap) => ({ ...current, gap }))} />
    </div>
    {distributions.map((mode) => <label key={mode} className="design-inspector__spacing-choice">
      <input type="radio" name={group} value={mode} checked={spacing === mode} disabled={disabled}
        onChange={() => { void onSave({ ...layout, justify: mode }); }} />
      {t(`feature.design.justify.${mode}`)}
    </label>)}
  </div>;
}

function LayoutPaddingFields({ layout, preview, disabled, onSave, numberEdits, translate: t }: LayoutNumbers) {
  const paired = layout.paddingSides === undefined;
  const [top, right, bottom, left] = designPadding(layout);
  const previewSides = preview ? designPadding(preview) : undefined;
  const PaddingIcon = paired ? Unlink2 : Link2;
  return <div className="design-inspector__paired-control">
    {paired ? <div className="design-inspector__pair">
      <NumberField label={t('feature.design.paddingX')} prefix={<ArrowLeftRight size={12} />} value={right} min={0}
        previewValue={previewSides?.[1]} {...bindLayoutNumber(numberEdits, (current, paddingX) => ({ ...current, paddingX }))} />
      <NumberField label={t('feature.design.paddingY')} prefix={<ArrowUpDown size={12} />} value={top} min={0}
        previewValue={previewSides?.[0]} {...bindLayoutNumber(numberEdits, (current, paddingY) => ({ ...current, paddingY }))} />
    </div> : <div className="design-inspector__pair">
      {paddingFields.map(({ side, index, icon: Icon }) => <NumberField key={side} label={t(`feature.design.padding.${side}`)}
        prefix={<Icon size={12} />} value={designPadding(layout)[index]} previewValue={previewSides?.[index]} min={0}
        {...bindLayoutNumber(numberEdits, (current, value) => {
          const paddingSides: [number, number, number, number] = [...designPadding(current)];
          paddingSides[index] = value;
          return { ...current, paddingSides };
        })} />)}
    </div>}
    <IconButton label={t(paired ? 'feature.design.padding.independent' : 'feature.design.padding.paired')}
      size="small" disabled={disabled} aria-pressed={!paired} onClick={() => {
        void onSave(paired ? { ...layout, paddingSides: designPadding(layout) }
          : { ...layout, paddingSides: undefined, paddingX: (right + left) / 2, paddingY: (top + bottom) / 2 });
      }}><PaddingIcon size={15} /></IconButton>
  </div>;
}
