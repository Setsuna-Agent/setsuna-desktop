// @vitest-environment happy-dom
import { Util } from 'konva/lib/Util.js';
import { expect, it, vi } from 'vitest';
import { loadYoga } from 'yoga-layout/load';
import { applyDesignEdits } from '../../src/contracts/apply-design-edits.js';
import { designDocumentCodec, designDocumentVersion } from '../../src/contracts/index.js';
import { dropDesignLayer, planDesignLayerUpdate, transformDesignLayer } from '../../src/renderer/design-canvas-edits.js';
import { resolveDesignScene } from '../../src/renderer/design-layout.js';
import { measureDesignText } from '../../src/renderer/design-text.js';
import { designExportBounds, loadExportImages } from '../../src/renderer/export/design-export-scene.js';
import { renderDesignHtml } from '../../src/renderer/export/export-design-html.js';
import { renderDesignSvg } from '../../src/renderer/export/export-design-svg.js';
import { insertDesignSvg, readDesignSvg } from '../../src/renderer/vectors/design-svg-import.js';

it('exports plain text with the same hyphen and whitespace breaks as the canvas', async () => {
  // Supply font metrics at the canvas boundary and let Konva perform its real word wrapping.
  const metrics = { save() {}, restore() {}, measureText: (text: string) => ({ width: text.length * 10 }) };
  const context = vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(metrics as unknown as CanvasRenderingContext2D);
  const canvasProbe = vi.spyOn(Util, 'isCanvasFarblingActive').mockReturnValue(false);
  try {
    const document = designDocumentCodec.parse({ schemaVersion: 5, documentId: 'caption', rootIds: ['label'], nodes: {
      label: { kind: 'text', name: 'Caption', x: 0, y: 0, width: 60, fontSize: 10, fontWeight: 200,
        fontStyle: 'italic', text: 'aa-bbbbb c' },
    } });
    const scene = resolveDesignScene(await loadYoga(), document, measureDesignText);
    const selection = { document, scene, ids: document.rootIds };
    const svg = renderDesignSvg(selection, designExportBounds(selection)!, new Map(), 'Caption');
    const lines = new DOMParser().parseFromString(svg, 'image/svg+xml').querySelectorAll('text');
    expect(Array.from(lines, (line) => line.textContent)).toEqual(['aa-', 'bbbbb', 'c']);
    expect(Array.from(lines, (line) => [line.getAttribute('font-style'), line.getAttribute('font-weight')]))
      .toEqual([['italic', '200'], ['italic', '200'], ['italic', '200']]);
  } finally {
    context.mockRestore();
    canvasProbe.mockRestore();
  }
});

it('exports inert layer content, typography and image framing in both HTML formats', async () => {
  const name = 'Card " onclick="alert(1)';
  const text = '你好 & <script>alert(1)</script>';
  const document = designDocumentCodec.parse({
    schemaVersion: 4, documentId: 'export', rootIds: ['frame'],
    nodes: {
      frame: { kind: 'frame', x: 300, y: -30, width: 200, height: 100, name, childIds: ['text', 'cover', 'contain'],
        layout: { direction: 'vertical', padding: 8, gap: 4, align: 'start' } },
      text: { kind: 'text', x: 0, y: 0, width: 180, fontSize: 16, text, name: 'Title',
        fontFamily: 'serif', fontWeight: 900, fontStyle: 'italic', lineHeight: 1.5, letterSpacing: -0.25, textAlign: 'right' },
      cover: { kind: 'image', x: 0, y: 0, width: 20, height: 18, assetPath: 'photo.png', crop: { x: 0.2, y: 0.6 } },
      contain: { kind: 'image', x: 0, y: 0, width: 20, height: 18, assetPath: 'photo.png', fit: 'contain', crop: { x: 0.2, y: 0.6 } },
    },
  });
  const scene = resolveDesignScene(await loadYoga(), document, () => ({ width: 180, height: 36 }));
  const selection = { document, scene, ids: ['frame'] };
  const bounds = designExportBounds(selection);
  if (!bounds) throw new Error('Expected visible export bounds.');
  for (const format of ['html', 'html-tailwind'] as const) {
    const output = renderDesignHtml(selection, bounds, new Map(), text, format);
    const html = new DOMParser().parseFromString(output, 'text/html');
    expect(html.querySelector('[data-layer]')?.getAttribute('data-layer')).toBe(name);
    expect(html.body.textContent).toContain(text);
    expect(html.title).toBe(text);
    expect(html.querySelector('script, [onclick]')).toBeNull();
    expect(html.querySelector('[data-layer="Title"]')?.getAttribute('style'))
      .toContain('font:italic 900 16px/1.5 Georgia, serif;letter-spacing:-0.25px;text-align:right');
    expect([...html.querySelectorAll('img')].map((image) => [
      image.style.getPropertyValue('object-fit'), image.style.getPropertyValue('object-position'),
    ])).toEqual([['cover', '20% 60%'], ['contain', '50% 50%']]);
  }
});

