import { Contrast, SquareDashed, Unlink2 } from 'lucide-react';
import { useContext, useState, type ReactNode } from 'react';
import type { RendererTranslate } from '@setsuna-desktop/feature-core/renderer';
import { Checkbox, ColorPicker, IconButton, SelectField, type PickerColor } from '@setsuna-desktop/renderer-ui';
import { designColorWithAlpha, designDefaultColor, splitDesignColor } from '../../contracts/design-color.js';
import { maxDesignFills, maxDesignStrokes, type DesignFill, type DesignNode, type DesignPaint, type DesignStroke } from '../../contracts/index.js';
import { resolveDesignPaintStyles } from '../../contracts/design-styles.js';
import { bindDesignVariable, designCornerVariableFields, resolveDesignVariableTarget } from '../../contracts/design-variables.js';
import { designInspectorPopoverPosition, InspectorGroup, InspectorSection, PaintToggle, VisibilityButton } from './DesignInspectorFields.js';
import { PaintField, ReadOnlyPaintSwatch } from './DesignPaintField.js';
import type { Bounds } from '../design-geometry.js';
import { defaultDesignStroke, defaultDesignStrokeJoin, designFills, hasDesignCorners } from '../design-paint.js';
import { DesignPaintStack } from './DesignPaintStack.js';
import { DesignPaintPicker, type DesignPaintAssets, type GradientControls } from './DesignPaintPicker.js';
import { designGradientPaintSpace, type DesignGradientTarget } from '../styles/design-gradient-geometry.js';
import { designGradientFor } from '../styles/DesignGradientSession.js';
import { designColorStyle, DesignStyleContext, DesignStyleSelect, type DesignStyleChoice } from '../styles/DesignStyleSelect.js';
import { DesignVariableField, VariableNumberField } from '../styles/DesignVariableField.js';
import { bindDesignNumber, bindDesignText, bindDesignValue, designOptionEdits, previewDesignNode, type InspectorFieldEdits } from './design-inspector-edit.js';

const strokeAlignments = ['inside', 'center', 'outside'] as const;
const strokeJoins = ['miter', 'round', 'bevel'] as const;
type SaveNode = (node: DesignNode) => Promise<boolean>;
type EditPaint<T> = (node: DesignNode, apply: (paint: T) => T) => DesignNode;
type PaintCallbacks = Readonly<{
  onSave: SaveNode;
  onPaintPreview(node: DesignNode | undefined): void;
  fieldEdits: InspectorFieldEdits;
}>;
type AppearanceFieldsProps = PaintCallbacks & Readonly<{
  node: DesignNode;
  layer?: Readonly<{ id: string; node: DesignNode; box: Bounds }>;
  disabled: boolean;
  assets: DesignPaintAssets;
  translate: RendererTranslate;
}>;

