import { MAX_DESIGN_SVG_BYTES } from '@setsuna-desktop/contracts';

export const minDesignPolygonSides = 3;
export const maxDesignPolygonSides = 32;
export const defaultDesignPolygonSides = 5;
export const maxDesignPathAnchors = 512;
export const maxDesignSvgPaths = 512;
export const designSvgNumberPattern = '[+-]?(?:\\d+\\.?\\d*|\\.\\d+)(?:[eE][+-]?\\d+)?';

export const designIconNames = [
  'heart', 'star', 'house', 'search', 'user', 'users', 'bell', 'mail', 'message-circle',
  'check', 'x', 'plus', 'arrow-right', 'arrow-left', 'chevron-down', 'menu', 'settings',
  'camera', 'image', 'shopping-bag', 'shopping-cart', 'map-pin', 'calendar', 'clock',
  'folder', 'file-text', 'download', 'upload', 'link', 'lock', 'eye', 'sparkles',
  'globe', 'bookmark', 'circle-help', 'circle-play', 'trash-2',
] as const;

export type DesignIconName = (typeof designIconNames)[number];
export type DesignVectorPoint = Readonly<{ x: number; y: number }>;
export type DesignPathAnchor = DesignVectorPoint & Readonly<{ incoming?: DesignVectorPoint; outgoing?: DesignVectorPoint }>;
export type DesignPathGeometry = Readonly<{ kind: 'path'; anchors: readonly DesignPathAnchor[]; closed: boolean }>;
export type DesignSvgMatrix = readonly [number, number, number, number, number, number];
export type DesignSvgViewBox = DesignVectorPoint & Readonly<{ width: number; height: number }>;
export type DesignSvgPath = Readonly<{
  data: string;
  transform?: DesignSvgMatrix;
  fillRule?: 'nonzero' | 'evenodd';
  fillFromStroke?: boolean;
  lineCap?: 'butt' | 'round' | 'square';
  dash?: readonly number[];
  dashOffset?: number;
}>;
export type DesignSvgGeometry = Readonly<{ kind: 'svg'; viewBox: DesignSvgViewBox; paths: readonly DesignSvgPath[]; icon?: string }>;
export type DesignVectorGeometry = DesignPathGeometry
  | Readonly<{ kind: 'polygon'; sides: number }>
  | Readonly<{ kind: 'icon'; icon: DesignIconName }>
  | DesignSvgGeometry;

export function parseDesignSvgNumber(value: unknown): number {
  if (typeof value === 'number' && Number.isFinite(value) && Math.abs(value) <= 10_000_000) return value;
  throw new Error('Invalid SVG coordinate.');
}

export function parseDesignSvgPathData(value: unknown): string {
  const data = typeof value === 'string' ? value.trim() : '';
  if (data.length > MAX_DESIGN_SVG_BYTES || !/^[Mm][MmLlHhVvCcSsQqTtAaZz0-9eE.,+\-\s]+$/u.test(data)) {
    throw new Error('Invalid SVG path data.');
  }
  for (const match of data.matchAll(new RegExp(designSvgNumberPattern, 'gu'))) parseDesignSvgNumber(Number(match[0]));
  return data;
}
