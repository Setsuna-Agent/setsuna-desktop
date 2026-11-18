import { Transform } from 'konva/lib/Util.js';
import { useMemo } from 'react';
import { Group, Path, Rect } from 'react-konva';
import type { DesignStroke, DesignVector, DesignVectorGeometry } from '../../contracts/index.js';
import { colorWithOpacity, type LayerPaint } from '../design-paint.js';
import { designCanvasFills, designCanvasPaintLayers, type DesignPaintImages } from '../styles/design-gradients.js';
import { designVectorPathFill, designVectorShape } from './design-vector.js';

export function DesignCanvasVector({ geometry, width, height, node, paint, outlines, images, interactive }: Readonly<{
  geometry: DesignVectorGeometry;
  width: number;
  height: number;
  node: DesignVector;
  paint: LayerPaint;
  outlines: readonly DesignStroke[];
  images: DesignPaintImages;
  interactive: boolean;
}>) {
  const shape = useMemo(() => {
    const vector = designVectorShape(geometry, width, height);
    return { ...vector, paths: vector.paths.map((path) => ({
      ...path, placement: path.transform ? new Transform([...path.transform]).decompose() : undefined,
      dash: path.dash && [...path.dash],
    })) };
  }, [geometry, width, height]);
  const { viewBox, scaleX, scaleY } = shape;
  if (scaleX <= 0 || scaleY <= 0) return null;
  const scale = Math.max(scaleX, scaleY);
  // SVG artwork can consist of disconnected outlines, so its layer bounds are selectable.
  const hitBounds = interactive && (geometry.kind === 'svg' || geometry.kind === 'icon');
  const hitInterior = interactive && (geometry.kind === 'polygon' || (geometry.kind === 'path' && geometry.closed));
  const layers = designCanvasPaintLayers(designCanvasFills(node, viewBox, images), paint, outlines);
  const frontStroke = outlines.at(-1);
  const fallbackInk = frontStroke ? colorWithOpacity(frontStroke.color, frontStroke.opacity) : paint.stroke;
  return <>
    {hitBounds ? <Rect width={width} height={height} fill="transparent" /> : null}
    <Group x={-viewBox.x * scaleX} y={-viewBox.y * scaleY} scaleX={scaleX} scaleY={scaleY}>
      {layers.flatMap((ink, layer) => shape.paths.map((path, index) => {
        const pathFill = ink.fillPriority ? undefined : designVectorPathFill(path, ink.fill ?? 'transparent', fallbackInk);
        const hasFill = ink.fillEnabled !== false && Boolean(ink.fillPriority || pathFill !== 'transparent');
        return <Path key={`${layer}:${index}`} data={path.data} {...path.placement} {...ink}
          fill={pathFill} fillEnabled={ink.fillEnabled !== false && (hasFill || hitInterior)} fillRule={path.fillRule} perfectDrawEnabled={hasFill}
          lineCap={path.lineCap ?? 'butt'} lineJoin={ink.lineJoin ?? 'round'} dash={path.dash} dashOffset={path.dashOffset}
          strokeWidth={ink.strokeWidth === undefined ? undefined : ink.strokeWidth / scale}
          shadowBlur={ink.shadowBlur === undefined ? undefined : ink.shadowBlur / scale}
          shadowOffsetX={ink.shadowOffsetX === undefined ? undefined : ink.shadowOffsetX / scaleX}
          shadowOffsetY={ink.shadowOffsetY === undefined ? undefined : ink.shadowOffsetY / scaleY} />;
      }))}
    </Group>
  </>;
}