it('omits hidden layers from both auto layout and exported HTML', async () => {
  const tile = { kind: 'rectangle', x: 0, y: 0, width: 20, height: 20, cornerRadius: 0 };
  const document = designDocumentCodec.parse({
    schemaVersion: 4, documentId: 'hidden-layer', rootIds: ['frame'], nodes: {
      frame: { kind: 'frame', x: 0, y: 0, width: 100, height: 20, widthMode: 'hug', childIds: ['hidden', 'first', 'second'],
        layout: { direction: 'horizontal', gap: 10, padding: 0, align: 'start' } },
      hidden: { ...tile, name: 'Hidden', width: 40, hidden: true },
      first: { ...tile, name: 'First' }, second: { ...tile, name: 'Second' },
    },
  });
  const scene = resolveDesignScene(await loadYoga(), document, () => ({ width: 1, height: 1 }));
  expect(scene.hidden).toMatchObject({ visible: false, width: 40 });
  expect(scene.first.x).toBe(0);
  expect(scene.second.x).toBe(30);
  expect(scene.frame.width).toBe(50);

  const selection = { document, scene, ids: ['frame'] };
  const html = renderDesignHtml(selection, designExportBounds(selection)!, new Map(), 'Visible layers', 'html');
  const layers = new DOMParser().parseFromString(html, 'text/html').querySelectorAll('[data-layer]');
  expect(Array.from(layers, (layer) => layer.getAttribute('data-layer'))).toEqual(['First', 'Second']);
});

