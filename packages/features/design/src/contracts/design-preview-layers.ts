import { parseDesignColor } from './design-color.js';
import { maxDesignFills, maxDesignStrokes, maxDesignTreeDepth, maxExpandedDesignLayers } from './document.js';
import { parseDesignSvgPathData } from './vector-geometry.js';

const layerKinds = ['artboard', 'frame', 'group', 'component', 'instance', 'rectangle', 'ellipse', 'text',
  'image', 'web', 'script', 'path', 'polygon', 'svg', 'icon'] as const;
export const maxDesignPreviewOutlinePoints = 32;
export const maxDesignPreviewLayerNameLength = 512;

export type DesignPreviewLayerKind = typeof layerKinds[number];
export type DesignPreviewLayer = Readonly<{
  kind: DesignPreviewLayerKind;
  key?: number;
  name?: string;
  bounds: readonly [x: number, y: number, width: number, height: number];
  rotation: number;
  opacity: number;
  outline: readonly (readonly [x: number, y: number])[];
  outlinePath?: string;
  pickable?: false;
  fills: readonly string[];
  strokes: readonly Readonly<{ color: string; width: number }>[];
  typography?: Readonly<{ family?: string; size: number; weight?: number }>;
  children: readonly DesignPreviewLayer[];
}>;

export function createDesignPreviewLayerParser() {
  let count = 0;
  // The preview DTO is also the HTTP response. Rebuild it from the public fields at the IPC boundary.
  function parse(value: unknown, depth = 0): DesignPreviewLayer {
    const layer = value as Partial<DesignPreviewLayer> | null;
    if (depth > maxDesignTreeDepth || ++count > maxExpandedDesignLayers) throw new Error('The design preview has too many layers.');
    if (!layer?.kind || !layerKinds.includes(layer.kind)) throw new Error('Invalid design preview layer.');
    const { kind, key, name, bounds, rotation, opacity, outline, outlinePath, pickable, fills, strokes, typography, children } = layer;
    if (key !== undefined && (!Number.isSafeInteger(key) || key < 0)) throw new Error('Invalid design preview layer key.');
    const [x, y, width, height] = array(bounds, 4, 4);
    return {
      kind, key, name: label(name), bounds: [number(x), number(y), number(width, 0), number(height, 0)],
      rotation: number(rotation), opacity: number(opacity, 0, 1),
      outline: Array.from(array(outline, maxDesignPreviewOutlinePoints), (value): readonly [number, number] => {
        const [x, y] = array(value, 2, 2);
        return [number(x, 0, 1), number(y, 0, 1)];
      }),
      outlinePath: outlinePath === undefined ? undefined : parseDesignSvgPathData(outlinePath),
      pickable: pickable === false ? false : undefined,
      fills: Array.from(array(fills, maxDesignFills), parseDesignColor),
      strokes: Array.from(array(strokes, maxDesignStrokes), (value) => {
        const stroke = value as { color?: unknown; width?: unknown } | null;
        return { color: parseDesignColor(stroke?.color), width: number(stroke?.width, 0) };
      }),
      typography: typography === undefined ? undefined : {
        family: label(typography?.family), size: number(typography?.size, 0),
        weight: typography?.weight === undefined ? undefined : number(typography.weight, 0),
      },
      children: Array.from(array(children, maxExpandedDesignLayers - count), (child) => parse(child, depth + 1)),
    };
  }
  return parse;
}

function array(value: unknown, max: number, min = 0): readonly unknown[] {
  if (!Array.isArray(value) || value.length < min || value.length > max) throw new Error('Invalid design preview layer data.');
  return value;
}

function number(value: unknown, min = -Infinity, max = Infinity): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < min || value > max) throw new Error('Invalid design preview layer geometry.');
  return value;
}

function label(value: unknown): string | undefined {
  if (value === undefined || typeof value === 'string' && value.length <= maxDesignPreviewLayerNameLength) return value;
  throw new Error('Invalid design preview layer label.');
}
