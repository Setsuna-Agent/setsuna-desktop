import type Konva from 'konva';
import { useContext, useEffect, useMemo, type RefObject } from 'react';
import { designLayerShaderPaths, type DesignDocument } from '../../contracts/index.js';
import { intersectBounds, type Bounds } from '../design-geometry.js';
import type { DesignScene } from '../design-layout.js';
import type { DesignPaintPreview } from '../design-paint.js';
import { readDesignShaderUniforms } from './design-shader-uniforms.js';
import { DesignShaderAssetsContext } from './use-design-shader-assets.js';

export function useDesignCanvasShaders(stage: RefObject<Konva.Stage>, document: DesignDocument, scene: DesignScene, range: Bounds,
  preview: DesignPaintPreview | undefined) {
  const sources = useContext(DesignShaderAssetsContext)?.sources;
  const timed = useMemo(() => {
    const paths = new Set<string>();
    for (const [path, source] of sources ?? []) {
      if (readDesignShaderUniforms(source).some(({ kind }) => kind === 'time')) paths.add(path);
    }
    return paths;
  }, [sources]);
  const timedLayers = useMemo(() => timed.size ? Object.entries(document.nodes).flatMap(([id, node]) =>
    designLayerShaderPaths(node, true).some((path) => timed.has(path)) ? [id] : []) : [], [document, timed]);
  const animated = timedLayers.some((id) => {
    const bounds = scene[id]?.visibleBounds;
    return bounds && intersectBounds(bounds, range);
  });

  useEffect(() => {
    if (!animated) return;
    let lastDraw = 0;
    let frame: number;
    function tick(now: number) {
      if (now - lastDraw >= 1000 / 30) {
        lastDraw = now;
        stage.current?.getLayers()[0]?.drawScene();
      }
      frame = requestAnimationFrame(tick);
    }
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [animated, stage]);

  // React Konva may only replace the fill callback when a uniform changes.
  useEffect(() => {
    if (sources?.size) stage.current?.getLayers()[0]?.batchDraw();
  }, [document, preview, sources, stage]);
  return useMemo(() => sources?.size ? { sources } : undefined, [sources]);
}