it('hands off an auto-layout search bar with fluid width, wrapping and intrinsic sizing', async () => {
  const draft = designDocumentCodec.parse({ schemaVersion: 4, documentId: 'search', rootIds: ['bar'], nodes: {
    bar: { kind: 'frame', name: 'Search bar', x: 0, y: 0, width: 360, height: 40, heightMode: 'hug', childIds: ['input', 'button'],
      layout: { direction: 'horizontal', align: 'start', padding: 0, gap: 16, wrap: true } },
    input: { kind: 'rectangle', name: 'Search input', x: 0, y: 0, width: 288, height: 32, widthMode: 'fill', minWidth: 240, maxWidth: 420, cornerRadius: 0 },
    button: { kind: 'frame', name: 'Submit', x: 0, y: 0, width: 56, height: 32, widthMode: 'hug', childIds: ['caption'],
      layout: { direction: 'horizontal', align: 'center', padding: 0, gap: 0 } },
    caption: { kind: 'text', x: 0, y: 0, width: 56, fontSize: 14, text: 'Search', widthMode: 'hug' },
  } });
  const yoga = await loadYoga();
  const layout = (width: number) => {
    const document = applyDesignEdits(draft, [{ kind: 'update', nodeId: 'bar', node: { ...draft.nodes.bar, width } }]);
    return { document, scene: resolveDesignScene(yoga, document, () => ({ width: 56, height: 18 })), ids: ['bar'] };
  };
  const original = layout(360);
  expect(original.scene.input.width).toBe(288);
  expect(layout(480).scene.input.width).toBe(408);
  expect(layout(600).scene.input.width).toBe(420);
  const wrapped = layout(260);
  expect(wrapped.scene.button.y).toBe(48);
  const insert = applyDesignEdits(wrapped.document, [{ kind: 'insert', nodeId: 'token', parentId: null,
    node: { kind: 'rectangle', x: 320, y: 0, width: 16, height: 16, cornerRadius: 2 } }]);
  const insertedScene = resolveDesignScene(yoga, insert, () => ({ width: 56, height: 18 }));
  const drop = dropDesignLayer(insert, insertedScene, 'token', { parentId: 'bar', beforeId: null, center: { x: 10, y: 60 } });
  expect(applyDesignEdits(insert, drop).nodes.bar).toMatchObject({ childIds: ['input', 'token', 'button'] });
  for (const format of ['html', 'html-tailwind'] as const) {
    const markup = renderDesignHtml(original, designExportBounds(original)!, new Map(), 'Search bar', format);
    const html = new DOMParser().parseFromString(markup, 'text/html');
    const style = (name: string) => html.querySelector<HTMLElement>(`[data-layer="${name}"]`)?.style;
    expect(style('Search bar')?.width).toBe('100%');
    expect(style('Search bar')?.height).toBe('auto');
    expect(style('Search bar')?.flexWrap).toBe('wrap');
    expect(style('Submit')?.width).toBe('max-content');
    expect(style('Search input')?.flexGrow).toBe('1');
    expect(style('Search input')?.flexBasis).toBe('0px');
    expect(style('Search input')?.minWidth).toBe('240px');
    expect(style('Search input')?.maxWidth).toBe('420px');
  }
});

it('resizes each editable SVG layer and exports only the converted geometry', async () => {
  const markup = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="2 3 32 20" onload="recordLoad()">'
    + '<title>Badge</title><script>recordLoad()</script>'
    + '<foreignObject><div xmlns="http://www.w3.org/1999/xhtml">foreign content</div></foreignObject>'
    + '<g transform="translate(4 3)" fill="#6c5da1"><rect id="base" width="20" height="12" rx="2"/>'
    + '<path id="trim" d="M2 4h16" style="fill:none;stroke:#134;stroke-width:2;stroke-dasharray:3 2"/></g></svg>';
  const asset = await readDesignSvg({ markup });
  const canvasProbe = vi.spyOn(Util, 'isCanvasFarblingActive').mockReturnValue(false);
  const { id, edits } = (() => {
    try { return insertDesignSvg(asset, null, { x: 16, y: 10 }, undefined, 'SVG'); }
    finally { canvasProbe.mockRestore(); }
  })();
  const source = designDocumentCodec.parse({ schemaVersion: 4, documentId: 'svg', rootIds: [], nodes: {} });
  const document = designDocumentCodec.parse(JSON.parse(JSON.stringify(applyDesignEdits(source, edits))));
  const group = document.nodes[id];
  if (group.kind !== 'frame') throw new Error('Expected separately editable SVG paths.');
  expect(group.name).toBe('Badge');
  expect(group.childIds.map((child) => document.nodes[child])).toMatchObject([
    { kind: 'vector', name: 'base', fills: [{ color: '#6c5da1' }] },
    { kind: 'vector', name: 'trim', fills: [], strokes: [{ color: '#113344', width: 2 }] },
  ]);
  const yoga = await loadYoga();
  const measure = () => ({ width: 1, height: 1 });
  const scene = resolveDesignScene(yoga, document, measure);
  const box = scene[id];
  const expanded = transformDesignLayer(document, scene, id, { x: box.x, y: box.y, width: box.width * 2 });
  if (!expanded) throw new Error('Expected a resized group.');
  const resized = applyDesignEdits(document, planDesignLayerUpdate(document, id, expanded, { projected: document, scene }));
  const resizedScene = resolveDesignScene(yoga, resized, measure);
  for (const childId of group.childIds) {
    expect(resizedScene[childId].x).toBeCloseTo(scene[childId].x * 2);
    expect(resizedScene[childId].width).toBeCloseTo(scene[childId].width * 2);
    expect(resizedScene[childId].height).toBeCloseTo(scene[childId].height);
  }
  const selection = { document: resized, scene: resizedScene, ids: [id] };
  const bounds = designExportBounds(selection);
  if (!bounds) throw new Error('Expected visible SVG bounds.');
  const html = new DOMParser().parseFromString(renderDesignHtml(selection, bounds, new Map(), 'Badge', 'html'), 'text/html');
  expect(html.querySelector('script, foreignObject, [onload]')).toBeNull();
  const path = html.querySelector('[data-layer="trim"] path');
  expect(path?.getAttribute('transform')).toBe('matrix(1 0 0 1 4 3)');
  expect(path?.getAttribute('stroke-dasharray')).toBe('3 2');
});

