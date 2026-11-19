import type Konva from 'konva';
import { createRef } from 'react';
import { flushSync } from 'react-dom';
import { createRoot } from 'react-dom/client';
import { Layer, Stage } from 'react-konva';
import { DesignCanvasLayers } from '../DesignCanvasLayers.js';
import type { Bounds } from '../design-geometry.js';
import type { DesignShaderRender } from '../shaders/design-canvas-shader.js';
import type { DesignShaderSources } from '../shaders/design-shader-renderer.js';
import type { DesignPaintImages } from '../styles/design-gradients.js';
import type { DesignExportSelection } from './design-export-scene.js';

export function renderDesignPng(
  selection: DesignExportSelection, bounds: Bounds, images: DesignPaintImages, pixelRatio: number, sources?: DesignShaderSources,
): string {
  const output = renderDesignBitmap(selection, bounds, images, pixelRatio, sources && { sources });
  const result = output.toDataURL('image/png');
  if (!result.startsWith('data:image/png;base64,')) throw new Error('The layer could not be encoded as PNG.');
  return result;
}

export async function bakeDesignShaderFills(selection: DesignExportSelection, bounds: Bounds, images: DesignPaintImages, sources: DesignShaderSources) {
  const captures = new Map<string, Map<number, string>>();
  const maxEdge = Math.max(bounds.width, bounds.height);
  const ratio = Math.min(1, 4096 / maxEdge);
  renderDesignBitmap(selection, bounds, images, ratio, { sources, capture(id, index, bitmap) {
    const fills = captures.get(id) ?? new Map<number, string>();
    if (!fills.has(index)) fills.set(index, bitmap.toDataURL('image/png'));
    captures.set(id, fills);
  } });

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

function renderDesignBitmap({ document, scene, ids, webImages }: DesignExportSelection, bounds: Bounds, images: DesignPaintImages,
  pixelRatio: number, shaders?: DesignShaderRender) {
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
    flushSync(() => root.render(<Stage ref={stage} width={1} height={1}>
      <Layer listening={false}>
        <DesignCanvasLayers document={document} scene={scene} output={{ rootIds: ids, images }} shaders={shaderRender} webImages={webImages} />
      </Layer>
    </Stage>));
    const layer = stage.current?.getLayers()[0];
    if (!layer) throw new Error('The layer export canvas is unavailable.');
    exporting = true;
    return layer.toCanvas({ x: bounds.x, y: bounds.y,
      width: Math.ceil(bounds.width), height: Math.ceil(bounds.height), pixelRatio });
  } finally {
    root.unmount();
  }
}
