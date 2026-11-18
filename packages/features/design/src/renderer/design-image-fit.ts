import type { DesignImage } from '../contracts/index.js';
import { roundDesignValue, type Bounds, type Point } from './design-geometry.js';

export const defaultImageCrop: Point = { x: 0.5, y: 0.5 };

export function designImageFit(node: DesignImage, width: number, height: number, imageWidth: number, imageHeight: number):
  Readonly<{ bounds: Bounds; crop?: Bounds; overhang?: Point }> {
  if (node.fit === 'contain') {
    const scale = Math.min(width / imageWidth, height / imageHeight);
    const w = imageWidth * scale;
    const h = imageHeight * scale;
    return { bounds: { x: (width - w) / 2, y: (height - h) / 2, width: w, height: h } };
  }
  const scale = Math.max(width / imageWidth, height / imageHeight);
  const w = width / scale;
  const h = height / scale;
  const crop = node.crop ?? defaultImageCrop;
  return { bounds: { x: 0, y: 0, width, height },
    crop: { x: (imageWidth - w) * crop.x, y: (imageHeight - h) * crop.y, width: w, height: h },
    overhang: { x: Math.max(0, imageWidth * scale - width), y: Math.max(0, imageHeight * scale - height) } };
}

export function moveImageCrop(crop: Point, overhang: Point, delta: Point): Point {
  function axis(value: number, space: number, movement: number) {
    return space > 0.01 ? roundDesignValue(Math.max(0, Math.min(1, value - movement / space)) * 100) / 100 : value;
  }
  return { x: axis(crop.x, overhang.x, delta.x), y: axis(crop.y, overhang.y, delta.y) };
}
