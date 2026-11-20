// @vitest-environment happy-dom

import { cleanup, render } from '@testing-library/react';
import { SceneCanvas } from 'konva/lib/Canvas.js';
import { Text, type TextConfig } from 'konva/lib/shapes/Text.js';
import { Util } from 'konva/lib/Util.js';
import { afterEach, expect, it, vi } from 'vitest';
import type { DesignText } from '../../../src/contracts/index.js';
import { measureDesignText } from '../../../src/renderer/design-text.js';
import { svgDesignText } from '../../../src/renderer/export/design-svg-markup.js';
import { DesignCanvasText } from '../../../src/renderer/text/DesignCanvasText.js';

const canvasText = vi.hoisted(() => vi.fn<(_props: TextConfig) => null>(() => null));
vi.mock('react-konva', () => ({ Text: canvasText }));

afterEach(() => { cleanup(); vi.restoreAllMocks(); });

it('keeps Chinese glyphs on the same baselines when different Latin fonts fall back to the same glyphs', () => {
  const painted: number[] = [];
  const native = {
    font: '', textBaseline: 'alphabetic',
    save() {}, restore() {}, scale() {}, translate() {},
    measureText(text: string) {
      const han = /^\p{Script=Han}+$/u.test(text);
      const latinAscent = this.font.includes('Georgia') ? 18 : 14;
      // The faces draw different Latin glyphs and share the same Han fallback.
      return { width: text.length * 20, actualBoundingBoxAscent: han ? 16 : latinAscent - 2, actualBoundingBoxDescent: han ? 0 : 2,
        fontBoundingBoxAscent: latinAscent, fontBoundingBoxDescent: 4 };
    },
    fillText(_text: string, _x: number, y: number) { painted.push(y); },
  };
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(native as unknown as CanvasRenderingContext2D);
  vi.spyOn(Util, 'isCanvasFarblingActive').mockReturnValue(false);
  const scene = new SceneCanvas({ width: 100, height: 80, pixelRatio: 1 });
  const text: DesignText = { kind: 'text', x: 0, y: 0, width: 100, fontSize: 20, lineHeight: 1.4, text: '中文\n排版' };

  function renderText(fontFamily: string) {
    const node = { ...text, fontFamily };
    const { height } = measureDesignText(node, node.width);
    const view = render(<DesignCanvasText node={node} width={node.width} height={height} paint={{}} outlines={[]} images={new Map()} />);
    const shape = new Text(canvasText.mock.lastCall![0]);
    try {
      painted.length = 0;
      shape.getSceneFunc().call(shape, scene.getContext(), shape);
      const svg = `<svg>${svgDesignText(node, node.width, [{ fill: '#000000' }], [])}</svg>`;
      const lines = new DOMParser().parseFromString(svg, 'image/svg+xml').querySelectorAll('text');
      return { height, canvas: painted.map((y) => shape.y() + y), svg: Array.from(lines, (line) => Number(line.getAttribute('y'))) };
    } finally {
      shape.destroy();
      view.unmount();
    }
  }

  const serif = renderText('serif');
  const mono = renderText('mono');
  expect(serif.canvas).toHaveLength(2);
  expect(serif.svg).toEqual(serif.canvas);
  expect(mono).toEqual(serif);
});
