import { Group, Label, Rect, Tag, Text } from 'react-konva';
import type { DesignDocument } from '../contracts/index.js';
import { designSelectionColor } from './DesignCanvasSelection.js';
import { intersectBounds, type Bounds, type Point } from './design-geometry.js';
import {
  frameLayoutGap, hasEditableLayout, layoutEdges, layoutHandleAxis, layoutHandleName, layoutHandleValue, type LayoutHandle,
} from './design-layout-adjustment.js';
import type { DesignScene } from './design-layout.js';
import { designTextFont } from './design-text.js';
import type { CanvasLayoutPreview } from './use-design-canvas-gestures.js';

const handleInk = '#a7519b';
const guideTint = 'rgba(167,81,155,0.16)';

export function DesignCanvasLayoutHandles({ id, document, scene, scale, disabled, preview }: Readonly<{
  id: string;
  document: DesignDocument;
  scene: DesignScene;
  scale: number;
  disabled: boolean;
  preview?: CanvasLayoutPreview;
}>) {
  const frame = document.nodes[id];
  const box = scene[id];
  if (!hasEditableLayout(frame) || !box.visible || !box.visibleBounds || box.locked || (disabled && !preview)) return null;
  if (!preview && Math.min(box.width, box.height) * scale < 54) return null;
  const layout = preview?.layout ?? frame.layout;
  const { width, height } = box;
  const px = 1 / scale;
  const gap = frameLayoutGap(document, scene, frame, layout);
  const inset = (edge: (typeof layoutEdges)[number], limit: number) => Math.min(limit / 3, Math.max(14 * px, layoutHandleValue(layout, edge) / 2));
  const paddingPoints = {
    top: { x: width / 2, y: inset('top', height) },
    right: { x: width - inset('right', width), y: height / 2 },
    bottom: { x: width / 2, y: height - inset('bottom', height) },
    left: { x: inset('left', width), y: height / 2 },
  };
  const points: Partial<Record<LayoutHandle, Point>> = { ...paddingPoints };
  const inside = { x: 0, y: 0, width, height };
  if (gap) {
    const origin = { x: clampGrip(gap.point.x, width, px), y: clampGrip(gap.point.y, height, px) };
    const horizontal = layout.direction === 'horizontal';
    const cross = horizontal ? 'y' : 'x';
    const extent = horizontal ? height : width;
    // Slide along the gap to keep nearby padding grips reachable.
    const positions = [origin, ...[0.5, 0.25, 0.75].map((fraction) => ({ ...origin, [cross]: extent * fraction }))];
    points.gap = positions.find((point) => Object.values(paddingPoints).every((padding) =>
      Math.abs(point.x - padding.x) >= 17 * px || Math.abs(point.y - padding.y) >= 17 * px)) ?? origin;
  }
  const active = preview?.handle;
  const grip = active ? points[active] : undefined;
  const bands: Bounds[] = [];
  if (active === 'gap') {
    const band = gap && intersectBounds(inside, gap.bounds);
    if (band) bands.push(band);
  } else if (active) {
    for (const edge of layoutEdges) {
      if (layout.paddingSides ? edge !== active : layoutHandleAxis(layout, edge) !== layoutHandleAxis(layout, active)) continue;
      const amount = layoutHandleValue(layout, edge);
      bands.push(paddingBand(edge, width, height, amount));
    }
  }

  return <Group x={box.absoluteX} y={box.absoluteY} rotation={box.angle} scaleX={box.scaleX} scaleY={box.scaleY}>
    {bands.map((band, index) => <Rect key={index} {...band} fill={guideTint} listening={false} />)}
    {([...layoutEdges, 'gap'] as const).map((handle) => {
      const point = points[handle];
      if (!point || (active && active !== handle)) return null;
      const across = layoutHandleAxis(layout, handle) === 'y';
      const length = handle === 'gap' ? Math.min(22 * px, (across ? width : height) * 0.28) : 18 * px;
      const thickness = 5 * px;
      const w = across ? length : thickness;
      const h = across ? thickness : length;
      return <Rect key={handle} name={layoutHandleName(handle)} x={point.x - w / 2} y={point.y - h / 2}
        width={w} height={h} cornerRadius={thickness / 2} hitStrokeWidth={10 * px}
        fill={active === handle ? designSelectionColor : handleInk} stroke="#fff" strokeWidth={px}
        listening={!active && !disabled} />;
    })}
    {preview && grip ? <Label x={grip.x} y={grip.y - 13 * px * box.scaleY} scaleX={box.scaleX} scaleY={box.scaleY} listening={false}>
      <Tag fill={designSelectionColor} cornerRadius={5 * px} pointerDirection="down" pointerWidth={6 * px} pointerHeight={4 * px} />
      <Text text={String(preview.value)} padding={4 * px} fontSize={11 * px} fontFamily={designTextFont} fill="#fff" />
    </Label> : null}
  </Group>;
}

function clampGrip(value: number, extent: number, px: number) {
  const inset = Math.min(extent / 2, 8 * px);
  return Math.max(inset, Math.min(extent - inset, value));
}

function paddingBand(edge: Exclude<LayoutHandle, 'gap'>, width: number, height: number, amount: number): Bounds {
  const x = Math.min(width, amount);
  const y = Math.min(height, amount);
  switch (edge) {
    case 'top': return { x: 0, y: 0, width, height: y };
    case 'right': return { x: width - x, y: 0, width: x, height };
    case 'bottom': return { x: 0, y: height - y, width, height: y };
    case 'left': return { x: 0, y: 0, width: x, height };
  }
}
