import type Konva from 'konva';
import { createRef } from 'react';
import { flushSync } from 'react-dom';
import { createRoot } from 'react-dom/client';
import { Group, Layer, Stage } from 'react-konva';
import { MAX_DESKTOP_IMAGE_BYTES } from '@setsuna-desktop/contracts';
import { DesignCanvasLayers } from '../DesignCanvasLayers.js';
import type { Bounds } from '../design-geometry.js';
import type { DesignShaderRender } from '../shaders/design-canvas-shader.js';
import type { DesignShaderSources } from '../shaders/design-shader-renderer.js';
import type { DesignPaintImages } from '../styles/design-gradients.js';
import type { DesignExportSelection } from './design-export-scene.js';

const maxPngEdge = 32_767;
const maxPngPixels = 16_000_000;
type PngRaster = Readonly<{ width: number; height: number; scale: number }>;

export function renderDesignPng(
  selection: DesignExportSelection, bounds: Bounds, images: DesignPaintImages, pixelRatio: number, sources?: DesignShaderSources,
): string {
  const output = renderDesignBitmap(selection, bounds, images, { pixelRatio, shaders: sources && { sources } });
  const result = output.toDataURL('image/png');
  if (!result.startsWith('data:image/png;base64,')) throw new Error('The layer could not be encoded as PNG.');
  return result;
}

export async function renderDesignExportPng(selection: DesignExportSelection, bounds: Bounds, images: DesignPaintImages,
  requestedScale: number, signal: AbortSignal, sources?: DesignShaderSources,
) {
  const width = Math.max(1, Math.ceil(bounds.width));
  const height = Math.max(1, Math.ceil(bounds.height));
  if (![bounds.x, bounds.y, width, height].every(Number.isFinite)) throw new Error('The design has invalid PNG export bounds.');
  let scale = requestedScale;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    signal.throwIfAborted();
    // Leave room for PNG filtering and container overhead if compression still exceeds the desktop byte limit.
    const pixelBudget = attempt < 2 ? maxPngPixels : Math.floor(MAX_DESKTOP_IMAGE_BYTES / 5);
    const raster = fitPngRaster(width, height, scale, pixelBudget);
    const bitmap = renderDesignBitmap(selection, bounds, images, {
      pixelRatio: requestedScale, raster: raster.scale < requestedScale ? raster : undefined, shaders: sources && { sources },
    });
    const blob = await encodeDesignPng(bitmap);
    signal.throwIfAborted();
    if (blob?.size && blob.size <= MAX_DESKTOP_IMAGE_BYTES) {
      const dataUrl = await pngDataUrl(blob);
      signal.throwIfAborted();
      return { ...raster, dataUrl };
    }
    scale = raster.scale * (blob?.size ? Math.sqrt(MAX_DESKTOP_IMAGE_BYTES / blob.size) * 0.98 : 0.5);
  }
  throw new Error('The PNG could not be encoded within the export limit.');
}

function fitPngRaster(width: number, height: number, maximumScale: number, pixelBudget: number): PngRaster {
  const requestedWidth = Math.max(1, Math.ceil(width * maximumScale));
  const requestedHeight = Math.max(1, Math.ceil(height * maximumScale));
  if (Math.max(requestedWidth, requestedHeight) <= maxPngEdge && requestedWidth * requestedHeight <= pixelBudget) {
    return { width: requestedWidth, height: requestedHeight, scale: maximumScale };
  }
  const desiredScale = Math.min(maximumScale, maxPngEdge / Math.max(width, height), Math.sqrt(pixelBudget) / Math.sqrt(width) / Math.sqrt(height));
  const pixelWidth = Math.min(maxPngEdge, Math.max(1, Math.ceil(width * desiredScale)));
  const pixelHeight = Math.min(maxPngEdge, Math.max(1, Math.ceil(height * desiredScale)), Math.floor(pixelBudget / pixelWidth));
  // Fit both integral dimensions so rounding never drops the far edge or exceeds the pixel budget.
  const scale = Math.min(desiredScale, pixelWidth / width, pixelHeight / height);
  return { width: Math.min(pixelWidth, Math.max(1, Math.ceil(width * scale))), height: pixelHeight, scale };
}

function pngDataUrl(blob: Blob) {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => typeof reader.result === 'string' ? resolve(reader.result) : reject(new Error('The PNG could not be read.'));
    reader.onerror = () => reject(reader.error ?? new Error('The PNG could not be read.'));
    reader.readAsDataURL(blob);
  });
}