it('preserves an imported arrow-shaped SVG when reopening a v5 draft', async () => {
  const data = 'M80 6.6 L0 6.6 M12 13.2 L0 6.6 L12 0';
  const asset = await readDesignSvg({ markup: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 80 13.2">'
    + `<path d="${data}" fill="none" stroke="#000000" stroke-width="2" stroke-linecap="round"/></svg>` });
  const { id, edits } = insertDesignSvg(asset, null, { x: 0, y: 0 }, undefined, 'Imported');
  const empty = designDocumentCodec.parse({ schemaVersion: 5, documentId: 'imported-svg', rootIds: [], nodes: {} });
  const saved = applyDesignEdits(empty, edits);

  const reopened = designDocumentCodec.parse({ ...saved, schemaVersion: 5 });
  expect(reopened.nodes[id]).toMatchObject({ geometry: { kind: 'svg', viewBox: asset.viewBox, paths: [{ data, lineCap: 'round' }] } });
});

it('round-trips vector geometry and exports open Bézier paths, polygons and icons as SVG', async () => {
  const layer = { kind: 'vector', x: 0, y: 0, width: 40, height: 20, fills: [], stroke: { color: '#335588', width: 2 } };
  const input = { schemaVersion: 4, documentId: 'vectors', rootIds: ['curve', 'poly', 'icon'], nodes: {
    curve: { ...layer, name: 'Curve', geometry: { kind: 'path', closed: false, anchors: [
      { x: 0, y: 0, outgoing: { x: 0.25, y: 0.5 } }, { x: 1, y: 1, incoming: { x: 0.75, y: 0.5 } },
    ] } },
    poly: { ...layer, name: 'Polygon', geometry: { kind: 'polygon', sides: 5 } },
    icon: { ...layer, name: 'Heart', geometry: { kind: 'icon', icon: 'heart' } },
  } };
  const document = designDocumentCodec.parse(input);
  expect(designDocumentCodec.parse(JSON.parse(JSON.stringify(document)))).toEqual(document);
  expect(() => designDocumentCodec.parse({ ...input, nodes: { ...input.nodes, poly: { ...input.nodes.poly,
    geometry: { kind: 'polygon', sides: 2 } } } })).toThrow('Invalid design vector geometry');
  const scene = resolveDesignScene(await loadYoga(), document, () => ({ width: 1, height: 1 }));
  const selection = { document, scene, ids: document.rootIds };
  const bounds = designExportBounds(selection)!;
  for (const format of ['html', 'html-tailwind'] as const) {
    const html = new DOMParser().parseFromString(renderDesignHtml(selection, bounds, new Map(), 'Vectors', format), 'text/html');
    expect(html.querySelector('svg[data-layer="Curve"] path')?.getAttribute('d')).toBe('M0 0 C10 10 30 10 40 20');
    const polygonPath = html.querySelector('svg[data-layer="Polygon"] path');
    expect(polygonPath?.getAttribute('stroke-linejoin')).toBe('round');
    const polygon = polygonPath?.getAttribute('d');
    expect(polygon?.match(/L/g)).toHaveLength(4);
    expect(polygon?.endsWith('Z')).toBe(true);
    const icon = html.querySelector('svg[data-layer="Heart"]');
    expect(icon?.getAttribute('viewBox')).toBe('0 0 24 24');
    expect(icon?.querySelector('path')?.getAttribute('d')).toMatch(/^M.*Z$/);
  }
});

