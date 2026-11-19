import type { Font } from 'fontkit';
import { designFontNameKey, isDesignFontName, maxDesignFontBytes, type DesignCustomFont, type DesignFontFormat } from '../contracts/design-fonts.js';
import { designFontFamilies } from '../contracts/document.js';

const headers: Readonly<Record<string, DesignFontFormat>> = { '\x00\x01\x00\x00': 'ttf', true: 'ttf', OTTO: 'otf', wOFF: 'woff', wOF2: 'woff2' };

export async function inspectDesignFont(bytes: Buffer): Promise<Omit<DesignCustomFont, 'id'>> {
  const format = headers[bytes.toString('latin1', 0, 4)];
  if (!format || bytes.length < 12) throw new Error('Unsupported font format.');
  // Import on demand. Listing fonts or starting the runtime does not load the parser.
  const { create } = await import('fontkit');
  const font = create(bytes);
  if (!('getName' in font)) throw new Error('Expected a single font face.');
  if (format === 'woff' || format === 'woff2') checkExpandedSize(font);
  const family = (font.getName('preferredFamily', 'en') || font.familyName)?.trim();
  if (!font.numGlyphs || !isDesignFontName(family) || designFontFamilies.some((preset) => preset === designFontNameKey(family))) {
    throw new Error('Invalid font family.');
  }
  const os2 = font['OS/2'];
  const axis = font.variationAxes.wght;
  const weight = os2?.usWeightClass || 400;
  const italic = os2?.fsSelection.italic || os2?.fsSelection.oblique || Boolean(font.italicAngle);
  const license = os2?.fsType;
  return {
    format, family, name: isDesignFontName(font.fullName) ? font.fullName.trim() : family,
    minWeight: axis?.min ?? weight, maxWeight: axis?.max ?? weight,
    style: italic ? 'italic' : 'normal',
    embeddable: Boolean(license && !license.noEmbedding && !license.viewOnly && !license.bitmapOnly),
  };
}

function checkExpandedSize(font: Font) {
  // WOFF2 allocates its decode buffer from the sum of the table lengths.
  const { directory } = font as Font & { directory: { tables: Record<string, { length: number; transformLength?: number }> } };
  let size = 0;
  for (const table of Object.values(directory.tables)) {
    if (table.length < 0 || (table.transformLength ?? 0) < 0) throw new Error('Invalid font table size.');
    size += Math.max(table.length, table.transformLength ?? 0);
    if (!Number.isFinite(size) || size > maxDesignFontBytes * 3) throw new Error('Expanded font is too large.');
  }
}