export function DesignAppearanceFields({ node, layer, opacity, hidden: projectedHidden, disabled, assets, onSave, onPaintPreview, fieldEdits, translate: t }: AppearanceFieldsProps & Readonly<{
  opacity?: number;
  hidden?: boolean;
}>) {
  const linked = node.kind === 'frame' && Boolean(node.instanceOf);
  const cornerNode = !linked && hasDesignCorners(node) ? node : undefined;
  const binding = { target: node, disabled, translate: t, onBind: onSave, onBindPreview: previewDesignNode(fieldEdits) };
  const opacityLabel = t('feature.design.opacity');
  const paintProps = { node, layer, assets, disabled, onSave, onPaintPreview, fieldEdits, translate: t };

  return <>
    <InspectorSection title={t('feature.design.appearance')}>
      <InspectorGroup title={opacityLabel}>
        <div className="design-inspector__paired-control">
          <VariableNumberField {...binding} field="opacity" factor={100} label={opacityLabel} prefix={<Contrast size={12} />} suffix="%"
            value={(opacity ?? node.opacity ?? 1) * 100} min={0} max={100} sliderMax={100}
            {...bindDesignNumber(fieldEdits, (current, value) => ({ ...current, opacity: value / 100 }))} />
          <DesignVariableField {...binding} field="hidden" label={t('feature.design.hideLayer')}>
            {(value, bound) => {
              const hidden = Boolean(value ?? projectedHidden ?? node.hidden);
              return <VisibilityButton visible={!hidden} disabled={disabled || bound}
                label={t(hidden ? 'feature.design.showLayer' : 'feature.design.hideLayer')}
                onToggle={() => { void onSave({ ...node, hidden: !hidden }); }} />;
            }}
          </DesignVariableField>
        </div>
      </InspectorGroup>
      {cornerNode ? <InspectorGroup title={t('feature.design.cornerRadius')}>
        <CornerFields node={cornerNode} box={layer?.box} disabled={disabled} onSave={onSave} fieldEdits={fieldEdits} translate={t} />
      </InspectorGroup> : null}
      {!linked && node.kind === 'frame' ? <DesignVariableField {...binding} target={node} field="clip" label={t('feature.design.clip')}>
        {(value, bound) => <Checkbox checked={(value ?? node.clip) !== false} disabled={disabled || bound}
          onChange={(clip) => { void onSave({ ...node, clip }); }}>{t('feature.design.clip')}</Checkbox>}
      </DesignVariableField> : null}
    </InspectorSection>
    <DesignFillFields {...paintProps} />
    {!linked ? <DesignStrokeStack {...paintProps} /> : null}
  </>;
}

export function DesignEffectFields(props: AppearanceFieldsProps) {
  const { node, disabled, onSave, fieldEdits, translate: t } = props;
  if (node.kind === 'frame' && node.instanceOf) return null;
  const { shadow } = node;
  const effects = node.kind === 'web' || node.kind === 'script';
  const shadowLabel = t('feature.design.shadow');
  const shadowFields = shadow ? <>
    <PaintRow {...props} label={shadowLabel} value={shadow} defaultOpacity={0.38} assets={undefined}
      actions={<PaintToggle enabled disabled={disabled} label={t('feature.design.removeShadow')}
        onToggle={() => { void onSave({ ...node, shadow: undefined }); }} />}
      editPaint={editShadow} />
    <ShadowNumberFields shadow={shadow} disabled={disabled} fieldEdits={fieldEdits} translate={t}
      onSave={(next) => onSave({ ...node, shadow: next })} />
  </> : null;
  return <InspectorSection title={effects ? t('feature.design.effects') : shadowLabel}
    action={shadow ? undefined : <PaintToggle enabled={false} disabled={disabled} label={t('feature.design.addShadow')}
      onToggle={() => { void onSave({ ...node, shadow: { color: designDefaultColor, blur: 12, x: 0, y: 4 } }); }} />}>
    {effects && shadowFields ? <InspectorGroup title={shadowLabel}>{shadowFields}</InspectorGroup> : shadowFields}
  </InspectorSection>;
}

const editShadow: EditPaint<NonNullable<DesignNode['shadow']>> = (node, apply) => node.shadow ? { ...node, shadow: apply(node.shadow) } : node;

function ShadowNumberFields({ shadow, disabled, onSave, fieldEdits, translate: t }: Readonly<{
  shadow: NonNullable<DesignNode['shadow']>; disabled: boolean;
  onSave(shadow: NonNullable<DesignNode['shadow']>): Promise<boolean>; fieldEdits: InspectorFieldEdits; translate: RendererTranslate;
}>) {
  const binding = { target: shadow, disabled, onBind: onSave, translate: t,
    onBindPreview: bindDesignValue(fieldEdits, (node, next: typeof shadow) => editShadow(node, () => next)).onPreview };
  const bind = (field: 'x' | 'y' | 'blur') => bindDesignNumber(fieldEdits,
    (node, value) => editShadow(node, (paint) => ({ ...paint, [field]: value })));
  return <>
    <div className="design-inspector__pair">
      {(['x', 'y'] as const).map((field) => <VariableNumberField {...binding} key={field} field={field} label={field.toUpperCase()} value={shadow[field]}
        {...bind(field)} />)}
    </div>
    <VariableNumberField {...binding} field="blur" label={t('feature.design.blur')} value={shadow.blur} min={0}
      {...bind('blur')} />
  </>;
}

