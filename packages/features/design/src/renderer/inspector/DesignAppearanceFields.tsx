import { Unlink2 } from 'lucide-react';
import { useContext, useState, type ReactNode } from 'react';
import type { RendererTranslate } from '@setsuna-desktop/feature-core/renderer';
import { Checkbox, ColorPicker, IconButton, SelectField, type PickerColor } from '@setsuna-desktop/renderer-ui';
import { designFrameFill, designTextFill, maxDesignFills, maxDesignStrokes, resolveDesignNodeStyles, type DesignFill, type DesignFrame,
  type DesignNode, type DesignRectangle, type DesignStroke } from '../../contracts/index.js';
import { designPaintPopoverPosition, InspectorSection, NumberField, PaintHexField, PaintToggle, QuadFields, VisibilityButton } from './DesignInspectorFields.js';
import { designFills } from '../design-paint.js';
import { DesignPaintStack } from './DesignPaintStack.js';
import { DesignFillPicker, type DesignFillAssets } from './DesignFillPicker.js';
import { DesignStyleContext, DesignStyleSelect } from '../styles/DesignStyleSelect.js';

const strokeAlignments = ['inside', 'center', 'outside'] as const;
const strokeJoins = ['miter', 'round', 'bevel'] as const;
type SaveNode = (node: DesignNode) => Promise<boolean>;
type PaintCallbacks = Readonly<{
  onSave: SaveNode;
  onPaintPreview(node: DesignNode | undefined): void;
}>;
type PaintValue = Readonly<{ color: string; styleId?: string; opacity?: number; hidden?: boolean }>;
type AppearanceFieldsProps = PaintCallbacks & Readonly<{
  node: DesignNode;
  disabled: boolean;
  translate: RendererTranslate;
}>;

export function DesignAppearanceFields({ node, opacity, disabled, onSave, onPaintPreview, translate: t }: AppearanceFieldsProps & Readonly<{
  opacity?: number;
}>) {
  const { shadow } = node;
  const linked = node.kind === 'frame' && Boolean(node.instanceOf);

  return <>
    <InspectorSection title={t('feature.design.appearance')}
      action={<VisibilityButton visible={!node.hidden} disabled={disabled}
        label={t(node.hidden ? 'feature.design.showLayer' : 'feature.design.hideLayer')}
        onToggle={() => { void onSave({ ...node, hidden: !node.hidden }); }} />}>
      <NumberField label={t('feature.design.opacity')} prefix="%" value={(opacity ?? node.opacity ?? 1) * 100} min={0} max={100}
        onSave={(value) => onSave({ ...node, opacity: value / 100 })} />
      {!linked && (node.kind === 'frame' || node.kind === 'rectangle') ? <CornerFields node={node} disabled={disabled} onSave={onSave} translate={t} /> : null}
      {!linked && node.kind === 'frame' ? <Checkbox checked={node.clip !== false} disabled={disabled}
        onChange={(clip) => { void onSave({ ...node, clip }); }}>{t('feature.design.clip')}</Checkbox> : null}
    </InspectorSection>
    {!linked ? <DesignStrokeStack node={node} disabled={disabled} translate={t} onSave={onSave} onPaintPreview={onPaintPreview} /> : null}
    {!linked ? <InspectorSection title={t('feature.design.shadow')}
      action={shadow ? undefined : <PaintToggle enabled={false} disabled={disabled} label={t('feature.design.addShadow')}
        onToggle={() => { void onSave({ ...node, shadow: { color: '#171925', blur: 12, x: 0, y: 4 } }); }} />}>
      {shadow ? <>
        <PaintRow label={t('feature.design.shadow')} value={shadow} defaultOpacity={0.38} disabled={disabled} translate={t}
          actions={<PaintToggle enabled disabled={disabled} label={t('feature.design.removeShadow')}
            onToggle={() => { void onSave({ ...node, shadow: undefined }); }} />}
          withPaint={(next) => ({ ...node, shadow: next })} onSave={onSave} onPaintPreview={onPaintPreview} />
        <div className="design-inspector__pair">
          <NumberField label="X" value={shadow.x} onSave={(x) => onSave({ ...node, shadow: { ...shadow, x } })} />
          <NumberField label="Y" value={shadow.y} onSave={(y) => onSave({ ...node, shadow: { ...shadow, y } })} />
        </div>
        <NumberField label={t('feature.design.blur')} value={shadow.blur} min={0}
          onSave={(blur) => onSave({ ...node, shadow: { ...shadow, blur } })} />
      </> : null}
    </InspectorSection> : null}
  </>;
}

