import {
  ArrowDownToLine, ArrowLeftRight, ArrowRightToLine, ArrowUpDown, ChevronsLeftRight, ChevronsRightLeft, Link2,
  PanelBottom, PanelLeft, PanelRight, PanelTop, SquareDashed, SquareDashedMousePointer, Unlink2, WrapText,
} from 'lucide-react';
import { useContext, type ReactNode } from 'react';
import type { RendererTranslate } from '@setsuna-desktop/feature-core/renderer';
import { IconButton, SelectField } from '@setsuna-desktop/renderer-ui';
import type { DesignFrame, DesignLayout, DesignNode, DesignSizeMode } from '../../contracts/index.js';
import { bindDesignVariable, designPaddingVariableFields, resolveDesignVariableTarget, validDesignWidthLimits } from '../../contracts/design-variables.js';
import { DesignArtboardPresetPicker } from './DesignArtboardPresetPicker.js';
import { InspectorField, InspectorGroup, InspectorSection, NumberField } from './DesignInspectorFields.js';
import { bindDesignNumber, bindDesignText, bindDesignValue, previewDesignNode, type InspectorFieldEdits } from './design-inspector-edit.js';
import { hasEditableLayout } from '../design-layout-adjustment.js';
import { designPadding, designSizeMode, designSizeModes, type DesignAxis, type DesignLayerBox } from '../design-layout.js';
import { DesignVariableField, VariableNumberField } from '../styles/DesignVariableField.js';
import { DesignStyleContext } from '../styles/DesignStyleSelect.js';

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
const widthLimitFields = [
  { field: 'minWidth', icon: ChevronsRightLeft }, { field: 'maxWidth', icon: ChevronsLeftRight },
] as const;
const paddingFields = [
  { side: 'left', index: 3, icon: PanelLeft }, { side: 'right', index: 1, icon: PanelRight },
  { side: 'top', index: 0, icon: PanelTop }, { side: 'bottom', index: 2, icon: PanelBottom },
] as const;

type SaveNode = (node: DesignNode) => Promise<boolean>;
type SaveLayout = (layout: DesignLayout) => Promise<boolean>;
type SpacingMode = 'fixed' | (typeof distributions)[number];

export function DesignSizeFields({ node, projectedNode, box, preview, parent, disabled, onSave, fieldEdits, translate: t }: Readonly<{
  node: DesignNode;
  projectedNode: DesignNode;
  box: DesignLayerBox;
  preview?: Readonly<{ width: number; height: number }>;
  parent?: DesignFrame;
  disabled: boolean;
  onSave: SaveNode;
  fieldEdits: InspectorFieldEdits;
  translate: RendererTranslate;
}>) {
  const artboard = node.kind === 'frame' && box.parentId === null && !node.group && !node.component && !node.instanceOf;
  const showUnavailableFill = node.kind === 'web' || node.kind === 'script';
  const presetEdits = bindDesignValue(fieldEdits, (current, { width, height }: Pick<DesignFrame, 'width' | 'height'>) =>
    current.kind === 'frame' ? { ...current, width, height, widthMode: 'fixed', heightMode: 'fixed' } : current);
  const previewNode = previewDesignNode(fieldEdits);
  const widthLimits = { minWidth: projectedNode.minWidth, maxWidth: projectedNode.maxWidth };

  function saveSizeMode(axis: DesignAxis, mode: DesignSizeMode) {
    return onSave({ ...bindDesignVariable(node, axis, undefined, Math.max(0.01, box[axis])), [`${axis}Mode`]: mode });
  }

  return <div className="design-inspector__size-fields" role="group" aria-label={t('feature.design.size')}>
    {artboard ? <DesignArtboardPresetPicker translate={t}
      disabled={disabled || Boolean(node.variableIds?.width || node.variableIds?.height)}
      onPreview={presetEdits.onPreview} onPick={(preset) => { void presetEdits.onSave(preset); }} /> : null}
    {sizeAxes.map((axis) => {
      const mode = designSizeMode(projectedNode, parent, axis);
      const modes = designSizeModes(projectedNode, parent, axis);
      const options: readonly DesignSizeMode[] = showUnavailableFill && !modes.includes('fill') ? [...modes, 'fill'] : modes;
      const readOnly = mode !== 'fixed' || (axis === 'height' && node.kind === 'text');
      const field = {
        label: t(`feature.design.${axis}`), prefix: axis === 'width' ? 'W' : 'H', value: box[axis], min: 0.01,
        previewValue: preview?.[axis],
        ...bindDesignNumber(fieldEdits, (current, size) => axis === 'width' ? { ...current, width: size, widthMode: 'fixed' }
          : current.kind === 'text' ? current : { ...current, height: size, heightMode: 'fixed' }),
      };
      const binding = bindDesignValue(fieldEdits, (_, next: DesignNode) => ({ ...next, [`${axis}Mode`]: 'fixed' }));
      return <div key={axis} className="design-inspector__size-axis">
        {readOnly ? <NumberField {...field} readOnly /> : <VariableNumberField {...field} target={node} field={axis}
          disabled={disabled} translate={t} onBind={binding.onSave} onBindPreview={binding.onPreview} />}
        {options.length > 1 ? <SelectField aria-label={t('feature.design.sizeMode', { axis: field.label })} value={mode} disabled={disabled}
          onValueChange={(value) => {
            const next = modes.find((option) => option === value);
            if (next && next !== mode) void saveSizeMode(axis, next);
          }}>
          {options.map((option) => <option key={option} value={option} disabled={!modes.includes(option)}>
            {t(`feature.design.sizeMode.${option}`)}
          </option>)}
        </SelectField> : null}
      </div>;
    })}
    {widthLimitFields.map(({ field: limit, icon: Icon }) => {
      const label = t(`feature.design.${limit}`);
      return <DesignVariableField key={limit} field={limit} label={label} target={node} disabled={disabled}
        onBind={onSave} onBindPreview={previewNode} translate={t}
        acceptsValue={(value) => typeof value === 'number' && validDesignWidthLimits({ ...widthLimits, [limit]: value })}>
        {(_, linked) => <InspectorField label={label} prefix={<Icon size={12} />} readOnly={disabled || linked}
          value={widthLimits[limit] === undefined ? '' : String(widthLimits[limit])} placeholder="—" type="number" step="any" min={0}
          {...bindDesignText(fieldEdits, (current, text) => {
            const size = text.trim() ? Number(text) : undefined;
            if (size !== undefined && (!Number.isFinite(size) || size < 0 || (limit === 'maxWidth' && size === 0))) return current;
            const next = { ...current, [limit]: size };
            return validDesignWidthLimits(next) && validDesignWidthLimits({ ...widthLimits, [limit]: size }) ? next : current;
          })} />}
      </DesignVariableField>;
    })}
  </div>;
}

