import { useMemo } from 'react';
import { Text } from 'react-konva';
import type { DesignStroke, DesignText } from '../../contracts/index.js';
import type { LayerPaint } from '../design-paint.js';
import { designCanvasTextStyle } from '../design-text.js';
import { designCanvasFills, designCanvasPaintLayers, type DesignPaintImages } from '../styles/design-gradients.js';
import { layoutRichDesignText } from './design-rich-text.js';

export function DesignCanvasText({ node, width, height, paint, outlines, images }: Readonly<{
  node: DesignText; width: number; height: number; paint: LayerPaint; outlines: readonly DesignStroke[]; images: DesignPaintImages;
}>) {
  const rich = useMemo(() => node.runs?.length ? layoutRichDesignText(node, width) : undefined, [node, width]);
  if (!rich) {
    const fills = designCanvasFills(node, { x: 0, y: 0, width, height }, images);
    const typography = designCanvasTextStyle(node);
    return designCanvasPaintLayers(fills, paint, outlines).map((layer, index) =>
      <Text key={index} width={width} text={node.text} listening={false} {...typography} {...layer} />);
  }
  return rich.pieces.flatMap(({ text, style, color, x, y }, part) => {
    const { textAlign: _align, fontWeight, ...typography } = style;
    const fills = color ? [{ fill: color }] : designCanvasFills(node, { x: -x, y: -y, width, height }, images);
    return designCanvasPaintLayers(fills, paint, outlines).map((layer, index) =>
      <Text key={`${part}:${index}`} x={x} y={y} text={text} listening={false} wrap="none"
        fontStyle={String(fontWeight)} {...typography} {...layer} />);
  });
}
