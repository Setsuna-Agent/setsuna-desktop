import { expect, it } from 'vitest';
import { loadYoga } from 'yoga-layout/load';
import { applyDesignEdits } from '../../src/contracts/apply-design-edits.js';
import { designDocumentCodec } from '../../src/contracts/index.js';
import { planDesignLayerUpdate, transformDesignLayer } from '../../src/renderer/design-canvas-edits.js';
import { resolveDesignScene } from '../../src/renderer/design-layout.js';

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
  const updated = applyDesignEdits(document, planDesignLayerUpdate(document, 'group', resized, scene.group));
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
    saved = JSON.stringify(applyDesignEdits(document, planDesignLayerUpdate(document, 'group', resized, scene.group)));
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
