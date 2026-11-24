import {
  AlignCenterHorizontal, AlignCenterVertical, AlignEndHorizontal, AlignEndVertical, AlignHorizontalDistributeCenter,
  AlignStartHorizontal, AlignStartVertical, AlignVerticalDistributeCenter, Circle, CodeXml, Component, Diamond, FlipHorizontal2, FlipVertical2, Frame, Globe, Group,
  ImageIcon, LayoutGrid, RotateCw, Square, Type,
} from 'lucide-react';
import { forwardRef, useImperativeHandle, useLayoutEffect, useRef, useState, type ComponentProps, type ReactNode } from 'react';
import type { RendererTranslate } from '@setsuna-desktop/feature-core/renderer';
import { Button, Checkbox, Disclosure, IconButton } from '@setsuna-desktop/renderer-ui';
import { maxDesignPolygonSides, minDesignPolygonSides, type DesignFrame, type DesignLayout, type DesignNode } from '../../contracts/index.js';
import { DesignSidePanel } from '../canvas/DesignSidePanels.js';
import { DesignComponentActions, type ComponentActions } from '../components/DesignComponentActions.js';
import { DesignInstanceFields } from '../components/DesignInstanceFields.js';
import { DesignAppearanceFields, DesignEffectFields } from './DesignAppearanceFields.js';
import { DesignBatchFields, type BatchLayer } from './DesignBatchFields.js';
import { DesignImageFields } from './DesignImageFields.js';
import { InspectorField, InspectorGroup, InspectorSection, InspectorTextArea, NumberField } from './DesignInspectorFields.js';
import { maxDesignContextLength } from '../../contracts/design-content-source.js';
import { DesignLayoutFields, DesignSizeFields } from './DesignLayoutFields.js';
import type { DesignPaintAssets } from './DesignPaintPicker.js';
import { DesignTextFields } from './DesignTextFields.js';
import { bindDesignVariable, normalizeDesignRotation } from '../../contracts/design-variables.js';
import { VariableNumberField } from '../styles/DesignVariableField.js';
import { placeFreeLayer, type Alignment } from '../design-canvas-edits.js';
import { bindDesignNumber, bindDesignText, previewDesignNode, type InspectorCanvasPreview, type InspectorFieldEdits } from './design-inspector-edit.js';
import { participatesInDesignFlow, type DesignLayerBox } from '../design-layout.js';
import { DesignExportFields } from '../export/DesignExportFields.js';
import type { DesignExportRequest } from '../export/use-design-exports.js';
import { designVectorIcons } from '../vectors/design-vector-icons.js';
import { designLucideIcon } from '../vectors/design-vector.js';
import { measureDesignSegment, reshapeDesignSegment, type DesignSegment, type DesignSegmentMeasurements } from '../vectors/design-path-edit.js';
import { DesignIconField } from './DesignIconField.js';
import { DesignPrototypeFields, type PrototypeFields } from '../prototype/DesignPrototypeFields.js';
import './design-inspector.css';

const alignmentGroups = [
  [
    { id: 'left', icon: AlignStartVertical }, { id: 'centerX', icon: AlignCenterVertical }, { id: 'right', icon: AlignEndVertical },
    { id: 'distributeX', icon: AlignHorizontalDistributeCenter },
  ], [
    { id: 'top', icon: AlignStartHorizontal }, { id: 'centerY', icon: AlignCenterHorizontal }, { id: 'bottom', icon: AlignEndHorizontal },
    { id: 'distributeY', icon: AlignVerticalDistributeCenter },
  ],
] as const;
const kindIcons = { frame: Frame, rectangle: Square, ellipse: Circle, image: ImageIcon, text: Type, web: Globe, script: CodeXml };

type InspectorSelection = Readonly<{
  id: string; node: DesignNode; projectedNode: DesignNode; box: DesignLayerBox; parent?: DesignFrame; parentBox?: DesignLayerBox;
}>;
type SaveNode = (node: DesignNode) => Promise<boolean>;
type ImageActions = Pick<ComponentProps<typeof DesignImageFields>, 'cropping' | 'onReplace' | 'onToggleCrop'>;
type LayoutAdjustment = ComponentProps<typeof DesignLayoutFields>['adjustment'];
type InstanceActions = Pick<ComponentProps<typeof DesignInstanceFields>, 'entries' | 'onContent' | 'onReplaceImage'>;

export type DesignInspectorHandle = Readonly<{ preview(value: InspectorCanvasPreview | undefined): void }>;

