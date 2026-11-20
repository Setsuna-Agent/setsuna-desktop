import { Check, ChevronDown } from 'lucide-react';
import { useMemo, useState } from 'react';
import type { RendererTranslate } from '@setsuna-desktop/feature-core/renderer';
import { Button, Popover, Slider, type PickerColor } from '@setsuna-desktop/renderer-ui';
import type { DesignFreehandStyle, DesignPaint } from '../../contracts/index.js';
import { designDefaultColor, splitDesignColor } from '../../contracts/design-color.js';
import { NumberField } from '../inspector/DesignInspectorFields.js';
import { DesignPaintPicker } from '../inspector/DesignPaintPicker.js';
import { designPathData, mapPathAnchors } from '../vectors/design-vector.js';
import {
  drawingInkTool, drawingPresets, freehandDesignNode, isFreehandTool, maxDrawingWidth, minDrawingWidth,
  type DrawingInk, type DrawingInkTool,
} from './design-drawing.js';
import './design-drawing-controls.css';

export function DesignDrawingControls({ tool, ink, disabled, onChange, translate: t }: Readonly<{
  tool: DrawingInkTool;
  ink: DrawingInk;
  disabled: boolean;
  onChange(ink: DrawingInk): void;
  translate: RendererTranslate;
}>) {
  const [preview, setPreview] = useState<{ source: DesignPaint; paint: DesignPaint }>();
  const { paint, width, preset } = ink;
  const { color, opacity } = splitDesignColor(paint.color);
  const display = preview?.source === paint ? preview.paint : paint;
  const widthLabel = t('feature.design.strokeWidth');
  const previewPaint = (next: DesignPaint | undefined) => setPreview(next ? { source: paint, paint: next } : undefined);
  const solidPaint = (next: PickerColor): DesignPaint => ({ ...paint, color: next.color, opacity: next.opacity });
  const savePaint = async (next: DesignPaint) => { setPreview(undefined); onChange({ ...ink, paint: next }); return true; };
  return <div className="design-drawing-controls" role="toolbar" aria-orientation="vertical" aria-label={t('feature.design.drawingControls')}
    onKeyDown={(event) => event.stopPropagation()}>
    <DesignPaintPicker paint={paint} display={display} color={color} opacity={opacity * (paint.opacity ?? 1)}
      label={t('feature.design.color')} disabled={disabled} placement="rightTop" translate={t}
      onColorPreview={(next) => previewPaint(next && solidPaint(next))}
      onColorCommit={(next) => savePaint(solidPaint(next))} onPreview={previewPaint} onSave={savePaint} />
    <div className="design-drawing-controls__width">
      <NumberField label={widthLabel} suffix="px" value={width} min={minDrawingWidth} max={maxDrawingWidth} readOnly={disabled}
        onSave={async (width) => { onChange({ ...ink, width }); return true; }} />
      <Slider aria-label={widthLabel} value={width} min={minDrawingWidth} max={maxDrawingWidth} step={0.5} disabled={disabled}
        onChange={(event) => onChange({ ...ink, width: event.currentTarget.valueAsNumber })} />
    </div>
    {isFreehandTool(tool) && preset ? <DrawingPresetPicker key={tool} presets={drawingPresets[tool]} selected={preset} disabled={disabled}
      onChange={(preset) => onChange({ ...ink, preset })} translate={t} /> : null}
  </div>;
}

function DrawingPresetPicker({ presets, selected, disabled, onChange, translate: t }: Readonly<{
  presets: readonly DesignFreehandStyle['preset'][];
  selected: DesignFreehandStyle['preset'];
  disabled: boolean;
  onChange(preset: DesignFreehandStyle['preset']): void;
  translate: RendererTranslate;
}>) {
  const [open, setOpen] = useState(false);
  const label = t('feature.design.drawingPreset');
  return <Popover className="design-drawing-presets" placement="rightTop" contentLabel={label} open={open} onOpenChange={setOpen}
    content={<div className="design-drawing-presets__list" role="group" aria-label={label}>
      {presets.map((preset) => <Button key={preset} size="small" className="design-drawing-presets__option"
        aria-pressed={preset === selected} onClick={() => { onChange(preset); setOpen(false); }}>
        <span>{t(`feature.design.drawingPreset.${preset}`)}</span>
        <PresetStroke preset={preset} />
        {preset === selected ? <Check size={14} aria-hidden="true" /> : null}
      </Button>)}
    </div>}>
    <Button size="small" variant="secondary" className="design-drawing-controls__preset" aria-label={label}
      title={t(`feature.design.drawingPreset.${selected}`)} disabled={disabled}>
      <PresetStroke preset={selected} />
      <ChevronDown size={13} aria-hidden="true" />
    </Button>
  </Popover>;
}

const presetSamples = [{ x: 5, y: 10 },
  ...Array.from({ length: 37 }, (_, index) => ({ x: 7 + index * 2, y: 10 - Math.sin((index + 1) / 6) * 3 }))] as const;

function PresetStroke({ preset }: Readonly<{ preset: DesignFreehandStyle['preset'] }>) {
  const stroke = useMemo(() => {
    const brush = drawingInkTool(preset) === 'brush';
    const width = brush ? 7 : 1.75;
    const node = freehandDesignNode(presetSamples, { paint: { color: designDefaultColor }, width, preset });
    const geometry = node.geometry;
    return { brush, width, data: designPathData(mapPathAnchors(geometry.anchors,
      ({ x, y }) => ({ x: node.x + node.width * x, y: node.y + node.height * y })), geometry.closed) };
  }, [preset]);
  return <svg className="design-drawing-preset-stroke" viewBox="0 0 84 20" aria-hidden="true">
    <path d={stroke.data} fill={stroke.brush ? 'currentColor' : 'none'} stroke={stroke.brush ? undefined : 'currentColor'}
      strokeWidth={stroke.brush ? undefined : stroke.width} strokeLinecap="round" strokeLinejoin="round" />
  </svg>;
}
