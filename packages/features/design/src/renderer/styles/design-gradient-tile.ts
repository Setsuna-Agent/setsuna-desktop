import type { DesignGradient } from '../../contracts/index.js';
import type { Bounds } from '../design-geometry.js';
import { designGradientGeometry, type DesignGradientGeometry } from './design-gradient-geometry.js';

export type GradientInk = Readonly<{ offset: number; color: string }>;
const tiles = new WeakMap<DesignGradient, { key: string; canvas: HTMLCanvasElement }>();

export function angularGradient(context: CanvasRenderingContext2D, geometry: DesignGradientGeometry, stops: readonly GradientInk[]) {
  const gradient = context.createConicGradient(geometry.radians, geometry.start.x, geometry.start.y);
  for (const { offset, color } of stops) gradient.addColorStop(offset, color);
  return gradient;
}

// SVG has no conic or diamond paint server. The same tile also paints a diamond on the canvas.
export function designGradientTile(gradient: DesignGradient, stops: readonly GradientInk[], size: Pick<Bounds, 'width' | 'height'>, maxEdge = 384) {
  const { width, height } = size;
  if (!(width > 0 && height > 0)) return;
  const key = JSON.stringify([width, height, maxEdge, stops]);
  const cached = tiles.get(gradient);
  if (cached?.key === key) return cached.canvas;

  const scale = maxEdge / Math.max(width, height);
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(width * scale));
  canvas.height = Math.max(1, Math.round(height * scale));
  const context = canvas.getContext('2d');
  if (!context) return;
  const geometry = designGradientGeometry(gradient, { x: 0, y: 0, width, height });
  if (gradient.kind === 'angular') {
    context.scale(canvas.width / width, canvas.height / height);
    context.fillStyle = angularGradient(context, geometry, stops);
    context.fillRect(0, 0, width, height);
  } else {
    paintDiamond(context, geometry, stops, size);
  }
  tiles.set(gradient, { key, canvas });
  return canvas;
}

function paintDiamond(context: CanvasRenderingContext2D, { start, radians, radius }: DesignGradientGeometry,
  stops: readonly GradientInk[], size: Pick<Bounds, 'width' | 'height'>) {
  // Sample a native color ramp so opacity, repeated stops and interpolation match the other gradient types.
  const rampSize = 1024;
  const ramp = document.createElement('canvas');
  ramp.width = rampSize;
  ramp.height = 1;
  const sampler = ramp.getContext('2d');
  if (!sampler) return;
  const colors = sampler.createLinearGradient(0.5, 0, rampSize - 0.5, 0);
  for (const { offset, color } of stops) colors.addColorStop(offset, color);
  sampler.fillStyle = colors;
  sampler.fillRect(0, 0, rampSize, 1);
  const samples = new Uint32Array(sampler.getImageData(0, 0, rampSize, 1).data.buffer);

  const { width, height } = context.canvas;
  const pixels = context.createImageData(width, height);
  const output = new Uint32Array(pixels.data.buffer);
  const cos = Math.cos(radians);
  const sin = Math.sin(radians);
  const steps = (rampSize - 1) / radius;
  for (let row = 0; row < height; row++) {
    const y = (row + 0.5) * size.height / height - start.y;
    for (let column = 0; column < width; column++) {
      const x = (column + 0.5) * size.width / width - start.x;
      const distance = Math.abs(x * cos + y * sin) + Math.abs(y * cos - x * sin);
      output[row * width + column] = samples[Math.min(rampSize - 1, Math.round(distance * steps))];
    }
  }
  context.putImageData(pixels, 0, 0);
}