type InspectorProps = Readonly<{
  selection?: InspectorSelection;
  selectedCount: number;
  revision: string;
  canAlign: boolean;
  canDistribute: boolean;
  disabled: boolean;
  components: ComponentActions;
  fieldEdits: InspectorFieldEdits;
  imageActions: ImageActions;
  paintAssets: DesignPaintAssets;
  layoutAdjustment?: LayoutAdjustment;
  pathActions?: LayoutAdjustment;
  instanceActions?: InstanceActions;
  prototype?: PrototypeFields;
  boardModes?: ReactNode;
  contentSource?: ReactNode;
  onAddLayout?(): void;
  batch: readonly BatchLayer[];
  exportDisabled: boolean;
  onClose(): void;
  onExport(request: DesignExportRequest): void;
  onSave: SaveNode;
  onPaintPreview(node: DesignNode | undefined): void;
  onLayoutChange(layout: DesignLayout | undefined): Promise<boolean>;
  onAlign(alignment: Alignment): void;
  translate: RendererTranslate;
}>;

export const DesignInspector = forwardRef<DesignInspectorHandle, InspectorProps>(function DesignInspector({
  selection, selectedCount, revision, canAlign, canDistribute, disabled, components, fieldEdits,
  imageActions, paintAssets, layoutAdjustment, pathActions, instanceActions, prototype, boardModes, contentSource, onAddLayout, batch, exportDisabled, onClose, onExport,
  onSave, onPaintPreview, onLayoutChange, onAlign, translate: t,
}, ref) {
  const scroll = useRef<HTMLDivElement>(null);
  const [preview, setPreview] = useState<InspectorCanvasPreview>();
  useImperativeHandle(ref, () => ({ preview: setPreview }), []);
  useLayoutEffect(() => { if (scroll.current) scroll.current.scrollTop = 0; }, [selection?.id, selectedCount]);

  const alignLabel = t('feature.design.align');
  const contentLayer = selection?.node.kind === 'web' || selection?.node.kind === 'script';
  const alignmentControls = canAlign || contentLayer ? <div className="design-inspector__pair" role="group" aria-label={alignLabel}>
    {alignmentGroups.map((group) => <div key={group[0].id} className="design-inspector__segments">
      {group.map(({ id, icon: Icon }) => {
        if (!canDistribute && id.startsWith('distribute')) return null;
        return <IconButton key={id} size="small" label={t(`feature.design.align.${id}`)}
          disabled={disabled || !canAlign}
          onClick={() => onAlign(id)}><Icon size={16} /></IconButton>;
      })}
    </div>)}
  </div> : null;
  const locked = Boolean(selection?.box.locked);
  const panelPreview = preview?.id === selection?.id && preview?.revision === revision ? preview : undefined;
  const { canCreate, onCreate, ...componentReuse } = components;
  return <DesignSidePanel side="inspector" label={t('feature.design.properties')} resizeLabel={t('feature.design.resizeProperties')}
    actions={canCreate ? <IconButton size="small" label={t('feature.design.createComponent')} disabled={disabled} onClick={onCreate}>
      <Component size={15} />
    </IconButton> : undefined}
    collapse={{ label: t('feature.design.collapseProperties'), onClick: onClose }}
    title={selection ? <LayerIdentity key={selection.id} {...selection} readOnly={disabled || locked} fieldEdits={fieldEdits} translate={t} /> : undefined}>
    <div className="design-panel-scroll" ref={scroll}>
      <div className="design-inspector">
        {selection ? <fieldset key={selection.id} disabled={locked || disabled} className="design-inspector__fields">
          {boardModes}
          <LayerFields {...selection} revision={revision} preview={panelPreview} alignmentControls={alignmentControls} translate={t}
            disabled={disabled || locked} onSave={onSave} fieldEdits={fieldEdits} onPaintPreview={onPaintPreview}
            imageActions={imageActions} paintAssets={paintAssets} layoutAdjustment={layoutAdjustment} pathActions={pathActions}
            instanceActions={instanceActions} onLayoutChange={onLayoutChange} onAddLayout={onAddLayout} contentSource={contentSource} />
          {prototype ? <DesignPrototypeFields {...prototype} disabled={disabled || locked} translate={t} /> : null}
        </fieldset> : selectedCount > 1 ? <>
          {alignmentControls ? <InspectorSection title={alignLabel}>{alignmentControls}</InspectorSection> : null}
          <DesignBatchFields key={batch.map(({ id }) => id).join(' ')} layers={batch} fieldEdits={fieldEdits} disabled={disabled} translate={t} />
        </> : null}
        <DesignComponentActions {...componentReuse} disabled={disabled} translate={t} />
        <DesignExportFields disabled={exportDisabled} onExport={onExport} translate={t} />
      </div>
    </div>
  </DesignSidePanel>;
});