function controlsForGradient(layer: AppearanceFieldsProps['layer'], stack: DesignGradientTarget['stack'], index: number): GradientControls | undefined {
  if (!layer) return;
  const target = { layerId: layer.id, stack, index };
  if (!designGradientFor(layer.node, target)) return;
  return { target, bounds: designGradientPaintSpace(layer.node, layer.box, target).bounds };
}

function DesignFillFields({ node, layer, disabled, assets, onSave, onPaintPreview, fieldEdits, translate: t }: AppearanceFieldsProps) {
  if (node.kind === 'image' || (node.kind === 'frame' && node.instanceOf)) return null;
  const fills = designFills(node);
  const withFills = (next: readonly DesignFill[]) => ({ ...node, fills: next });
  const save = (next: readonly DesignFill[]) => onSave(withFills(next));
  const label = t('feature.design.fill');
  function renderFill(fill: DesignFill, index: number) {
    return <PaintRow label={label} node={node} value={fill} disabled={disabled} translate={t} assets={assets} allowShader
      gradientControls={controlsForGradient(layer, 'fills', index)}
      editPaint={(current, apply) => {
        const stack = designFills(current);
        return stack[index] ? { ...current, fills: stack.map((paint, at) => at === index ? apply(paint) : paint) } : current;
      }} onSave={onSave} onPaintPreview={onPaintPreview} fieldEdits={fieldEdits}
      actions={<PaintToggle enabled disabled={disabled} label={t('feature.design.removeFill')}
        onToggle={() => { void save(fills.filter((_, at) => at !== index)); }} />} />;
  }
  return <InspectorSection title={label}
    action={<PaintToggle enabled={false} disabled={disabled || fills.length >= maxDesignFills} label={t('feature.design.addFill')}
      onToggle={() => { void save([...fills, { color: designDefaultColor }]); }} />}>
    <DesignPaintStack entries={fills} disabled={disabled} label={t('feature.design.reorderFill')} onSave={save}
      onPreview={(next) => onPaintPreview(next && withFills(next))} renderEntry={renderFill} />
  </InspectorSection>;
}

function DesignStrokeStack({ node, layer, disabled, assets, onSave, onPaintPreview, fieldEdits, translate: t }: AppearanceFieldsProps) {
  const strokes = node.strokes ?? [];
  const withStrokes = (next: readonly DesignStroke[]) => ({ ...node, strokes: next.length ? next : undefined });
  const save = (next: readonly DesignStroke[]) => onSave(withStrokes(next));
  return <InspectorSection title={t('feature.design.stroke')}
    action={<PaintToggle enabled={false} disabled={disabled || strokes.length >= maxDesignStrokes} label={t('feature.design.addStroke')}
      onToggle={() => { void save([...strokes, defaultDesignStroke]); }} />}>
    <DesignPaintStack entries={strokes} disabled={disabled} label={t('feature.design.reorderStroke')} onSave={save}
      onPreview={(next) => onPaintPreview(next && withStrokes(next))} renderEntry={(stroke, index) => <StrokeFields
        node={node} stroke={stroke} disabled={disabled} assets={assets} translate={t}
        onSave={onSave} onPaintPreview={onPaintPreview} fieldEdits={fieldEdits}
        gradientControls={controlsForGradient(layer, 'strokes', index)}
        editPaint={(current, apply) => {
          const stack = current.strokes;
          return stack?.[index] ? { ...current, strokes: stack.map((paint, at) => at === index ? apply(paint) : paint) } : current;
        }}
        onRemove={() => { void save(strokes.filter((_, at) => at !== index)); }} />} />
  </InspectorSection>;
}

