// @vitest-environment happy-dom

import { SceneCanvas } from 'konva/lib/Canvas.js';
import { Util } from 'konva/lib/Util.js';
import { Rect } from 'konva/lib/shapes/Rect.js';
import { afterEach, expect, it, vi } from 'vitest';
import { designStrokeBounds } from '../../src/renderer/design-paint.js';
import { designCanvasStroke, designStrokePatternRef } from '../../src/renderer/styles/design-gradients.js';

afterEach(() => { vi.restoreAllMocks(); });

it('passes an image pattern to the stroke draw', () => {
  const image = document.createElement('img');
  Object.defineProperties(image, { naturalWidth: { value: 20 }, naturalHeight: { value: 10 } });
  const pattern = { setTransform() {} };
  const drawn: unknown[] = [];
  const native = {
    strokeStyle: undefined as unknown,
    scale() {}, beginPath() {}, rect() {}, closePath() {},
    createPattern: vi.fn().mockReturnValue(pattern),
    stroke() { drawn.push(this.strokeStyle); },
  };
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(native as unknown as CanvasRenderingContext2D);
  vi.spyOn(Util, 'isCanvasFarblingActive').mockReturnValue(false);
  const scene = new SceneCanvas({ width: 90, height: 60, pixelRatio: 1 });
  const bounds = designStrokeBounds({ x: 0, y: 0, width: 80, height: 40 }, 4);
  const { strokePattern, ...ink } = designCanvasStroke({ color: '#000000', width: 4, image: { assetPath: 'paper.png', fit: 'cover' } },
    bounds, new Map([['paper.png', image]]));
  const rectangle = new Rect({ width: 80, height: 40, ...ink });
  const attach = designStrokePatternRef(strokePattern);
  try {
    attach?.(rectangle);
    rectangle.getSceneFunc().call(rectangle, scene.getContext(), rectangle);
    expect(drawn).toEqual([pattern]);
  } finally {
    attach?.(null);
    rectangle.destroy();
  }
});