it('includes the thick arrowhead outside its shaft bounds in the exported drawing', async () => {
  const document = designDocumentCodec.parse({ schemaVersion: designDocumentVersion, documentId: 'arrow-export', rootIds: ['arrow'], nodes: {
    arrow: { kind: 'vector', x: 0, y: 0, width: 110, height: 1, strokes: [{ color: '#000000', width: 12 }],
      geometry: { kind: 'path', endMarker: 'arrow', closed: false, anchors: [{ x: 0, y: 0 }, { x: 1, y: 0 }] } },
  } });
  const scene = resolveDesignScene(await loadYoga(), document, () => ({ width: 1, height: 1 }));
  const selection = { document, scene, ids: document.rootIds };
  const bounds = designExportBounds(selection)!;
  const file = new DOMParser().parseFromString(renderDesignSvg(selection, bounds, new Map(), 'Arrow'), 'image/svg+xml');
  const path = file.querySelector('path')!;
  const points = [...(path.getAttribute('d') ?? '').matchAll(/[ML](-?[\d.]+) (-?[\d.]+)/gu)].map(([, x, y]) => ({ x: Number(x), y: Number(y) }));
  expect(points).toHaveLength(5);
  const vertical = points.map(({ y }) => y);
  expect(Math.max(...vertical) - Math.min(...vertical)).toBeGreaterThan(12);
  expect(bounds.y).toBeLessThanOrEqual(Math.min(...vertical) - 6);
  expect(bounds.y + bounds.height).toBeGreaterThanOrEqual(Math.max(...vertical) + 6);
});

it('keeps an image fill and ordered visible outlines in the generated files', async () => {
  const design = designDocumentCodec.parse({ schemaVersion: 5, documentId: 'paints', rootIds: ['card'], nodes: {
    card: { name: 'Card', kind: 'rectangle', x: 0, y: 0, width: 80, height: 50, cornerRadius: 4,
      fills: [{ color: '#ffffff' }, { color: '#ffffff', image: { assetPath: 'design-assets/paper.png', fit: 'contain' }, opacity: 0.4, blendMode: 'multiply' }],
      strokes: [{ color: '#361254', width: 8, alignment: 'outside' }, { color: '#2b779a', width: 3, alignment: 'inside' },
        { color: '#df527c', width: 100, hidden: true }, { color: '#111111', width: 200, opacity: 0 }],
    },
  } });
  const selection = { document: design, scene: resolveDesignScene(await loadYoga(), design, () => ({ width: 1, height: 1 })), ids: design.rootIds };
  const bounds = designExportBounds(selection)!;
  expect(bounds).toEqual({ x: -8, y: -8, width: 96, height: 66 });
  const raster = document.createElement('img');
  raster.src = 'data:image/png;base64,cGFwZXI=';
  const images = await loadExportImages(selection, async (asset, options) => {
    expect(asset).toBe('design-assets/paper.png');
    expect(options?.fresh).toBe(true);
    return raster;
  });
  const svg = new DOMParser().parseFromString(renderDesignSvg(selection, bounds, images, 'Card'), 'image/svg+xml');
  expect(svg.querySelector('pattern image')?.getAttribute('href')).toBe(raster.src);
  expect(svg.querySelector('path[style="mix-blend-mode:multiply"]')?.getAttribute('fill-opacity')).toBe('0.4');
  expect(Array.from(svg.querySelectorAll('path[stroke]'), (path) => [path.getAttribute('stroke'), path.getAttribute('stroke-width')]))
    .toEqual([['#361254', '16'], ['#2b779a', '6']]);
  const html = renderDesignHtml(selection, bounds, images, 'Card', 'html');
  expect(html).toContain(raster.src);
  expect(html).toContain('mix-blend-mode:multiply');
  expect(html).not.toContain('#df527c');
});