function CornerFields({ node, box = node, disabled, onSave, fieldEdits, translate: t }: Readonly<{
  node: Extract<DesignNode, { kind: 'frame' | 'rectangle' | 'web' }>;
  box?: Pick<Bounds, 'width' | 'height'>;
  disabled: boolean;
  onSave: SaveNode;
  fieldEdits: InspectorFieldEdits;
  translate: RendererTranslate;
}>) {
  const { styles } = useContext(DesignStyleContext);
  const { cornerRadii, cornerRadius = 0 } = node;
  const current = resolveDesignVariableTarget(node, styles);
  const binding = { target: node, disabled, onBind: onSave, translate: t, onBindPreview: previewDesignNode(fieldEdits) };
  const corners = ['topLeft', 'topRight', 'bottomRight', 'bottomLeft'] as const;
  const sliderMax = Math.min(200, Math.ceil(Math.min(box.width, box.height) / 2));
  return <div className="design-inspector__paired-control">
    {cornerRadii ? <div className="design-inspector__pair">
      {corners.map((corner, index) => <VariableNumberField {...binding} key={corner} field={designCornerVariableFields[index]}
        label={t(`feature.design.corner.${corner}`)} prefix={['↖', '↗', '↘', '↙'][index]} value={cornerRadii[index]} min={0}
        {...bindDesignNumber(fieldEdits, (node, value) => {
          if (!hasDesignCorners(node) || !node.cornerRadii) return node;
          const next: [number, number, number, number] = [...node.cornerRadii];
          next[index] = value;
          return { ...node, cornerRadii: next };
        })} />)}
    </div> : <VariableNumberField {...binding} field="cornerRadius" label={t('feature.design.cornerRadius')} prefix={<SquareDashed size={12} />}
        value={cornerRadius} min={0} sliderMax={sliderMax}
        {...bindDesignNumber(fieldEdits, (node, value) => hasDesignCorners(node) ? { ...node, cornerRadius: value } : node)} />}
    <IconButton size="small" label={t(cornerRadii ? 'feature.design.corner.uniform' : 'feature.design.corner.independent')}
      disabled={disabled} aria-pressed={Boolean(cornerRadii)} onClick={() => {
        if (cornerRadii) {
          const id = node.variableIds?.[designCornerVariableFields[0]];
          const shared = designCornerVariableFields.every((field) => node.variableIds?.[field] === id) ? id : undefined;
          const next = designCornerVariableFields.reduce((value, field) => bindDesignVariable(value, field, undefined), node);
          void onSave(bindDesignVariable({ ...next, cornerRadii: undefined }, 'cornerRadius', shared, current.cornerRadii?.[0] ?? cornerRadii[0]));
        } else {
          const next = bindDesignVariable({ ...node, cornerRadii: [cornerRadius, cornerRadius, cornerRadius, cornerRadius] as const }, 'cornerRadius', undefined);
          void onSave(designCornerVariableFields.reduce((value, field) => bindDesignVariable(value, field, node.variableIds?.cornerRadius), next));
        }
      }}><Unlink2 size={15} /></IconButton>
  </div>;
}