export function DesignFillFields({ node, disabled, assets, onSave, onPaintPreview, translate: t }: AppearanceFieldsProps & { assets: DesignFillAssets }) {
  const { styles } = useContext(DesignStyleContext);
  if (node.kind === 'image' || (node.kind === 'frame' && node.instanceOf)) return null;
  const fills = designFills(node);
  const resolvedFills = styles ? designFills(resolveDesignNodeStyles(node, styles)) : fills;
  const withFills = (next: readonly DesignFill[]) => ({ ...node, fills: next });
  const save = (next: readonly DesignFill[]) => onSave(withFills(next));
  const label = t('feature.design.fill');
  function renderFill(fill: DesignFill, index: number) {
    const kindLabel = fill.image ? t('feature.design.imageFill') : fill.gradient ? t(`feature.design.fillType.${fill.gradient.kind}`) : undefined;
    return <PaintRow label={label} value={fill} disabled={disabled} translate={t} kindLabel={kindLabel}
      withPaint={(next) => withFills(fills.map((current, at) => at === index ? next : current))}
      onSave={onSave} onPaintPreview={onPaintPreview}
      renderPicker={({ color, display, preview, save, previewColor, saveColor }) => <DesignFillPicker
        fill={fill} display={display === fill ? resolvedFills[index] : display} color={color} label={label} disabled={disabled} assets={assets}
        onColorPreview={previewColor} onColorCommit={saveColor} onPreview={preview} onSave={save} translate={t} />}
      actions={<PaintToggle enabled disabled={disabled} label={t('feature.design.removeFill')}
        onToggle={() => { void save(fills.filter((_, at) => at !== index)); }} />} />;
  }
  return <InspectorSection title={label}
    action={<PaintToggle enabled={false} disabled={disabled || fills.length >= maxDesignFills} label={t('feature.design.addFill')}
      onToggle={() => {
        const next = fills.length ? { color: designTextFill, opacity: 0.2 } : { color: node.kind === 'text' ? designTextFill : designFrameFill };
        void save([...fills, next]);
      }} />}>
    <DesignPaintStack entries={fills} disabled={disabled} label={t('feature.design.reorderFill')} onSave={save}
      onPreview={(next) => onPaintPreview(next && withFills(next))} renderEntry={renderFill} />
  </InspectorSection>;
}

function DesignStrokeStack({ node, disabled, onSave, onPaintPreview, translate: t }: AppearanceFieldsProps) {
  const strokes = node.strokes ?? [];
  const withStrokes = (next: readonly DesignStroke[]) => ({ ...node, strokes: next.length ? next : undefined });
  const save = (next: readonly DesignStroke[]) => onSave(withStrokes(next));
  return <InspectorSection title={t('feature.design.stroke')}
    action={<PaintToggle enabled={false} disabled={disabled || strokes.length >= maxDesignStrokes} label={t('feature.design.addStroke')}
      onToggle={() => { void save([...strokes, { color: '#171925', width: 1, opacity: strokes.length ? 0.2 : undefined }]); }} />}>
    <DesignPaintStack entries={strokes} disabled={disabled} label={t('feature.design.reorderStroke')} onSave={save}
      onPreview={(next) => onPaintPreview(next && withStrokes(next))} renderEntry={(stroke, index) => <StrokeFields
        kind={node.kind} stroke={stroke} disabled={disabled} translate={t} onSave={onSave} onPaintPreview={onPaintPreview}
        withStroke={(next) => withStrokes(strokes.map((value, at) => at === index ? next : value))}
        onRemove={() => { void save(strokes.filter((_, at) => at !== index)); }} />} />
  </InspectorSection>;
}

