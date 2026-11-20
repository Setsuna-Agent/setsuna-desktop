import { defineRuntimeCodec } from '@setsuna-desktop/feature-core/codec';
import { defineFeatureOperation } from '@setsuna-desktop/feature-core/operation';

export const designFontWeights = [100, 200, 300, 400, 500, 600, 700, 800, 900] as const;
export const designFontStyles = ['normal', 'italic'] as const;
export type DesignFontWeight = (typeof designFontWeights)[number];
export type DesignFontStyle = (typeof designFontStyles)[number];

export function isDesignFontWeight(value: unknown): value is DesignFontWeight {
  return designFontWeights.some((weight) => weight === value);
}

export const designFontFormats = {
  ttf: { mime: 'font/ttf', css: 'truetype' },
  otf: { mime: 'font/otf', css: 'opentype' },
  woff: { mime: 'font/woff', css: 'woff' },
  woff2: { mime: 'font/woff2', css: 'woff2' },
} as const;
export const maxDesignFontBytes = 20 * 1024 * 1024;
export type DesignFontFormat = keyof typeof designFontFormats;
export type DesignCustomFont = Readonly<{
  id: string;
  family: string;
  name: string;
  format: DesignFontFormat;
  minWeight: number;
  maxWeight: number;
  style: DesignFontStyle;
  embeddable: boolean;
}>;

export function isDesignFontId(value: unknown): value is string {
  return typeof value === 'string' && /^[a-f0-9]{64}$/u.test(value);
}

export function isDesignFontName(value: unknown): value is string {
  return typeof value === 'string' && Boolean(value.trim()) && value.length <= 128 && !/[\p{C}]/u.test(value);
}

export function designFontNameKey(name: string): string {
  return name.normalize('NFC').toLowerCase();
}

function record(input: unknown) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new Error('Invalid design font data.');
  return input as Record<string, unknown>;
}

function isWeight(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 1 && value <= 1000;
}

export const designCustomFontCodec = defineRuntimeCodec<DesignCustomFont>((input) => {
  const { id, family, name, format, minWeight, maxWeight, style, embeddable } = record(input);
  if (!isDesignFontId(id) || !isDesignFontName(family) || !isDesignFontName(name)
      || typeof format !== 'string' || !Object.hasOwn(designFontFormats, format)
      || !isWeight(minWeight) || !isWeight(maxWeight) || minWeight > maxWeight
      || (style !== 'normal' && style !== 'italic') || typeof embeddable !== 'boolean') {
    throw new Error('Invalid design font metadata.');
  }
  return { id, family: family.trim(), name: name.trim(), format: format as DesignFontFormat, minWeight, maxWeight, style, embeddable };
});

const emptyInput = defineRuntimeCodec<undefined>((input) => {
  if (input !== undefined && input !== null) throw new Error('Unexpected design font list input.');
  return undefined;
});
const fontRef = defineRuntimeCodec<Readonly<{ id: string }>>((input) => {
  const { id } = record(input);
  if (!isDesignFontId(id)) throw new Error('Invalid design font ID.');
  return { id };
});
const fontData = defineRuntimeCodec<Readonly<{ base64: string }>>((input) => {
  const { base64 } = record(input);
  if (typeof base64 !== 'string' || !base64 || base64.length > Math.ceil(maxDesignFontBytes / 3) * 4) {
    throw new Error('The design font is empty or too large.');
  }
  return { base64 };
});
const route = '/v1/features/design/fonts';

export const listDesignFonts = defineFeatureOperation({
  id: 'design.font.list', path: route, method: 'GET', input: emptyInput,
  output: defineRuntimeCodec<readonly DesignCustomFont[]>((input) => {
    if (!Array.isArray(input)) throw new Error('Expected a design font list.');
    return input.map((font) => designCustomFontCodec.parse(font));
  }),
  errors: {}, idempotency: 'safe',
});

export const importDesignFont = defineFeatureOperation({
  id: 'design.font.import', path: route, method: 'POST', input: fontData, output: designCustomFontCodec,
  errors: { DESIGN_FONT_INVALID: { status: 422 } }, idempotency: 'idempotent',
});

export const readDesignFont = defineFeatureOperation({
  id: 'design.font.read', path: `${route}/data`, method: 'GET', input: fontRef, output: fontData,
  errors: { DESIGN_FONT_NOT_FOUND: { status: 404 } }, idempotency: 'safe',
});

export const removeDesignFont = defineFeatureOperation({
  id: 'design.font.remove', path: route, method: 'DELETE', input: fontRef,
  output: defineRuntimeCodec<null>((value) => {
    if (value !== null) throw new Error('Invalid design font removal result.');
    return null;
  }),
  errors: {}, idempotency: 'idempotent',
});