function StrokeFields({ node, stroke, disabled, assets, gradientControls, onSave, onPaintPreview, fieldEdits, editPaint, onRemove, translate: t }: PaintCallbacks & Readonly<{
  node: DesignNode;
  stroke: DesignStroke;
  disabled: boolean;
  assets: DesignPaintAssets;
  gradientControls?: GradientControls;
  editPaint: EditPaint<DesignStroke>;
  onRemove(): void;
  translate: RendererTranslate;
}>) {
  const canAlignStroke = node.kind !== 'text' && node.kind !== 'vector';
  const save = (next: DesignStroke) => onSave(editPaint(node, () => next));
  const previewBinding = bindDesignValue(fieldEdits, (node, next: DesignStroke) => editPaint(node, () => next)).onPreview;
  return <>
    <PaintRow label={t('feature.design.stroke')} node={node} value={stroke} disabled={disabled} translate={t} assets={assets} gradientControls={gradientControls}
      actions={<PaintToggle enabled disabled={disabled} label={t('feature.design.removeStroke')} onToggle={onRemove} />}
      editPaint={editPaint} onSave={onSave} onPaintPreview={onPaintPreview} fieldEdits={fieldEdits} />
    <div className="design-inspector__stroke-options">
      {canAlignStroke ? <SelectField aria-label={t('feature.design.strokeAlignment')} title={t('feature.design.strokeAlignment')}
        value={stroke.alignment ?? 'center'} disabled={disabled}
        {...designOptionEdits(strokeAlignments, bindDesignValue(fieldEdits,
          (node, alignment) => editPaint(node, (current) => ({ ...current, alignment }))))}>
        {strokeAlignments.map((option) => <option key={option} value={option}>{t(`feature.design.strokeAlignment.${option}`)}</option>)}
      </SelectField> : null}
      <VariableNumberField target={stroke} field="width" disabled={disabled} onBind={save} onBindPreview={previewBinding} translate={t}
        label={t('feature.design.strokeWidth')} prefix="W" value={stroke.width} min={0.01}
        {...bindDesignNumber(fieldEdits, (node, width) => editPaint(node, (current) => ({ ...current, width })))} />
      {node.kind !== 'ellipse' ? <SelectField aria-label={t('feature.design.strokeJoin')} title={t('feature.design.strokeJoin')}
        value={stroke.join ?? defaultDesignStrokeJoin(node)} disabled={disabled}
        {...designOptionEdits(strokeJoins, bindDesignValue(fieldEdits, (node, join) => editPaint(node, (current) => ({ ...current, join }))))}>
        {strokeJoins.map((option) => <option key={option} value={option}>{t(`feature.design.strokeJoin.${option}`)}</option>)}
      </SelectField> : null}
    </div>
  </>;
}

