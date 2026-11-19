// @vitest-environment happy-dom
import paper from 'paper';
import { expect, it } from 'vitest';
import { loadYoga } from 'yoga-layout/load';
import { applyDesignEdits } from '../../src/contracts/apply-design-edits.js';
import { designDocumentCodec } from '../../src/contracts/index.js';
import { designFrameMask } from '../../src/contracts/design-references.js';
import { copyDesignBranches, parseDesignClipboard, pasteDesignBranches } from '../../src/renderer/context/design-layer-clipboard.js';
import { groupDesignLayers } from '../../src/renderer/design-canvas-edits.js';
import { resolveDesignScene } from '../../src/renderer/design-layout.js';
import { designExportBounds } from '../../src/renderer/export/design-export-scene.js';
import { renderDesignSvg } from '../../src/renderer/export/export-design-svg.js';
import { combineDesignPaths } from '../../src/renderer/vectors/design-path-boolean.js';

it('unites overlapping paths and keeps holes created by subtraction in standalone SVG', async () => {
  const rectangle = { kind: 'rectangle', x: 0, y: 0, width: 50, height: 40, cornerRadius: 0, fills: [{ color: '#004488' }] };
  const document = designDocumentCodec.parse({ schemaVersion: 4, documentId: 'boolean', rootIds: ['base', 'insert'], nodes: {
    base: { ...rectangle, name: 'Base' }, insert: { ...rectangle, x: 15, y: 10, width: 20, height: 20 },
  } });
  const yoga = await loadYoga();
  const scene = resolveDesignScene(yoga, document, () => ({ width: 1, height: 1 }));
  const united = await combineDesignPaths(document, scene, document.rootIds, 'union', 'Union');
  const merged = applyDesignEdits(document, united.edits);
  expect(merged.rootIds).toEqual([united.id]);
  expect(merged.nodes[united.id!]).toMatchObject({ width: 50, height: 40, geometry: { kind: 'path', closed: true } });

  const subtracted = await combineDesignPaths(document, scene, document.rootIds, 'subtract', 'Cutout');
  const result = designDocumentCodec.parse(JSON.parse(JSON.stringify(applyDesignEdits(document, subtracted.edits))));
  const selection = { document: result, scene: resolveDesignScene(yoga, result, () => ({ width: 1, height: 1 })), ids: result.rootIds };
  const xml = renderDesignSvg(selection, designExportBounds(selection)!, new Map(), 'Cutout');
  const svg = new DOMParser().parseFromString(xml, 'image/svg+xml');
  const path = svg.querySelector('[data-layer="Cutout"] path');
  const scope = new paper.PaperScope();
  scope.setup(new scope.Size(1, 1));
  try {
    const contour = scope.PathItem.create(path?.getAttribute('d') ?? '');
    expect(contour.contains(new scope.Point(4, 4))).toBe(true);
    expect(contour.contains(new scope.Point(25, 20))).toBe(false);
    expect(Math.abs(contour.area)).toBeCloseTo(1600);
    expect(path?.getAttribute('fill')).toBe('rgba(0, 68, 136, 1)');
  } finally { scope.remove(); }
});

it('keeps a shape mask and its gradient content linked after paste and SVG export', async () => {
  const document = designDocumentCodec.parse({ schemaVersion: 4, documentId: 'mask', rootIds: ['art', 'outline'], nodes: {
    art: { kind: 'rectangle', name: 'Artwork', x: 0, y: 0, width: 70, height: 50, cornerRadius: 0, fills: [
      { color: '#363749' },
      { color: '#ff0000', opacity: 0.5, gradient: { kind: 'linear', angle: 90, stops: [
        { color: '#ff0000', offset: 0 }, { color: '#0000ff', offset: 1 },
      ] } },
    ] },
    outline: { kind: 'ellipse', name: 'Mask outline', x: 10, y: 10, width: 48, height: 30 },
  } });
  const yoga = await loadYoga();
  const sceneFor = (doc: typeof document) => resolveDesignScene(yoga, doc, () => ({ width: 1, height: 1 }));
  const { id, edits } = groupDesignLayers(document, sceneFor(document), document.rootIds, 'Masked art', { group: true, maskId: 'outline' });
  const masked = applyDesignEdits(document, edits);
  const ref = { projectId: 'project', path: 'one.design.json' };
  const copied = parseDesignClipboard(copyDesignBranches(ref, masked, sceneFor(masked), [id], { x: 0, y: 0 }));
  const paste = pasteDesignBranches(copied, document, ref, { parentId: null, beforeId: null, origin: { x: 100, y: 60 } });
  const reopened = designDocumentCodec.parse(JSON.parse(JSON.stringify(applyDesignEdits(document, paste.edits))));
  const frame = reopened.nodes[paste.ids[0]];
  if (frame.kind !== 'frame') throw new Error('Expected a pasted mask group.');
  expect(designFrameMask(reopened, frame)).toMatchObject({ node: { kind: 'ellipse', name: 'Mask outline' } });
  const selection = { document: reopened, scene: sceneFor(reopened), ids: paste.ids };
  const svg = new DOMParser().parseFromString(renderDesignSvg(selection, designExportBounds(selection)!, new Map(), 'Masked art'), 'image/svg+xml');
  const clip = svg.querySelector('clipPath');
  expect(clip?.querySelector('path')?.getAttribute('d')).toMatch(/A24 15/u);
  expect(svg.querySelector(`[clip-path="url(#${clip?.id})"] [data-layer="Artwork"]`)).not.toBeNull();
  expect(svg.querySelector('[data-layer="Mask outline"]')).toBeNull();
  expect(Array.from(svg.querySelectorAll('linearGradient stop'), (stop) =>
    [stop.getAttribute('offset'), stop.getAttribute('stop-color'), stop.getAttribute('stop-opacity')]))
    .toEqual([['0', '#ff0000', '0.5'], ['1', '#0000ff', '0.5']]);
});
