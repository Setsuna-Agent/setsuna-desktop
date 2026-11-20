import Konva from 'konva';
import { getDummyContext } from 'konva/lib/shapes/Text.js';
import type { DesignText } from '../contracts/index.js';
import type { MeasureDesignText } from './design-layout.js';
import { layoutRichDesignText } from './text/design-rich-text.js';
import { designCanvasTextStyle, designFontStyleWeight, designTextStyle } from './text/design-typography.js';

export { designCanvasTextStyle, designFontStack, designFontStyleWeight, designTextFont, designTextStyle } from './text/design-typography.js';

export function createPlainDesignText(node: DesignText, width?: number) {
  return new Konva.Text({ ...designCanvasTextStyle(designTextStyle(node)), text: node.text, width });
}

export const measureDesignText: MeasureDesignText = (node, maxWidth) => {
  if (node.runs?.length) return layoutRichDesignText(node, maxWidth);
  const text = createPlainDesignText(node, maxWidth);
  const width = Math.max(1, Math.min(maxWidth ?? Infinity, Math.ceil(text.getTextWidth())));
  const size = { width, height: Math.max(node.fontSize * text.lineHeight(), text.height()) };
  text.destroy();
  return size;
};

type TextBaseline = Readonly<{ fromCenter: number; canvasOffset: number }>;
type TextMetricsStyle = Pick<ReturnType<typeof designTextStyle>, 'fontSize' | 'fontWeight' | 'fontFamily' | 'fontStyle'>;

export function designHanTextBaselines(text: string) {
  const glyph = text.match(/\p{Script=Han}/u)?.[0];
  if (!glyph || Konva.legacyTextRendering) return;
  const cache = new Map<string, TextBaseline | undefined>();
  return (style: TextMetricsStyle) => {
    const font = `${designFontStyleWeight(style)} ${style.fontSize}px ${style.fontFamily}`;
    if (!cache.has(font)) cache.set(font, measureHanBaseline(glyph, font));
    return cache.get(font);
  };
}

function measureHanBaseline(glyph: string, font: string): TextBaseline | undefined {
  const context = getDummyContext();
  if (!context) return;
  const previousFont = context.font;
  const previousBaseline = context.textBaseline;
  try {
    context.font = font;
    context.textBaseline = 'alphabetic';
    const { actualBoundingBoxAscent: ascent, actualBoundingBoxDescent: descent } = context.measureText(glyph);
    if (!Number.isFinite(ascent) || !Number.isFinite(descent) || ascent + descent <= 0) return;
    // The glyph bounds include browser fallback. Konva positions text using a Latin sample instead.
    const fromCenter = (ascent - descent) / 2;
    const latin = context.measureText('M');
    const konvaBaseline = (latin.fontBoundingBoxAscent - latin.fontBoundingBoxDescent) / 2;
    if (Number.isFinite(konvaBaseline)) return { fromCenter, canvasOffset: fromCenter - konvaBaseline };
  } finally {
    context.font = previousFont;
    context.textBaseline = previousBaseline;
  }
}