function CornerFields({ node, disabled, onSave, translate: t }: Readonly<{
  node: DesignFrame | DesignRectangle;
  disabled: boolean;
  onSave: SaveNode;
  translate: RendererTranslate;
}>) {
  const { cornerRadii, cornerRadius = 0 } = node;
  return <div className="design-inspector__paired-control">
    {cornerRadii ? <QuadFields values={cornerRadii} prefixes={['↖', '↗', '↘', '↙']}
      labels={[t('feature.design.corner.topLeft'), t('feature.design.corner.topRight'),
        t('feature.design.corner.bottomRight'), t('feature.design.corner.bottomLeft')]}
      onSave={(values) => onSave({ ...node, cornerRadii: values })} />
      : <NumberField label={t('feature.design.cornerRadius')} prefix="◜" value={cornerRadius} min={0}
        onSave={(value) => onSave({ ...node, cornerRadius: value })} />}
    <IconButton size="small" label={t(cornerRadii ? 'feature.design.corner.uniform' : 'feature.design.corner.independent')}
      disabled={disabled} aria-pressed={Boolean(cornerRadii)} onClick={() => {
        void onSave(cornerRadii ? { ...node, cornerRadius: cornerRadii[0], cornerRadii: undefined }
          : { ...node, cornerRadii: [cornerRadius, cornerRadius, cornerRadius, cornerRadius] });
      }}><Unlink2 size={15} /></IconButton>
  </div>;
}

function StrokeFields({ kind, stroke, disabled, onSave, onPaintPreview, withStroke, onRemove, translate: t }: PaintCallbacks & Readonly<{
  kind: DesignNode['kind'];
  stroke: DesignStroke;
  disabled: boolean;
  withStroke(stroke: DesignStroke): DesignNode;
  onRemove(): void;
  translate: RendererTranslate;
}>) {
  const canAlignStroke = kind !== 'text' && kind !== 'vector';
  const save = (next: DesignStroke) => onSave(withStroke(next));
  return <>
    <PaintRow label={t('feature.design.stroke')} value={stroke} disabled={disabled} translate={t}
      actions={<PaintToggle enabled disabled={disabled} label={t('feature.design.removeStroke')} onToggle={onRemove} />}
      withPaint={withStroke} onSave={onSave} onPaintPreview={onPaintPreview} />
    <div className="design-inspector__stroke-options">
      {canAlignStroke ? <SelectField aria-label={t('feature.design.strokeAlignment')} title={t('feature.design.strokeAlignment')}
        value={stroke.alignment ?? 'center'} disabled={disabled} onValueChange={(value) => {
          const alignment = strokeAlignments.find((option) => option === value);
          if (alignment) void save({ ...stroke, alignment });
        }}>
        {strokeAlignments.map((option) => <option key={option} value={option}>{t(`feature.design.strokeAlignment.${option}`)}</option>)}
      </SelectField> : null}
      <NumberField label={t('feature.design.strokeWidth')} prefix="W" value={stroke.width} min={0.01}
        onSave={(width) => save({ ...stroke, width })} />
      {kind !== 'ellipse' ? <SelectField aria-label={t('feature.design.strokeJoin')} title={t('feature.design.strokeJoin')}
        value={stroke.join ?? (kind === 'vector' ? 'round' : 'miter')} disabled={disabled} onValueChange={(value) => {
          const join = strokeJoins.find((option) => option === value);
          if (join) void save({ ...stroke, join });
        }}>
        {strokeJoins.map((option) => <option key={option} value={option}>{t(`feature.design.strokeJoin.${option}`)}</option>)}
      </SelectField> : null}
    </div>
  </>;
}

