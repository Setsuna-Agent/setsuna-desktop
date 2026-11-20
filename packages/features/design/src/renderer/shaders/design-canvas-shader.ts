import { SceneCanvas } from 'konva/lib/Canvas.js';
import type { Context } from 'konva/lib/Context.js';
import { Group } from 'konva/lib/Group.js';
import type { Node } from 'konva/lib/Node.js';
import type { Shape } from 'konva/lib/Shape.js';
import type { RefCallback } from 'react';
import type { DesignShaderPaint } from '../../contracts/design-shader.js';
import type { DesignPaintImages } from '../styles/design-gradients.js';
import { designShaderRasterSize, drawDesignShader, type DesignShaderSources } from './design-shader-renderer.js';

export type DesignShaderRender = Readonly<{
  sources: DesignShaderSources;
  capture?(layerId: string, index: number, bitmap: HTMLCanvasElement): void;
  strict?: boolean;
}>;

type ShaderFill = Readonly<{ paint: DesignShaderPaint; size: { width: number; height: number }; index: number;
  images: DesignPaintImages; render: DesignShaderRender }>;

let objectCanvas: SceneCanvas | undefined;
let backdropCanvas: HTMLCanvasElement | undefined;
let samplingObject = false;

export function designCanvasShaderRef({ paint, size, index, images, render }: ShaderFill): RefCallback<Shape> {
  const source = render.sources.get(paint.assetPath);
  let restore: (() => void) | undefined;
  return (shape) => {
    restore?.();
    restore = undefined;
    if (!shape) return;
    const fill = shape._fillFunc;
    const draw = shape.drawScene;
    let pass: { target: CanvasRenderingContext2D; transform: DOMMatrix; top?: Node; pattern?: CanvasPattern | null; matrix?: DOMMatrix } | undefined;

    shape.drawScene = function (canvas, top) {
      if (samplingObject) return draw.call(this, canvas, top);
      const target = (canvas ?? this.getLayer()?.getCanvas())?.getContext()._context;
      if (!target) return draw.call(this, canvas, top);
      pass = { target, transform: target.getTransform(), top };
      try { return draw.call(this, canvas, top); }
      finally { pass = undefined; }
    };
    shape._fillFunc = function (context) {
      if (samplingObject || !pass) return;
      if (pass.pattern === undefined) {
        pass.pattern = null;
        const owner = this.findAncestor('.design-hit-layer');
        if (!(owner instanceof Group) || size.width <= 0 || size.height <= 0) return;
        try {
          if (source === undefined) throw new Error(`Missing shader: ${paint.assetPath}`);
          const world = new DOMMatrix(owner.getAbsoluteTransform(pass.top).getMatrix());
          const matrix = pass.transform.multiply(world);
          const raster = designShaderRasterSize(size.width * Math.hypot(matrix.a, matrix.b), size.height * Math.hypot(matrix.c, matrix.d));
          const bitmap = drawDesignShader(source, paint, { ...raster, time: performance.now() / 1000, texture(sampler) {
            if (sampler.kind === 'image') return sampler.assetPath ? images.get(sampler.assetPath) : undefined;
            if (sampler.kind === 'object') return captureObject(owner, raster, size);
            return captureBackdrop(pass!.target, matrix, raster, size);
          } });
          render.capture?.(owner.id(), index, bitmap);
          pass.matrix = matrix.scale(size.width / raster.width, size.height / raster.height);
          pass.pattern = context._context.createPattern(bitmap, 'no-repeat');
        } catch (error) {
          if (render.strict) throw error;
        }
      }
      if (pass.pattern && pass.matrix) {
        // Text and vector paths may translate within a layer. Keep the texture in layer coordinates.
        pass.pattern.setTransform(patternMatrix(context, pass.target, pass.matrix));
        context.setAttr('fillStyle', pass.pattern);
        return fill.call(this, context);
      }
    };
    restore = () => { shape.drawScene = draw; shape._fillFunc = fill; };
    shape.getLayer()?.batchDraw();
  };
}

function patternMatrix(context: Context, target: CanvasRenderingContext2D, matrix: DOMMatrix) {
  const isolation = context.canvas instanceof SceneCanvas && context._context !== target ? context.canvas._isolationRect : undefined;
  const origin = isolation ? new DOMMatrix().translate(-isolation.x, -isolation.y).multiply(matrix) : matrix;
  return context._context.getTransform().inverse().multiply(origin);
}

type Size = Readonly<{ width: number; height: number }>;

function captureBackdrop(target: CanvasRenderingContext2D, transform: DOMMatrix, raster: Size, size: Size) {
  const canvas = backdropCanvas ??= document.createElement('canvas');
  if (canvas.width !== raster.width) canvas.width = raster.width;
  if (canvas.height !== raster.height) canvas.height = raster.height;
  const ctx = canvas.getContext('2d');
  if (!ctx) return;
  ctx.resetTransform();
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.setTransform(new DOMMatrix().scale(raster.width / size.width, raster.height / size.height).multiply(transform.inverse()));
  ctx.drawImage(target.canvas, 0, 0);
  return canvas;
}

function captureObject(owner: Group, raster: Size, size: Size) {
  const group = owner.findOne('.design-layer-paint');
  if (!group) return;
  const canvas = objectCanvas ??= new SceneCanvas({ pixelRatio: 1 });
  canvas.setSizeIfChanged(raster.width, raster.height);
  const context = canvas.getContext();
  const ctx = context._context;
  ctx.resetTransform();
  ctx.clearRect(0, 0, raster.width, raster.height);
  ctx.scale(raster.width / size.width, raster.height / size.height);
  // Capture the layer's ordinary paint and children without feeding shader output back into itself.
  samplingObject = true;
  context._opacityRoot = group;
  try { group.drawScene(canvas, group); }
  finally { context._opacityRoot = undefined; samplingObject = false; }
  return ctx.canvas;
}
