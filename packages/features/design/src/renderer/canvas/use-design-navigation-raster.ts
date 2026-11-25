import type Konva from 'konva';
import { createContext, useCallback, useContext, useLayoutEffect, useRef } from 'react';
import { containsBounds, type Bounds } from '../design-geometry.js';
import type { CanvasViewport } from '../use-design-canvas-gestures.js';
import { designCanvasCullingPadding } from './use-design-canvas-render-range.js';

const rasterOverdraw = 64;
const maxRasterPixels = 4_000_000;
const rasterIdleMs = 120;
const vectorPaintBudgetMs = 6;
const maxZoomReuse = 1.2;

export const DesignRasterInvalidationContext = createContext<(() => void) | undefined>(undefined);

type Raster = Readonly<{ image: HTMLCanvasElement; bounds: Bounds; view: CanvasViewport; pixelRatio: number; content: object }>;

function captureBounds(screen: Bounds, view: CanvasViewport, mounted: Bounds): Bounds {
  const { width, height } = screen;
  const left = view.x + mounted.x * view.scale + designCanvasCullingPadding;
  const top = view.y + mounted.y * view.scale + designCanvasCullingPadding;
  const right = left + mounted.width * view.scale - 2 * designCanvasCullingPadding;
  const bottom = top + mounted.height * view.scale - 2 * designCanvasCullingPadding;
  const x = Math.min(0, Math.max(-rasterOverdraw, Math.ceil(left)));
  const y = Math.min(0, Math.max(-rasterOverdraw, Math.ceil(top)));
  return { x, y, width: Math.max(width, Math.min(width + rasterOverdraw, Math.floor(right))) - x,
    height: Math.max(height, Math.min(height + rasterOverdraw, Math.floor(bottom))) - y };
}

function reproject(raster: Raster, view: CanvasViewport): Bounds | undefined {
  const ratio = view.scale / raster.view.scale;
  if (ratio < 1 / maxZoomReuse || ratio > maxZoomReuse) return;
  const { x, y, width, height } = raster.bounds;
  return { x: view.x + (x - raster.view.x) * ratio, y: view.y + (y - raster.view.y) * ratio,
    width: width * ratio, height: height * ratio };
}

type RasterOptions = Readonly<{ enabled: boolean; mounted: Bounds; content: object }>;

function installDesignNavigationRaster(artwork: Konva.Group, read: () => RasterOptions) {
  const drawScene = artwork.drawScene;
  let raster: Raster | undefined;
  let idle: ReturnType<typeof setTimeout> | undefined;
  let previousView: CanvasViewport | undefined;
  let vectorPaintMs = 0;

  function release() {
    if (!raster) return;
    raster.image.width = 0;
    raster.image.height = 0;
    raster = undefined;
  }

  artwork.drawScene = function (canvas, top) {
    const layer = this.getLayer();
    // Offscreen renders and exports always traverse the original artwork.
    if (!canvas || !layer || top || canvas !== layer.getCanvas()) return drawScene.call(this, canvas, top);
    const camera = this.getParent();
    const stage = this.getStage();
    const options = read();
    if (!camera || !stage || !this.isVisible()) return drawScene.call(this, canvas, top);
    const view = { x: camera.x(), y: camera.y(), scale: camera.scaleX() };
    const screen = { x: 0, y: 0, width: stage.width(), height: stage.height() };
    const moving = previousView && (view.x !== previousView.x || view.y !== previousView.y || view.scale !== previousView.scale);
    previousView = view;
    clearTimeout(idle);
    idle = undefined;

    if (!options.enabled || !moving || (!raster && vectorPaintMs < vectorPaintBudgetMs) || !screen.width || !screen.height) {
      release();
      const start = performance.now();
      const result = drawScene.call(this, canvas, top);
      vectorPaintMs = performance.now() - start;
      return result;
    }

    const pixelRatio = canvas.getPixelRatio();
    let destination = raster?.pixelRatio === pixelRatio && raster.content === options.content ? reproject(raster, view) : undefined;
    if (!raster || !destination || !containsBounds(destination, screen)) {
      release();
      const bounds = captureBounds(screen, view, options.mounted);
      const ratio = Math.min(pixelRatio, Math.sqrt(maxRasterPixels / (bounds.width * bounds.height)));
      raster = { image: this.toCanvas({ ...bounds, pixelRatio: ratio }), bounds, view, pixelRatio, content: options.content };
      destination = bounds;
    }
    canvas.getContext()._context.drawImage(raster.image, destination.x, destination.y, destination.width, destination.height);
    // Zoom can resample one bitmap briefly. Paint vectors again at the final viewport.
    idle = setTimeout(() => layer.batchDraw(), rasterIdleMs);
    return this;
  };

  return {
    invalidate: release,
    dispose() {
      clearTimeout(idle);
      release();
      artwork.drawScene = drawScene;
    },
  };
}

export function useDesignNavigationRaster(options: RasterOptions & Readonly<{ panning: boolean }>) {
  const current = useRef(options);
  const registration = useRef<ReturnType<typeof installDesignNavigationRaster>>();
  const lastWheel = useRef(-Infinity);
  useLayoutEffect(() => { current.current = options; }, [options]);
  const bindArtwork = useCallback((group: Konva.Group | null) => {
    registration.current?.dispose();
    registration.current = group ? installDesignNavigationRaster(group, () => {
      const { panning, enabled, mounted, content } = current.current;
      const navigating = panning || performance.now() - lastWheel.current < rasterIdleMs;
      return { enabled: enabled && navigating, mounted, content };
    }) : undefined;
  }, []);
  const noteWheel = useCallback(() => { lastWheel.current = performance.now(); }, []);
  const invalidateRaster = useCallback(() => { registration.current?.invalidate(); }, []);
  return { bindArtwork, noteWheel, invalidateRaster };
}

export function useInvalidateRasterOnChange(pixels: object | undefined) {
  const invalidate = useContext(DesignRasterInvalidationContext);
  // Image decodes can replace pixels without changing the canvas document props.
  useLayoutEffect(() => { invalidate?.(); }, [invalidate, pixels]);
}
