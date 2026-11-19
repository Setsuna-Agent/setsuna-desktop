import type { DesignTypography } from '../../contracts/index.js';

export const designTextFont = 'system-ui, sans-serif';
const fontStacks = { system: designTextFont, sans: 'Arial, sans-serif', serif: 'Georgia, serif', mono: 'monospace' } as const;

export function designFontStack(font = 'system'): string {
  return Object.hasOwn(fontStacks, font) ? fontStacks[font as keyof typeof fontStacks] : `${JSON.stringify(font)}, sans-serif`;
}

export function designTextStyle(node: DesignTypography) {
  return {
    fontFamily: designFontStack(node.fontFamily), fontSize: node.fontSize, fontWeight: node.fontWeight ?? 400,
    lineHeight: node.lineHeight ?? 1.2, letterSpacing: node.letterSpacing ?? 0, textAlign: node.textAlign ?? 'left',
  };
}

export function designCanvasTextStyle(node: DesignTypography) {
  const { fontWeight, textAlign, ...style } = designTextStyle(node);
  return { ...style, fontStyle: String(fontWeight), align: textAlign };
}
