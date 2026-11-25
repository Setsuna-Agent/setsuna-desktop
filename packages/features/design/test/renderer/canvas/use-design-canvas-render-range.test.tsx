// @vitest-environment happy-dom
import { cleanup, renderHook } from '@testing-library/react';
import { afterEach, expect, it } from 'vitest';
import { useDesignCanvasRenderRange } from '../../../src/renderer/canvas/use-design-canvas-render-range.js';
import { containsBounds } from '../../../src/renderer/design-geometry.js';

afterEach(cleanup);

it('reuses the mounted area during local pans and replaces it for a distant or much smaller viewport', () => {
  const overview = { x: 0, y: 0, width: 2000, height: 1000 };
  const { result, rerender } = renderHook(({ viewport, scale }) => useDesignCanvasRenderRange(viewport, scale),
    { initialProps: { viewport: overview, scale: 0.5 } });
  const mountedOverview = result.current;
  rerender({ viewport: { ...overview, x: 20, y: 40 }, scale: 0.5 });
  expect(result.current).toBe(mountedOverview);

  const detail = { x: 250, y: 180, width: 500, height: 250 };
  rerender({ viewport: detail, scale: 2 });
  expect(containsBounds(result.current, detail)).toBe(true);
  expect(containsBounds(result.current, overview)).toBe(false);

  const distant = { ...detail, x: -2000, y: 3000 };
  rerender({ viewport: distant, scale: 2 });
  expect(containsBounds(result.current, distant)).toBe(true);
  expect(containsBounds(result.current, detail)).toBe(false);
});