export async function renderDesignPreviewPng(selection: DesignExportSelection, id: string,
  size: Pick<Bounds, 'width' | 'height'> & { hidden?: true },
  images: DesignPaintImages, sources: DesignShaderSources,
): Promise<Blob> {
  const box = selection.scene[id];
  const scene = { ...selection.scene, [id]: { ...box, absoluteX: 0, absoluteY: 0, angle: 0, scaleX: 1, scaleY: 1 } };
  const clip = { x: 0, y: 0, width: box.width, height: box.height };
  const bitmap = size.hidden ? window.document.createElement('canvas') : renderDesignBitmap({
    document: selection.document, scene, ids: [id], paintedLayerIds: selection.paintedLayerIds,
  },
    { x: 0, y: 0, ...size }, images, { shaders: { sources }, boardClip: clip });
  if (size.hidden) {
    bitmap.width = size.width;
    bitmap.height = size.height;
  }
  const blob = await encodeDesignPng(bitmap);
  if (!blob?.size) throw new Error('The artboard could not be encoded as PNG.');
  return blob;
}

async function encodeDesignPng(bitmap: HTMLCanvasElement) {
  try {
    return await new Promise<Blob | null>((resolve) => bitmap.toBlob(resolve, 'image/png'));
  } finally {
    bitmap.width = 0;
    bitmap.height = 0;
  }
}

export async function bakeDesignShaderFills(selection: DesignExportSelection, bounds: Bounds, images: DesignPaintImages, sources: DesignShaderSources) {
  const captures = new Map<string, Map<number, string>>();
  const maxEdge = Math.max(bounds.width, bounds.height);
  const ratio = Math.min(1, 4096 / maxEdge);
  renderDesignBitmap(selection, bounds, images, { pixelRatio: ratio, shaders: { sources, capture(id, index, bitmap) {
    const fills = captures.get(id) ?? new Map<number, string>();
    if (!fills.has(index)) fills.set(index, bitmap.toDataURL('image/png'));
    captures.set(id, fills);
  } } });

  const nodes = { ...selection.document.nodes };
  const assets = new Map(images);
  let nextAsset = 0;
  for (const [id, capturesForLayer] of captures) {
    const node = nodes[id];
    if (node.kind === 'image' || !node.fills) continue;
    const fills = await Promise.all(node.fills.map(async (fill, index) => {
      const url = capturesForLayer.get(index);
      if (!url) return fill;
      let assetPath: string;
      do { assetPath = `_shader/${++nextAsset}.png`; } while (assets.has(assetPath));
      const image = new Image();
      image.src = url;
      assets.set(assetPath, image);
      await image.decode();
      return { ...fill, shader: undefined, image: { assetPath, fit: 'stretch' as const } };
    }));
    nodes[id] = { ...node, fills };
  }
  return { selection: { ...selection, document: { ...selection.document, nodes } }, images: assets };
}

function renderDesignBitmap({ document, scene, ids, paintedLayerIds, webImages }: DesignExportSelection, bounds: Bounds, images: DesignPaintImages,
  { pixelRatio = 1, shaders, boardClip, raster }: Readonly<{ pixelRatio?: number; shaders?: DesignShaderRender;
    boardClip?: Bounds; raster?: PngRaster }>) {
  const stage = createRef<Konva.Stage>();
  const root = createRoot(window.document.createElement('div'));
  let exporting = false;
  const shaderRender = shaders && {
    sources: shaders.sources,
    get strict() { return exporting; },
    capture: shaders.capture && ((...args: Parameters<NonNullable<DesignShaderRender['capture']>>) => {
      if (exporting) shaders.capture?.(...args);
    }),
  };
  try {
    const content = <DesignCanvasLayers document={document} scene={scene} output={{ rootIds: ids, images, paintedLayerIds, neutralPlaceholder: Boolean(boardClip) }}
      shaders={shaderRender} webImages={webImages} />;
    const positioned = raster ? <Group x={-bounds.x * raster.scale} y={-bounds.y * raster.scale} scaleX={raster.scale} scaleY={raster.scale}>
      {content}
    </Group> : boardClip ? <Group clip={boardClip} scaleX={bounds.width / boardClip.width} scaleY={bounds.height / boardClip.height}>
      {content}
    </Group> : content;
    flushSync(() => root.render(<Stage ref={stage} width={1} height={1}>
      <Layer listening={false}>{positioned}</Layer>
    </Stage>));
    const layer = stage.current?.getLayers()[0];
    if (!layer) throw new Error('The layer export canvas is unavailable.');
    exporting = true;
    return layer.toCanvas(raster ? { x: 0, y: 0, width: raster.width, height: raster.height, pixelRatio: 1 } : { x: bounds.x, y: bounds.y,
      width: Math.ceil(bounds.width), height: Math.ceil(bounds.height), pixelRatio });
  } finally {
    root.unmount();
  }
}
