import { Ellipse, Group, Rect } from 'react-konva';
import type { DesignStroke } from '../contracts/index.js';
import { designStrokePaint } from './design-paint.js';

export function DesignAlignedStroke({ stroke, width, height, radius, ellipse }: Readonly<{
  stroke: DesignStroke;
  width: number;
  height: number;
  radius: number | number[];
  ellipse: boolean;
}>) {
  if (width <= 0 || height <= 0) return null;
  const aligned = stroke.alignment === 'inside' || stroke.alignment === 'outside';
  const paint = { ...designStrokePaint(stroke), strokeWidth: aligned ? stroke.width * 2 : stroke.width, fillEnabled: false, listening: false };
  const shape = ellipse
    ? <Ellipse x={width / 2} y={height / 2} radiusX={width / 2} radiusY={height / 2} {...paint} />
    : <Rect width={width} height={height} cornerRadius={radius} {...paint} />;
  if (!aligned) return shape;
  // Clip a doubled stroke to one side of the same boundary, including elliptical and rounded outlines.
  return <Group listening={false} clipFunc={(context) => {
    context.beginPath();
    const outside = stroke.alignment === 'outside';
    if (outside) {
      const extent = stroke.width * 2;
      context.rect(-extent, -extent, width + extent * 2, height + extent * 2);
    }
    if (ellipse) {
      context.moveTo(width, height / 2);
      context.ellipse(width / 2, height / 2, width / 2, height / 2, 0, 0, Math.PI * 2);
    } else {
      context.roundRect(0, 0, width, height, radius);
    }
    return outside ? ['evenodd'] : undefined;
  }}>
    {shape}
  </Group>;
}
