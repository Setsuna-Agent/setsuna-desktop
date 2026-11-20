import { expect, it } from 'vitest';
import { loadYoga } from 'yoga-layout/load';
import { applyDesignEdits } from '../../src/contracts/apply-design-edits.js';
import { designDocumentCodec, designDocumentVersion } from '../../src/contracts/index.js';
import { projectDesignComponents } from '../../src/renderer/components/design-components.js';
import { planDesignLayerUpdate, transformDesignLayer } from '../../src/renderer/design-canvas-edits.js';
import { resolveDesignScene } from '../../src/renderer/design-layout.js';

it('scales child positions and widths from the current board mode', async () => {
  const document = designDocumentCodec.parse({
    schemaVersion: designDocumentVersion, documentId: 'draft', rootIds: ['board'],
    variableCollections: { default: { modes: { wide: 'Wide' } } },
    styles: {
      offset: { kind: 'number', name: 'Offset', value: 50, modeValues: { wide: 25 } },
      width: { kind: 'number', name: 'Width', value: 30, modeValues: { wide: 45 } },
      minimum: { kind: 'number', name: 'Minimum width', value: 20, modeValues: { wide: 0 } },
      baseline: { kind: 'number', name: 'Baseline', value: 7 },
    },
    nodes: {
      board: { kind: 'frame', x: 0, y: 0, width: 400, height: 100, childIds: ['group'], variableModeIds: { draft: 'wide' } },
      group: { kind: 'frame', group: true, x: 0, y: 0, width: 100, height: 50, childIds: ['tile'] },
      tile: { kind: 'rectangle', x: 50, y: 2, width: 30, minWidth: 20, maxWidth: 50, height: 20, cornerRadius: 0,
        variableIds: { x: 'offset', y: 'baseline', width: 'width', minWidth: 'minimum' } },
    },
  });
  const yoga = await loadYoga();
  const measure = () => ({ width: 1, height: 1 });
  const projected = projectDesignComponents(document);
  const scene = resolveDesignScene(yoga, projected, measure);
  expect(scene.tile).toMatchObject({ x: 25, y: 7, width: 45 });
  const update = transformDesignLayer(document, scene, 'group', { x: 0, y: 0, width: 200 }, projected);
  if (!update) throw new Error('Expected a group resize.');
  const resized = applyDesignEdits(document, planDesignLayerUpdate(document, 'group', update, { projected, scene }));
  expect(resized.nodes.tile).toMatchObject({ x: 50, y: 2, width: 90, maxWidth: 100, variableIds: { y: 'baseline', minWidth: 'minimum' } });
  expect(resolveDesignScene(yoga, projectDesignComponents(resized), measure).tile).toMatchObject({ x: 50, y: 7, width: 90 });

  const smaller = transformDesignLayer(document, scene, 'group', { x: 0, y: 0, width: 20 }, projected);
  if (!smaller) throw new Error('Expected a group resize.');
  const shrunk = applyDesignEdits(document, planDesignLayerUpdate(document, 'group', smaller, { projected, scene }));
  expect(designDocumentCodec.parse(shrunk).nodes.tile).toMatchObject({ x: 5, width: 9, minWidth: 0, maxWidth: 10, variableIds: { y: 'baseline' } });
});

it('scales nested flow spacing from the active board mode and keeps bindings on unchanged axes', async () => {
  const tile = { kind: 'rectangle', x: 0, y: 0, width: 20, height: 10, cornerRadius: 0 };
  const document = designDocumentCodec.parse({
    schemaVersion: designDocumentVersion, documentId: 'draft', rootIds: ['board'],
    variableCollections: { default: { modes: { wide: 'Wide' } } },
    styles: {
      gutter: { kind: 'number', name: 'Gutter', value: 10, modeValues: { wide: 25 } },
      horizontal: { kind: 'number', name: 'Horizontal padding', value: 12, modeValues: { wide: 6 } },
      vertical: { kind: 'number', name: 'Vertical padding', value: 1, modeValues: { wide: 8 } },
    },
    nodes: {
      board: { kind: 'frame', x: 0, y: 0, width: 400, height: 100, childIds: ['group'], variableModeIds: { draft: 'wide' } },
      group: { kind: 'frame', group: true, x: 0, y: 0, width: 100, height: 50, childIds: ['row'] },
      row: { kind: 'frame', x: 0, y: 0, width: 100, height: 50, childIds: ['left', 'right'], layout: {
        direction: 'horizontal', gap: 10, padding: 0, paddingX: 12, paddingY: 1, align: 'start',
        variableIds: { gap: 'gutter', paddingX: 'horizontal', paddingY: 'vertical' },
      } },
      left: tile, right: tile,
    },
  });
  const yoga = await loadYoga();
  const measure = () => ({ width: 1, height: 1 });
  const projected = projectDesignComponents(document);
  const scene = resolveDesignScene(yoga, projected, measure);
  expect(scene.left).toMatchObject({ x: 6, y: 8 });
  expect(scene.right.x - scene.left.x - scene.left.width).toBe(25);
  const update = transformDesignLayer(document, scene, 'group', { x: 0, y: 0, width: 200 }, projected);
  if (!update) throw new Error('Expected a group resize.');
  const resized = applyDesignEdits(document, planDesignLayerUpdate(document, 'group', update, { projected, scene }));
  const next = resolveDesignScene(yoga, projectDesignComponents(resized), measure);
  expect(next.left).toMatchObject({ x: 12, y: 8, width: 40 });
  expect(next.right.x - next.left.x - next.left.width).toBe(50);
  expect(resized.nodes.row).toMatchObject({ layout: { gap: 50, paddingX: 12, variableIds: { paddingY: 'vertical' } } });
});