function PaintRow<T extends DesignPaint>({ label, node, value, defaultOpacity = 1, disabled, editPaint, onSave, onPaintPreview, fieldEdits, actions,
  assets, gradientControls, allowShader, translate: t }: PaintCallbacks & Readonly<{
  label: string;
  node: DesignNode;
  value: T;
  defaultOpacity?: number;
  disabled: boolean;
  editPaint: EditPaint<T>;
  actions: ReactNode;
  assets?: DesignPaintAssets;
  allowShader?: boolean;
  gradientControls?: GradientControls;
  translate: RendererTranslate;
}>) {
  const { styles } = useContext(DesignStyleContext);
  const [draft, setDraft] = useState<{ source: T; paint: T; owner?: string }>();
  const shared = designColorStyle(styles, value.styleId);
  const color = shared?.color ?? value.color;
  const kindLabel = value.shader?.assetPath.split('/').at(-1)
    ?? (value.image ? t('feature.design.image') : value.gradient ? t(`feature.design.fillType.${value.gradient.kind}`) : undefined);
  const sourceName = !kindLabel && value.styleId ? shared?.name ?? t('feature.design.unavailableStyle') : undefined;
  const opacity = resolveDesignVariableTarget(value, styles).opacity ?? defaultOpacity;
  const active = draft?.source === value ? draft : undefined;
  const previewPaint = active?.paint;
  const previewColorValue = previewPaint?.styleId && previewPaint.styleId === value.styleId ? color : previewPaint?.color;
  const display = previewPaint ? { ...previewPaint, color: previewColorValue ?? color } : value;
  const displayOpacity = display.opacity !== value.opacity ? display.opacity ?? defaultOpacity : opacity;
  const withPaint = (next: T) => editPaint(node, () => next);
  const save = (next: T) => onSave(withPaint(next));
  const previewBinding = bindDesignValue(fieldEdits, (node, paint: T) => editPaint(node, () => paint)).onPreview;
  function showDraft(next: T | undefined, owner?: string) {
    setDraft((current) => next ? { source: value, paint: next, owner } : current?.owner === owner ? undefined : current);
  }
  function preview(next: T | undefined) {
    showDraft(next);
    onPaintPreview(next && withPaint(next));
  }
  function withPickedColor(next: PickerColor): T {
    const base = splitDesignColor(color);
    const recolored = next.color.toLowerCase() !== base.color.toLowerCase();
    const paint = recolored ? { ...value, color: designColorWithAlpha(next.color, base.opacity) } : value;
    return next.opacity === opacity ? paint : bindDesignVariable(paint, 'opacity', undefined, next.opacity);
  }
  const previewColor = (next: PickerColor | undefined) => preview(next && sourceName === undefined ? withPickedColor(next) : undefined);
  const saveColor = (next: PickerColor) => sourceName === undefined ? save(withPickedColor(next)) : Promise.resolve(false);
  const hexEdits = bindDesignText(fieldEdits, (node, color) => editPaint(node, (paint) => ({ ...paint, color })));
  const opacityEdits = bindDesignNumber(fieldEdits, (node, opacity) => editPaint(node, (paint) => ({ ...paint, opacity: opacity / 100 })));
  const colorLink = bindDesignValue(fieldEdits, (node, { id, style }: DesignStyleChoice) =>
    editPaint(node, (paint) => ({ ...paint, styleId: id, color: style?.kind === 'color' ? style.color : color })));
  const swatch = assets ? <DesignPaintPicker paint={value} display={resolveDesignPaintStyles({ ...display, opacity: displayOpacity }, styles)}
    color={color} opacity={opacity} label={label} disabled={disabled} assets={assets} gradientControls={gradientControls} allowShader={allowShader} translate={t}
    onColorPreview={previewColor} onColorCommit={saveColor} onPreview={preview} onSave={save} />
    : sourceName !== undefined ? <ReadOnlyPaintSwatch value={color} opacity={displayOpacity} />
    : <ColorPicker label={label} value={active?.owner ? display.color : color} opacity={active?.owner ? displayOpacity : opacity}
      disabled={disabled} {...designInspectorPopoverPosition}
      onColorPreview={previewColor} onColorCommit={saveColor} />;
  return <div className="design-inspector__paint-row">
    <PaintField label={label} value={color} displayName={kindLabel ?? sourceName} swatch={swatch} disabled={disabled}
      preview={active?.owner || previewColorValue === color ? undefined : previewColorValue} onSave={hexEdits.onSave}
      onDraft={(color, owner) => {
        showDraft(color === undefined ? undefined : { ...value, color }, owner);
        hexEdits.onDraft(color, owner);
      }}
      link={!kindLabel ? <DesignStyleSelect kind="color" value={value.styleId} disabled={disabled} compact translate={t}
        onPreview={colorLink.onPreview} onChange={(choice) => { void colorLink.onSave(choice); }} /> : null}
      opacityField={<VariableNumberField target={value} field="opacity" disabled={disabled} onBind={save} onBindPreview={previewBinding} translate={t} factor={100}
        label={t('feature.design.paintOpacity', { paint: label })} suffix="%"
        value={opacity * 100} previewValue={!active?.owner && displayOpacity !== opacity ? displayOpacity * 100 : undefined} min={0} max={100}
        onSave={opacityEdits.onSave} onPreview={(opacity, owner) => {
          showDraft(opacity === undefined ? undefined : { ...value, opacity: opacity / 100 }, owner);
          opacityEdits.onPreview(opacity, owner);
        }} />} />
    <div className="design-inspector__paint-actions">
      <VisibilityButton visible={!value.hidden} disabled={disabled}
        label={t(value.hidden ? 'feature.design.showPaint' : 'feature.design.hidePaint', { paint: label })}
        onToggle={() => { void save({ ...value, hidden: !value.hidden }); }} />
      {actions}
    </div>
  </div>;
}
