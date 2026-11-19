import { MAX_DESIGN_SVG_BYTES } from '@setsuna-desktop/contracts';

const svgMimeType = 'image/svg+xml';
export const designSvgAccept = '.svg,' + svgMimeType;
export type DesignLucideSource = Readonly<{ markup: string; name: string; icon: string; color: string }>;
export type DesignSvgSource = Readonly<{ file: File }> | Readonly<{ markup: string }> | DesignLucideSource;

export function clipboardDesignSvg(clipboard: DataTransfer): DesignSvgSource | undefined {
  const file = Array.from(clipboard.files).find(({ type, name }) => type === svgMimeType || /\.svg$/iu.test(name));
  if (file) return { file };
  const encoded = clipboard.getData(svgMimeType);
  if (encoded) return { markup: encoded };
  const plain = clipboard.getData('text/plain').trimStart();
  if (/^(?:(?:<\?xml\b[^]*?\?>|<!--[^]*?-->)\s*)*<(?:[\w-]+:)?svg\b/iu.test(plain) || /^<!DOCTYPE\s+svg\b/iu.test(plain)) {
    return { markup: plain };
  }
  const html = clipboard.getData('text/html');
  const inline = html.length <= MAX_DESIGN_SVG_BYTES ? html.match(/<svg(?=[\s/>])[^]*?<\/svg\s*>/iu)?.[0] : undefined;
  return inline ? { markup: inline } : undefined;
}
