import type Konva from 'konva';
import { createRef } from 'react';
import { flushSync } from 'react-dom';
import { createRoot } from 'react-dom/client';
import { Layer, Stage } from 'react-konva';
import { DesignCanvasLayers } from '../DesignCanvasLayers.js';
import type { Bounds } from '../design-geometry.js';
import type { DesignExportSelection } from './design-export-scene.js';

export function renderDesignPng(
  { document, scene, ids }: DesignExportSelection, bounds: Bounds, images: ReadonlyMap<string, HTMLImageElement>, pixelRatio: number,
): string {
  const stage = createRef<Konva.Stage>();
  const root = createRoot(window.document.createElement('div'));
  try {
    flushSync(() => root.render(<Stage ref={stage} width={1} height={1}>
      <Layer listening={false}>
        <DesignCanvasLayers document={document} scene={scene} output={{ rootIds: ids, images }} />
      </Layer>
    </Stage>));
    const layer = stage.current?.getLayers()[0];
    if (!layer) throw new Error('The layer export canvas is unavailable.');
    const result = layer.toDataURL({ x: bounds.x, y: bounds.y,
      width: Math.ceil(bounds.width), height: Math.ceil(bounds.height), pixelRatio, mimeType: 'image/png' });
    if (!result.startsWith('data:image/png;base64,')) throw new Error('The layer could not be encoded as PNG.');
    return result;
  } finally {
    root.unmount();
  }
}
