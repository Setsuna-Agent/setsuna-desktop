import {
  AlignCenterHorizontal, AlignCenterVertical, AlignEndHorizontal, AlignEndVertical, AlignHorizontalDistributeCenter,
  AlignStartHorizontal, AlignStartVertical, AlignVerticalDistributeCenter, Circle, Component, Diamond, FlipHorizontal2, FlipVertical2, Frame, Group,
  ImageIcon, Monitor, PanelRightClose, PanelRightOpen, RotateCw, Smartphone, Square, Tablet, Type,
} from 'lucide-react';
import { forwardRef, useId, useImperativeHandle, useLayoutEffect, useRef, useState, type ComponentProps, type ReactNode } from 'react';
import type { RendererTranslate } from '@setsuna-desktop/feature-core/renderer';
import { Button, Checkbox, IconButton } from '@setsuna-desktop/renderer-ui';
import { maxDesignPolygonSides, minDesignPolygonSides, type DesignFrame, type DesignLayout, type DesignNode } from '../../contracts/index.js';
import { DesignComponentActions, type ComponentActions } from '../components/DesignComponentActions.js';
import { DesignInstanceFields } from '../components/DesignInstanceFields.js';
import { DesignAppearanceFields, DesignFillFields } from './DesignAppearanceFields.js';
import { DesignBatchFields } from './DesignBatchFields.js';
import { DesignImageFields } from './DesignImageFields.js';
import { InspectorField, InspectorSection, NumberField } from './DesignInspectorFields.js';
import { DesignLayoutFields, DesignSizeFields } from './DesignLayoutFields.js';
import type { DesignFillAssets } from './DesignFillPicker.js';
import { DesignTextFields } from './DesignTextFields.js';
import { placeFreeLayer, type Alignment } from '../design-canvas-edits.js';
import { bindDesignNumber, type InspectorCanvasPreview, type InspectorNumberEdits } from './design-inspector-edit.js';
import { participatesInDesignFlow, type DesignLayerBox } from '../design-layout.js';
import { DesignExportFields } from '../export/DesignExportFields.js';
import type { DesignExportRequest } from '../export/use-design-exports.js';
import { designVectorIcons } from '../vectors/design-vector-icons.js';
import { designLucideIcon } from '../vectors/design-vector.js';
import { DesignIconField } from './DesignIconField.js';
import { DesignPrototypeFields, type PrototypeFields } from '../prototype/DesignPrototypeFields.js';
import './design-inspector.css';

const alignment = [
  { id: 'left', icon: AlignStartVertical }, { id: 'centerX', icon: AlignCenterVertical }, { id: 'right', icon: AlignEndVertical },
  { id: 'top', icon: AlignStartHorizontal }, { id: 'centerY', icon: AlignCenterHorizontal }, { id: 'bottom', icon: AlignEndHorizontal },
  { id: 'distributeX', icon: AlignHorizontalDistributeCenter }, { id: 'distributeY', icon: AlignVerticalDistributeCenter },
] as const;
const presets = [
  { id: 'phone', width: 390, height: 844, icon: Smartphone },
  { id: 'tablet', width: 768, height: 1024, icon: Tablet },
  { id: 'desktop', width: 1440, height: 900, icon: Monitor },
] as const;
const kindIcons = { frame: Frame, rectangle: Square, ellipse: Circle, image: ImageIcon, text: Type };

export type ArtboardPreset = (typeof presets)[number];

type InspectorSelection = Readonly<{ id: string; node: DesignNode; projectedNode: DesignNode; box: DesignLayerBox; parent?: DesignFrame }>;
type SaveNode = (node: DesignNode) => Promise<boolean>;
type ImageActions = Pick<ComponentProps<typeof DesignImageFields>, 'cropping' | 'onReplace' | 'onToggleCrop'>;
type LayoutAdjustment = ComponentProps<typeof DesignLayoutFields>['adjustment'];
type InstanceActions = Pick<ComponentProps<typeof DesignInstanceFields>, 'entries' | 'onContent' | 'onReplaceImage'>;
type BatchActions = Pick<ComponentProps<typeof DesignBatchFields>, 'layers' | 'onSave' | 'onPreview'>;

export type DesignInspectorHandle = Readonly<{ preview(value: InspectorCanvasPreview | undefined): void }>;

