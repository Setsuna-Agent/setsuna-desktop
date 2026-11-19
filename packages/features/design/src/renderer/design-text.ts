import Konva from 'konva';
import type { DesignText } from '../contracts/index.js';
import type { MeasureDesignText } from './design-layout.js';
import { layoutRichDesignText } from './text/design-rich-text.js';
import { designCanvasTextStyle } from './text/design-typography.js';

export { designCanvasTextStyle, designFontStack, designTextFont, designTextStyle } from './text/design-typography.js';

export function createPlainDesignText(node: DesignText, width?: number) {
  return new Konva.Text({ ...designCanvasTextStyle(node), text: node.text, width });
}

export const measureDesignText: MeasureDesignText = (node, maxWidth) => {
  if (node.runs?.length) return layoutRichDesignText(node, maxWidth);
  const text = createPlainDesignText(node, maxWidth);
  const width = Math.max(1, Math.min(maxWidth ?? Infinity, Math.ceil(text.getTextWidth())));
  const size = { width, height: Math.max(node.fontSize * text.lineHeight(), text.height()) };
  text.destroy();
  return size;
};
