import { Circle, Group, Line, Rect, Text } from 'react-konva';
import type { DesignDocument } from '../contracts/index.js';
import { layerTransform, toWorld, unionBounds, unreflect, type Bounds } from './design-geometry.js';
import type { DesignScene } from './design-layout.js';
import { designTextFont } from './design-text.js';
import { designAnchors, type LayerPlacements } from './use-design-canvas-gestures.js';

export const designSelectionColor = '#3d99ff';
export const designSelectionLabelColor = '#2376cc';

export function DesignCanvasSelection({ document, scene, ids, placements, scale, handles, outlineOpacity = 1 }: Readonly<{
  document: DesignDocument;
  scene: DesignScene;
  ids: readonly string[];
  placements?: LayerPlacements;
  scale: number;
  handles: boolean;
  outlineOpacity?: number;
}>) {
  const visible = ids.filter((id) => scene[id]?.visible && scene[id].visibleBounds);
  const selected = visible.length === 1 ? visible[0] : null;
  const aggregate = !placements && visible.length > 1 ? unionBounds(visible.map((id) => scene[id].paintBounds)) : undefined;
  const sw = 1 / scale;
  const outlineWidth = 2 / scale;
  return <>
    {aggregate ? <Rect {...aggregate} stroke={designSelectionColor} strokeWidth={outlineWidth}
      dash={[4 * sw, 4 * sw]} opacity={outlineOpacity} listening={false} /> : null}
    {visible.map((id) => {
      const node = document.nodes[id];
      const box = scene[id];
      const move = placements?.[id];
      const width = move?.width ?? box.width;
      const height = move?.height ?? box.height;
      const parent = box.parentId ? scene[box.parentId] : undefined;
      const pose = move ? layerTransform({ x: move.x, y: move.y, width, height }, { ...node, rotation: move.rotation ?? node.rotation }, parent) : box;
      const single = selected === id && !box.locked && handles;
      const showAnchors = single && Math.min(width, height) * scale >= 12;
      const textOnly = node.kind === 'text';
      return <Group key={id} x={pose.absoluteX} y={pose.absoluteY} rotation={pose.angle} scaleX={pose.scaleX} scaleY={pose.scaleY}>
        <Rect width={width} height={height} stroke={designSelectionColor} strokeWidth={aggregate ? sw : outlineWidth}
          opacity={outlineOpacity * (aggregate ? 0.64 : 1)} listening={false} />
        {showAnchors ? designAnchors.map((anchor, index) => {
            if (textOnly && (!anchor.x || anchor.y)) return null;
            const size = 7 * sw;
            const x = (anchor.x + 1) * width / 2 - size / 2;
            const y = (anchor.y + 1) * height / 2 - size / 2;
            return <Rect key={index} name={`design-anchor-${index}`} x={x} y={y} width={size} height={size}
              cornerRadius={1.5 * sw} fill="#fff" stroke={designSelectionColor} strokeWidth={sw} hitStrokeWidth={8 * sw} />;
        }) : null}
        {single ? <Group {...unreflect(width, height, pose)}>
          {showAnchors && node.kind !== 'web' ? <>
            <Line points={[width / 2, -sw, width / 2, -18 * sw]} stroke={designSelectionColor} strokeWidth={sw} listening={false} />
            <Circle name="design-rotate" x={width / 2} y={-21 * sw} radius={4 * sw} fill="#ffffff"
              stroke={designSelectionColor} strokeWidth={sw} hitStrokeWidth={10 * sw} />
          </> : null}
          <DimensionTag width={width} height={height} scale={scale} />
        </Group> : null}
      </Group>;
    })}
  </>;
}

export function DimensionTag({ width, height, scale, label = `${Math.round(width)} × ${Math.round(height)}` }:
  Readonly<{ width: number; height: number; scale: number; label?: string }>) {
  const size = (label.length * 7 + 12) / scale;
  return <Group x={(width - size) / 2} y={height + 8 / scale} listening={false}>
    <Rect width={size} height={19 / scale} cornerRadius={5 / scale} fill={designSelectionLabelColor} />
    <Text text={label} width={size} height={19 / scale} align="center" verticalAlign="middle" fill="#fff"
      fontFamily={designTextFont} fontSize={11 / scale} />
  </Group>;
}

export function drawingPreview(bounds: Bounds, parent: DesignScene[string] | undefined) {
  return { ...toWorld(parent, bounds), rotation: parent?.angle ?? 0, scaleX: parent?.scaleX ?? 1, scaleY: parent?.scaleY ?? 1 };
}