type InspectorProps = Readonly<{
  selection?: InspectorSelection;
  selectedCount: number;
  revision: string;
  numbersBusy: boolean;
  open: boolean;
  canAlign: boolean;
  canDistribute: boolean;
  disabled: boolean;
  components: ComponentActions;
  numberEdits: InspectorNumberEdits;
  imageActions: ImageActions;
  fillAssets: DesignFillAssets;
  layoutAdjustment?: LayoutAdjustment;
  pathActions?: LayoutAdjustment;
  instanceActions?: InstanceActions;
  prototype?: PrototypeFields;
  batch: BatchActions;
  exportDisabled: boolean;
  onTogglePanel(): void;
  onExport(request: DesignExportRequest): void;
  onSave: SaveNode;
  onPaintPreview(node: DesignNode | undefined): void;
  onLayoutChange(layout: DesignLayout | undefined): Promise<boolean>;
  onAlign(alignment: Alignment): void;
  onAddPreset(preset: ArtboardPreset): void;
  translate: RendererTranslate;
}>;

export const DesignInspector = forwardRef<DesignInspectorHandle, InspectorProps>(function DesignInspector({
  selection, selectedCount, revision, numbersBusy, open, canAlign, canDistribute, disabled, components, numberEdits,
  imageActions, fillAssets, layoutAdjustment, pathActions, instanceActions, prototype, batch, exportDisabled, onTogglePanel, onExport,
  onSave, onPaintPreview, onLayoutChange, onAlign, onAddPreset, translate: t,
}, ref) {
  const panelId = useId();
  const scroll = useRef<HTMLDivElement>(null);
  const [preview, setPreview] = useState<InspectorCanvasPreview>();
  useImperativeHandle(ref, () => ({ preview: setPreview }), []);
  useLayoutEffect(() => { if (scroll.current) scroll.current.scrollTop = 0; }, [open, selection?.id, selectedCount]);

  const alignmentControls = canAlign ? <InspectorSection title={t('feature.design.align')}>
    <div className={`design-inspector__alignment${canDistribute ? '' : ' design-inspector__alignment--six'}`}
      role="group" aria-label={t('feature.design.align')}>
      {alignment.map(({ id, icon: Icon }) => {
        if (!canDistribute && id.startsWith('distribute')) return null;
        return <IconButton key={id} size="small" label={t(`feature.design.align.${id}`)}
          disabled={disabled}
          onClick={() => onAlign(id)}><Icon size={16} /></IconButton>;
      })}
    </div>
  </InspectorSection> : null;
  const locked = Boolean(selection?.box.locked);
  const panelPreview = preview?.id === selection?.id && preview?.revision === revision ? preview : undefined;
  const { canCreate, onCreate, ...componentReuse } = components;
  const PanelToggle = open ? PanelRightClose : PanelRightOpen;
  return <aside className="design-editor__inspector" aria-label={t('feature.design.properties')}>
    <header className="design-panel__header">
      {open && (selection
        ? <LayerIdentity key={selection.id} {...selection} readOnly={disabled || locked} onSave={onSave} translate={t} />
        : <h2>{t(selectedCount ? 'feature.design.properties' : 'feature.design.artboardPresets')}</h2>)}
      <IconButton className="design-panel__toggle" label={t('feature.design.properties')} size="small"
        aria-expanded={open} aria-controls={panelId} onClick={onTogglePanel}><PanelToggle size={15} /></IconButton>
    </header>
    <div className="design-inspector design-panel-scroll" id={panelId} ref={scroll} hidden={!open}>
      {open ? <>
        {canCreate ? <div className="design-inspector__component-actions">
          <Button size="small" variant="ghost" disabled={disabled} icon={<Component size={15} />} onClick={onCreate}>
            {t('feature.design.createComponent')}
          </Button>
        </div> : null}
        {!selectedCount ? <div className="design-inspector__section">
          <div className="design-inspector__presets">
            {presets.map((preset) => {
              const Icon = preset.icon;
              const label = t(`feature.design.preset.${preset.id}`);
              const name = `${label} · ${preset.width} × ${preset.height}`;
              return <Button key={preset.id} variant="ghost" size="small" disabled={disabled} data-device={preset.id}
                icon={<Icon size={22} strokeWidth={1.65} />} aria-label={name} title={name} onClick={() => onAddPreset(preset)}>
                <span>{label}</span>
              </Button>;
            })}
          </div>
        </div> : null}
        {selection ? <fieldset key={selection.id} disabled={locked || (disabled && !numbersBusy)} className="design-inspector__fields">
          <LayerFields {...selection} preview={panelPreview} alignmentControls={alignmentControls} translate={t}
            disabled={disabled || locked} onSave={onSave} numberEdits={numberEdits} onPaintPreview={onPaintPreview}
            imageActions={imageActions} fillAssets={fillAssets} layoutAdjustment={layoutAdjustment} pathActions={pathActions}
            instanceActions={instanceActions} onLayoutChange={onLayoutChange} />
          {prototype ? <DesignPrototypeFields {...prototype} disabled={disabled || locked} translate={t} /> : null}
        </fieldset> : selectedCount > 1 ? <><DesignBatchFields {...batch} disabled={disabled} translate={t} />{alignmentControls}</> : null}
        <DesignComponentActions {...componentReuse} disabled={disabled} translate={t} />
        {selectedCount ? <DesignExportFields disabled={exportDisabled} onExport={onExport} translate={t} /> : null}
      </> : null}
    </div>
  </aside>;
});