export function DesignLayoutFields({ frame, preview, sizeControls, disabled, adjustment, onLayoutChange, fieldEdits, translate: t }: Readonly<{
  frame: DesignFrame;
  preview?: DesignLayout;
  sizeControls: ReactNode;
  disabled: boolean;
  adjustment?: Readonly<{ active: boolean; toggle(): void }>;
  onLayoutChange(layout: DesignLayout | undefined): Promise<boolean>;
  fieldEdits: InspectorFieldEdits;
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
    <div className={layout ? 'design-inspector__paired-control' : undefined}>
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
      {layout ? <DesignVariableField target={layout} field="wrap" label={t('feature.design.layout.wrap')} disabled={disabled}
        onBind={(next) => onLayoutChange(next)} onBindPreview={previewDesignLayout(fieldEdits)} translate={t}>
        {(value, linked) => <IconButton className="design-inspector__layout-wrap" size="small" label={t('feature.design.layout.wrap')}
          aria-pressed={Boolean(value ?? layout.wrap)} disabled={disabled || linked}
          onClick={() => { void onLayoutChange({ ...layout, wrap: !layout.wrap }); }}><WrapText size={15} /></IconButton>}
      </DesignVariableField> : null}
    </div>
    <InspectorGroup title={t('feature.design.size')}>{sizeControls}</InspectorGroup>
    {layout ? <>
      <div className="design-inspector__layout-controls">
        <InspectorGroup title={t('feature.design.align')}>
          <LayoutAlignment layout={shown ?? layout} spacing={spacing} disabled={disabled || Boolean(preview)} onSave={onLayoutChange} translate={t} />
        </InspectorGroup>
        <InspectorGroup title={t('feature.design.gap')}>
          <LayoutSpacing layout={layout} preview={preview} spacing={spacing} disabled={disabled || Boolean(preview)}
            onSave={onLayoutChange} fieldEdits={fieldEdits} translate={t} />
        </InspectorGroup>
      </div>
      <LayoutPaddingFields layout={layout} preview={preview} disabled={disabled || Boolean(preview)}
        onSave={onLayoutChange} fieldEdits={fieldEdits} translate={t} />
    </> : null}
  </InspectorSection>;
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

type LayoutNumbers = LayoutControls & Readonly<{ preview?: DesignLayout; fieldEdits: InspectorFieldEdits }>;

function bindLayoutValue<T>(edits: InspectorFieldEdits, apply: (layout: DesignLayout, value: T) => DesignLayout) {
  return bindDesignValue<T>(edits, (node, value) => hasEditableLayout(node) ? { ...node, layout: apply(node.layout, value) } : node);
}

function previewDesignLayout(edits: InspectorFieldEdits) {
  return bindLayoutValue(edits, (_, layout: DesignLayout) => layout).onPreview;
}

function LayoutSpacing({ layout, preview, spacing, disabled, onSave, fieldEdits, translate: t }: LayoutNumbers & { spacing: SpacingMode }) {
  const GapIcon = layout.direction === 'horizontal' ? ArrowLeftRight : ArrowUpDown;
  return <div className="design-inspector__spacing">
    <SelectField aria-label={t('feature.design.distribution')} value={spacing} disabled={disabled}
      onValueChange={(mode) => { void onSave({ ...layout, justify: distributions.find((item) => item === mode) ?? 'start' }); }}>
      <option value="fixed">{t('feature.design.gap.fixed')}</option>
      {distributions.map((mode) => <option key={mode} value={mode}>{t(`feature.design.justify.${mode}`)}</option>)}
    </SelectField>
    <VariableNumberField target={layout} field="gap" disabled={disabled} onBind={onSave} onBindPreview={previewDesignLayout(fieldEdits)} translate={t}
      label={t(spacing === 'fixed' ? 'feature.design.gap' : 'feature.design.gap.minimum')} prefix={<GapIcon size={12} />}
      value={layout.gap} previewValue={preview?.gap} min={0}
      {...bindLayoutValue<number>(fieldEdits, (current, gap) => ({ ...current, gap }))} />
  </div>;
}

function LayoutPaddingFields({ layout, preview, disabled, onSave, fieldEdits, translate: t }: LayoutNumbers) {
  const { styles } = useContext(DesignStyleContext);
  const paired = layout.paddingSides === undefined;
  const padding = designPadding(layout);
  const previewSides = preview ? designPadding(preview) : undefined;
  const PaddingIcon = paired ? Unlink2 : Link2;
  const binding = { target: layout, disabled, onBind: onSave, onBindPreview: previewDesignLayout(fieldEdits), translate: t };

  function togglePaddingMode() {
    let next: DesignLayout;
    if (paired) {
      next = { ...layout, paddingSides: padding };
      for (const [index, field] of designPaddingVariableFields.entries()) {
        next = bindDesignVariable(next, field, layout.variableIds?.[index % 2 ? 'paddingX' : 'paddingY']);
      }
      next = bindDesignVariable(bindDesignVariable(next, 'paddingX', undefined), 'paddingY', undefined);
    } else {
      const [effectiveTop, effectiveRight, effectiveBottom, effectiveLeft] = designPadding(resolveDesignVariableTarget(layout, styles));
      next = { ...layout, paddingSides: undefined, paddingX: (effectiveRight + effectiveLeft) / 2, paddingY: (effectiveTop + effectiveBottom) / 2 };
      for (const [index, axis] of (['paddingY', 'paddingX'] as const).entries()) {
        const id = layout.variableIds?.[designPaddingVariableFields[index]];
        next = bindDesignVariable(next, axis,
          id === layout.variableIds?.[designPaddingVariableFields[index + 2]] ? id : undefined);
      }
      next = designPaddingVariableFields.reduce((current, field) => bindDesignVariable(current, field, undefined), next);
    }
    void onSave(next);
  }

  return <InspectorGroup title={t('feature.design.padding')} action={<IconButton
    label={t(paired ? 'feature.design.padding.independent' : 'feature.design.padding.paired')} size="small"
    disabled={disabled} aria-pressed={!paired} onClick={togglePaddingMode}><PaddingIcon size={15} /></IconButton>}>
    <div className="design-inspector__pair">
      {paired ? <>
        <VariableNumberField {...binding} field="paddingX" label={t('feature.design.paddingX')} prefix={<ArrowLeftRight size={12} />} value={padding[1]} min={0}
          previewValue={previewSides?.[1]} {...bindLayoutValue<number>(fieldEdits, (current, paddingX) => ({ ...current, paddingX }))} />
        <VariableNumberField {...binding} field="paddingY" label={t('feature.design.paddingY')} prefix={<ArrowUpDown size={12} />} value={padding[0]} min={0}
          previewValue={previewSides?.[0]} {...bindLayoutValue<number>(fieldEdits, (current, paddingY) => ({ ...current, paddingY }))} />
      </> : paddingFields.map(({ side, index, icon: Icon }) => <VariableNumberField {...binding} field={designPaddingVariableFields[index]}
        key={side} label={t(`feature.design.padding.${side}`)}
        prefix={<Icon size={12} />} value={padding[index]} previewValue={previewSides?.[index]} min={0}
        {...bindLayoutValue<number>(fieldEdits, (current, value) => {
          const paddingSides: [number, number, number, number] = [...designPadding(current)];
          paddingSides[index] = value;
          return { ...current, paddingSides };
        })} />)}
    </div>
  </InspectorGroup>;
}