type PaintPicker<T> = Readonly<{
  color: string; display: T;
  preview(next: T | undefined): void;
  save(next: T): Promise<boolean>;
  previewColor(paint: PickerColor | undefined): void;
  saveColor(paint: PickerColor): Promise<boolean>;
}>;

function PaintRow<T extends PaintValue>({ label, value, defaultOpacity = 1, disabled, withPaint, onSave, onPaintPreview, actions,
  kindLabel, renderPicker, translate: t }: PaintCallbacks & Readonly<{
  label: string;
  value: T;
  defaultOpacity?: number;
  disabled: boolean;
  withPaint(value: T): DesignNode;
  actions: ReactNode;
  kindLabel?: string;
  renderPicker?(props: PaintPicker<T>): ReactNode;
  translate: RendererTranslate;
}>) {
  const { styles } = useContext(DesignStyleContext);
  const [draft, setDraft] = useState<{ source: T; paint: T }>();
  const shared = value.styleId && styles && Object.hasOwn(styles, value.styleId) ? styles[value.styleId] : undefined;
  const color = shared?.kind === 'color' ? shared.color : value.color;
  const opacity = value.opacity ?? defaultOpacity;
  const previewPaint = draft?.source === value ? draft.paint : undefined;
  const previewColorValue = previewPaint?.styleId && previewPaint.styleId === value.styleId ? color : previewPaint?.color;
  const display = previewPaint ? { ...previewPaint, color: previewColorValue ?? color } : value;
  const save = (next: T) => onSave(withPaint(next));
  function preview(next: T | undefined) {
    setDraft(next ? { source: value, paint: next } : undefined);
    onPaintPreview(next && withPaint(next));
  }
  function withPickedColor(next: PickerColor): T {
    const recolored = next.color.toLowerCase() !== color.toLowerCase();
    return { ...value, opacity: next.opacity === opacity ? value.opacity : next.opacity,
      ...(recolored ? { color: next.color, styleId: undefined } : undefined) };
  }
  const previewColor = (next: PickerColor | undefined) => preview(next && withPickedColor(next));
  const saveColor = (next: PickerColor) => save(withPickedColor(next));
  return <div className="design-inspector__paint-row">
    <div className="design-inspector__paint-primary">
      <div className="design-inspector__paint-controls">
        {renderPicker ? renderPicker({ color, display, preview, save, previewColor, saveColor })
          : <ColorPicker label={label} value={color} opacity={opacity} disabled={disabled} {...designPaintPopoverPosition}
            onColorPreview={previewColor} onColorCommit={saveColor} />}
        {kindLabel ? <span className="design-inspector__paint-kind" title={kindLabel}>{kindLabel}</span>
          : <PaintHexField label={label} value={color} disabled={disabled}
            preview={previewColorValue !== color ? previewColorValue : undefined}
            onSave={(color) => save({ ...value, color, styleId: undefined })} />}
        <NumberField label={t('feature.design.paintOpacity', { paint: label })} suffix="%"
          value={opacity * 100} previewValue={display.opacity !== value.opacity ? (display.opacity ?? defaultOpacity) * 100 : undefined} min={0} max={100}
          onSave={(opacity) => save({ ...value, opacity: opacity / 100 })} />
      </div>
      {!kindLabel ? <DesignStyleSelect kind="color" value={value.styleId} disabled={disabled} compact translate={t}
        onChange={(styleId, style) => { void save({ ...value, styleId, color: style?.kind === 'color' ? style.color : color }); }} /> : null}
    </div>
    <div className="design-inspector__paint-actions">
      <VisibilityButton visible={!value.hidden} disabled={disabled}
        label={t(value.hidden ? 'feature.design.showPaint' : 'feature.design.hidePaint', { paint: label })}
        onToggle={() => { void save({ ...value, hidden: !value.hidden }); }} />
      {actions}
    </div>
  </div>;
}