it('stretches rotated children and nested content along the group axes', async () => {
  const rectangle = { kind: 'rectangle', cornerRadius: 0 };
  const document = designDocumentCodec.parse({
    schemaVersion: 4, documentId: 'rotated-group', rootIds: ['group'], nodes: {
      group: { kind: 'frame', group: true, x: 100, y: 50, width: 45, height: 20, childIds: ['turned', 'nested', 'plain'] },
      turned: { ...rectangle, x: -5, y: 5, width: 20, height: 10, rotation: 90 },
      nested: { kind: 'frame', x: 10, y: 5, width: 20, height: 10, rotation: 90, flipX: true, childIds: ['inside'] },
      inside: { ...rectangle, x: 4, y: 2, width: 8, height: 4 },
      plain: { ...rectangle, x: 25, y: 0, width: 20, height: 20 },
    },
  });
  const yoga = await loadYoga();
  const measure = () => ({ width: 1, height: 1 });
  const scene = resolveDesignScene(yoga, document, measure);
  const resized = transformDesignLayer(document, scene, 'group', { x: 100, y: 50, width: 90, height: 20 });
  if (!resized) throw new Error('Expected a group resize.');
  const updated = applyDesignEdits(document, planDesignLayerUpdate(document, 'group', resized, { projected: document, scene }));
  const next = resolveDesignScene(yoga, updated, measure);
  for (const [id, [x, y, width, height]] of Object.entries({
    turned: [100, 50, 20, 20], inside: [138, 58, 8, 8], plain: [150, 50, 40, 20],
  })) {
    expect(next[id].paintBounds.x).toBeCloseTo(x);
    expect(next[id].paintBounds.y).toBeCloseTo(y);
    expect(next[id].paintBounds.width).toBeCloseTo(width);
    expect(next[id].paintBounds.height).toBeCloseTo(height);
  }
});

it('restores an oblique layer after repeated saved group resizes', async () => {
  const rectangle = { kind: 'rectangle', x: 18, y: 23, width: 20, height: 10, rotation: 45, cornerRadius: 0 };
  const source = designDocumentCodec.parse({
    schemaVersion: 4, documentId: 'resize-round-trip', rootIds: ['group'], nodes: {
      group: { kind: 'frame', group: true, x: 0, y: 0, width: 100, height: 80, childIds: ['rectangle'] },
      rectangle,
    },
  });
  const yoga = await loadYoga();
  const measure = () => ({ width: 1, height: 1 });
  let saved = JSON.stringify(source);

  function resize(width: number, height: number) {
    const document = designDocumentCodec.parse(JSON.parse(saved));
    const scene = resolveDesignScene(yoga, document, measure);
    const resized = transformDesignLayer(document, scene, 'group', { x: 0, y: 0, width, height });
    if (!resized) throw new Error('Expected a group resize.');
    saved = JSON.stringify(applyDesignEdits(document, planDesignLayerUpdate(document, 'group', resized, { projected: document, scene })));
    return designDocumentCodec.parse(JSON.parse(saved)).nodes.rectangle;
  }

  for (const [width, height] of [[200, 80], [200, 80], [213.47, 120.8]]) {
    expect(resize(width, height).width).toBeGreaterThan(rectangle.width);
    const restored = resize(100, 80);
    if (restored.kind !== 'rectangle') throw new Error('Expected a rectangle.');
    for (const key of ['x', 'y', 'width', 'height'] as const) {
      expect(restored[key]).toBeCloseTo(rectangle[key], 10);
    }
  }
});
