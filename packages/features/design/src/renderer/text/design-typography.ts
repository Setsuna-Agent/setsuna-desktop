import type { DesignText, DesignTypography } from '../../contracts/index.js';
import { designFontNameKey } from '../../contracts/design-fonts.js';

export const designTextFont = 'system-ui, sans-serif';
const fontStacks = { system: designTextFont, sans: 'Arial, sans-serif', serif: 'Georgia, serif', mono: 'monospace' } as const;

export function designFontStack(font = 'system'): string {
  if (Object.hasOwn(fontStacks, font)) return fontStacks[font as keyof typeof fontStacks];
  return `${designCustomFontFamily(font)}, ${JSON.stringify(font)}, sans-serif`;
}

export function designCustomFontFamily(family: string): string {
  // Scope imported faces to design typography, even if they share a name with an app or system font.
  return `setsuna-design-${Array.from(designFontNameKey(family), (char) => char.codePointAt(0)!.toString(16)).join('-')}`;
}

export function collectDesignTextFonts(node: DesignText, families: Set<string>) {
  if (node.fontFamily) families.add(node.fontFamily);
  for (const run of node.runs ?? []) if (run.fontFamily) families.add(run.fontFamily);
}

export function designTextStyle(node: DesignTypography) {
  return {
    fontFamily: designFontStack(node.fontFamily), fontSize: node.fontSize, fontWeight: node.fontWeight ?? 400,
    fontStyle: node.fontStyle ?? 'normal',
    lineHeight: node.lineHeight ?? 1.2, letterSpacing: node.letterSpacing ?? 0, textAlign: node.textAlign ?? 'left',
  };
}

type TextStyle = ReturnType<typeof designTextStyle>;

export function designFontStyleWeight({ fontStyle, fontWeight }: Pick<TextStyle, 'fontStyle' | 'fontWeight'>): string {
  return fontStyle === 'italic' ? `italic ${fontWeight}` : String(fontWeight);
}

export function designCanvasTextStyle(style: TextStyle) {
  const { fontWeight: _weight, fontStyle: _style, textAlign, ...text } = style;
  // Konva uses fontStyle for the weight and slant portion of the canvas font shorthand.
  return { ...text, fontStyle: designFontStyleWeight(style), align: textAlign };
}