function LayerIdentity({ node, box, onSave, readOnly, translate: t }: InspectorSelection & Readonly<{
  readOnly: boolean;
  onSave: SaveNode;
  translate: RendererTranslate;
}>) {
  const isComponent = node.kind === 'frame' && node.component;
  const linked = node.kind === 'frame' && node.instanceOf;
  const isGroup = node.kind === 'frame' && node.group;
  const Icon = isComponent ? Component : linked ? Diamond : isGroup ? Group
    : node.kind === 'vector' ? designVectorIcons[node.geometry.kind] : kindIcons[node.kind];
  const kind = isComponent ? 'component' : linked ? 'instance' : isGroup ? 'group' : node.kind === 'frame' && box.parentId === null ? 'artboard'
    : node.kind === 'vector' ? (designLucideIcon(node.geometry) ? 'icon' : node.geometry.kind) : node.kind;
  const kindName = t(`feature.design.${kind}`);
  return <div className="design-inspector__identity">
    <span className="design-inspector__kind" title={kindName}><Icon size={15} /></span>
    <InspectorField label={t('feature.design.name')} value={node.name ?? ''} placeholder={kindName} readOnly={readOnly}
      onSave={(name) => onSave({ ...node, name: name.trim() })} />
  </div>;
}

function LayerFields({ id, node, projectedNode, box, parent, preview, disabled, onSave, numberEdits, onPaintPreview, onLayoutChange,
  imageActions, fillAssets, layoutAdjustment, pathActions, instanceActions, alignmentControls, translate: t }: InspectorSelection & Readonly<{
  preview?: InspectorCanvasPreview;
  disabled: boolean;
  onSave: SaveNode;
  numberEdits: InspectorNumberEdits;
  onPaintPreview(node: DesignNode | undefined): void;
  onLayoutChange(layout: DesignLayout | undefined): Promise<boolean>;
  alignmentControls: ReactNode;
  imageActions: ImageActions;
  fillAssets: DesignFillAssets;
  layoutAdjustment?: LayoutAdjustment;
  pathActions?: LayoutAdjustment;
  instanceActions?: InstanceActions;
  translate: RendererTranslate;
}>) {
  const flows = parent?.layout && participatesInDesignFlow(node, id, parent);
  const frame = node.kind === 'frame' && !node.instanceOf ? node : undefined;
  const icon = node.kind === 'vector' ? designLucideIcon(node.geometry) : undefined;
  const sizeControls = <DesignSizeFields node={node} projectedNode={projectedNode} box={box} preview={preview} parent={parent?.maskId === id ? undefined : parent}
    disabled={disabled} translate={t} onSave={onSave} numberEdits={numberEdits} />;
  const fill = <fieldset className="design-inspector__fields" disabled={disabled}>
    <DesignFillFields node={node} disabled={disabled} assets={fillAssets} onSave={onSave} onPaintPreview={onPaintPreview} translate={t} />
  </fieldset>;
  return <>
    {frame ? <DesignLayoutFields frame={frame} preview={preview?.layout} sizeControls={sizeControls} adjustment={layoutAdjustment}
      disabled={disabled} translate={t} onLayoutChange={onLayoutChange} numberEdits={numberEdits} /> : null}
    {node.kind === 'text' ? <>
      <DesignTextFields node={node} projected={projectedNode.kind === 'text' ? projectedNode : node}
        disabled={disabled} onSave={onSave} numberEdits={numberEdits} translate={t} />
      {fill}
    </> : null}
    {node.kind === 'image' ? <DesignImageFields node={node} {...imageActions} preview={preview?.crop}
      disabled={disabled} onSave={onSave} numberEdits={numberEdits} translate={t} /> : null}
    {node.kind === 'frame' && instanceActions ? <DesignInstanceFields instance={node} {...instanceActions}
      disabled={disabled} translate={t} /> : null}
    {node.kind === 'vector' && node.geometry.kind === 'polygon' ? <InspectorSection title={t('feature.design.polygon')}>
      <NumberField label={t('feature.design.polygonSides')} value={node.geometry.sides} min={minDesignPolygonSides} max={maxDesignPolygonSides}
        onSave={(sides) => Number.isInteger(sides) ? onSave({ ...node, geometry: { kind: 'polygon', sides } }) : Promise.resolve(false)} />
    </InspectorSection> : null}
    {node.kind === 'vector' && icon ? <DesignIconField node={node} icon={icon} onSave={onSave} disabled={disabled} translate={t} /> : null}
    {pathActions ? <div className="design-inspector__section">
      <Button variant="secondary" size="small" aria-pressed={pathActions.active} disabled={disabled}
        icon={<designVectorIcons.path size={14} />} onClick={pathActions.toggle}>{t('feature.design.editPath')}</Button>
    </div> : null}
    <InspectorSection title={t('feature.design.transform')}>
      {!flows ? <div className="design-inspector__pair">
        <NumberField label="X" value={node.x} previewValue={preview?.x}
          {...bindDesignNumber(numberEdits, (current, x) => ({ ...current, x }))} />
        <NumberField label="Y" value={node.y} previewValue={preview?.y}
          {...bindDesignNumber(numberEdits, (current, y) => ({ ...current, y }))} />
      </div> : null}
      {frame ? null : sizeControls}
      <div className="design-inspector__pair">
        <NumberField label={t('feature.design.rotation')} prefix="∠" value={node.rotation ?? 0} previewValue={preview?.rotation}
          {...bindDesignNumber(numberEdits, (current, degrees) => {
            const angle = degrees % 360;
            return { ...current, rotation: angle >= 180 ? angle - 360 : angle < -180 ? angle + 360 : angle };
          })} />
        <div className="design-inspector__segments" role="group" aria-label={t('feature.design.transform')}>
          <IconButton label={t('feature.design.rotateQuarter')} size="small" disabled={disabled}
            onClick={() => { void onSave({ ...node, rotation: (node.rotation ?? 0) + 90 }); }}><RotateCw size={14} /></IconButton>
          <IconButton label={t('feature.design.flipHorizontal')} size="small" disabled={disabled} aria-pressed={Boolean(node.flipX)}
            onClick={() => { void onSave({ ...node, flipX: !node.flipX }); }}><FlipHorizontal2 size={14} /></IconButton>
          <IconButton label={t('feature.design.flipVertical')} size="small" disabled={disabled} aria-pressed={Boolean(node.flipY)}
            onClick={() => { void onSave({ ...node, flipY: !node.flipY }); }}><FlipVertical2 size={14} /></IconButton>
        </div>
      </div>
      {parent?.layout ? <Checkbox checked={Boolean(node.absolute)} disabled={disabled} onChange={(absolute) => {
        void onSave({ ...(absolute ? placeFreeLayer(node, box, box.x, box.y) : node), absolute });
      }}>{t('feature.design.absolute')}</Checkbox> : null}
    </InspectorSection>
    {alignmentControls}
    {node.kind !== 'text' ? fill : null}
    <fieldset className="design-inspector__fields" disabled={disabled}>
      <DesignAppearanceFields node={node} opacity={projectedNode.opacity} disabled={disabled}
        onSave={onSave} onPaintPreview={onPaintPreview} translate={t} />
    </fieldset>
  </>;
}
