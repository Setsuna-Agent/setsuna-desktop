import { useContext, useMemo } from 'react';
import { Text } from 'react-konva';
import type { DesignStroke, DesignText } from '../../contracts/index.js';
import type { LayerPaint } from '../design-paint.js';
import { designCanvasTextStyle, designHanTextBaselines, designTextStyle } from '../design-text.js';
import { designCanvasFills, designCanvasPaintLayers, designStrokePatternRef, type CanvasShaderFill, type DesignPaintImages } from '../styles/design-gradients.js';
import { layoutRichDesignText } from './design-rich-text.js';
import { DesignFontsContext } from './use-design-fonts.js';

export function DesignCanvasText({ node, width, height, paint, outlines, images, shader }: Readonly<{
  node: DesignText; width: number; height: number; paint: LayerPaint; outlines: readonly DesignStroke[]; images: DesignPaintImages;
  shader?: CanvasShaderFill;
}>) {
  const fontRevision = useContext(DesignFontsContext)?.revision ?? 0;
  const rich = useMemo(() => node.runs?.length ? layoutRichDesignText(node, width) : undefined, [node, width, fontRevision]);
  const baselines = useMemo(() => designHanTextBaselines(node.text), [node, fontRevision]);
  if (!rich) {
    const style = designTextStyle(node);
    const y = baselines?.(style)?.canvasOffset ?? 0;
    const bounds = { x: 0, y: -y, width, height };
    const fills = designCanvasFills(node, bounds, images, shader);
    const typography = designCanvasTextStyle(style);
    return designCanvasPaintLayers(fills, paint, outlines, bounds, images).map(({ shaderRef, strokePattern, ...layer }, index) =>
      <Text key={`${fontRevision}:${index}`} ref={shaderRef?.() ?? designStrokePatternRef(strokePattern)} width={width}
        y={y} text={node.text} listening={false} {...typography} {...layer} />);
  }
  return rich.pieces.flatMap(({ text, style, color, x, y }, part) => {
    const typography = designCanvasTextStyle(style);
    const drawY = y + (baselines?.(style)?.canvasOffset ?? 0);
    const bounds = { x: -x, y: -drawY, width, height };
    const fills = color ? [{ fill: color }] : designCanvasFills(node, bounds, images, shader);
    return designCanvasPaintLayers(fills, paint, outlines, bounds, images).map(({ shaderRef, strokePattern, ...layer }, index) =>
      <Text key={`${fontRevision}:${part}:${index}`} ref={shaderRef?.() ?? designStrokePatternRef(strokePattern)} x={x} y={drawY} text={text} listening={false} wrap="none"
        {...typography} align="left" {...layer} />);
  });
}