function LayerIdentity({ node, box, fieldEdits, readOnly, translate: t }: InspectorSelection & Readonly<{
  readOnly: boolean;
  fieldEdits: InspectorFieldEdits;
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
    <span className="design-inspector__kind" title={kindName}><Icon size={14} /></span>
    <InspectorField label={t('feature.design.name')} value={node.name ?? ''} placeholder={kindName} readOnly={readOnly}
      {...bindDesignText(fieldEdits, (node, name) => ({ ...node, name: name.trim() }))} />
  </div>;
}

function LayerFields({ id, node, projectedNode, box, parent, parentBox, preview, revision, disabled, onSave, fieldEdits, onPaintPreview, onLayoutChange, onAddLayout, contentSource,
  imageActions, paintAssets, layoutAdjustment, pathActions, instanceActions, alignmentControls, translate: t }: InspectorSelection & Readonly<{
  preview?: InspectorCanvasPreview;
  revision: string;
  disabled: boolean;
  onSave: SaveNode;
  fieldEdits: InspectorFieldEdits;
  onPaintPreview(node: DesignNode | undefined): void;
  onLayoutChange(layout: DesignLayout | undefined): Promise<boolean>;
  onAddLayout?(): void;
  contentSource?: ReactNode;
  alignmentControls: ReactNode;
  imageActions: ImageActions;
  paintAssets: DesignPaintAssets;
  layoutAdjustment?: LayoutAdjustment;
  pathActions?: LayoutAdjustment;
  instanceActions?: InstanceActions;
  translate: RendererTranslate;
}>) {
  const flows = parent?.layout && participatesInDesignFlow(projectedNode, id, parent);
  const frame = node.kind === 'frame' && !node.instanceOf ? node : undefined;
  const contentLayer = node.kind === 'web' || node.kind === 'script';
  const icon = node.kind === 'vector' ? designLucideIcon(node.geometry) : undefined;
  const segment = measureDesignSegment(projectedNode, box);
  const sizeControls = segment ? null : <DesignSizeFields node={node} projectedNode={projectedNode} box={box} preview={preview}
    parent={parent?.maskId === id ? undefined : parent} disabled={disabled} translate={t} onSave={onSave} fieldEdits={fieldEdits} />;
  const rotationLabel = t('feature.design.rotation');
  const binding = { target: node, onBind: onSave, disabled, translate: t, onBindPreview: previewDesignNode(fieldEdits) };
  const appearance = { node, layer: { id, box, node: projectedNode }, disabled, assets: paintAssets, onSave, onPaintPreview, fieldEdits, translate: t };
  const rotationActions = <div className="design-inspector__segments" role="group" aria-label={rotationLabel}>
    <IconButton label={t('feature.design.rotateQuarter')} size="small" disabled={disabled}
      onClick={() => { void onSave(bindDesignVariable(node, 'rotation', undefined, normalizeDesignRotation((projectedNode.rotation ?? 0) + 90))); }}>
      <RotateCw size={14} />
    </IconButton>
    <IconButton label={t('feature.design.flipHorizontal')} size="small" disabled={disabled} aria-pressed={Boolean(node.flipX)}
      onClick={() => { void onSave({ ...node, flipX: !node.flipX }); }}><FlipHorizontal2 size={14} /></IconButton>
    <IconButton label={t('feature.design.flipVertical')} size="small" disabled={disabled} aria-pressed={Boolean(node.flipY)}
      onClick={() => { void onSave({ ...node, flipY: !node.flipY }); }}><FlipVertical2 size={14} /></IconButton>
  </div>;
  return <>
    {contentLayer ? <Disclosure className="design-inspector__section design-inspector__context"
      title={<h3>{t('feature.design.layerContext')}</h3>} defaultOpen={Boolean(node.context)}>
      <InspectorTextArea aria-label={t('feature.design.layerContext')} value={node.context ?? ''} rows={3}
        maxLength={maxDesignContextLength} readOnly={disabled}
        onSave={(value) => onSave({ ...node, context: value.trim() ? value : undefined })} />
    </Disclosure> : null}
    <InspectorSection title={t('feature.design.transform')}>
      {alignmentControls ? <InspectorGroup title={t('feature.design.align')}>{alignmentControls}</InspectorGroup> : null}
      {!flows ? <div className="design-inspector__pair">
        {(['x', 'y'] as const).map((axis) => <VariableNumberField key={axis} {...binding} field={axis}
          label={axis.toUpperCase()} value={node[axis]} previewValue={preview?.[axis]}
          {...bindDesignNumber(fieldEdits, (current, value) => ({ ...current, [axis]: value }))} />)}
      </div> : null}
      {segment ? <>
        <SegmentFields segment={segment} box={box} parentBox={parentBox} inFlow={Boolean(flows)}
          preview={preview?.segment} disabled={disabled} fieldEdits={fieldEdits} translate={t} />
        {rotationActions}
      </> : <InspectorGroup title={rotationLabel}>
        <div className="design-inspector__pair">
          <VariableNumberField {...binding} field="rotation" label={rotationLabel} prefix="∠" suffix="°"
            value={node.rotation ?? 0} previewValue={preview?.rotation}
            {...bindDesignNumber(fieldEdits, (current, degrees) => ({ ...current, rotation: normalizeDesignRotation(degrees) }))} />
          {rotationActions}
        </div>
      </InspectorGroup>}
      {frame || contentLayer || !sizeControls ? null : <InspectorGroup title={t('feature.design.size')}>{sizeControls}</InspectorGroup>}
      {parent?.layout ? <Checkbox checked={Boolean(node.absolute)} disabled={disabled} onChange={(absolute) => {
        void onSave({ ...(absolute ? placeFreeLayer(node, box, box.x, box.y) : node), absolute });
      }}>{t('feature.design.absolute')}</Checkbox> : null}
    </InspectorSection>
    {frame ? <DesignLayoutFields frame={frame} preview={preview?.layout} sizeControls={sizeControls} adjustment={layoutAdjustment}
      disabled={disabled} translate={t} onLayoutChange={onLayoutChange} fieldEdits={fieldEdits} /> : null}
    {contentLayer ? <InspectorSection title={t('feature.design.layout')}
      action={<IconButton size="small" label={t('feature.design.addAutoLayout')} disabled={disabled || !onAddLayout}
        onClick={onAddLayout}><LayoutGrid size={15} /></IconButton>}>
      <InspectorGroup title={t('feature.design.size')}>{sizeControls}</InspectorGroup>
    </InspectorSection> : null}
    {node.kind === 'text' ? <DesignTextFields node={node} projected={projectedNode.kind === 'text' ? projectedNode : node}
      disabled={disabled} onSave={onSave} fieldEdits={fieldEdits} translate={t} /> : null}
    {node.kind === 'image' ? <DesignImageFields node={node} {...imageActions} revision={revision} imageAssets={paintAssets} preview={preview?.crop}
      disabled={disabled} onSave={onSave} fieldEdits={fieldEdits} translate={t} /> : null}
    {node.kind === 'frame' && instanceActions ? <DesignInstanceFields instance={node} {...instanceActions} revision={revision} imageAssets={paintAssets}
      disabled={disabled} fieldEdits={fieldEdits} translate={t} /> : null}
    {node.kind === 'vector' && node.geometry.kind === 'polygon' ? <InspectorSection title={t('feature.design.polygon')}>
      <VariableNumberField {...binding} field="geometry.sides" label={t('feature.design.polygonSides')}
        value={node.geometry.sides} integer min={minDesignPolygonSides} max={maxDesignPolygonSides}
        {...bindDesignNumber(fieldEdits, (node, sides) => node.kind === 'vector' && node.geometry.kind === 'polygon'
          ? { ...node, geometry: { ...node.geometry, sides } } : node)} />
    </InspectorSection> : null}
    {node.kind === 'vector' && icon ? <DesignIconField node={node} icon={icon} onSave={onSave}
      fieldEdits={fieldEdits} disabled={disabled} translate={t} /> : null}
    {pathActions ? <div className="design-inspector__section">
      <Button variant="secondary" size="small" aria-pressed={pathActions.active} disabled={disabled}
        icon={<designVectorIcons.path size={14} />} onClick={pathActions.toggle}>{t('feature.design.editPath')}</Button>
    </div> : null}
    <DesignAppearanceFields {...appearance} opacity={projectedNode.opacity} hidden={projectedNode.hidden} />
    {contentSource}
    <DesignEffectFields {...appearance} />
  </>;
}

function SegmentFields({ segment, box, parentBox, inFlow, preview, disabled, fieldEdits, translate: t }: Readonly<{
  segment: DesignSegment;
  box: DesignLayerBox;
  parentBox?: DesignLayerBox;
  inFlow: boolean;
  preview?: DesignSegmentMeasurements;
  disabled: boolean;
  fieldEdits: InspectorFieldEdits;
  translate: RendererTranslate;
}>) {
  const length = t('feature.design.segment.length');
  const angle = t('feature.design.segment.angle');
  const edit = (key: keyof DesignSegmentMeasurements) => bindDesignNumber(fieldEdits, (node, value) =>
    reshapeDesignSegment(node, segment, box, parentBox, inFlow, { [key]: value }));
  return <div className="design-inspector__pair">
    <NumberField label={length} prefix={length} suffix="px" value={segment.length} previewValue={preview?.length}
      min={0.01} readOnly={disabled} {...edit('length')} />
    <NumberField label={angle} prefix={angle} suffix="°" value={segment.angle} previewValue={preview?.angle}
      readOnly={disabled} {...edit('angle')} />
  </div>;
}