it('exports gradient and image outlines with the referenced image, clip and blend mode', async () => {
  const assetPath = 'design-assets/outline.png';
  const design = designDocumentCodec.parse({ schemaVersion: designDocumentVersion, documentId: 'outlines', rootIds: ['frame'], nodes: {
    frame: { kind: 'frame', name: 'Frame', x: 0, y: 0, width: 80, height: 50, cornerRadius: 6, childIds: ['tile'],
      clip: true, strokes: [
        { color: '#556677', width: 8, alignment: 'outside', opacity: 0.5,
          gradient: { kind: 'linear', axis: { start: { x: 0.2, y: 0.25 }, end: { x: 0.8, y: 0.75 } },
            stops: [{ offset: 0, color: '#55667780' }, { offset: 1, color: '#112233' }] } },
        { color: '#000000', width: 3, alignment: 'inside', image: { assetPath, fit: 'stretch' }, blendMode: 'screen' },
      ] },
    tile: { name: 'Tile', kind: 'rectangle', x: 2, y: 3, width: 25, height: 30, cornerRadius: 0 },
  } });
  const selection = { document: design, scene: resolveDesignScene(await loadYoga(), design, () => ({ width: 1, height: 1 })), ids: design.rootIds };
  const bounds = designExportBounds(selection)!;
  const raster = document.createElement('img');
  raster.src = 'data:image/png;base64,b3V0bGluZQ==';
  const load = vi.fn().mockResolvedValue(raster);
  const images = await loadExportImages(selection, load);
  expect(load).toHaveBeenCalledExactlyOnceWith(assetPath, { fresh: true });

  const svg = new DOMParser().parseFromString(renderDesignSvg(selection, bounds, images, 'Frame'), 'image/svg+xml');
  function definitionFor(value: string | null | undefined) {
    const id = value?.match(/^url\(#([^\s)]+)\)$/u)?.[1];
    return id ? svg.getElementById(id) : null;
  }
  const [gradient, pattern] = svg.querySelectorAll('[data-layer="Frame"] path[stroke]');
  const mask = definitionFor(gradient.parentElement?.getAttribute('mask'));
  expect(mask?.localName).toBe('mask');
  expect(mask?.querySelector('path')?.getAttribute('d')).toMatch(/^\s*[Mm]/u);
  const gradientDefinition = definitionFor(gradient.getAttribute('stroke'));
  const points = ['x1', 'y1', 'x2', 'y2'].map((axis) => Number(gradientDefinition?.getAttribute(axis)));
  expect(points).toEqual([11.2, 8.5, 68.8, 41.5]);
  expect(gradientDefinition?.querySelector('stop')?.getAttribute('stop-opacity')).toBe('0.251');
  const clip = definitionFor(pattern.parentElement?.getAttribute('clip-path'));
  expect(clip?.localName).toBe('clipPath');
  expect(clip?.querySelector('path')?.getAttribute('d')).toMatch(/^\s*[Mm]/u);
  expect(pattern.parentElement?.getAttribute('style')).toBe('mix-blend-mode:screen');
  expect(definitionFor(pattern.getAttribute('stroke'))?.querySelector('image')?.getAttribute('href')).toBe(raster.src);

  for (const format of ['html', 'html-tailwind'] as const) {
    const html = new DOMParser().parseFromString(renderDesignHtml(selection, bounds, images, 'Frame', format), 'text/html');
    const frame = html.querySelector<HTMLElement>('[data-layer="Frame"]')!;
    expect(frame.style.overflow).not.toBe('hidden');
    expect(frame.querySelector('svg[style*="mix-blend-mode:screen"] path')?.getAttribute('stroke')).toMatch(/^url\(#/u);
    expect(html.querySelector('pattern image')?.getAttribute('href')).toBe(raster.src);
  }
});
